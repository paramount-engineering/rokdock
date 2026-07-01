import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { materializeCliPolicy } from '@main/services/ai/cliPolicy'

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-policy-')) })
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ } })

describe('materializeCliPolicy', () => {
    it('writes gemini policy content and returns its path', () => {
        const policyPath = materializeCliPolicy('gemini', dir)
        expect(policyPath).toBeDefined()
        const content = fs.readFileSync(policyPath!, 'utf-8')
        expect(content).toContain('decision = "deny"')
        expect(content).toContain('toolName = "*"')
    })

    it('returns undefined for a CLI that declares no policy file', () => {
        expect(materializeCliPolicy('claude', dir)).toBeUndefined()
    })

    it('rewrites only when content changed', () => {
        const policyPath = materializeCliPolicy('gemini', dir)!
        fs.writeFileSync(policyPath, 'STALE')
        materializeCliPolicy('gemini', dir)
        expect(fs.readFileSync(policyPath, 'utf-8')).toContain('decision = "deny"')
    })

    it('does not rewrite when content is identical', () => {
        const policyPath = materializeCliPolicy('gemini', dir)!
        const before = fs.statSync(policyPath).mtimeMs
        materializeCliPolicy('gemini', dir)
        expect(fs.statSync(policyPath).mtimeMs).toBe(before)
    })
})
