import { describe, it, expect } from 'vitest'
import { resolveTerminalCopyText, type TerminalCopySelection } from '@renderer/components/terminal/terminalCopy'

// A buffer larger than any single virtual window in these cases.
const buffer = Array.from({ length: 20 }, (_, i) => `line ${i}`)

function selection(overrides: Partial<TerminalCopySelection>): TerminalCopySelection {
    return { selectAllActive: false, nativeText: '', anchorLineIndex: null, focusLineIndex: null, ...overrides }
}

describe('resolveTerminalCopyText', () => {
    it('copies the entire buffer for Select All, regardless of what the DOM holds', () => {
        // The DOM selection only reflects a handful of virtualized rows...
        const text = resolveTerminalCopyText(
            selection({ selectAllActive: true, nativeText: 'line 8\nline 9\nline 10' }),
            buffer
        )
        // ...but Select All yields every line.
        expect(text).toBe(buffer.join('\n'))
        expect(text.split('\n')).toHaveLength(20)
    })

    it('returns the empty string when nothing is selected', () => {
        expect(resolveTerminalCopyText(selection({ nativeText: '' }), buffer)).toBe('')
    })

    it('uses the native text when the selection endpoints cannot be mapped to lines', () => {
        const text = resolveTerminalCopyText(
            selection({ nativeText: 'partial', anchorLineIndex: null, focusLineIndex: 5 }),
            buffer
        )
        expect(text).toBe('partial')
    })

    it('trusts the native text for an in-window selection (nothing dropped)', () => {
        // Selection spans lines 3..5 (3 lines) and the native text has all 3, including a
        // partial first/last line, so it is authoritative.
        const text = resolveTerminalCopyText(
            selection({ nativeText: 'ne 3\nline 4\nlin', anchorLineIndex: 3, focusLineIndex: 5 }),
            buffer
        )
        expect(text).toBe('ne 3\nline 4\nlin')
    })

    it('rebuilds from the buffer when virtualization dropped rows mid-range', () => {
        // The user selected lines 2..12 (11 lines) but the DOM only had the last few rows,
        // so the native text is short. Rebuild the full range from the buffer.
        const text = resolveTerminalCopyText(
            selection({ nativeText: 'line 10\nline 11\nline 12', anchorLineIndex: 2, focusLineIndex: 12 }),
            buffer
        )
        expect(text).toBe(buffer.slice(2, 13).join('\n'))
        expect(text.split('\n')).toHaveLength(11)
    })

    it('normalizes reversed endpoints (focus above anchor)', () => {
        const text = resolveTerminalCopyText(
            selection({ nativeText: 'line 12', anchorLineIndex: 12, focusLineIndex: 2 }),
            buffer
        )
        expect(text).toBe(buffer.slice(2, 13).join('\n'))
    })

    it('keeps a single-line partial selection as the native text', () => {
        const text = resolveTerminalCopyText(
            selection({ nativeText: 'ne 7', anchorLineIndex: 7, focusLineIndex: 7 }),
            buffer
        )
        expect(text).toBe('ne 7')
    })
})
