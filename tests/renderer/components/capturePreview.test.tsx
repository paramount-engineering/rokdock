// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import CapturePreview from '@renderer/components/capturePreview'
import { useAppStore } from '@renderer/store/appStore'

const enumerateDevices = vi.fn(async () => [])

Object.defineProperty(navigator, 'mediaDevices', {
    value: {
        enumerateDevices,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    },
    writable: true,
    configurable: true,
})

beforeEach(() => {
    enumerateDevices.mockClear()
    useAppStore.setState({
        captureDeviceId: null,
        captureMode: 'docked',
    })
    ;(globalThis as unknown as { window: unknown }).window = {
        rokdock: {
            capture: { onGrabFrame: vi.fn(() => () => {}) },
        },
    }
})

afterEach(() => {
    cleanup()
})

describe('CapturePreview device detection gating', () => {
    it('does not probe capture devices while the Capture section is collapsed', () => {
        useAppStore.setState({ collapsedPanels: ['capture-preview'] })
        render(<CapturePreview mode="docked" active={true} />)
        expect(enumerateDevices).not.toHaveBeenCalled()
    })

    it('probes capture devices once the Capture section is expanded', () => {
        useAppStore.setState({ collapsedPanels: [] })
        render(<CapturePreview mode="docked" active={true} />)
        expect(enumerateDevices).toHaveBeenCalled()
    })
})
