import { describe, it, expect } from 'vitest'
import { createAiEngine } from '@ai-core/engine'
import type { AiAdapter, ResolvedRequest, ResolvedCliRequest, RedactSecrets, ContextProvider, AiEngineConfig, HttpEngineConfig } from '@ai-core/types'

const noSecrets: RedactSecrets = { ips: [], deviceNames: [], serials: [], custom: [] }

/** A fake adapter that records the request it received and echoes the last message content back as two deltas. */
function recordingAdapter(): { adapter: AiAdapter; seen: ResolvedRequest[] } {
    const seen: ResolvedRequest[] = []
    const adapter: AiAdapter = {
        type: 'openai-compatible',
        async *stream(request) {
            seen.push(request)
            const last = request.messages[request.messages.length - 1].content
            yield last.slice(0, 3)
            yield last.slice(3)
        },
    }
    return { adapter, seen }
}

function baseConfig(adapter: AiAdapter, overrides: Partial<HttpEngineConfig> = {}): AiEngineConfig {
    return { transport: 'http', adapter, model: 'm', redaction: { enabled: true }, secrets: noSecrets, ...overrides }
}

describe('createAiEngine', () => {
    it('streams adapter deltas as chunks and complete() collects them', async () => {
        const { adapter } = recordingAdapter()
        const engine = createAiEngine(baseConfig(adapter))
        const result = await engine.complete({ messages: [{ role: 'user', content: 'hello' }] }, new AbortController().signal)
        expect(result.text).toBe('hello')
    })

    it('redacts the prompt before the adapter sees it', async () => {
        const { adapter, seen } = recordingAdapter()
        const secrets: RedactSecrets = { ...noSecrets, ips: ['10.0.0.5'] }
        const engine = createAiEngine(baseConfig(adapter, { secrets }))
        await engine.complete({ messages: [{ role: 'user', content: 'ping 10.0.0.5 now' }] }, new AbortController().signal)
        expect(seen[0].messages[0].content).toBe('ping [ip] now')
    })

    it('dryRun returns the assembled+redacted payload (context + prompt + system) without dispatching', async () => {
        const { adapter, seen } = recordingAdapter()
        const provider: ContextProvider = {
            name: 'docs',
            retrieve: async () => [{ title: 'Doc', text: 'device 10.0.0.5 info' }],
        }
        const secrets: RedactSecrets = { ...noSecrets, ips: ['10.0.0.5'] }
        const engine = createAiEngine(baseConfig(adapter, { secrets, providers: [provider] }))
        const redacted = await engine.dryRun({ messages: [{ role: 'user', content: 'q' }], system: 'sys 10.0.0.5' }, new AbortController().signal)
        expect(redacted.prompt).toContain('device [ip] info')
        expect(redacted.prompt).toContain('q')
        expect(redacted.system).toBe('sys [ip]')
        expect(redacted.replacements).toContainEqual({ label: 'ip', count: 2 })
        expect(seen).toHaveLength(0) // the adapter is never called
    })

    it('runs context providers and prepends their blocks, also redacted', async () => {
        const { adapter, seen } = recordingAdapter()
        const provider: ContextProvider = {
            name: 'docs',
            retrieve: async () => [{ title: 'Doc', text: 'device 10.0.0.5 info' }],
        }
        const secrets: RedactSecrets = { ...noSecrets, ips: ['10.0.0.5'] }
        const engine = createAiEngine(baseConfig(adapter, { secrets, providers: [provider] }))
        await engine.complete({ messages: [{ role: 'user', content: 'question' }] }, new AbortController().signal)
        expect(seen[0].messages[0].content).toContain('device [ip] info')
        expect(seen[0].messages[0].content).toContain('question')
    })

    it('passes model, baseUrl, and apiKey through to an HTTP adapter', async () => {
        const { adapter, seen } = recordingAdapter()
        const engine = createAiEngine(baseConfig(adapter, { model: 'x', baseUrl: 'b', apiKey: 'k' }))
        await engine.complete({ messages: [{ role: 'user', content: 'q' }] }, new AbortController().signal)
        expect(seen[0]).toMatchObject({ transport: 'http', model: 'x', baseUrl: 'b', apiKey: 'k' })
    })

    it('passes model, command (built from cliKind), and env through to a CLI adapter', async () => {
        const { adapter, seen } = recordingAdapter()
        const engine = createAiEngine({
            transport: 'cli', adapter, model: 'x', cliKind: 'claude', env: { PATH: '/p' },
            redaction: { enabled: true }, secrets: noSecrets,
        })
        await engine.complete({ messages: [{ role: 'user', content: 'q' }] }, new AbortController().signal)
        expect(seen[0]).toMatchObject({ transport: 'cli', model: 'x', env: { PATH: '/p' } })
        // The command is built from the registry; confirm it is non-empty and contains the model.
        expect(seen[0].transport).toBe('cli')
        const req = seen[0] as ResolvedCliRequest
        expect(req.command).toContain('x')
    })

    it('does not redact when redaction is disabled', async () => {
        const { adapter, seen } = recordingAdapter()
        const secrets: RedactSecrets = { ...noSecrets, ips: ['10.0.0.5'] }
        const engine = createAiEngine(baseConfig(adapter, { secrets, redaction: { enabled: false } }))
        await engine.complete({ messages: [{ role: 'user', content: 'ping 10.0.0.5' }] }, new AbortController().signal)
        expect(seen[0].messages[0].content).toBe('ping 10.0.0.5')
    })

    it('a single user message assembles to exactly that content (no labels)', async () => {
        const { adapter, seen } = recordingAdapter()
        const engine = createAiEngine(baseConfig(adapter))
        await engine.complete({ messages: [{ role: 'user', content: 'just this' }] }, new AbortController().signal)
        expect(seen[0].messages[0].content).toBe('just this')
    })

    it('passes multiple turns in order to the adapter', async () => {
        const { adapter, seen } = recordingAdapter()
        const engine = createAiEngine(baseConfig(adapter))
        await engine.complete({ messages: [
            { role: 'user', content: 'first question' },
            { role: 'assistant', content: 'first answer' },
            { role: 'user', content: 'and now?' },
        ] }, new AbortController().signal)
        expect(seen[0].messages).toEqual([
            { role: 'user', content: 'first question' },
            { role: 'assistant', content: 'first answer' },
            { role: 'user', content: 'and now?' },
        ])
    })

    it('renders provider context onto the last user turn, redacted', async () => {
        const { adapter, seen } = recordingAdapter()
        const provider: ContextProvider = { name: 'docs', retrieve: async () => [{ title: 'Doc', text: 'device 10.0.0.5 info' }] }
        const secrets: RedactSecrets = { ...noSecrets, ips: ['10.0.0.5'] }
        const engine = createAiEngine(baseConfig(adapter, { secrets, providers: [provider] }))
        await engine.complete({ messages: [
            { role: 'user', content: 'q1' },
            { role: 'assistant', content: 'a1' },
            { role: 'user', content: 'q2' },
        ] }, new AbortController().signal)
        const lastUserMsg = seen[0].messages[seen[0].messages.length - 1].content
        expect(lastUserMsg).toContain('device [ip] info')
        expect(lastUserMsg).toContain('q2')
    })

    it('redacts secrets that appear only in an earlier turn', async () => {
        const { adapter, seen } = recordingAdapter()
        const secrets: RedactSecrets = { ...noSecrets, ips: ['10.0.0.5'] }
        const engine = createAiEngine(baseConfig(adapter, { secrets }))
        await engine.complete({ messages: [
            { role: 'user', content: 'see 10.0.0.5' },
            { role: 'assistant', content: 'ok' },
            { role: 'user', content: 'follow up' },
        ] }, new AbortController().signal)
        expect(seen[0].messages[0].content).toContain('see [ip]')
        expect(seen[0].messages[0].content).not.toContain('10.0.0.5')
    })

    it('builds a toolkit from provider tools() and passes it to the adapter', async () => {
        let seenToolkit: unknown = 'unset'
        const adapter: AiAdapter = {
            type: 'openai-compatible',
            async *stream(_req, _signal, toolkit) { seenToolkit = toolkit; yield 'ok' },
        }
        const provider: ContextProvider = {
            name: 'docs',
            tools: () => [{ name: 'search_docs', description: 'd', parameters: { type: 'object' } }],
            callTool: async () => ({ content: 'r' }),
        }
        const engine = createAiEngine(baseConfig(adapter, { providers: [provider] }))
        await engine.complete({ messages: [{ role: 'user', content: 'q' }] }, new AbortController().signal)
        expect(seenToolkit).toMatchObject({ specs: [{ name: 'search_docs' }] })
    })

    it('passes no toolkit when no provider exposes tools', async () => {
        let seenToolkit: unknown = 'unset'
        const adapter: AiAdapter = { type: 'openai-compatible', async *stream(_r, _s, tk) { seenToolkit = tk; yield 'ok' } }
        const provider: ContextProvider = { name: 'docs', retrieve: async () => [] }
        const engine = createAiEngine(baseConfig(adapter, { providers: [provider] }))
        await engine.complete({ messages: [{ role: 'user', content: 'q' }] }, new AbortController().signal)
        expect(seenToolkit).toBeUndefined()
    })

    it('toolkit.call dispatches to the provider that declares the tool', async () => {
        let calledWith: unknown = null
        const adapter: AiAdapter = {
            type: 'openai-compatible',
            async *stream(_r, signal, tk) { await tk!.call('search_docs', { query: 'x' }, signal); yield 'ok' },
        }
        const provider: ContextProvider = {
            name: 'docs',
            tools: () => [{ name: 'search_docs', description: 'd', parameters: {} }],
            callTool: async (name, args) => { calledWith = { name, args }; return { content: 'hits' } },
        }
        const engine = createAiEngine(baseConfig(adapter, { providers: [provider] }))
        await engine.complete({ messages: [{ role: 'user', content: 'q' }] }, new AbortController().signal)
        expect(calledWith).toEqual({ name: 'search_docs', args: { query: 'x' } })
    })

    it('maps a tool adapter event to an activity chunk', async () => {
        const adapter: AiAdapter = {
            type: 'openai-compatible',
            async *stream() { yield { tool: { name: 'search_docs', args: { query: 'z' } } }; yield 'hi' },
        }
        const engine = createAiEngine(baseConfig(adapter))
        const out: Array<Record<string, unknown>> = []
        for await (const chunk of engine.stream({ messages: [{ role: 'user', content: 'q' }] }, new AbortController().signal)) out.push(chunk)
        expect(out).toEqual([{ activity: { name: 'search_docs', args: { query: 'z' } } }, { delta: 'hi' }])
    })
})

// A provider that exposes one tool, used by the MCP mode tests.
function toolProvider(): ContextProvider {
    return {
        name: 'docs',
        tools: () => [{ name: 'search_docs', description: 'd', parameters: { type: 'object' } }],
        callTool: async () => ({ content: '' }),
    }
}

function cliConfig(adapter: AiAdapter, cliKind: 'claude' | 'gemini' | 'codex' | 'copilot', overrides: Partial<AiEngineConfig> = {}): AiEngineConfig {
    return {
        transport: 'cli', adapter, model: 'x', cliKind,
        redaction: { enabled: true }, secrets: noSecrets,
        ...(cliKind === 'gemini' ? { cliPolicyFilePath: '/tmp/policy.toml' } : {}),
        ...overrides,
    } as AiEngineConfig
}

describe('CLI MCP mode', () => {
    it('MCP mode passes the prebuilt command and cwd through with no toolkit', async () => {
        const captured: { command?: string; cwd?: string; toolkit?: unknown } = {}
        const adapter: AiAdapter = { type: 'cli' as const, async *stream(req: ResolvedRequest, _signal: AbortSignal, toolkit?: unknown) {
            captured.command = (req as ResolvedCliRequest).command; captured.cwd = (req as ResolvedCliRequest).cwd; captured.toolkit = toolkit; yield 'ok'
        } }
        const engine = createAiEngine({
            transport: 'cli', cliKind: 'claude', adapter, model: 'm',
            redaction: { enabled: false }, secrets: { ips: [], deviceNames: [], serials: [], custom: [] },
            mcpTools: { command: 'claude -p ... --mcp-config "C:/d/mcp.json"', cwd: 'C:/d' },
        } as any)
        let text = ''
        for await (const chunk of engine.stream({ messages: [{ role: 'user', content: 'hi' }] }, new AbortController().signal)) {
            if ('delta' in chunk) text += chunk.delta
        }
        expect(captured.command).toContain('--mcp-config "C:/d/mcp.json"')
        expect(captured.cwd).toBe('C:/d')
        expect(captured.toolkit).toBeUndefined()
        expect(text).toBe('ok')
    })

    it('claude with mcpTools calls adapter.stream with toolkit === undefined', async () => {
        let seenToolkit: unknown = 'unset'
        const adapter: AiAdapter = {
            type: 'cli',
            async *stream(_req, _signal, toolkit) { seenToolkit = toolkit; yield 'ok' },
        }
        const engine = createAiEngine(cliConfig(adapter, 'claude', {
            providers: [toolProvider()],
            mcpTools: {
                command: 'claude -p --mcp-config "/tmp/mcp.json" --allowedTools "mcp__rokdock__search_docs"',
            },
        }))
        await engine.complete({ messages: [{ role: 'user', content: 'q' }] }, new AbortController().signal)
        expect(seenToolkit).toBeUndefined()
    })

})
