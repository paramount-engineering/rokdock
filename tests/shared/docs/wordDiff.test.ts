import { describe, it, expect } from 'vitest'
import { wordDiff } from '@shared/docs/wordDiff'

/** Reassemble a side's segments, to prove no characters were lost. */
function join(segments: { text: string }[]): string {
    return segments.map(segment => segment.text).join('')
}

/** The changed substrings of a side, in order. */
function changed(segments: { text: string; changed: boolean }[]): string[] {
    return segments.filter(segment => segment.changed).map(segment => segment.text)
}

describe('wordDiff', () => {
    it('marks only the changed word in an otherwise identical line', () => {
        const { before, after } = wordDiff('the quick brown fox', 'the slow brown fox')
        expect(changed(before)).toEqual(['quick'])
        expect(changed(after)).toEqual(['slow'])
    })

    it('marks every token changed when nothing is shared', () => {
        const { before, after } = wordDiff('alpha', 'beta gamma')
        expect(changed(before)).toEqual(['alpha'])
        expect(after.every(seg => seg.changed)).toBe(true)
    })

    it('marks nothing changed for identical lines', () => {
        const { before, after } = wordDiff('same line here', 'same line here')
        expect(changed(before)).toEqual([])
        expect(changed(after)).toEqual([])
    })

    it('handles a pure insertion (added words flagged, kept words not)', () => {
        const { before, after } = wordDiff('install the app', 'install the latest app')
        expect(changed(before)).toEqual([])
        expect(changed(after).join('').includes('latest')).toBe(true)
    })

    it('preserves all characters on both sides (whitespace included)', () => {
        const beforeLine = '  set timeout = 30 seconds'
        const afterLine = '  set timeout = 45 seconds'
        const { before, after } = wordDiff(beforeLine, afterLine)
        expect(join(before)).toBe(beforeLine)
        expect(join(after)).toBe(afterLine)
    })

    it('treats empty lines as no change', () => {
        const { before, after } = wordDiff('', '')
        expect(before).toEqual([])
        expect(after).toEqual([])
    })
})
