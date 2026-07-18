import { describe, it, expect } from 'vitest'
import { resolveFocusedTerminalPayload } from '@renderer/terminalOutputResolver'
import type { TerminalLineChunk } from '@shared/terminal'

function chunk(text: string): TerminalLineChunk {
    return { text, tokens: [], overlays: [] }
}

const tab = (id: string, deviceName: string, paneId: 'a' | 'b') => ({
    id, deviceIp: '10.0.0.5', deviceName, port: 8085,
    status: 'connected' as const, autoScroll: true, wordWrap: false, hasActivity: false, paneId,
})

const baseState = {
    focusedPaneId: 'a' as const,
    paneA: { activeTabId: 't1' },
    paneB: null,
    tabs: [tab('t1', 'Living Room', 'a')],
}

describe('resolveFocusedTerminalPayload', () => {
    it('returns the focused tab label and lines from the cache', () => {
        const cache = new Map<string, TerminalLineChunk[]>([['t1', [chunk('one'), chunk('two')]]])
        const payload = resolveFocusedTerminalPayload(baseState, id => cache.get(id))
        expect(payload).toEqual({ label: 'Living Room', lines: ['one', 'two'] })
    })

    it('answers from the cache even when the terminal view is unmounted (collapsed panel)', () => {
        // No component mounted; the cache still holds the last write-through buffer.
        const cache = new Map<string, TerminalLineChunk[]>([['t1', [chunk('frozen')]]])
        const payload = resolveFocusedTerminalPayload(baseState, id => cache.get(id))
        expect(payload?.lines).toEqual(['frozen'])
    })

    it('returns empty lines when the focused tab has no cache entry yet', () => {
        const payload = resolveFocusedTerminalPayload(baseState, () => undefined)
        expect(payload).toEqual({ label: 'Living Room', lines: [] })
    })

    it('returns null when no tab is focused', () => {
        const state = { ...baseState, paneA: { activeTabId: null } }
        expect(resolveFocusedTerminalPayload(state, () => undefined)).toBeNull()
    })

    it('resolves pane B when it is focused', () => {
        const state = {
            focusedPaneId: 'b' as const,
            paneA: { activeTabId: 't1' },
            paneB: { activeTabId: 't2' },
            tabs: [tab('t1', 'Living Room', 'a'), tab('t2', 'Bedroom', 'b')],
        }
        const cache = new Map<string, TerminalLineChunk[]>([['t2', [chunk('b-line')]]])
        const payload = resolveFocusedTerminalPayload(state, id => cache.get(id))
        expect(payload).toEqual({ label: 'Bedroom', lines: ['b-line'] })
    })
})
