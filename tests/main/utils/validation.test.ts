/**
 * Unit tests for the IPC input-validation and sanitization utilities.
 *
 * These functions guard the IPC boundary (renderer-supplied values used in
 * main-process file I/O, network requests, and store writes), so their edge
 * cases are security and correctness relevant. All pure functions, no mocks.
 */

import { describe, it, expect } from 'vitest'
import {
    clampInt,
    isNonEmptyString,
    isValidPort,
    asThemeMode,
    isValidPanelState,
    normalizeAutoRefreshIntervalSec,
    isValidIp,
    isValidPortConfig,
    isValidDeeplinkConfig,
    escapeHtml
} from '@main/utils/validation'
import { AUTO_REFRESH_INTERVALS_SEC } from '@main/constants/preview'

describe('clampInt', () => {
    it('clamps to the inclusive range and rounds to the nearest integer', () => {
        expect(clampInt(5, 0, 10)).toBe(5)
        expect(clampInt(-3, 0, 10)).toBe(0)
        expect(clampInt(99, 0, 10)).toBe(10)
        expect(clampInt(5.6, 0, 10)).toBe(6)
        expect(clampInt(5.4, 0, 10)).toBe(5)
        expect(clampInt(10.9, 0, 10)).toBe(10)
    })
})

describe('isNonEmptyString', () => {
    it('is true only for strings with non-whitespace content', () => {
        expect(isNonEmptyString('x')).toBe(true)
        expect(isNonEmptyString('  hi  ')).toBe(true)
    })
    it('is false for empty, whitespace-only, and non-strings', () => {
        expect(isNonEmptyString('')).toBe(false)
        expect(isNonEmptyString('   ')).toBe(false)
        expect(isNonEmptyString('\t\n')).toBe(false)
        expect(isNonEmptyString(5)).toBe(false)
        expect(isNonEmptyString(null)).toBe(false)
        expect(isNonEmptyString(undefined)).toBe(false)
        expect(isNonEmptyString({})).toBe(false)
    })
})

describe('isValidPort', () => {
    it('accepts integers in 1-65535', () => {
        expect(isValidPort(1)).toBe(true)
        expect(isValidPort(8060)).toBe(true)
        expect(isValidPort(65535)).toBe(true)
    })
    it('rejects out-of-range, non-integer, and non-number values', () => {
        expect(isValidPort(0)).toBe(false)
        expect(isValidPort(65536)).toBe(false)
        expect(isValidPort(-1)).toBe(false)
        expect(isValidPort(3.5)).toBe(false)
        expect(isValidPort('8060')).toBe(false)
        expect(isValidPort(NaN)).toBe(false)
        expect(isValidPort(Infinity)).toBe(false)
        expect(isValidPort(null)).toBe(false)
    })
})

describe('asThemeMode', () => {
    it("returns 'light' only for the exact string 'light', otherwise 'dark'", () => {
        expect(asThemeMode('light')).toBe('light')
        expect(asThemeMode('dark')).toBe('dark')
        expect(asThemeMode('Light')).toBe('dark')
        expect(asThemeMode('')).toBe('dark')
        expect(asThemeMode(undefined)).toBe('dark')
        expect(asThemeMode(null)).toBe('dark')
        expect(asThemeMode(1)).toBe('dark')
    })
})

describe('isValidPanelState', () => {
    it('accepts an object with boolean leftOpen and rightOpen', () => {
        expect(isValidPanelState({ leftOpen: true, rightOpen: false })).toBe(true)
    })
    it('rejects missing fields, wrong types, and non-objects', () => {
        expect(isValidPanelState({ leftOpen: true })).toBe(false)
        expect(isValidPanelState({ leftOpen: 'yes', rightOpen: false })).toBe(false)
        expect(isValidPanelState(null)).toBe(false)
        expect(isValidPanelState('x')).toBe(false)
        expect(isValidPanelState(undefined)).toBe(false)
    })
    it('accepts optional leftWidth, leftSplit, and aiChatOpen', () => {
        expect(isValidPanelState({ leftOpen: true, rightOpen: false, leftWidth: 320, leftSplit: 0.4, aiChatOpen: true })).toBe(true)
    })
    it('rejects non-number leftWidth / leftSplit', () => {
        expect(isValidPanelState({ leftOpen: true, rightOpen: false, leftWidth: 'x' })).toBe(false)
        expect(isValidPanelState({ leftOpen: true, rightOpen: false, leftSplit: 'y' })).toBe(false)
    })
})

describe('normalizeAutoRefreshIntervalSec', () => {
    const sorted = [...AUTO_REFRESH_INTERVALS_SEC].sort((numA, numB) => numA - numB)
    const min = sorted[0]
    const max = sorted[sorted.length - 1]

    it('returns an allowed option for any input', () => {
        for (const testValue of [-100, 0, 1, 7, 42, 99999]) {
            expect(AUTO_REFRESH_INTERVALS_SEC).toContain(normalizeAutoRefreshIntervalSec(testValue))
        }
    })
    it('returns each allowed option unchanged when given exactly', () => {
        for (const option of AUTO_REFRESH_INTERVALS_SEC) {
            expect(normalizeAutoRefreshIntervalSec(option)).toBe(option)
        }
    })
    it('clamps below-min and above-max to the nearest endpoint', () => {
        expect(normalizeAutoRefreshIntervalSec(min - 1000)).toBe(min)
        expect(normalizeAutoRefreshIntervalSec(max + 1000)).toBe(max)
    })
})

describe('isValidIp', () => {
    it('accepts well-formed IPv4 addresses (trimming surrounding whitespace)', () => {
        expect(isValidIp('192.168.1.100')).toBe(true)
        expect(isValidIp('0.0.0.0')).toBe(true)
        expect(isValidIp('255.255.255.255')).toBe(true)
        expect(isValidIp('  10.0.0.1  ')).toBe(true)
    })
    it('rejects out-of-range octets, wrong shapes, and non-strings', () => {
        expect(isValidIp('256.1.1.1')).toBe(false)
        expect(isValidIp('1.2.3')).toBe(false)
        expect(isValidIp('1.2.3.4.5')).toBe(false)
        expect(isValidIp('1.2.3.x')).toBe(false)
        expect(isValidIp('hello')).toBe(false)
        expect(isValidIp('')).toBe(false)
        expect(isValidIp('192.168.1.1; rm -rf /')).toBe(false)
        expect(isValidIp(12345)).toBe(false)
        expect(isValidIp(null)).toBe(false)
        expect(isValidIp(undefined)).toBe(false)
    })
})

describe('isValidPortConfig', () => {
    const valid = { port: 8085, label: 'Debug', color: '#fff', enabled: true }
    it('accepts a well-formed port config', () => {
        expect(isValidPortConfig(valid)).toBe(true)
    })
    it('rejects bad port, missing/typed fields, and non-objects', () => {
        expect(isValidPortConfig({ ...valid, port: 0 })).toBe(false)
        expect(isValidPortConfig({ ...valid, label: 5 })).toBe(false)
        expect(isValidPortConfig({ ...valid, enabled: 'yes' })).toBe(false)
        expect(isValidPortConfig({ port: 8085 })).toBe(false)
        expect(isValidPortConfig(null)).toBe(false)
        expect(isValidPortConfig('x')).toBe(false)
    })
})

describe('isValidDeeplinkConfig', () => {
    const valid = {
        id: 'd1',
        name: 'Test',
        type: 'launch',
        appId: '12',
        mediaType: 'movie',
        contentId: 'abc',
        extraParams: [{ key: 'k', value: 'v' }]
    }
    it('accepts a well-formed launch and input deeplink config', () => {
        expect(isValidDeeplinkConfig(valid)).toBe(true)
        expect(isValidDeeplinkConfig({ ...valid, type: 'input' })).toBe(true)
        expect(isValidDeeplinkConfig({ ...valid, extraParams: [] })).toBe(true)
    })
    it('rejects bad type, missing fields, and malformed extraParams', () => {
        expect(isValidDeeplinkConfig({ ...valid, type: 'other' })).toBe(false)
        expect(isValidDeeplinkConfig({ ...valid, appId: 12 })).toBe(false)
        expect(isValidDeeplinkConfig({ ...valid, extraParams: 'nope' })).toBe(false)
        expect(isValidDeeplinkConfig({ ...valid, extraParams: [{ key: 'k' }] })).toBe(false)
        expect(isValidDeeplinkConfig({ ...valid, extraParams: [{ key: 1, value: 'v' }] })).toBe(false)
        expect(isValidDeeplinkConfig(null)).toBe(false)
    })
})

describe('escapeHtml', () => {
    it('escapes all five special characters', () => {
        expect(escapeHtml('&')).toBe('&amp;')
        expect(escapeHtml('<')).toBe('&lt;')
        expect(escapeHtml('>')).toBe('&gt;')
        expect(escapeHtml('"')).toBe('&quot;')
        expect(escapeHtml("'")).toBe('&#39;')
    })
    it('neutralizes a script-injection attempt', () => {
        expect(escapeHtml('<script>alert("x")</script>'))
            .toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
    })
    it('escapes ampersands first so other entities are not double-escaped', () => {
        // If < were escaped before &, the result would be &amp;lt; (wrong).
        expect(escapeHtml('<')).toBe('&lt;')
        expect(escapeHtml('a & b < c')).toBe('a &amp; b &lt; c')
    })
    it('leaves ordinary text unchanged', () => {
        expect(escapeHtml('hello world 123')).toBe('hello world 123')
    })
})
