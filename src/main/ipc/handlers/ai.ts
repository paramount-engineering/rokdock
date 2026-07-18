/**
 * IPC handlers for the AI subsystem. Profile CRUD and the redaction preview are
 * request/response. Streaming is a start/cancel pair plus chunk/done/error pushes
 * back to the requesting window, keyed by a session id so multiple windows can stream
 * independently. The wire carries only deltas, a final result, and friendly errors.
 * No adapter/profile/model detail leaks to the renderer.
 */
import { ipcMain } from 'electron'
import type { WebContents } from 'electron'
import type { IpcContext } from '../types'
import type { AiProfileInput, AiRequest, DocSource, CliOverride, AiUiRequest, AiUiResponse } from '../../../shared/ai/types'
import type { CliKind } from '../../../ai-core/types'
import { createDocSymbolIndex } from '../../services/ai/docsSymbols'

interface StreamSession {
    controller: AbortController
}

/** Bound on remembered "allow device control for this chat" grants, so the set cannot grow
 *  without limit across a long app session with many conversations. */
const MAX_DEVICE_GRANTS = 100

/** Map de-duped fetched page paths to {path,title} using the docs page-label map. */
export function resolveSources(paths: string[], labels: Array<[string, string]>): DocSource[] {
    const titleByPath = new Map(labels)
    const seen = new Set<string>()
    const out: DocSource[] = []
    for (const path of paths) {
        if (seen.has(path)) continue
        seen.add(path)
        out.push({ path, title: titleByPath.get(path) ?? path })
    }
    return out
}

export function registerAiHandlers(context: IpcContext): void {
    const sessions = new Map<string, StreamSession>()
    // Conversations the user has granted "allow device control for this chat". A grant
    // suppresses the confirm prompt for the rest of that conversation's state-changing tools.
    const deviceControlGrants = new Set<string>()
    // In-flight renderer prompts (confirm / choice) awaiting the user's reply, keyed by requestId.
    const pendingUi = new Map<string, (response: AiUiResponse) => void>()
    ipcMain.on('ai:ui-response', (_event, response: AiUiResponse) => {
        pendingUi.get(response.requestId)?.(response)
    })
    const docSymbols = createDocSymbolIndex(() => context.docs.listPageLabels())
    ipcMain.handle('ai:get-doc-symbols', () => docSymbols.get())
    // The renderer pushes the currently-selected remote device so device-control tools have a
    // default target. Kept in the shared context ref the device provider reads.
    ipcMain.handle('ai:set-active-device', (_event, ip: string | null) => { context.setActiveDeviceIp(ip) })

    ipcMain.handle('ai:list-profiles', () => context.ai.listProfiles())
    ipcMain.handle('ai:save-profile', (_event, input: AiProfileInput) => context.ai.saveProfile(input))
    ipcMain.handle('ai:delete-profile', (_event, id: string) => { context.ai.deleteProfile(id) })
    ipcMain.handle('ai:get-active', () => context.ai.getActiveId())
    ipcMain.handle('ai:set-active', (_event, id: string | null) => context.ai.setActiveId(id))
    ipcMain.handle('ai:test-connection', (_event, profileId?: string) => context.ai.testConnection(profileId))
    ipcMain.handle('ai:preview-redaction', (_event, request: AiRequest, profileId?: string) => context.ai.previewRedaction(request, profileId))
    ipcMain.handle('ai:get-cli-overrides', () => context.ai.getCliOverrides())
    ipcMain.handle('ai:set-cli-override', (_event, kind: CliKind, override: CliOverride) => context.ai.setCliOverride(kind, override))
    ipcMain.handle('ai:refresh-cli-detection', () => context.ai.refreshCliDetection())

    ipcMain.handle('ai:start-stream', (event, request: AiRequest, conversationId?: string) => {
        const sessionId = crypto.randomUUID()
        const controller = new AbortController()
        sessions.set(sessionId, { controller })
        // Abort and drop only THIS session if its requesting window goes away mid-stream.
        // Scoped to event.sender, so closing one window never aborts another window's stream,
        // and it also covers windows opened after handler registration.
        const sender = event.sender
        const onDestroyed = (): void => {
            controller.abort()
            sessions.delete(sessionId)
            // Evict the CLI session for this conversation so the next window start is fresh.
            if (conversationId) {
                context.ai.evictConversation(conversationId)
                deviceControlGrants.delete(conversationId)
            }
        }
        sender.once('destroyed', onDestroyed)
        void runStream(sender, sessionId, request, conversationId, controller, onDestroyed)
        return { sessionId }
    })

    ipcMain.on('ai:cancel-stream', (_event, sessionId: string) => {
        sessions.get(sessionId)?.controller.abort()
        sessions.delete(sessionId)
    })

    async function runStream(sender: WebContents, sessionId: string, request: AiRequest, conversationId: string | undefined, controller: AbortController, onDestroyed: () => void): Promise<void> {
        const send = (channel: string, payload: unknown): void => {
            if (!sender.isDestroyed()) sender.send(channel, payload)
        }
        // Tools that need the user drive a renderer prompt (a custom dialog) and await the reply.
        // Calls are serialized through uiChain so parallel tool calls (a CLI can issue several at
        // once) queue one prompt at a time instead of stacking dialogs on the window. Each pending
        // request also resolves (to a decline) if the stream aborts or the window closes.
        let uiSeq = 0
        let uiChain: Promise<unknown> = Promise.resolve()
        const requestUi = (build: (requestId: string) => AiUiRequest): Promise<AiUiResponse | null> => {
            const run = (): Promise<AiUiResponse | null> => new Promise(resolve => {
                if (sender.isDestroyed() || controller.signal.aborted) { resolve(null); return }
                const requestId = `${sessionId}:${uiSeq++}`
                const settle = (response: AiUiResponse | null): void => {
                    if (!pendingUi.delete(requestId)) return
                    controller.signal.removeEventListener('abort', onAbort)
                    resolve(response)
                }
                const onAbort = (): void => settle(null)
                pendingUi.set(requestId, settle)
                controller.signal.addEventListener('abort', onAbort, { once: true })
                send('ai:ui-request', build(requestId))
            })
            const result = uiChain.then(run)
            uiChain = result.catch(() => undefined)
            return result
        }
        // Device-control confirmations are on unless the user turned them off on the AI settings
        // tab (unset defaults to on). Read live so a mid-session toggle takes effect. The single
        // source for both the confirm() gate and the confirmationsEnabled flag below.
        const deviceControlConfirmEnabled = (): boolean => context.store.getPreferences().aiConfirmDeviceControl !== false
        // Gate for state-changing device tools. Read tools never call this. A per-conversation
        // "allow for this chat" grant skips the prompt for the rest of the conversation.
        const confirm = async (summary: string): Promise<boolean> => {
            if (!deviceControlConfirmEnabled()) return true
            if (conversationId && deviceControlGrants.has(conversationId)) return true
            const response = await requestUi(requestId => ({ requestId, kind: 'confirm', summary }))
            if (response?.kind !== 'confirm') return false
            if (response.choice === 'chat' && conversationId) {
                deviceControlGrants.add(conversationId)
                if (deviceControlGrants.size > MAX_DEVICE_GRANTS) deviceControlGrants.delete(deviceControlGrants.values().next().value as string)
            }
            return response.choice === 'once' || response.choice === 'chat'
        }
        // Let a tool offer the user a set of clickable choices; resolves the chosen option or null.
        const ask = async (question: string, options: string[]): Promise<string | null> => {
            const response = await requestUi(requestId => ({ requestId, kind: 'choice', question, options }))
            return response?.kind === 'choice' ? response.value : null
        }
        // Lets a tool skip an optional disambiguation prompt (like relaunch-or-leave) when
        // device-control confirmations are turned off.
        const confirmationsEnabled = deviceControlConfirmEnabled()
        try {
            let finalText = ''
            const fetchedPaths: string[] = []
            for await (const chunk of context.ai.stream(request, controller.signal, conversationId, { confirm, ask, confirmationsEnabled })) {
                if ('delta' in chunk) {
                    finalText += chunk.delta
                    send('ai:stream-chunk', { sessionId, delta: chunk.delta })
                } else {
                    const { name, args } = chunk.activity
                    // Only fetch_page calls count as sources: the model chose to read the full
                    // page content, so those pages are genuinely "used". A search_docs call
                    // produces a transient activity line but does not add a source entry because
                    // the model saw only a results list, not the page content itself.
                    if (name === 'fetch_page' && typeof args.path === 'string') fetchedPaths.push(args.path)
                    send('ai:stream-activity', { sessionId, name, args })
                }
            }
            const labels = fetchedPaths.length ? await context.docs.listPageLabels() : []
            send('ai:stream-done', { sessionId, finalText, sources: resolveSources(fetchedPaths, labels) })
        } catch (err) {
            // A user-initiated cancel (ai:cancel-stream) or a closed window aborts the signal.
            // That is a clean stop, not an error, so emit nothing further in that case.
            if (!controller.signal.aborted) {
                send('ai:stream-error', { sessionId, message: err instanceof Error ? err.message : String(err) })
            }
        } finally {
            sessions.delete(sessionId)
            if (!sender.isDestroyed()) sender.removeListener('destroyed', onDestroyed)
        }
    }
}
