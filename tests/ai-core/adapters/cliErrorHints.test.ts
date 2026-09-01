import { describe, it, expect } from 'vitest'
import { enrichCliError } from '@ai-core/adapters/cliErrorHints'

describe('enrichCliError', () => {
    it('explains a Claude Code denylist/allowlist tool-name mismatch and keeps the raw error', () => {
        const raw = 'AI CLI exited with code 1: Permission deny rule "SlashCommand" matches no known tool - check for typos.'
        const enriched = enrichCliError('claude', raw)
        expect(enriched).toContain('"SlashCommand"')
        expect(enriched).toContain('CLI is out of date')
        expect(enriched).toContain(raw)
    })

    it('matches an allow-rule mismatch, not just a deny-rule one', () => {
        const raw = 'Permission allow rule "Foo" matches no known tool - check for typos.'
        const enriched = enrichCliError('claude', raw)
        expect(enriched).toContain('"Foo"')
    })

    it('passes an unrecognized message through unchanged', () => {
        const raw = 'AI CLI exited with code 1: some unrelated failure'
        expect(enrichCliError('claude', raw)).toBe(raw)
    })

    it('passes messages through unchanged for a CLI kind with no registered hints', () => {
        const raw = 'Permission deny rule "SlashCommand" matches no known tool'
        expect(enrichCliError('codex', raw)).toBe(raw)
    })
})
