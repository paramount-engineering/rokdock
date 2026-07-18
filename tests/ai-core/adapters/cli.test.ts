import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { cliAdapter } from '@ai-core/adapters/cli'
import type { ResolvedRequest } from '@ai-core/types'

// Use the current Node binary plus temp script FILES as a cross-platform fake CLI.
// Script files keep the program logic off the command line, so the same command
// string runs identically under cmd.exe (Windows) and sh (macOS/Linux) in shell mode.
const NODE = process.execPath
let dir: string
let echoScript: string
let failScript: string
let hangScript: string

function buildCommand(script: string): string {
    return `"${NODE}" "${script}"`
}

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cli-'))
    echoScript = path.join(dir, 'echo.js')
    failScript = path.join(dir, 'fail.js')
    hangScript = path.join(dir, 'hang.js')
    fs.writeFileSync(echoScript, 'process.stdin.pipe(process.stdout)')
    fs.writeFileSync(failScript, 'process.exit(2)')
    fs.writeFileSync(hangScript, 'setTimeout(() => {}, 2000)')
})
afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ } })

async function collect(req: ResolvedRequest): Promise<string> {
    let text = ''
    for await (const ev of cliAdapter.stream(req, new AbortController().signal)) {
        if (typeof ev === 'string') text += ev
    }
    return text
}

describe('cliAdapter', () => {
    it('writes the prompt to stdin and streams stdout', async () => {
        const req: ResolvedRequest = { transport: 'cli', model: 'm', messages: [{ role: 'user', content: 'hello cli' }], command: buildCommand(echoScript) }
        expect((await collect(req)).trim()).toBe('hello cli')
    })

    it('prepends the system prompt to stdin when present', async () => {
        const req: ResolvedRequest = { transport: 'cli', model: 'm', system: 'SYSTEM RULES', messages: [{ role: 'user', content: 'user question' }], command: buildCommand(echoScript) }
        expect((await collect(req)).trim()).toBe('SYSTEM RULES\n\nuser question')
    })

    it('folds a multi-turn conversation onto stdin', async () => {
        const req: ResolvedRequest = { transport: 'cli', model: 'm', messages: [
            { role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' },
        ], command: buildCommand(echoScript) }
        expect((await collect(req)).trim()).toBe('User: q1\n\nAssistant: a1\n\nUser: q2')
    })

    it('throws on a non-zero exit', async () => {
        const req: ResolvedRequest = { transport: 'cli', model: 'm', messages: [{ role: 'user', content: 'x' }], command: buildCommand(failScript) }
        await expect(collect(req)).rejects.toThrow(/code 2/i)
    })

    it('aborts a running process', async () => {
        const controller = new AbortController()
        const req: ResolvedRequest = { transport: 'cli', model: 'm', messages: [{ role: 'user', content: 'x' }], command: buildCommand(hangScript) }
        const iter = cliAdapter.stream(req, controller.signal)[Symbol.asyncIterator]()
        const next = iter.next()
        controller.abort()
        await expect(next).resolves.toMatchObject({ done: true })
    })

    it('forwards the provided env to the subprocess', async () => {
        const envScript = path.join(dir, 'env.js')
        fs.writeFileSync(envScript, 'process.stdout.write(process.env.AI_TEST_VAR ?? "")')
        const req: ResolvedRequest = {
            transport: 'cli', model: 'm', messages: [{ role: 'user', content: '' }], command: buildCommand(envScript),
            env: { ...process.env, AI_TEST_VAR: 'xyz' } as Record<string, string>,
        }
        expect(await collect(req)).toBe('xyz')
    })

    it('throws when handed an HTTP request (transport/adapter mismatch)', async () => {
        const req: ResolvedRequest = { transport: 'http', model: 'm', messages: [{ role: 'user', content: 'x' }], baseUrl: 'https://example.com' }
        await expect(collect(req)).rejects.toThrow(/non-CLI request/i)
    })

    it('stops a CLI that produces no output before the idle timeout, with a clear error', async () => {
        const req: ResolvedRequest = { transport: 'cli', model: 'm', messages: [{ role: 'user', content: 'x' }], command: buildCommand(hangScript), idleTimeoutMs: 150 }
        await expect(collect(req)).rejects.toThrow(/no output for/i)
    })
})

describe('cliAdapter cwd', () => {
    it('spawns the command in the request cwd when provided', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwd-'))
        const req: ResolvedRequest = { transport: 'cli', command: 'node -e "process.stdout.write(process.cwd())"', cwd: tempDir, model: '', messages: [{ role: 'user', content: 'x' }] } as any
        let out = ''
        for await (const event of cliAdapter.stream(req, new AbortController().signal)) if (typeof event === 'string') out += event
        expect(fs.realpathSync(out.trim())).toBe(fs.realpathSync(tempDir))
        fs.rmdirSync(tempDir)
    })
})
