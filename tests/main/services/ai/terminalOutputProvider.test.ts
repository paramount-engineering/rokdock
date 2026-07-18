import { describe, it, expect, vi } from 'vitest'
import { createTerminalOutputProvider } from '@main/services/ai/terminalOutputProvider'
import type { FocusedTerminalPayload } from '@shared/terminal'

const SIGNAL = new AbortController().signal

function make(payload: FocusedTerminalPayload | null) {
    const redact = vi.fn(async (text: string) => text)
    const readFocusedTerminal = vi.fn(async () => payload)
    const provider = createTerminalOutputProvider({ readFocusedTerminal, redact })
    return { provider, redact, readFocusedTerminal }
}

function lines(count: number, make = (i: number) => `line ${i}`): FocusedTerminalPayload {
    return { label: 'Living Room', lines: Array.from({ length: count }, (_unused, i) => make(i + 1)) }
}

describe('terminalOutputProvider tool specs', () => {
    it('exposes the read and search tools', () => {
        const names = make(null).provider.tools!().map(tool => tool.name).sort()
        expect(names).toEqual(['read_terminal_output', 'search_terminal_output'])
    })
})

describe('read_terminal_output', () => {
    it('tails the default 200 lines with a total-count header', async () => {
        const { provider } = make(lines(500))
        const result = await provider.callTool!('read_terminal_output', {}, SIGNAL)
        expect(result.content).toContain('500 total lines')
        expect(result.content).toContain('showing the last 200')
        expect(result.content).toContain('line 500')
        expect(result.content).not.toContain('line 300')
        expect(result.content).toContain('line 301')
    })

    it('clamps limit to 1000', async () => {
        const { provider } = make(lines(2000))
        const result = await provider.callTool!('read_terminal_output', { limit: 99999 }, SIGNAL)
        expect(result.content).toContain('showing the last 1000')
        expect(result.content).toContain('line 2000')
        expect(result.content).not.toContain('line 1000\n')
    })

    it('truncates to the char cap keeping the most recent lines', async () => {
        const big = lines(1000, () => 'x'.repeat(500)) // 1000 * ~500 chars = ~500 KB, over the 40 KB cap
        const { provider } = make(big)
        const result = await provider.callTool!('read_terminal_output', { limit: 1000 }, SIGNAL)
        expect(result.content.length).toBeLessThan(41000)
        expect(result.content).toContain('older lines omitted to fit')
    })

    it('keeps the single most recent line even when it alone exceeds the char cap', async () => {
        // A lone giant line (e.g. a huge JSON blob) must not be dropped to an empty result.
        const huge = 'BLOB' + 'y'.repeat(50000)
        const { provider } = make({ label: 'Living Room', lines: [huge] })
        const result = await provider.callTool!('read_terminal_output', {}, SIGNAL)
        expect(result.content).toContain('showing the last 1')
        expect(result.content).toContain('BLOByyyy')
    })

    it('reports no focused terminal', async () => {
        const { provider } = make(null)
        const result = await provider.callTool!('read_terminal_output', {}, SIGNAL)
        expect(result.content).toBe('No terminal tab is focused.')
    })

    it('reports an empty buffer', async () => {
        const { provider } = make({ label: 'Living Room', lines: [] })
        const result = await provider.callTool!('read_terminal_output', {}, SIGNAL)
        expect(result.content).toBe('The focused terminal has no output yet.')
    })

    it('redacts every content-bearing result', async () => {
        const { provider, redact } = make(lines(10))
        await provider.callTool!('read_terminal_output', {}, SIGNAL)
        expect(redact).toHaveBeenCalledOnce()
    })
})

describe('search_terminal_output', () => {
    it('returns matches most-recent-first with context and a header', async () => {
        const payload: FocusedTerminalPayload = {
            label: 'Living Room',
            lines: ['boot', 'ERROR first', 'ok', 'ERROR second', 'done'],
        }
        const { provider } = make(payload)
        const result = await provider.callTool!('search_terminal_output', { pattern: 'error', contextLines: 1 }, SIGNAL)
        expect(result.content).toContain('2 match(es) for "error"')
        const firstIdx = result.content.indexOf('ERROR second')
        const secondIdx = result.content.indexOf('ERROR first')
        expect(firstIdx).toBeGreaterThanOrEqual(0)
        expect(firstIdx).toBeLessThan(secondIdx) // most recent match printed first
    })

    it('is case-insensitive substring, caps matches at 30', async () => {
        const payload: FocusedTerminalPayload = { label: 'X', lines: Array.from({ length: 100 }, () => 'Warn here') }
        const { provider } = make(payload)
        const result = await provider.callTool!('search_terminal_output', { pattern: 'WARN', maxMatches: 999 }, SIGNAL)
        expect(result.content).toContain('showing 30')
    })

    it('reports zero matches', async () => {
        const { provider } = make(lines(5))
        const result = await provider.callTool!('search_terminal_output', { pattern: 'nope' }, SIGNAL)
        expect(result.content).toContain('0 match(es)')
    })

    it('requires a non-empty pattern', async () => {
        const { provider } = make(lines(5))
        const result = await provider.callTool!('search_terminal_output', { pattern: '' }, SIGNAL)
        expect(result.isError).toBe(true)
    })

    it('redacts every content-bearing result', async () => {
        const { provider, redact } = make(lines(5))
        await provider.callTool!('search_terminal_output', { pattern: 'line' }, SIGNAL)
        expect(redact).toHaveBeenCalledOnce()
    })

    it('reports no focused terminal', async () => {
        const { provider } = make(null)
        const result = await provider.callTool!('search_terminal_output', { pattern: 'x' }, SIGNAL)
        expect(result.content).toBe('No terminal tab is focused.')
    })

    it('reports an empty buffer', async () => {
        const { provider } = make({ label: 'Living Room', lines: [] })
        const result = await provider.callTool!('search_terminal_output', { pattern: 'x' }, SIGNAL)
        expect(result.content).toBe('The focused terminal has no output yet.')
    })
})
