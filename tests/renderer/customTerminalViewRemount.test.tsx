// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { act } from 'react'
import CustomTerminalView, { readTerminalCache, clearTerminalCache } from '@renderer/components/customTerminalView'
import { useAppStore, type TabInfo } from '@renderer/store/appStore'
import type { TerminalLineChunk } from '@shared/terminal'

const tab: TabInfo = {
    id: 'tab-remount-1',
    deviceIp: '10.0.0.5',
    deviceName: 'Living Room',
    port: 8085,
    status: 'connected',
    autoScroll: true,
    wordWrap: false,
    hasActivity: false,
    paneId: 'a'
}

/** Captured by the mocked terminal.onData subscription so the test can push a line directly. */
let onDataHandler: ((id: string, chunk: TerminalLineChunk) => void) | null = null

beforeEach(() => {
    onDataHandler = null

    // The component batches incoming lines through requestAnimationFrame. Stubbing it to run
    // the callback synchronously flushes the batch inside the test's act() call, so the test
    // is deterministic and never needs to poll a real timer.
    global.requestAnimationFrame = ((callback: FrameRequestCallback): number => {
        callback(0)
        return 0
    }) as typeof requestAnimationFrame
    global.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame

    class NoOpResizeObserver {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
    }
    global.ResizeObserver = NoOpResizeObserver as unknown as typeof ResizeObserver

    ;(window as unknown as { rokdock: unknown }).rokdock = {
        terminal: {
            onData: vi.fn((handler: (id: string, chunk: TerminalLineChunk) => void) => {
                onDataHandler = handler
                return () => {}
            }),
            onExit: vi.fn(() => () => {}),
            onStatus: vi.fn(() => () => {}),
            write: vi.fn(),
            kill: vi.fn()
        },
        contextMenu: {
            onAction: vi.fn(() => () => {}),
            showTerminalMenu: vi.fn()
        },
        dialog: {
            appendFile: vi.fn(async () => true),
            saveFile: vi.fn(async () => true),
            pickSavePath: vi.fn(async () => null)
        },
        docs: { lookUp: vi.fn() },
        external: { openUrl: vi.fn() },
        json: { addTab: vi.fn() }
    }

    useAppStore.setState({
        aiConfigured: false,
        themeMode: 'dark',
        terminalFontFamily: '',
        terminalFontSize: 13,
        terminalSyntaxThemePreset: 'rokdockDark',
        terminalSyntaxThemeCustomColors: {},
        terminalUseThemeBackground: true,
        terminalFallbackColor: '#e6e6e6',
        terminalCommandHistory: [],
        searchVisible: {},
        paneA: { activeTabId: null },
        paneB: null,
        updateTabStatus: vi.fn() as never,
        markTabActivity: vi.fn() as never,
        openChatWith: vi.fn(async () => {}) as never,
        addTerminalCommandHistory: vi.fn() as never,
        setTerminalBufferLineCount: vi.fn() as never,
        setSearchVisible: vi.fn() as never,
        toggleSearch: vi.fn() as never,
        toggleTabAutoScroll: vi.fn() as never,
        toggleTabWordWrap: vi.fn() as never
    })
})

afterEach(() => {
    cleanup()
    clearTerminalCache(tab.id)
})

describe('CustomTerminalView remount', () => {
    it('a remounted terminal view keeps its buffer (cache is not clobbered on mount)', () => {
        const instanceA = render(<CustomTerminalView tab={tab} isActive={true} />)

        expect(onDataHandler).not.toBeNull()
        act(() => {
            onDataHandler!(tab.id, { text: 'ERROR boot failed', tokens: [], overlays: [] })
        })

        // The write-through effect should have populated the module cache with the pushed line.
        const afterPush = readTerminalCache(tab.id)
        expect(afterPush).toHaveLength(1)
        expect(afterPush?.[0]?.text).toBe('ERROR boot failed')

        instanceA.unmount()

        // Unmounting must not clear the cache: it is the mechanism that survives a remount.
        const afterUnmount = readTerminalCache(tab.id)
        expect(afterUnmount).toHaveLength(1)
        expect(afterUnmount?.[0]?.text).toBe('ERROR boot failed')

        // Render a brand-new instance for the same tab id (simulating a pane move or the left
        // panel being collapsed and reopened).
        render(<CustomTerminalView tab={tab} isActive={true} />)

        // REGRESSION ASSERTION: with the bug, the fresh instance's `useState([])` mount would
        // run before the write-through effect saw the seeded value, so the write-through effect
        // would immediately overwrite the cache with an empty array and this would read length 0.
        // With the fix, `lines` is lazily seeded from the cache on mount
        // (`useState(() => terminalLinesCache.get(tab.id) ?? [])`), so the write-through effect
        // re-persists the same one-line buffer instead of clobbering it.
        const afterRemount = readTerminalCache(tab.id)
        expect(afterRemount).toHaveLength(1)
        expect(afterRemount?.[0]?.text).toBe('ERROR boot failed')
    })
})
