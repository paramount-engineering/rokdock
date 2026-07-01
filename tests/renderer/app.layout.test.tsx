// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import LeftColumn from '@renderer/components/leftColumn'
import { useAppStore } from '@renderer/store/appStore'

// DevicePanel -> CapturePreview -> useCaptureStream uses navigator.mediaDevices
// which is not available in jsdom. Stub it out so the component tree mounts.
Object.defineProperty(navigator, 'mediaDevices', {
    value: {
        enumerateDevices: vi.fn(async () => []),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    },
    writable: true,
    configurable: true,
})

beforeEach(() => {
    useAppStore.setState({
        aiConfigured: false,
        aiChatOpen: false,
        leftPanelOpen: true,
        leftPanelWidth: 240,
        leftSplitRatio: 0.5,
        toggleAiChat: vi.fn() as never,
    })
    ;(globalThis as unknown as { window: unknown }).window = {
        rokdock: {
            docs: { prime: vi.fn(async () => {}) },
        },
    }
})

afterEach(() => {
    cleanup()
})

describe('App left-column AI gating', () => {
    it('hides the chat toggle when no provider is configured', () => {
        useAppStore.setState({ aiConfigured: false })
        const { queryByTestId } = render(<LeftColumn />)
        expect(queryByTestId('ai-chat-toggle')).toBeNull()
    })

    it('shows the chat toggle when a provider is configured', () => {
        useAppStore.setState({ aiConfigured: true })
        const { queryByTestId } = render(<LeftColumn />)
        expect(queryByTestId('ai-chat-toggle')).not.toBeNull()
    })
})
