import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { detectInstalledClis } from '@main/services/ai/cliDetect'

let dir: string
const isWin = process.platform === 'win32'

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-detect-'))
    // claude as a bare executable; copilot via a Windows .cmd shim.
    fs.writeFileSync(path.join(dir, isWin ? 'claude.exe' : 'claude'), '')
    fs.writeFileSync(path.join(dir, isWin ? 'copilot.cmd' : 'copilot'), '')
})
afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ } })

describe('detectInstalledClis', () => {
    it('finds the executables present on the given PATH', async () => {
        const found = await detectInstalledClis(dir)
        expect(found).toContain('claude')
        expect(found).toContain('copilot')
    })

    it('returns nothing for an empty PATH', async () => {
        expect(await detectInstalledClis('')).toEqual([])
    })

    it('searches every PATH entry', async () => {
        const env = ['/nonexistent/a', dir, '/nonexistent/b'].join(path.delimiter)
        const found = await detectInstalledClis(env)
        expect(found).toContain('claude')
    })
})
