/**
 * Tests for the streaming IPC session lifecycle in registerAiHandlers.
 * Covers: chunk-then-done, error propagation, and cancel-is-a-clean-stop.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoist the capture maps so the vi.mock factory can reference them without
// triggering the "factory cannot reference out-of-scope variable" error.
const { handleMap, onMap } = vi.hoisted(() => {
    return {
        handleMap: new Map<string, (...args: unknown[]) => unknown>(),
        onMap: new Map<string, (...args: unknown[]) => unknown>(),
    }
})

vi.mock('electron', () => ({
    ipcMain: {
        handle: (ch: string, fn: (...args: unknown[]) => unknown) => handleMap.set(ch, fn),
        on: (ch: string, fn: (...args: unknown[]) => unknown) => onMap.set(ch, fn),
    },
}))

import { registerAiHandlers } from '@main/ipc/handlers/ai'
import type { IpcContext } from '@main/ipc/types'
import type { AiRequest } from '@shared/ai/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSender() {
    return {
        isDestroyed: () => false,
        send: vi.fn<[string, unknown], void>(),
        once: vi.fn<[string, () => void], void>(),
        removeListener: vi.fn<[string, () => void], void>(),
    }
}

function makeContext(streamImpl: (req: AiRequest, signal: AbortSignal, conversationId?: string) => AsyncIterable<{ delta: string }>) {
    return {
        ai: {
            stream: streamImpl,
            listProfiles: vi.fn(),
            saveProfile: vi.fn(),
            deleteProfile: vi.fn(),
            getActiveId: vi.fn(),
            setActiveId: vi.fn(),
            testConnection: vi.fn(),
            previewRedaction: vi.fn(),
            getCliOverrides: vi.fn(),
            setCliOverride: vi.fn(),
            refreshCliDetection: vi.fn(),
            evictConversation: vi.fn(),
        },
    } as unknown as IpcContext
}

const fakeRequest: AiRequest = { messages: [{ role: 'user', content: 'hello' }] }

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('registerAiHandlers streaming lifecycle', () => {
    beforeEach(() => {
        handleMap.clear()
        onMap.clear()
    })

    it('(a) chunk-then-done: emits chunk payloads and a final done, never an error', async () => {
        async function* fakeStream() {
            yield { delta: 'O' }
            yield { delta: 'K' }
        }

        const context = makeContext(fakeStream)
        registerAiHandlers(context)

        const startHandler = handleMap.get('ai:start-stream')!
        const sender = makeSender()
        const fakeEvent = { sender }

        const { sessionId } = await (startHandler as (ev: unknown, req: AiRequest) => Promise<{ sessionId: string }>)(fakeEvent, fakeRequest)

        // Wait for the done push. The handler always includes sources (empty when no tool rounds ran).
        await vi.waitFor(() => {
            expect(sender.send).toHaveBeenCalledWith('ai:stream-done', { sessionId, finalText: 'OK', sources: [] })
        })

        const calls = sender.send.mock.calls
        const chunkCalls = calls.filter(([ch]) => ch === 'ai:stream-chunk')
        expect(chunkCalls).toHaveLength(2)
        expect(chunkCalls[0][1]).toEqual({ sessionId, delta: 'O' })
        expect(chunkCalls[1][1]).toEqual({ sessionId, delta: 'K' })

        const errorCalls = calls.filter(([ch]) => ch === 'ai:stream-error')
        expect(errorCalls).toHaveLength(0)
    })

    it('(b) error: emits exactly one stream-error with the message, and no done', async () => {
        async function* fakeStream(): AsyncGenerator<{ delta: string }> {
            throw new Error('boom')
        }

        const context = makeContext(fakeStream)
        registerAiHandlers(context)

        const startHandler = handleMap.get('ai:start-stream')!
        const sender = makeSender()
        const fakeEvent = { sender }

        const { sessionId } = await (startHandler as (ev: unknown, req: AiRequest) => Promise<{ sessionId: string }>)(fakeEvent, fakeRequest)

        await vi.waitFor(() => {
            expect(sender.send).toHaveBeenCalledWith(
                'ai:stream-error',
                expect.objectContaining({ sessionId, message: expect.stringContaining('boom') }),
            )
        })

        const calls = sender.send.mock.calls
        const errorCalls = calls.filter(([ch]) => ch === 'ai:stream-error')
        expect(errorCalls).toHaveLength(1)

        const doneCalls = calls.filter(([ch]) => ch === 'ai:stream-done')
        expect(doneCalls).toHaveLength(0)
    })

    it('(c) cancel is a clean stop: no error and no done are emitted after cancel', async () => {
        async function* fakeStream(_req: AiRequest, signal: AbortSignal): AsyncGenerator<{ delta: string }> {
            yield { delta: 'O' }
            // Suspend until the signal aborts, then unwind cleanly (throw so the generator terminates).
            await new Promise<never>((_res, rej) => {
                signal.addEventListener('abort', () => rej(new Error('aborted')))
            })
        }

        const context = makeContext(fakeStream)
        registerAiHandlers(context)

        const startHandler = handleMap.get('ai:start-stream')!
        const cancelHandler = onMap.get('ai:cancel-stream')!
        const sender = makeSender()
        const fakeEvent = { sender }

        const { sessionId } = await (startHandler as (ev: unknown, req: AiRequest) => Promise<{ sessionId: string }>)(fakeEvent, fakeRequest)

        // Wait until the first chunk ('O') has been pushed to confirm the stream is live.
        await vi.waitFor(() => {
            expect(sender.send).toHaveBeenCalledWith('ai:stream-chunk', { sessionId, delta: 'O' })
        })

        // Cancel the session.
        ;(cancelHandler as (ev: unknown, id: string) => void)({}, sessionId)

        // Give the microtask queue a tick to let the generator unwind.
        await new Promise((resolve) => setTimeout(resolve, 10))

        const calls = sender.send.mock.calls
        const errorCalls = calls.filter(([ch]) => ch === 'ai:stream-error')
        const doneCalls = calls.filter(([ch]) => ch === 'ai:stream-done')

        expect(errorCalls).toHaveLength(0)
        expect(doneCalls).toHaveLength(0)
    })

    it('forwards ai:get-cli-overrides to context.ai.getCliOverrides and returns its result', async () => {
        const mockOverrides = { claude: { model: 'claude-3-opus' }, gemini: { hidden: true } }
        const context = makeContext(async function* () { yield { delta: '' } })
        context.ai.getCliOverrides = vi.fn().mockResolvedValue(mockOverrides)

        registerAiHandlers(context)
        const handler = handleMap.get('ai:get-cli-overrides')!

        const result = await (handler as () => Promise<unknown>)()
        expect(result).toEqual(mockOverrides)
        expect(context.ai.getCliOverrides).toHaveBeenCalledOnce()
    })

    it('forwards ai:set-cli-override to context.ai.setCliOverride with (kind, override)', async () => {
        const context = makeContext(async function* () { yield { delta: '' } })
        context.ai.setCliOverride = vi.fn().mockResolvedValue(undefined)

        registerAiHandlers(context)
        const handler = handleMap.get('ai:set-cli-override')!

        const kind = 'claude' as const
        const override = { model: 'claude-3-sonnet' }
        await (handler as (event: unknown, kind: string, override: unknown) => Promise<void>)({}, kind, override)

        expect(context.ai.setCliOverride).toHaveBeenCalledWith(kind, override)
    })

    it('forwards ai:refresh-cli-detection to context.ai.refreshCliDetection', async () => {
        const context = makeContext(async function* () { yield { delta: '' } })
        context.ai.refreshCliDetection = vi.fn().mockResolvedValue(undefined)

        registerAiHandlers(context)
        const handler = handleMap.get('ai:refresh-cli-detection')!

        await (handler as () => Promise<void>)()
        expect(context.ai.refreshCliDetection).toHaveBeenCalledOnce()
    })

    it('threads conversationId from the IPC arg into context.ai.stream', async () => {
        const seenConversationIds: Array<string | undefined> = []
        async function* fakeStream(_req: AiRequest, _signal: AbortSignal, conversationId?: string) {
            seenConversationIds.push(conversationId)
            yield { delta: 'OK' }
        }

        const context = makeContext(fakeStream)
        registerAiHandlers(context)

        const startHandler = handleMap.get('ai:start-stream')!
        const sender = makeSender()
        const fakeEvent = { sender }

        await (startHandler as (ev: unknown, req: AiRequest, convId?: string) => Promise<{ sessionId: string }>)(fakeEvent, fakeRequest, 'conv-abc')

        await vi.waitFor(() => {
            expect(sender.send).toHaveBeenCalledWith('ai:stream-done', expect.objectContaining({ finalText: 'OK' }))
        })

        expect(seenConversationIds).toEqual(['conv-abc'])
    })

    it('calls evictConversation when the sender is destroyed and a conversationId was set', async () => {
        async function* fakeStream(): AsyncGenerator<{ delta: string }> {
            // Suspend indefinitely so the stream is still live when 'destroyed' fires.
            await new Promise<never>(() => { /* never resolves */ })
            yield { delta: 'unreachable' }
        }

        const context = makeContext(fakeStream)
        registerAiHandlers(context)

        const startHandler = handleMap.get('ai:start-stream')!
        const sender = makeSender()
        const fakeEvent = { sender }

        await (startHandler as (ev: unknown, req: AiRequest, convId?: string) => Promise<{ sessionId: string }>)(fakeEvent, fakeRequest, 'conv-xyz')

        // Simulate the window being destroyed by calling the registered 'destroyed' handler.
        const [, onDestroyedCallback] = sender.once.mock.calls.find(([eventName]) => eventName === 'destroyed')!
        ;(onDestroyedCallback as () => void)()

        expect(context.ai.evictConversation).toHaveBeenCalledWith('conv-xyz')
    })

    it('does not call evictConversation on destroy when no conversationId was passed', async () => {
        async function* fakeStream(): AsyncGenerator<{ delta: string }> {
            await new Promise<never>(() => { /* never resolves */ })
            yield { delta: 'unreachable' }
        }

        const context = makeContext(fakeStream)
        registerAiHandlers(context)

        const startHandler = handleMap.get('ai:start-stream')!
        const sender = makeSender()
        const fakeEvent = { sender }

        // No conversationId argument -- should not evict.
        await (startHandler as (ev: unknown, req: AiRequest) => Promise<{ sessionId: string }>)(fakeEvent, fakeRequest)

        const [, onDestroyedCallback] = sender.once.mock.calls.find(([eventName]) => eventName === 'destroyed')!
        ;(onDestroyedCallback as () => void)()

        expect(context.ai.evictConversation).not.toHaveBeenCalled()
    })
})
