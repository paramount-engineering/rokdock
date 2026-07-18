/**
 * RokDock-facing AI service. Picks the active profile, decrypts its key, gathers
 * Roku redaction secrets, and builds a portable core engine for it. Exposes a generic
 * stream (the agnostic seam every feature uses), a test connection, and an inspect-only
 * redaction preview. It knows about RokDock. The core it builds does not.
 *
 * Detected CLI providers: on first call to listProfiles(), the service probes the PATH
 * for recognized CLIs and merges them into the returned list as synthetic profiles with
 * ids of the form `cli:<kind>`. Per-CLI overrides (model, redaction, hidden) live in
 * aiProfileStore via the aiCliOverrides preference key. The detection result is cached
 * until refreshCliDetection() is called.
 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
    createAiEngine,
    cliAdapter, anthropicAdapter, geminiAdapter, openAiCompatibleAdapter,
    CLI_DEFINITIONS, isCliKind, redact,
} from '../../../ai-core'
import type { AiEngine } from '../../../ai-core'
import type { AiAdapter, AiEngineConfig, CliEngineConfig, AiRequest, AiStreamChunk, AiActivityChunk, ContextProvider, RedactSecrets, ToolDef, ToolResult, ToolCallContext } from '../../../ai-core/types'
import { buildToolRouting, dispatchTool } from '../../../ai-core/toolRouting'
import type { CliKind } from '../../../ai-core/types'
import type { AiProfile, AiProfileInput, AiTestResult, RedactionPreview, AiCliOverrides, CliOverride } from '../../../shared/ai/types'
import type { AiProfileStore } from './aiProfileStore'
import type { SsdpService } from '../ssdp'
import type { StoreService } from '../store'
import type { McpToolEndpoint } from './mcpToolEndpoint'
import type { CliMcp, CliSessionPlan } from '../../../ai-core/adapters/cliRegistry'
import { createMergedIterable } from '../../../ai-core/asyncMerge'
import { detectInstalledClis } from './cliDetect'
import { materializeCliPolicy } from './cliPolicy'
import { gatherRokuSecrets } from './rokuSecrets'
import { loadChatSystemPrompt } from './chatSystemPrompt'
import { resolveAugmentedPath } from './shellPath'
import { MCP_BRIDGE_PATH } from '../../utils/resourcePaths'

const TEST_PROMPT = 'Reply with the single word OK.'

const DEFAULT_ADAPTERS: Record<AiProfile['adapter'], AiAdapter> = {
    cli: cliAdapter,
    anthropic: anthropicAdapter,
    gemini: geminiAdapter,
    'openai-compatible': openAiCompatibleAdapter,
}

interface AiServiceDeps {
    createEngine?: (config: AiEngineConfig) => AiEngine
    adapters?: Record<AiProfile['adapter'], AiAdapter>
    /** Resolve the env (augmented PATH) for CLI subprocesses. Injectable so unit tests do not spawn a shell. */
    resolveEnv?: () => Promise<Record<string, string>>
    /** Context providers attached only on the chat stream path (built at the composition root). */
    contextProviders?: ContextProvider[]
    /** The baked-in chat system prompt; defaults to the packaged asset. */
    chatSystemPrompt?: string
    /** Probe installed CLIs. Injectable so tests do not touch the real PATH. */
    detectClis?: (pathEnv: string) => Promise<CliKind[]>
    /** Directory where CLI policy files are materialized (userData in production). */
    policyDir?: string
    /**
     * The MCP tool endpoint. When provided and the active CLI supports MCP and tools are
     * present, the single-spawn native-MCP path is used instead of the text-protocol loop.
     */
    mcpEndpoint?: McpToolEndpoint
    /** Mint a bearer token for an MCP session. Defaults to globalThis.crypto.randomUUID. */
    tokenSource?: () => string
    /**
     * Directory where per-request MCP config JSON files are written. Defaults to a
     * subdirectory of the OS temp dir named after the process (created on first use).
     */
    mcpConfigDir?: string
    /** Absolute path to the bundled MCP bridge script. Defaults to MCP_BRIDGE_PATH. */
    bridgePath?: string
}

/** Tracks an active CLI session for a conversation so subsequent turns can resume it. */
interface ConversationSession {
    cliKind: CliKind
    model: string
    handle: string
    deliveredCount: number
    /** Stable per-conversation dir for CLIs that require a fixed cwd across turns (gemini). Undefined for per-request-dir CLIs. */
    dir?: string
}

export class AiService {
    private createEngine: NonNullable<AiServiceDeps['createEngine']>
    private adapters: Record<AiProfile['adapter'], AiAdapter>
    private resolveEnv: NonNullable<AiServiceDeps['resolveEnv']>
    private contextProviders: ContextProvider[]
    private chatSystemPrompt: string
    private detectClis: NonNullable<AiServiceDeps['detectClis']>
    private policyDir: string
    private mcpEndpoint: McpToolEndpoint | undefined
    private tokenSource: () => string
    private mcpConfigDir: string | undefined
    private bridgePath: string
    private detectedKinds: CliKind[] | null = null
    private conversations = new Map<string, ConversationSession>()
    private static readonly MAX_CONVERSATIONS = 50

    constructor(
        private profileStore: AiProfileStore,
        private ssdp: SsdpService,
        private store: StoreService,
        deps: AiServiceDeps = {},
    ) {
        this.createEngine = deps.createEngine ?? createAiEngine
        this.adapters = deps.adapters ?? DEFAULT_ADAPTERS
        this.resolveEnv = deps.resolveEnv ?? (async () => ({ ...process.env, PATH: await resolveAugmentedPath() } as Record<string, string>))
        this.contextProviders = deps.contextProviders ?? []
        this.chatSystemPrompt = deps.chatSystemPrompt ?? loadChatSystemPrompt()
        this.detectClis = deps.detectClis ?? detectInstalledClis
        this.policyDir = deps.policyDir ?? ''
        this.mcpEndpoint = deps.mcpEndpoint
        this.tokenSource = deps.tokenSource ?? (() => globalThis.crypto.randomUUID())
        this.mcpConfigDir = deps.mcpConfigDir
        this.bridgePath = deps.bridgePath ?? MCP_BRIDGE_PATH
    }

    // profile passthroughs
    async listProfiles(): Promise<AiProfile[]> {
        const saved = this.profileStore.listProfiles()
        const overrides = this.profileStore.getCliOverrides()
        const kinds = await this.shownCliKinds()
        return [...saved, ...kinds.map(k => this.detectedProvider(k, overrides))]
    }

    /**
     * The CLI kinds that appear as providers: those found on PATH, plus any the user added
     * explicitly from the provider form (which records an override), minus ones they removed
     * (a removed CLI is recorded as a hidden override). This is why an added CLI shows even
     * when it is not on PATH, and a detected CLI disappears once removed.
     */
    private async shownCliKinds(): Promise<CliKind[]> {
        const detected = await this.detectedKindList()
        const overrides = this.profileStore.getCliOverrides()
        const overrideKinds = Object.keys(overrides).filter(isCliKind)
        const all = Array.from(new Set<CliKind>([...detected, ...overrideKinds]))
        return all.filter(kind => !overrides[kind]?.hidden)
    }

    saveProfile(input: AiProfileInput): AiProfile { return this.profileStore.saveProfile(input) }
    deleteProfile(id: string): void { this.profileStore.deleteProfile(id) }
    getActiveId(): string | null { return this.profileStore.getActiveId() }

    async setActiveId(id: string | null): Promise<void> {
        if (id?.startsWith('cli:')) {
            const provider = await this.resolveProvider(id)
            if (!provider) throw new Error('That CLI is not available. Add it from the provider list first.')
        }
        this.profileStore.setActiveId(id)
    }

    getCliOverrides(): AiCliOverrides { return this.profileStore.getCliOverrides() }
    setCliOverride(kind: CliKind, override: CliOverride): void {
        this.profileStore.setCliOverride(kind, override)
        // If the caller is hiding this CLI and it is currently the active provider, deactivate it
        // so stream() cannot keep using a hidden CLI after the override is persisted.
        if (override.hidden === true && this.profileStore.getActiveId() === `cli:${kind}`) {
            this.profileStore.setActiveId(null)
        }
    }

    /** Re-probe installed CLIs (e.g. when Settings opens). */
    async refreshCliDetection(): Promise<void> {
        const env = await this.resolveEnv()
        this.detectedKinds = await this.detectClis(env.PATH ?? '')
    }

    private async detectedKindList(): Promise<CliKind[]> {
        if (this.detectedKinds === null) {
            const env = await this.resolveEnv()
            this.detectedKinds = await this.detectClis(env.PATH ?? '')
        }
        return this.detectedKinds
    }

    private detectedProvider(kind: CliKind, overrides: AiCliOverrides): AiProfile {
        const override = overrides[kind] ?? {}
        return {
            id: `cli:${kind}`,
            name: CLI_DEFINITIONS[kind].label,
            adapter: 'cli',
            cliKind: kind,
            model: override.model ?? '',
            isLocal: true,
            redactionEnabled: override.redactionEnabled ?? true,
            hasKey: false,
        }
    }

    private async resolveProvider(id: string | null): Promise<AiProfile | undefined> {
        if (!id) return undefined
        if (id.startsWith('cli:')) {
            const kind = id.slice(4)
            if (!isCliKind(kind)) return undefined
            const shown = await this.shownCliKinds()
            if (!shown.includes(kind)) return undefined
            return this.detectedProvider(kind, this.profileStore.getCliOverrides())
        }
        return this.profileStore.getProfile(id)
    }

    private secrets(): RedactSecrets { return gatherRokuSecrets(this.ssdp, this.store) }

    /**
     * Build the core engine config for a profile: decrypt its key, gather redaction
     * secrets, apply its redaction policy, and for a CLI profile inject the augmented
     * PATH env so a bare command resolves the way it does in the user's terminal.
     * Also materializes the CLI's policy file for kinds that declare one.
     */
    private async configForProfile(profile: AiProfile, includeProviders: boolean): Promise<AiEngineConfig> {
        const base = {
            adapter: this.adapters[profile.adapter],
            model: profile.model,
            redaction: { enabled: profile.redactionEnabled },
            secrets: this.secrets(),
            providers: includeProviders ? this.contextProviders : undefined,
        }
        // CLI auth is whatever the CLI already has (no API key) and needs the augmented PATH;
        // HTTP transports need the key and base URL. The discriminated config keeps each
        // transport's fields from leaking into the other.
        if (profile.adapter === 'cli') {
            if (!profile.cliKind) throw new Error('CLI provider is missing its CLI kind.')
            const cliPolicyFilePath = materializeCliPolicy(profile.cliKind, this.policyDir)
            return { ...base, transport: 'cli', cliKind: profile.cliKind, cliPolicyFilePath, env: await this.resolveEnv() }
        }
        return { ...base, transport: 'http', baseUrl: profile.baseUrl, apiKey: this.profileStore.getKey(profile.id) }
    }


    private async requireActive(): Promise<AiProfile> {
        const profile = await this.resolveProvider(this.profileStore.getActiveId())
        if (!profile) throw new Error('There is no active AI profile. Configure one in Settings.')
        return profile
    }

    /** Resolve (or lazily create) the root directory under which per-request MCP config dirs are made. */
    private resolveMcpRoot(): string {
        if (this.mcpConfigDir) return this.mcpConfigDir
        const dir = path.join(os.tmpdir(), 'rokdock-mcp')
        fs.mkdirSync(dir, { recursive: true })
        this.mcpConfigDir = dir
        return dir
    }

    /** The engine-agnostic seam: a stream of deltas for the active profile. */
    async *stream(request: AiRequest, signal: AbortSignal, conversationId?: string, toolContext?: ToolCallContext): AsyncIterable<AiStreamChunk | AiActivityChunk> {
        const profile = await this.requireActive()
        const withSystem: AiRequest = { ...request, system: request.system ?? this.chatSystemPrompt }

        // MCP mode: active CLI supports native MCP AND at least one provider exposes tools
        // AND an endpoint is wired in. The CLI is spawned once. It calls tools via the bridge.
        if (
            this.mcpEndpoint &&
            profile.adapter === 'cli' &&
            profile.cliKind &&
            CLI_DEFINITIONS[profile.cliKind].mcp
        ) {
            const { specs, ownerByToolName } = buildToolRouting(this.contextProviders)
            if (specs.length > 0) {
                yield* this.streamWithMcp(profile, withSystem, signal, specs, ownerByToolName, conversationId, toolContext)
                return
            }
        }

        const engine = this.createEngine(await this.configForProfile(profile, true))
        yield* engine.stream(withSystem, signal, toolContext)
    }

    /** Remove a directory tree, swallowing any error (cleanup is always best-effort). */
    private removeDirBestEffort(dir: string): void {
        try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort cleanup */ }
    }

    /** Drop a tracked conversation session so the next stream call starts fresh. */
    evictConversation(conversationId: string): void {
        const entry = this.conversations.get(conversationId)
        if (entry?.dir) this.removeDirBestEffort(entry.dir)
        this.conversations.delete(conversationId)
    }

    /**
     * Returns the service to a clean-install state for a config reset: tears down
     * every tracked CLI conversation (removing its temp dir), drops the cached CLI
     * detection so it re-probes fresh, and deletes the stored API keys. The profile
     * metadata is cleared separately by the store reset. This covers the in-memory
     * state and the secrets file that the store cannot reach.
     */
    clearForReset(): void {
        // Deleting the just-yielded key mid-iteration is safe for a Map iterator.
        for (const conversationId of this.conversations.keys()) {
            this.evictConversation(conversationId)
        }
        this.detectedKinds = null
        this.profileStore.clearSecrets()
    }

    private async *streamWithMcp(
        profile: AiProfile,
        request: AiRequest,
        signal: AbortSignal,
        specs: ToolDef[],
        ownerByToolName: Map<string, ContextProvider>,
        conversationId?: string,
        toolContext?: ToolCallContext,
    ): AsyncIterable<AiStreamChunk | AiActivityChunk> {
        const endpoint = this.mcpEndpoint!
        const { url } = await endpoint.start()

        if (!profile.cliKind) throw new Error('CLI provider is missing its CLI kind.')
        const definition = CLI_DEFINITIONS[profile.cliKind]
        if (!definition.mcp) throw new Error('invariant: streamWithMcp called for a CLI without MCP support')
        const mcp = definition.mcp

        const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
        const cliKind = profile.cliKind
        const toolNames = specs.map(spec => spec.name)

        // Build the engine config once up front. Both the resume attempt and the start fallback
        // share it, and a routing/invariant break fires before any spawn.
        const baseConfig = await this.configForProfile(profile, true)
        if (baseConfig.transport !== 'cli') throw new Error('invariant: streamWithMcp called with non-cli transport')

        // Session reuse is only attempted when the CLI declares it supports it AND a
        // conversationId was supplied. Codex always gets the no-reuse path so its MCP
        // bridge profile is reloaded on every turn (resume drops -p, losing the tools).
        const reuseCapable = Boolean(conversationId) && mcp.supportsSessionReuse === true
        // Gemini sessions are project/cwd-scoped: the dir must be the same across all turns
        // of a conversation or the CLI cannot locate the prior session. All other CLIs get a
        // fresh per-request dir every turn and clean it in the finally.
        const stableDir = mcp.requiresStableSessionDir === true

        const fullMessages = request.messages
        const prior = reuseCapable ? this.conversations.get(conversationId!) : undefined
        const reuse = Boolean(prior && prior.cliKind === cliKind && prior.model === profile.model)

        // A stable-dir conversation reuses its prior dir; everything else gets a fresh dir this
        // turn. reuseExistingDir is the single source for both the dir choice and the cleanup rules.
        const reuseExistingDir = reuseCapable && stableDir && reuse && Boolean(prior?.dir)
        const configDir = reuseExistingDir
            ? prior!.dir!
            : fs.mkdtempSync(path.join(this.resolveMcpRoot(), stableDir ? 'conv-' : 'req-'))

        const spawnContext = { mcp, baseConfig, configDir, codexHome, toolNames, url, request, signal, specs, ownerByToolName, toolContext }
        const recordSession = (handle: string): void => {
            this.conversations.set(conversationId!, {
                cliKind, model: profile.model, handle,
                deliveredCount: fullMessages.length + 1,
                dir: stableDir ? configDir : undefined,
            })
        }

        try {
            // RESUME attempt. On a pre-output failure, fall through to a fresh START on the same dir.
            if (reuseCapable && reuse) {
                let chunksYielded = 0
                try {
                    for await (const chunk of this.runMcpSpawn({
                        ...spawnContext, token: this.tokenSource(),
                        // The resumed session already holds the system prompt from its START
                        // turn; the CLI folds system into stdin, so re-sending it every turn
                        // would repeat the whole prompt. Strip it and send only the new turns.
                        request: { ...spawnContext.request, system: undefined },
                        session: { handle: prior!.handle, mode: 'resume' },
                        messages: fullMessages.slice(prior!.deliveredCount),
                    })) {
                        chunksYielded++
                        yield chunk
                    }
                    // Updates an existing key (the map cannot grow), so capConversations is not needed.
                    recordSession(prior!.handle)
                    return
                } catch (resumeError) {
                    // Output already streamed means the session is broken and cannot be retried.
                    if (chunksYielded > 0) {
                        if (conversationId) this.evictConversation(conversationId)
                        throw resumeError
                    }
                    // Pre-output failure: fall through to START (the runMcpSpawn finally already
                    // revoked the resume token and removed its files from configDir).
                }
            }

            // START: the initial turn, a non-reuse CLI (codex), or the resume fallback.
            const startSession: CliSessionPlan | undefined = reuseCapable ? { handle: this.tokenSource(), mode: 'start' } : undefined
            for await (const chunk of this.runMcpSpawn({
                ...spawnContext, token: this.tokenSource(), session: startSession, messages: fullMessages,
            })) {
                yield chunk
            }
            if (reuseCapable && startSession) {
                recordSession(startSession.handle)
                this.capConversations()
            }
        } catch (streamError) {
            // Drop the conversation and its stable dir so the next turn re-syncs with a clean START.
            // evictConversation removes a stored entry's dir; a fresh stable dir never stored (failure
            // before recordSession) is removed here.
            if (conversationId) this.evictConversation(conversationId)
            if (stableDir && !reuseExistingDir) this.removeDirBestEffort(configDir)
            throw streamError
        } finally {
            // Per-request dirs are removed here. Stable dirs (gemini) survive until eviction.
            if (!stableDir) this.removeDirBestEffort(configDir)
        }
    }

    /**
     * Run one CLI spawn: materialize the plan's files into the config dir, attach the MCP bridge
     * session, and stream the answer. The per-spawn token is revoked and the plan's files are
     * unlinked in the finally. The caller owns the conversation map and the config dir lifecycle.
     */
    private async *runMcpSpawn(opts: {
        mcp: CliMcp
        baseConfig: CliEngineConfig
        configDir: string
        codexHome: string
        toolNames: string[]
        url: string
        token: string
        session: CliSessionPlan | undefined
        messages: AiRequest['messages']
        request: AiRequest
        signal: AbortSignal
        specs: ToolDef[]
        ownerByToolName: Map<string, ContextProvider>
        toolContext?: ToolCallContext
    }): AsyncIterable<AiStreamChunk | AiActivityChunk> {
        const endpoint = this.mcpEndpoint!
        const plan = opts.mcp.plan({
            model: opts.baseConfig.model,
            toolNames: opts.toolNames,
            configDir: opts.configDir,
            codexHome: opts.codexHome,
            bridgePath: this.bridgePath,
            nodePath: process.execPath,
            url: opts.url,
            token: opts.token,
            bridgeEnv: { ELECTRON_RUN_AS_NODE: '1' },
            session: opts.session,
        })
        // Everything that has side effects (writing files, registering the bridge session) runs
        // inside the try so the finally always unlinks the plan files and revokes the token, even
        // when a file write or registration throws mid-setup. plan() above has no side effects.
        try {
            // Each file carries its own absolute path (it may be outside configDir, e.g. codex's
            // profile in CODEX_HOME), so write directly to file.path.
            for (const file of plan.files) {
                fs.mkdirSync(path.dirname(file.path), { recursive: true })
                fs.writeFileSync(file.path, file.content, 'utf8')
            }
            const engineConfig: AiEngineConfig = { ...opts.baseConfig, mcpTools: { command: plan.command, cwd: plan.cwd } }
            const engine = this.createEngine(engineConfig)
            // Create the merged iterable before registering the session so the queue is in place
            // when the first onActivity call arrives.
            const { iterable, queue } = createMergedIterable<AiStreamChunk | AiActivityChunk, AiActivityChunk>(
                engine.stream({ ...opts.request, messages: opts.messages }, opts.signal),
            )
            endpoint.registerSession(opts.token, {
                tools: opts.specs,
                call: (name: string, args: unknown, callSignal: AbortSignal): Promise<ToolResult> =>
                    dispatchTool(opts.ownerByToolName, name, args, callSignal, opts.toolContext),
                onActivity(activity) { queue.push({ activity }) },
                signal: opts.signal,
            })
            yield* iterable
        } finally {
            endpoint.revokeSession(opts.token)
            for (const file of plan.files) {
                try { fs.unlinkSync(file.path) } catch { /* best-effort cleanup */ }
            }
        }
    }

    /** Drop the oldest entries once the conversation map exceeds the cap. Map preserves insertion order. */
    private capConversations(): void {
        while (this.conversations.size > AiService.MAX_CONVERSATIONS) {
            const oldest = this.conversations.keys().next().value
            if (oldest === undefined) break
            const entry = this.conversations.get(oldest)
            if (entry?.dir) this.removeDirBestEffort(entry.dir)
            this.conversations.delete(oldest)
        }
    }

    /** Stream the canned prompt through the real path and report success/failure. */
    async testConnection(profileId?: string): Promise<AiTestResult> {
        const id = profileId ?? this.profileStore.getActiveId()
        const profile = await this.resolveProvider(id)
        if (!profile) return { ok: false, error: 'There is no AI profile to test.' }
        try {
            const engine = this.createEngine(await this.configForProfile(profile, false))
            const result = await engine.complete({ messages: [{ role: 'user', content: TEST_PROMPT }] }, new AbortController().signal)
            return { ok: true, text: result.text }
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
    }

    /**
     * Inspect-only "what will be sent" preview. Runs the engine's real assemble-then-redact
     * path (dryRun) for the chosen profile, so the preview reflects the full payload the
     * engine would send (assembled context + prompt + system), not just the raw prompt, and
     * cannot drift from the actual send. Builds a connection-less engine: dryRun does no
     * dispatch, so no key, base URL, or CLI env is needed. Sends nothing.
     */
    async previewRedaction(request: AiRequest, profileId?: string): Promise<RedactionPreview> {
        const id = profileId ?? this.profileStore.getActiveId()
        // Route through resolveProvider so a synthetic cli:<kind> id resolves correctly.
        // dryRun never dispatches, so no connection fields are needed. Transport only has to be a
        // valid variant. Derive it from the adapter to stay honest about which one would be used.
        const profile = await this.resolveProvider(id)
        const redaction = { enabled: profile ? profile.redactionEnabled : true }
        let config: AiEngineConfig
        if (profile?.adapter === 'cli') {
            // A cli provider missing its kind is a misconfiguration; throw rather than silently
            // defaulting, so this path is consistent with configForProfile.
            if (!profile.cliKind) throw new Error('CLI provider is missing its CLI kind.')
            config = { transport: 'cli', cliKind: profile.cliKind, adapter: this.adapters.cli, model: profile.model, redaction, secrets: this.secrets() }
        } else {
            config = { transport: 'http', adapter: this.adapters[profile?.adapter ?? 'anthropic'], model: profile?.model ?? '', redaction, secrets: this.secrets() }
        }
        const engine = this.createEngine(config)
        const redacted = await engine.dryRun(request, new AbortController().signal)
        const text = redacted.system ? `${redacted.system}\n\n${redacted.prompt}` : redacted.prompt
        return { text, replacements: redacted.replacements }
    }

    /**
     * Redact a tool result for the active profile before it reaches the model. Runs the same
     * pure device-values-only redact() pass the outbound prompt uses, gated on the active
     * profile's redactionEnabled flag. Returns the text unchanged only when an active profile
     * explicitly has redaction off. Fails closed otherwise: an unresolvable active profile still
     * gets scrubbed, matching previewRedaction and avoiding a raw leak if the profile changes
     * mid-stream. Backs the terminal-output provider's redact dependency, so terminal text is
     * scrubbed on both the HTTP and CLI/MCP transports.
     */
    async redactForActiveProfile(text: string): Promise<string> {
        const profile = await this.resolveProvider(this.profileStore.getActiveId())
        if (profile && !profile.redactionEnabled) return text
        return redact(text, this.secrets(), { enabled: true }).text
    }
}
