import { describe, it, expect } from 'vitest'
import { AI_BETA_SUFFIX, AI_CHAT_TITLE, AI_EXPLAIN_ACTION, withBeta } from '@shared/ai/labels'

describe('ai labels', () => {
    it('exposes the base labels and the beta suffix', () => {
        expect(AI_CHAT_TITLE).toBe('AI Chat')
        expect(AI_EXPLAIN_ACTION).toBe('Explain this')
        expect(AI_BETA_SUFFIX).toBe('(Beta)')
    })
    it('withBeta appends the suffix once', () => {
        expect(withBeta(AI_EXPLAIN_ACTION)).toBe('Explain this (Beta)')
        expect(withBeta(AI_CHAT_TITLE)).toBe('AI Chat (Beta)')
    })
})
