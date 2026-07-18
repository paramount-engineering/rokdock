import { describe, it, expect } from 'vitest'
import { findSearchMatches, filterMatchingLineIndices } from '@shared/regexMatch'

describe('findSearchMatches', () => {
    it('finds every non-empty match across lines with a global pattern', () => {
        const result = findSearchMatches('ab', 'g', ['abab', 'xab', 'no'])
        expect(result).toEqual({
            status: 'ok',
            matches: [
                { lineIndex: 0, start: 0, end: 2 },
                { lineIndex: 0, start: 2, end: 4 },
                { lineIndex: 1, start: 1, end: 3 },
            ],
        })
    })

    it('honors case-insensitive flags', () => {
        const result = findSearchMatches('AB', 'gi', ['ab AB'])
        expect(result.status).toBe('ok')
        expect(result.status === 'ok' && result.matches).toHaveLength(2)
    })

    it('skips empty-string matches without looping forever', () => {
        // A pattern that can match empty (a*) must still terminate and only record real spans.
        const result = findSearchMatches('a*', 'g', ['baaa'])
        expect(result.status).toBe('ok')
        expect(result.status === 'ok' && result.matches).toEqual([{ lineIndex: 0, start: 1, end: 4 }])
    })

    it('does not loop forever on a non-global pattern', () => {
        // Guard: a non-global pattern never advances lastIndex; we must break after one match per line.
        const result = findSearchMatches('a', '', ['aaa'])
        expect(result.status).toBe('ok')
        expect(result.status === 'ok' && result.matches).toEqual([{ lineIndex: 0, start: 0, end: 1 }])
    })

    it('reports an invalid pattern rather than throwing', () => {
        expect(findSearchMatches('(', 'g', ['x'])).toEqual({ status: 'invalid' })
    })

    it('ignores empty lines', () => {
        const result = findSearchMatches('x', 'g', ['', 'x', ''])
        expect(result.status === 'ok' && result.matches).toEqual([{ lineIndex: 1, start: 0, end: 1 }])
    })
})

describe('filterMatchingLineIndices', () => {
    it('returns the indices of matching lines', () => {
        expect(filterMatchingLineIndices('err', '', ['ok', 'error here', 'also err', 'fine']))
            .toEqual({ status: 'ok', keptIndices: [1, 2] })
    })

    it('is stateless across lines even with a global flag', () => {
        // lastIndex is reset per line, so a global pattern does not skip lines.
        expect(filterMatchingLineIndices('a', 'g', ['a', 'a', 'a']))
            .toEqual({ status: 'ok', keptIndices: [0, 1, 2] })
    })

    it('reports an invalid pattern rather than throwing', () => {
        expect(filterMatchingLineIndices('(', '', ['x'])).toEqual({ status: 'invalid' })
    })
})
