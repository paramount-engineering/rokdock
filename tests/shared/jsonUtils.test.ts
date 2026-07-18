import { describe, it, expect } from 'vitest'
import { findMatchingBracket, keepOutermostSpans } from '@shared/jsonUtils'

// ---------------------------------------------------------------------------
// findMatchingBracket
// ---------------------------------------------------------------------------

describe('findMatchingBracket - curly braces', () => {
    it('finds the matching closing brace at the end of the string', () => {
        expect(findMatchingBracket('{"a":1}', 0)).toBe(6)
    })

    it('finds the matching brace when preceded by other text', () => {
        const text = 'prefix {"key":"val"}'
        const start = text.indexOf('{')
        expect(findMatchingBracket(text, start)).toBe(text.length - 1)
    })

    it('returns -1 when there is no matching closing brace', () => {
        expect(findMatchingBracket('{"a":1', 0)).toBe(-1)
    })

    it('handles nested braces correctly', () => {
        const text = '{"outer":{"inner":1}}'
        // outer closes at the last char
        expect(findMatchingBracket(text, 0)).toBe(text.length - 1)
        // inner opens at index 9, closes at index 19
        expect(findMatchingBracket(text, 9)).toBe(19)
    })
})

describe('findMatchingBracket - square brackets', () => {
    it('finds the matching closing bracket', () => {
        expect(findMatchingBracket('[1,2,3]', 0)).toBe(6)
    })

    it('handles nested brackets', () => {
        const text = '[[1,2],[3,4]]'
        expect(findMatchingBracket(text, 0)).toBe(text.length - 1)
        // inner first array opens at 1, closes at 5
        expect(findMatchingBracket(text, 1)).toBe(5)
    })

    it('returns -1 for an unmatched opening bracket', () => {
        expect(findMatchingBracket('[1,2', 0)).toBe(-1)
    })
})

describe('findMatchingBracket - string literal handling', () => {
    it('does not mistake a closing brace inside a string for the match', () => {
        // The string value contains a "}" but the real match is the last char
        const text = '{"key":"value with } inside"}'
        expect(findMatchingBracket(text, 0)).toBe(text.length - 1)
    })

    it('does not mistake a closing bracket inside a string for the match', () => {
        const text = '["item with ] inside"]'
        expect(findMatchingBracket(text, 0)).toBe(text.length - 1)
    })

    it('handles escaped double quotes inside a string value correctly', () => {
        // The \" inside the string should not end the string early
        const text = '{"key":"val\\"ue"}'
        expect(findMatchingBracket(text, 0)).toBe(text.length - 1)
    })

    it('handles a string containing a nested opening brace that is never matched outside', () => {
        // The '{' inside the string is not a real nesting increment
        const text = '{"k":"v{nested"}'
        expect(findMatchingBracket(text, 0)).toBe(text.length - 1)
    })
})

describe('findMatchingBracket - edge cases', () => {
    it('returns -1 when start is not an opening brace or bracket', () => {
        expect(findMatchingBracket('hello world', 0)).toBe(-1)
        expect(findMatchingBracket('hello world', 5)).toBe(-1)
    })

    it('returns -1 for an empty string', () => {
        expect(findMatchingBracket('', 0)).toBe(-1)
    })

    it('finds a single-char empty array []', () => {
        // "[]" is 2 chars; bracket opens at 0, closes at 1
        expect(findMatchingBracket('[]', 0)).toBe(1)
    })

    it('finds a single-char empty object {}', () => {
        expect(findMatchingBracket('{}', 0)).toBe(1)
    })

    it('correctly handles a start offset mid-string', () => {
        const text = 'before [1,2] after'
        const start = text.indexOf('[')
        expect(findMatchingBracket(text, start)).toBe(text.indexOf(']'))
    })

    it('handles deeply nested structures', () => {
        const text = '[[[1]]]'
        expect(findMatchingBracket(text, 0)).toBe(6)
        expect(findMatchingBracket(text, 1)).toBe(5)
        expect(findMatchingBracket(text, 2)).toBe(4)
    })
})

// ---------------------------------------------------------------------------
// keepOutermostSpans
// ---------------------------------------------------------------------------

describe('keepOutermostSpans', () => {
    it('returns the input unchanged (same reference) for zero or one span', () => {
        const one = [{ start: 0, end: 5 }]
        expect(keepOutermostSpans(one)).toBe(one)
        const none: Array<{ start: number; end: number }> = []
        expect(keepOutermostSpans(none)).toBe(none)
    })

    it('drops a span entirely contained within a wider one', () => {
        const outer = { start: 0, end: 20 }
        const inner = { start: 9, end: 18 }
        const result = keepOutermostSpans([inner, outer])
        expect(result).toEqual([outer])
    })

    it('keeps disjoint sibling spans', () => {
        const first = { start: 0, end: 5 }
        const second = { start: 10, end: 20 }
        expect(keepOutermostSpans([first, second])).toEqual([first, second])
    })

    it('keeps both when spans partially overlap (neither contains the other)', () => {
        const first = { start: 0, end: 10 }
        const second = { start: 5, end: 15 }
        expect(keepOutermostSpans([first, second])).toEqual([first, second])
    })

    it('drops exact-duplicate ranges, keeping one', () => {
        const spanA = { start: 2, end: 8, tag: 'a' }
        const spanB = { start: 2, end: 8, tag: 'b' }
        expect(keepOutermostSpans([spanA, spanB])).toHaveLength(1)
    })
})
