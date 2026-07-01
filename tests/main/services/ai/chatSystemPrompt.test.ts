import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadChatSystemPrompt, FALLBACK_CHAT_SYSTEM_PROMPT } from '@main/services/ai/chatSystemPrompt'

describe('loadChatSystemPrompt', () => {
    it('returns the file contents when the file exists', () => {
        const dir = mkdtempSync(join(tmpdir(), 'rokdock-prompt-'))
        const file = join(dir, 'p.md')
        writeFileSync(file, 'You are a test assistant.', 'utf8')
        try {
            expect(loadChatSystemPrompt(file)).toBe('You are a test assistant.')
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('returns the built-in fallback when the file is missing', () => {
        expect(loadChatSystemPrompt(join(tmpdir(), 'definitely-not-here-12345.md'))).toBe(FALLBACK_CHAT_SYSTEM_PROMPT)
    })
})
