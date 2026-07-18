// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import AiChatPanel from '@renderer/components/ai/aiChatPanel'
import { useAppStore } from '@renderer/store/appStore'

beforeEach(() => {
    ;(window as unknown as { rokdock: unknown }).rokdock = {
        ai: { startStream: vi.fn(), cancelStream: vi.fn(), onStreamChunk: vi.fn(), onStreamEnd: vi.fn(), onStreamError: vi.fn() },
        docs: { lookUp: vi.fn() },
    }
    useAppStore.setState({
        aiConfigured: true,
        aiChatMessages: [], aiChatStreaming: null, aiChatError: null,
        aiDocSymbols: {},
        sendChatMessage: vi.fn(async () => {}) as never,
        cancelChat: vi.fn() as never,
        newChat: vi.fn() as never,
        aiChatOpen: true,
        toggleAiChat: vi.fn() as never,
        aiChatDock: 'left',
        cycleAiChatDock: vi.fn() as never,
    })
})

afterEach(() => {
    cleanup()
})

describe('AiChatPanel', () => {
    it('shows the (Beta) title', () => {
        const { getByTestId } = render(<AiChatPanel />)
        expect(getByTestId('ai-chat-panel').textContent).toContain('roBot (Beta)')
    })

    it('sends the typed message on Enter', () => {
        const send = vi.fn(async () => {})
        useAppStore.setState({ sendChatMessage: send as never })
        const { getByTestId } = render(<AiChatPanel />)
        const input = getByTestId('ai-chat-input') as HTMLTextAreaElement
        fireEvent.change(input, { target: { value: 'why is this failing?' } })
        fireEvent.keyDown(input, { key: 'Enter' })
        expect(send).toHaveBeenCalledWith('why is this failing?')
    })

    it('renders existing messages', () => {
        useAppStore.setState({ aiChatMessages: [
            { role: 'user', content: 'hello' }, { role: 'assistant', content: '**hi**' },
        ] })
        const { getAllByTestId } = render(<AiChatPanel />)
        expect(getAllByTestId('ai-chat-message')).toHaveLength(2)
    })

    it('shows Cancel while streaming', () => {
        useAppStore.setState({ aiChatStreaming: { sessionId: 's', text: 'partial' } })
        const cancel = vi.fn()
        useAppStore.setState({ cancelChat: cancel as never })
        const { getByTestId } = render(<AiChatPanel />)
        fireEvent.click(getByTestId('ai-chat-cancel'))
        expect(cancel).toHaveBeenCalled()
    })

    it('shows an error row', () => {
        useAppStore.setState({ aiChatError: 'network down' })
        const { getByTestId } = render(<AiChatPanel />)
        expect(getByTestId('ai-chat-error').textContent).toContain('network down')
    })

    it('shows the activity line while streaming before text arrives', () => {
        useAppStore.setState({ aiConfigured: true, aiChatOpen: true, aiChatMessages: [], aiChatStreaming: { sessionId: 's', text: '', activity: 'Searching docs: "x"' } })
        const { getByText } = render(<AiChatPanel />)
        expect(getByText('Searching docs: "x"')).toBeTruthy()
    })

    it('renders a Used docs chip and opens a source on click', () => {
        const lookUp = vi.fn()
        ;(window as unknown as { rokdock: { docs: { lookUp: typeof lookUp } } }).rokdock = { docs: { lookUp } } as never
        useAppStore.setState({ aiConfigured: true, aiChatOpen: true, aiChatStreaming: null, aiChatMessages: [
            { role: 'user', content: 'q' },
            { role: 'assistant', content: 'A node.', sources: [{ path: 'SceneGraph/Node.md', title: 'Node' }] },
        ] })
        const { getByTestId, getByText } = render(<AiChatPanel />)
        fireEvent.click(getByTestId('ai-chat-sources-toggle'))
        fireEvent.click(getByText('Node'))
        expect(lookUp).toHaveBeenCalledWith('Node')
    })
})
