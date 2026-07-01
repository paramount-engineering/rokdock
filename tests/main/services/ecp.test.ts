import { describe, it, expect } from 'vitest'
import { buildQueryString, parseMs, normalizePlayerState } from '@main/services/ecp'

// ---------------------------------------------------------------------------
// buildQueryString
// ---------------------------------------------------------------------------

describe('buildQueryString', () => {
    it('returns an empty string for an empty params object', () => {
        expect(buildQueryString({})).toBe('')
    })

    it('encodes a single key-value pair', () => {
        expect(buildQueryString({ key: 'value' })).toBe('key=value')
    })

    it('encodes multiple pairs joined by &', () => {
        const result = buildQueryString({ a: '1', b: '2' })
        // Order follows Object.entries order (insertion order)
        expect(result).toBe('a=1&b=2')
    })

    it('percent-encodes special characters in keys and values', () => {
        const result = buildQueryString({ 'content id': 'a b+c' })
        expect(result).toBe('content%20id=a%20b%2Bc')
    })

    it('percent-encodes an equals sign in a value', () => {
        const result = buildQueryString({ q: 'x=y' })
        expect(result).toBe('q=x%3Dy')
    })

    it('percent-encodes an ampersand in a value', () => {
        const result = buildQueryString({ text: 'a&b' })
        expect(result).toBe('text=a%26b')
    })

    it('handles an empty string value', () => {
        expect(buildQueryString({ key: '' })).toBe('key=')
    })
})

// ---------------------------------------------------------------------------
// parseMs
// ---------------------------------------------------------------------------

describe('parseMs', () => {
    it('returns undefined for undefined input', () => {
        expect(parseMs(undefined)).toBeUndefined()
    })

    it('returns undefined for null input', () => {
        expect(parseMs(null)).toBeUndefined()
    })

    it('returns undefined for an empty string', () => {
        expect(parseMs('')).toBeUndefined()
    })

    it('returns the number for a plain numeric value', () => {
        expect(parseMs(5000)).toBe(5000)
    })

    it('parses a plain numeric string', () => {
        expect(parseMs('1234')).toBe(1234)
    })

    it('strips non-digit characters (e.g. "10 ms") and returns the integer', () => {
        expect(parseMs('10 ms')).toBe(10)
    })

    it('strips "ms" suffix with no space', () => {
        expect(parseMs('250ms')).toBe(250)
    })

    it('returns undefined for a non-numeric string', () => {
        expect(parseMs('not a number')).toBeUndefined()
    })

    it('returns undefined for a negative value (guard against negative ms)', () => {
        expect(parseMs(-1)).toBeUndefined()
    })

    it('returns 0 for the value 0', () => {
        // 0 is valid (player at start position)
        expect(parseMs(0)).toBe(0)
    })
})

// ---------------------------------------------------------------------------
// normalizePlayerState
// ---------------------------------------------------------------------------

describe('normalizePlayerState', () => {
    it('normalizes "play" to "play"', () => {
        expect(normalizePlayerState('play')).toBe('play')
    })

    it('normalizes "playing" to "play"', () => {
        expect(normalizePlayerState('playing')).toBe('play')
    })

    it('normalizes "pause" to "pause"', () => {
        expect(normalizePlayerState('pause')).toBe('pause')
    })

    it('normalizes "paused" to "pause"', () => {
        expect(normalizePlayerState('paused')).toBe('pause')
    })

    it('normalizes "buffering" to "buffering"', () => {
        expect(normalizePlayerState('buffering')).toBe('buffering')
    })

    it('normalizes "finished" to "finished"', () => {
        expect(normalizePlayerState('finished')).toBe('finished')
    })

    it('normalizes "finish" (alternate firmware spelling) to "finished"', () => {
        expect(normalizePlayerState('finish')).toBe('finished')
    })

    it('normalizes an unrecognized value to "stop"', () => {
        expect(normalizePlayerState('unknown')).toBe('stop')
    })

    it('normalizes an empty string to "stop"', () => {
        expect(normalizePlayerState('')).toBe('stop')
    })

    it('normalizes "stop" to "stop"', () => {
        expect(normalizePlayerState('stop')).toBe('stop')
    })
})
