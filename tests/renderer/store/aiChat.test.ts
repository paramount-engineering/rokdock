import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAppStore } from '@renderer/store/appStore'

type ChunkCb = (d: { sessionId: string; delta: string }) => void
type DoneCb = (d: { sessionId: string; finalText: string; sources: { path: string; title: string }[] }) => void
type ErrCb = (d: { sessionId: string; message: string }) => void
type ActivityCb = (d: { sessionId: string; name: string; args: Record<string, unknown> }) => void

let chunkCb: ChunkCb, doneCb: DoneCb, errCb: ErrCb, activityCb: ActivityCb
let startMock: ReturnType<typeof vi.fn>
let cancelMock: ReturnType<typeof vi.fn>

beforeEach(() => {
    startMock = vi.fn(async () => ({ sessionId: 's1' }))
    cancelMock = vi.fn()
    ;(globalThis as unknown as { window: unknown }).window = {
        rokdock: {
            ai: {
                listProfiles: async () => [],
                startStream: startMock,
                cancelStream: cancelMock,
                getDocSymbols: async () => ({}),
                onStreamChunk: (callback: ChunkCb) => { chunkCb = callback; return () => {} },
                onStreamDone: (callback: DoneCb) => { doneCb = callback; return () => {} },
                onStreamError: (callback: ErrCb) => { errCb = callback; return () => {} },
                onStreamActivity: (callback: ActivityCb) => { activityCb = callback; return () => {} },
                onChatImage: () => () => {},
            },
        },
    }
    useAppStore.setState({
        aiConfigured: true, aiChatOpen: false, aiChatMessages: [], aiChatStreaming: null, aiChatError: null, aiConversationId: null,
    })
    useAppStore.getState().initAiChatStream()
})

describe('ai chat store', () => {
    it('sendChatMessage pushes a user message, streams, and commits the assistant reply on done', async () => {
        await useAppStore.getState().sendChatMessage('hello')
        expect(useAppStore.getState().aiChatMessages).toEqual([{ role: 'user', content: 'hello' }])
        expect(startMock).toHaveBeenCalledWith({ messages: [{ role: 'user', content: 'hello' }] }, expect.any(String))
        chunkCb({ sessionId: 's1', delta: 'hi ' })
        chunkCb({ sessionId: 's1', delta: 'there' })
        expect(useAppStore.getState().aiChatStreaming?.text).toBe('hi there')
        doneCb({ sessionId: 's1', finalText: 'hi there', sources: [] })
        expect(useAppStore.getState().aiChatStreaming).toBeNull()
        expect(useAppStore.getState().aiChatMessages).toEqual([
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'hi there' },
        ])
    })

    it('sends history on a follow-up turn', async () => {
        useAppStore.setState({ aiChatMessages: [
            { role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' },
        ] })
        await useAppStore.getState().sendChatMessage('q2')
        expect(startMock).toHaveBeenCalledWith({ messages: [
            { role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' },
        ] }, expect.any(String))
    })

    it('reuses one conversationId across turns and mints a fresh one after newChat', async () => {
        await useAppStore.getState().sendChatMessage('first')
        const firstId = startMock.mock.calls[0][1]
        expect(typeof firstId).toBe('string')
        // Complete the stream so the store is not busy, then send a follow-up.
        doneCb({ sessionId: 's1', finalText: 'a', sources: [] })
        await useAppStore.getState().sendChatMessage('second')
        expect(startMock.mock.calls[1][1]).toBe(firstId)  // same conversation -> same id
        // newChat resets the conversation, so the next message mints a new id.
        useAppStore.getState().newChat()
        await useAppStore.getState().sendChatMessage('third')
        expect(startMock.mock.calls[2][1]).not.toBe(firstId)
    })

    it('ignores empty input', async () => {
        await useAppStore.getState().sendChatMessage('   ')
        expect(startMock).not.toHaveBeenCalled()
        expect(useAppStore.getState().aiChatMessages).toEqual([])
    })

    it('openChatWith opens the panel and sends', async () => {
        await useAppStore.getState().openChatWith('explain this')
        expect(useAppStore.getState().aiChatOpen).toBe(true)
        expect(startMock).toHaveBeenCalledWith({ messages: [{ role: 'user', content: 'explain this' }] }, expect.any(String))
    })

    it('cancelChat cancels the session and keeps partial text as an assistant message', async () => {
        await useAppStore.getState().sendChatMessage('hello')
        chunkCb({ sessionId: 's1', delta: 'partial' })
        useAppStore.getState().cancelChat()
        expect(cancelMock).toHaveBeenCalledWith('s1')
        expect(useAppStore.getState().aiChatStreaming).toBeNull()
        expect(useAppStore.getState().aiChatMessages.at(-1)).toEqual({ role: 'assistant', content: 'partial' })
    })

    it('surfaces a stream error and clears streaming', async () => {
        await useAppStore.getState().sendChatMessage('hello')
        errCb({ sessionId: 's1', message: 'network down' })
        expect(useAppStore.getState().aiChatError).toBe('network down')
        expect(useAppStore.getState().aiChatStreaming).toBeNull()
    })

    it('newChat clears the thread', async () => {
        useAppStore.setState({ aiChatMessages: [{ role: 'user', content: 'x' }], aiChatError: 'e' })
        useAppStore.getState().newChat()
        expect(useAppStore.getState().aiChatMessages).toEqual([])
        expect(useAppStore.getState().aiChatError).toBeNull()
    })

    it('setAiConfigured(false) closes the panel', () => {
        useAppStore.setState({ aiChatOpen: true })
        useAppStore.getState().setAiConfigured(false)
        expect(useAppStore.getState().aiConfigured).toBe(false)
        expect(useAppStore.getState().aiChatOpen).toBe(false)
    })

    it('stale sessionId callbacks do not mutate state', async () => {
        await useAppStore.getState().sendChatMessage('hello')
        chunkCb({ sessionId: 'stale', delta: 'x' })
        expect(useAppStore.getState().aiChatStreaming?.text).toBe('')
        expect(useAppStore.getState().aiChatStreaming).not.toBeNull()
        doneCb({ sessionId: 'stale', finalText: 'x', sources: [] })
        expect(useAppStore.getState().aiChatStreaming).not.toBeNull()
        expect(useAppStore.getState().aiChatMessages).toHaveLength(1)
        errCb({ sessionId: 'stale', message: 'x' })
        expect(useAppStore.getState().aiChatError).toBeNull()
        expect(useAppStore.getState().aiChatStreaming).not.toBeNull()
    })

    it('newChat cancels an in-flight stream and clears state', async () => {
        await useAppStore.getState().sendChatMessage('hello')
        useAppStore.getState().newChat()
        expect(cancelMock).toHaveBeenCalledWith('s1')
        expect(useAppStore.getState().aiChatMessages).toEqual([])
        expect(useAppStore.getState().aiChatStreaming).toBeNull()
        expect(useAppStore.getState().aiChatError).toBeNull()
    })

    it('sets a formatted activity label on a search_docs activity', async () => {
        await useAppStore.getState().sendChatMessage('hello')
        activityCb({ sessionId: 's1', name: 'search_docs', args: { query: 'roSGNode' } })
        expect(useAppStore.getState().aiChatStreaming?.activity).toBe('Searching docs: "roSGNode"')
        activityCb({ sessionId: 's1', name: 'fetch_page', args: { path: 'SceneGraph/Node.md' } })
        expect(useAppStore.getState().aiChatStreaming?.activity).toBe('Reading: SceneGraph/Node.md')
    })

    it('attaches sources to the committed assistant message on done', async () => {
        await useAppStore.getState().sendChatMessage('hello')
        chunkCb({ sessionId: 's1', delta: 'A node.' })
        doneCb({ sessionId: 's1', finalText: 'A node.', sources: [{ path: 'SceneGraph/Node.md', title: 'Node' }] })
        expect(useAppStore.getState().aiChatMessages.at(-1)).toEqual({ role: 'assistant', content: 'A node.', sources: [{ path: 'SceneGraph/Node.md', title: 'Node' }] })
    })
})
