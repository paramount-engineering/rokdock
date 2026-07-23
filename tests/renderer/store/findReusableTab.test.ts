import { describe, it, expect } from 'vitest'
import { findReusableTab, createTabInfo, type TabInfo } from '@renderer/store/appStore'

function tab(overrides: Partial<TabInfo> = {}): TabInfo {
    return { ...createTabInfo('s1', '10.0.0.5', 'Living Room', 8085), ...overrides }
}

describe('findReusableTab', () => {
    it('returns a connected tab for the same device and port', () => {
        const tabs = [tab({ id: 's1', status: 'connected' })]
        expect(findReusableTab(tabs, '10.0.0.5', 8085)?.id).toBe('s1')
    })

    it('returns a still-connecting tab (a second click during connect should focus it)', () => {
        const tabs = [tab({ id: 's1', status: 'connecting' })]
        expect(findReusableTab(tabs, '10.0.0.5', 8085)?.id).toBe('s1')
    })

    it('ignores a disconnected tab so the user can reconnect', () => {
        const tabs = [tab({ id: 's1', status: 'disconnected' })]
        expect(findReusableTab(tabs, '10.0.0.5', 8085)).toBeUndefined()
    })

    it('ignores an errored tab so the user can reconnect', () => {
        const tabs = [tab({ id: 's1', status: 'error' })]
        expect(findReusableTab(tabs, '10.0.0.5', 8085)).toBeUndefined()
    })

    it('does not match a different port on the same device', () => {
        const tabs = [tab({ id: 's1', status: 'connected', port: 8085 })]
        expect(findReusableTab(tabs, '10.0.0.5', 8089)).toBeUndefined()
    })

    it('does not match a different device on the same port', () => {
        const tabs = [tab({ id: 's1', status: 'connected', deviceIp: '10.0.0.5' })]
        expect(findReusableTab(tabs, '10.0.0.9', 8085)).toBeUndefined()
    })

    it('returns the live tab when a stale disconnected tab for the same target also exists', () => {
        const tabs = [
            tab({ id: 'stale', status: 'disconnected' }),
            tab({ id: 'live', status: 'connected' })
        ]
        expect(findReusableTab(tabs, '10.0.0.5', 8085)?.id).toBe('live')
    })

    it('returns undefined for an empty tab list', () => {
        expect(findReusableTab([], '10.0.0.5', 8085)).toBeUndefined()
    })
})
