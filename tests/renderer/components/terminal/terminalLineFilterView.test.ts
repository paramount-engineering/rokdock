import { describe, it, expect } from 'vitest'
import {
    linesForCopy,
    resolveBufferLineIndex,
    toFilteredPosition
} from '@renderer/components/terminal/terminalLineFilterView'

const lineTexts = ['alpha', 'beta', 'gamma alpha', 'delta', 'alpha beta']

describe('resolveBufferLineIndex', () => {
    it('is the identity when no filter is active', () => {
        expect(resolveBufferLineIndex(null, 3)).toBe(3)
    })

    it('maps a render position to the real buffer index through the filtered list', () => {
        expect(resolveBufferLineIndex([0, 2, 4], 1)).toBe(2)
    })
})

describe('linesForCopy', () => {
    it('returns every line when no filter is active', () => {
        expect(linesForCopy(lineTexts, null)).toEqual(lineTexts)
    })

    it('returns only the filtered lines, in buffer order, when a filter is active', () => {
        expect(linesForCopy(lineTexts, [0, 2, 4])).toEqual(['alpha', 'gamma alpha', 'alpha beta'])
    })
})

describe('toFilteredPosition', () => {
    it('is the identity when no filter is active', () => {
        expect(toFilteredPosition(null, 3)).toBe(3)
    })

    it('returns null when the buffer index is null', () => {
        expect(toFilteredPosition([0, 2, 4], null)).toBeNull()
    })

    it('maps a real buffer index to its position within the filtered list', () => {
        expect(toFilteredPosition([0, 2, 4], 4)).toBe(2)
    })

    it('returns null when the buffer index is not part of the filtered list', () => {
        expect(toFilteredPosition([0, 2, 4], 3)).toBeNull()
    })
})
