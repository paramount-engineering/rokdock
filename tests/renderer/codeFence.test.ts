import { describe, it, expect } from 'vitest'
import { wrapInCodeFence } from '@renderer/codeFence'

describe('wrapInCodeFence', () => {
    it('wraps plain text in a triple-backtick fence', () => {
        expect(wrapInCodeFence('a -> b')).toBe('```\na -> b\n```')
    })

    it('preserves multi-line content verbatim', () => {
        expect(wrapInCodeFence('line 1\n  line 2')).toBe('```\nline 1\n  line 2\n```')
    })

    it('grows the fence past an embedded backtick run', () => {
        // The content contains a 3-backtick run, so the outer fence must be 4.
        expect(wrapInCodeFence('x ``` y')).toBe('````\nx ``` y\n````')
    })

    it('tags the opening fence with a language for syntax highlighting', () => {
        expect(wrapInCodeFence('print "hi"', 'roku-console')).toBe('```roku-console\nprint "hi"\n```')
    })

    it('keeps the language on the opening fence when the fence grows', () => {
        expect(wrapInCodeFence('x ``` y', 'roku-console')).toBe('````roku-console\nx ``` y\n````')
    })
})
