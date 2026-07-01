import { describe, it, expect } from 'vitest'
import { safeJsonObject } from '@ai-core/adapters/json'

describe('safeJsonObject', () => {
    it('returns the parsed object for a valid JSON object', () => {
        expect(safeJsonObject('{"query":"roSGNode","n":2}')).toEqual({ query: 'roSGNode', n: 2 })
    })

    it('returns {} for empty input', () => {
        expect(safeJsonObject('')).toEqual({})
    })

    it('returns {} for malformed JSON', () => {
        expect(safeJsonObject('not json')).toEqual({})
        expect(safeJsonObject('{"query":')).toEqual({})
    })

    it('returns {} for valid JSON that is not a plain object', () => {
        // `null` is the dangerous one: a caller doing result.name on it would throw.
        expect(safeJsonObject('null')).toEqual({})
        expect(safeJsonObject('5')).toEqual({})
        expect(safeJsonObject('true')).toEqual({})
        expect(safeJsonObject('"hi"')).toEqual({})
        expect(safeJsonObject('[1,2,3]')).toEqual({})
    })
})
