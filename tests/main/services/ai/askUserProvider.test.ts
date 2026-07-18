import { describe, it, expect, vi } from 'vitest'
import { createAskUserProvider } from '@main/services/ai/askUserProvider'

const SIGNAL = new AbortController().signal

describe('askUserProvider', () => {
    it('exposes the ask_user tool', () => {
        expect(createAskUserProvider().tools!().map(tool => tool.name)).toEqual(['ask_user'])
    })

    it('presents the question via context.ask and returns the chosen option', async () => {
        const ask = vi.fn(async () => 'Benjamin (Office)')
        const result = await createAskUserProvider().callTool!(
            'ask_user', { question: 'Which device?', options: ['Nemo', 'Benjamin (Office)'] }, SIGNAL, { ask },
        )
        expect(ask).toHaveBeenCalledWith('Which device?', ['Nemo', 'Benjamin (Office)'])
        expect(result.isError).toBeFalsy()
        expect(result.content).toBe('The user chose: Benjamin (Office)')
    })

    it('reports when the user dismissed without choosing', async () => {
        const result = await createAskUserProvider().callTool!(
            'ask_user', { question: 'Pick', options: ['A', 'B'] }, SIGNAL, { ask: async () => null },
        )
        expect(result.isError).toBe(true)
        expect(result.content).toContain('dismissed')
    })

    it('errors when options are missing or empty', async () => {
        const result = await createAskUserProvider().callTool!('ask_user', { question: 'Pick', options: [] }, SIGNAL, { ask: async () => null })
        expect(result.isError).toBe(true)
    })

    it('errors when no ask hook is available in this context', async () => {
        const result = await createAskUserProvider().callTool!('ask_user', { question: 'Pick', options: ['A'] }, SIGNAL)
        expect(result.isError).toBe(true)
        expect(result.content).toContain('plain text')
    })
})
