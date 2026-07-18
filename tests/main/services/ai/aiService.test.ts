import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { AiService } from '@main/services/ai/aiService'
import type { AiProfile, AiRequest } from '@shared/ai/types'
import type { AiEngineConfig, ContextProvider, ToolActivity, CliEngineConfig } from '@ai-core/types'
import type { McpToolEndpoint, McpToolSession } from '@main/services/ai/mcpToolEndpoint'

function fakeProfileStore(active: AiProfile | null, key?: string) {
    return {
        listProfiles: () => (active ? [active] : []),
        getProfile: (id: string) => (active && active.id === id ? active : undefined),
        getActiveId: () => active?.id ?? null,
        getKey: () => key,
        saveProfile: vi.fn(),
        deleteProfile: vi.fn(),
        setActiveId: vi.fn(),
        getCliOverrides: () => ({}),
        setCliOverride: vi.fn(),
        clearSecrets: vi.fn(),
    }
}

const ssdp = { getDevices: () => [{ ip: '10.0.0.5', name: 'R', serialNumber: 'S' }] } as never

function fakeStore(activeProfile?: AiProfile) {
    const stored = activeProfile ? [{ id: activeProfile.id, name: activeProfile.name, adapter: activeProfile.adapter, model: activeProfile.model, baseUrl: activeProfile.baseUrl, isLocal: activeProfile.isLocal, redactionEnabled: activeProfile.redactionEnabled }] : []
    return { getManualDevices: () => [], getPreferences: () => ({ aiProfiles: stored }) }
}

const remoteProfile: AiProfile = {
    id: 'p1', name: 'Claude', adapter: 'anthropic', model: 'claude-opus-4-8',
    isLocal: false, redactionEnabled: true, hasKey: true,
}

/** Capture the config the engine was built with, and stream a canned response. */
function captureEngine() {
    const configs: AiEngineConfig[] = []
    const createEngine = (config: AiEngineConfig) => {
        configs.push(config)
        return {
            async *stream() { yield { delta: 'OK' } },
            async complete() { return { text: 'OK' } },
            async dryRun(req: AiRequest) {
                const lastUser = [...req.messages].reverse().find(msg => msg.role === 'user')?.content ?? ''
                return { prompt: lastUser, replacements: [] }
            },
        }
    }
    return { configs, createEngine }
}

async function drain(iter: AsyncIterable<{ delta: string }>): Promise<string> {
    let text = ''
    for await (const chunk of iter) text += chunk.delta
    return text
}

describe('AiService', () => {
    it('streams via an engine built from the active profile, with its key and gathered secrets', async () => {
        const { configs, createEngine } = captureEngine()
        const svc = new AiService(fakeProfileStore(remoteProfile, 'sk-1') as never, ssdp, fakeStore(remoteProfile) as never, { createEngine })
        const text = await drain(svc.stream({ messages: [{ role: 'user', content: 'hi' }] } as AiRequest, new AbortController().signal))
        expect(text).toBe('OK')
        expect(configs[0]).toMatchObject({ transport: 'http', model: 'claude-opus-4-8', apiKey: 'sk-1' })
        expect(configs[0].adapter.type).toBe('anthropic')
        expect(configs[0].redaction.enabled).toBe(true)
        expect(configs[0].secrets.ips).toContain('10.0.0.5')
    })

    it('clearForReset deletes the stored keys via the profile store', () => {
        const profileStore = fakeProfileStore(remoteProfile, 'sk-1')
        const { createEngine } = captureEngine()
        const svc = new AiService(profileStore as never, ssdp, fakeStore(remoteProfile) as never, { createEngine })
        svc.clearForReset()
        expect(profileStore.clearSecrets).toHaveBeenCalledTimes(1)
    })

    it('disables redaction for a local profile', async () => {
        const local: AiProfile = { ...remoteProfile, id: 'p2', adapter: 'cli', cliKind: 'claude', isLocal: true, redactionEnabled: false, hasKey: false }
        const { configs, createEngine } = captureEngine()
        // Inject resolveEnv so a CLI profile does not spawn a real login shell during the unit test.
        const svc = new AiService(fakeProfileStore(local) as never, ssdp, fakeStore() as never, { createEngine, resolveEnv: async () => ({}) })
        await drain(svc.stream({ messages: [{ role: 'user', content: 'hi' }] } as AiRequest, new AbortController().signal))
        expect(configs[0].redaction.enabled).toBe(false)
    })

    it('injects the resolved env (augmented PATH) for a CLI profile', async () => {
        const cli: AiProfile = { ...remoteProfile, id: 'p3', adapter: 'cli', cliKind: 'claude', isLocal: true, redactionEnabled: false, hasKey: false }
        const { configs, createEngine } = captureEngine()
        const svc = new AiService(fakeProfileStore(cli) as never, ssdp, fakeStore() as never, { createEngine, resolveEnv: async () => ({ PATH: '/aug' }) })
        await drain(svc.stream({ messages: [{ role: 'user', content: 'hi' }] } as AiRequest, new AbortController().signal))
        expect(configs[0]).toMatchObject({ transport: 'cli', env: { PATH: '/aug' } })
    })

    it('rejects streaming when there is no active profile', async () => {
        const { createEngine } = captureEngine()
        const svc = new AiService(fakeProfileStore(null) as never, ssdp, fakeStore(remoteProfile) as never, { createEngine })
        await expect(drain(svc.stream({ messages: [{ role: 'user', content: 'hi' }] } as AiRequest, new AbortController().signal))).rejects.toThrow(/no active AI profile/i)
    })

    it('testConnection returns ok text on success and a friendly error on failure', async () => {
        const okSvc = new AiService(fakeProfileStore(remoteProfile, 'sk-1') as never, ssdp, fakeStore() as never, { createEngine: captureEngine().createEngine })
        await expect(okSvc.testConnection()).resolves.toMatchObject({ ok: true, text: 'OK' })

        const failEngine = { createEngine: () => ({ async *stream() { throw new Error('boom') }, async complete() { throw new Error('boom') }, async dryRun() { return { prompt: '', replacements: [] } } }) }
        const failSvc = new AiService(fakeProfileStore(remoteProfile, 'sk-1') as never, ssdp, fakeStore() as never, failEngine as never)
        await expect(failSvc.testConnection()).resolves.toMatchObject({ ok: false, error: expect.stringContaining('boom') })
    })

    it('previewRedaction runs the real engine dry-run and reflects what would be sent', async () => {
        // No createEngine injection: use the real engine so dryRun does the real assemble + redact.
        const svc = new AiService(fakeProfileStore(remoteProfile, 'sk-1') as never, ssdp, fakeStore(remoteProfile) as never)
        const preview = await svc.previewRedaction({ messages: [{ role: 'user', content: 'ping 10.0.0.5' }] })
        expect(preview.text).toBe('ping [ip]')
        expect(preview.replacements).toContainEqual({ label: 'ip', count: 1 })
    })

    it('previewRedaction includes assembled context and system, not just the prompt', async () => {
        const local: AiProfile = { ...remoteProfile, id: 'p9', isLocal: false, redactionEnabled: true }
        const svc = new AiService(fakeProfileStore(local, 'sk-1') as never, ssdp, fakeStore(local) as never)
        const preview = await svc.previewRedaction({
            messages: [{ role: 'user', content: 'question' }],
            system: 'system mentions 10.0.0.5',
            context: [{ title: 'Doc', text: 'device 10.0.0.5 details' }],
        })
        // The preview must show the system + assembled context + prompt, all redacted.
        expect(preview.text).toContain('system mentions [ip]')
        expect(preview.text).toContain('device [ip] details')
        expect(preview.text).toContain('question')
        expect(preview.replacements).toContainEqual({ label: 'ip', count: 2 })
    })

    it('redactForActiveProfile scrubs device values when the active profile has redaction on', async () => {
        const { createEngine } = captureEngine()
        const svc = new AiService(fakeProfileStore(remoteProfile) as never, ssdp, fakeStore(remoteProfile) as never, { createEngine })
        const out = await svc.redactForActiveProfile('connect to 10.0.0.5 on R')
        expect(out).not.toContain('10.0.0.5')
        expect(out).toContain('[ip]')
    })

    it('redactForActiveProfile passes text through when redaction is off', async () => {
        const localProfile: AiProfile = { ...remoteProfile, id: 'p2', isLocal: true, redactionEnabled: false }
        const { createEngine } = captureEngine()
        const svc = new AiService(fakeProfileStore(localProfile) as never, ssdp, fakeStore(localProfile) as never, { createEngine })
        const out = await svc.redactForActiveProfile('connect to 10.0.0.5 on R')
        expect(out).toBe('connect to 10.0.0.5 on R')
    })

    it('redactForActiveProfile fails closed (redacts) when there is no resolvable active profile', async () => {
        const { createEngine } = captureEngine()
        const svc = new AiService(fakeProfileStore(null) as never, ssdp, fakeStore() as never, { createEngine })
        const out = await svc.redactForActiveProfile('connect to 10.0.0.5')
        expect(out).not.toContain('10.0.0.5')
        expect(out).toContain('[ip]')
    })

    it('injects the chat system prompt on stream when the request omits one', async () => {
        const seen: AiRequest[] = []
        const createEngine = () => ({
            async *stream(req: AiRequest) { seen.push(req); yield { delta: 'OK' } },
            async complete() { return { text: 'OK' } },
            async dryRun() { return { prompt: '', replacements: [] } },
        })
        const svc = new AiService(fakeProfileStore(remoteProfile, 'sk-1') as never, ssdp, fakeStore(remoteProfile) as never,
            { createEngine, chatSystemPrompt: 'BAKED PROMPT' })
        await drain(svc.stream({ messages: [{ role: 'user', content: 'hi' }] } as AiRequest, new AbortController().signal))
        expect(seen[0].system).toBe('BAKED PROMPT')
    })

    it('does not override an explicit system on stream', async () => {
        const seen: AiRequest[] = []
        const createEngine = () => ({
            async *stream(req: AiRequest) { seen.push(req); yield { delta: 'OK' } },
            async complete() { return { text: 'OK' } },
            async dryRun() { return { prompt: '', replacements: [] } },
        })
        const svc = new AiService(fakeProfileStore(remoteProfile, 'sk-1') as never, ssdp, fakeStore(remoteProfile) as never,
            { createEngine, chatSystemPrompt: 'BAKED' })
        await drain(svc.stream({ messages: [{ role: 'user', content: 'hi' }], system: 'EXPLICIT' } as AiRequest, new AbortController().signal))
        expect(seen[0].system).toBe('EXPLICIT')
    })

    it('attaches context providers on stream but not on testConnection', async () => {
        const provider: ContextProvider = { name: 'roku-docs', retrieve: async () => [] }
        const { configs, createEngine } = captureEngine()
        const svc = new AiService(fakeProfileStore(remoteProfile, 'sk-1') as never, ssdp, fakeStore(remoteProfile) as never,
            { createEngine, contextProviders: [provider] })
        await drain(svc.stream({ messages: [{ role: 'user', content: 'hi' }] } as AiRequest, new AbortController().signal))
        expect(configs[0].providers).toEqual([provider])

        await svc.testConnection()
        expect(configs[1].providers ?? []).toEqual([])
    })
})

// Minimal doubles. The real composition root wires SSDP/StoreService; here we inject just enough.
function deps(detected: string[], overrides: Record<string, unknown> = {}) {
    const preferences: Record<string, unknown> = { aiProfiles: [], aiActiveProfileId: null, aiCliOverrides: overrides }
    const store = { getPreferences: () => preferences, setPreferences: (patch: Record<string, unknown>) => Object.assign(preferences, patch) }
    const profileStore = {
        listProfiles: () => [],
        getProfile: () => undefined,
        getKey: () => undefined,
        getActiveId: () => preferences.aiActiveProfileId as string | null,
        setActiveId: (id: string | null) => { preferences.aiActiveProfileId = id },
        getCliOverrides: () => preferences.aiCliOverrides as Record<string, unknown>,
        setCliOverride: (k: string, overrideValue: unknown) => { (preferences.aiCliOverrides as Record<string, unknown>)[k] = overrideValue },
    }
    const ssdpDouble = {} as never
    return new AiService(profileStore as never, ssdpDouble, store as never, {
        detectClis: async () => detected as never,
        policyDir: '',
        resolveEnv: async () => ({ PATH: '' }),
    })
}

describe('AiService detected CLI providers', () => {
    it('merges detected CLIs as providers with id cli:<kind>, redaction on, default model', async () => {
        const svc = deps(['claude', 'codex'])
        const list = await svc.listProfiles()
        const claude = list.find(profile => profile.id === 'cli:claude')!
        expect(claude.adapter).toBe('cli')
        expect(claude.cliKind).toBe('claude')
        expect(claude.model).toBe('')
        expect(claude.redactionEnabled).toBe(true)
        expect(list.some(profile => profile.id === 'cli:codex')).toBe(true)
    })

    it('applies a model and redaction override to a detected CLI', async () => {
        const svc = deps(['claude'], { claude: { model: 'claude-opus-4-8', redactionEnabled: false } })
        const claude = (await svc.listProfiles()).find(profile => profile.id === 'cli:claude')!
        expect(claude.model).toBe('claude-opus-4-8')
        expect(claude.redactionEnabled).toBe(false)
    })

    it('drops a CLI recorded as a hidden override from the list, even when detected', async () => {
        const svc = deps(['claude'], { claude: { hidden: true } })
        expect((await svc.listProfiles()).some(profile => profile.id === 'cli:claude')).toBe(false)
    })

    it('surfaces a CLI added via an override even when it is not on PATH', async () => {
        const svc = deps([], { codex: { model: 'gpt-5-codex', redactionEnabled: true } })
        const codex = (await svc.listProfiles()).find(profile => profile.id === 'cli:codex')
        expect(codex).toBeDefined()
        expect(codex!.model).toBe('gpt-5-codex')
    })

    it('activates a CLI added via an override even when it is not on PATH', async () => {
        const svc = deps([], { codex: {} })
        await expect(svc.setActiveId('cli:codex')).resolves.toBeUndefined()
    })

    it('refuses to activate a removed (hidden) CLI', async () => {
        const svc = deps(['claude'], { claude: { hidden: true } })
        await expect(svc.setActiveId('cli:claude')).rejects.toThrow(/not available/i)
    })

    it('materializes the Gemini deny-all policy file and threads its path into the built config', async () => {
        // Gemini's tools can only be disabled via a materialized policy file, so this proves
        // the path threads end-to-end: detection -> active cli:gemini -> configForProfile builds
        // the engine config with a cliPolicyFilePath, and the file is written with deny-all content.
        const policyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-policy-'))
        const { configs, createEngine } = captureEngine()
        const preferences: Record<string, unknown> = { aiProfiles: [], aiActiveProfileId: 'cli:gemini', aiCliOverrides: {} }
        const store = { getManualDevices: () => [], getPreferences: () => preferences, setPreferences: (patch: Record<string, unknown>) => Object.assign(preferences, patch) }
        const profileStore = {
            listProfiles: () => [],
            getProfile: () => undefined,
            getKey: () => undefined,
            getActiveId: () => preferences.aiActiveProfileId as string | null,
            setActiveId: (id: string | null) => { preferences.aiActiveProfileId = id },
            getCliOverrides: () => preferences.aiCliOverrides as Record<string, unknown>,
            setCliOverride: vi.fn(),
        }
        const svc = new AiService(profileStore as never, ssdp, store as never, {
            createEngine,
            detectClis: async () => ['gemini'] as never,
            policyDir,
            resolveEnv: async () => ({ PATH: '' }),
        })

        // testConnection drives the same configForProfile path that stream uses for the active provider.
        await svc.testConnection()

        const config = configs[0]
        expect(config.transport).toBe('cli')
        if (config.transport !== 'cli') throw new Error('expected a cli config')
        expect(config.cliPolicyFilePath).toBeTruthy()
        const policyPath = config.cliPolicyFilePath!
        expect(policyPath.startsWith(policyDir)).toBe(true)
        expect(fs.existsSync(policyPath)).toBe(true)
        expect(fs.readFileSync(policyPath, 'utf-8')).toContain('decision = "deny"')

        fs.rmSync(policyDir, { recursive: true, force: true })
    })
})

// ---------------------------------------------------------------------------
// MCP path tests
// ---------------------------------------------------------------------------

/**
 * Build a fake McpToolEndpoint whose registerSession captures the registered
 * session object so the test can call its onActivity callback.
 */
function fakeMcpEndpoint(): {
    endpoint: McpToolEndpoint
    capturedSession(): McpToolSession
} {
    let captured: McpToolSession | undefined
    const endpoint: McpToolEndpoint = {
        start: async () => ({ url: 'http://127.0.0.1:9999' }),
        stop: async () => undefined,
        registerSession: (_token: string, session: McpToolSession) => { captured = session },
        revokeSession: vi.fn(),
    }
    return {
        endpoint,
        capturedSession: () => {
            if (!captured) throw new Error('registerSession was never called')
            return captured
        },
    }
}

describe('AiService MCP path', () => {
    it('registers a session and builds mcpTools config when the CLI has mcp support and tools are present', async () => {
        const mcpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-mcp-test-'))

        // Use a deferred promise to pause the engine mid-stream. This lets the test
        // push an activity via the registered session while the stream is still open,
        // so the interleaving assertion is deterministic.
        let unpauseEngine!: () => void
        const enginePaused = new Promise<void>((resolve) => { unpauseEngine = resolve })

        const capturedConfigs: AiEngineConfig[] = []
        const createEngine = (config: AiEngineConfig) => {
            capturedConfigs.push(config)
            return {
                async *stream() {
                    yield { delta: 'before' }
                    await enginePaused   // pause here while the test pushes an activity
                    yield { delta: 'after' }
                },
                async complete() { return { text: 'ok' } },
                async dryRun() { return { prompt: '', replacements: [] } },
            }
        }

        const { endpoint, capturedSession } = fakeMcpEndpoint()

        const provider: ContextProvider = {
            name: 'docs',
            tools: () => [{ name: 'search_docs', description: 'search', parameters: {} }],
            callTool: async () => ({ content: 'result' }),
        }

        const fakeBridgePath = path.join(os.tmpdir(), 'docsToolBridge.js')

        const cliProfile: AiProfile = {
            id: 'cli:claude', name: 'Claude Code', adapter: 'cli', cliKind: 'claude',
            model: '', isLocal: true, redactionEnabled: false, hasKey: false,
        }

        const svc = new AiService(
            fakeProfileStore(cliProfile) as never,
            ssdp,
            fakeStore() as never,
            {
                createEngine,
                contextProviders: [provider],
                resolveEnv: async () => ({ PATH: '' }),
                detectClis: async () => ['claude'] as never,
                mcpEndpoint: endpoint,
                tokenSource: () => 'fixed-token',
                mcpConfigDir,
                bridgePath: fakeBridgePath,
            },
        )

        const chunks: Array<{ delta?: string; activity?: ToolActivity }> = []
        const signal = new AbortController().signal

        // Run the stream concurrently so we can push activity while it is paused.
        const streamPromise = (async () => {
            for await (const chunk of svc.stream({ messages: [{ role: 'user', content: 'q' }] } as AiRequest, signal)) {
                chunks.push(chunk as { delta?: string; activity?: ToolActivity })
            }
        })()

        // Yield control until the engine stream has paused (it yielded 'before' and then awaits).
        // Multiple ticks ensure all the async setup in streamWithMcp has completed and the
        // merge helper is waiting on the engine promise.
        await new Promise(resolve => setImmediate(resolve))

        // Now push the activity via the registered session.
        const session = capturedSession()
        session.onActivity({ name: 'search_docs', args: { query: 'roku' } })

        // Unblock the engine so the stream finishes.
        unpauseEngine()

        await streamPromise

        // The engine config must have mcpTools wired up with the prebuilt command.
        expect(capturedConfigs).toHaveLength(1)
        const engineConfig = capturedConfigs[0] as CliEngineConfig
        expect(engineConfig.transport).toBe('cli')
        expect(engineConfig.mcpTools).toBeDefined()
        expect(engineConfig.mcpTools!.command).toContain('--mcp-config')

        // The activity pushed via onActivity must appear as an AiActivityChunk.
        const activityChunks = chunks.filter(chunk => 'activity' in chunk)
        expect(activityChunks).toHaveLength(1)
        expect(activityChunks[0].activity).toEqual({ name: 'search_docs', args: { query: 'roku' } })

        // Both text deltas must also be present.
        const deltaTexts = chunks.filter(chunk => 'delta' in chunk).map(chunk => chunk.delta)
        expect(deltaTexts).toContain('before')
        expect(deltaTexts).toContain('after')

        // The per-request config dir and its mcp.json must have been removed after the stream.
        const reqDirs = fs.readdirSync(mcpConfigDir)
        expect(reqDirs).toHaveLength(0)

        // revokeSession must have been called.
        expect(endpoint.revokeSession).toHaveBeenCalledWith('fixed-token')

        fs.rmSync(mcpConfigDir, { recursive: true, force: true })
    })

    it('writes mcp.json at its absolute path before the engine runs and removes it after', async () => {
        const mcpConfigRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-mcp-test-'))
        let capturedFilePath = ''
        let mcpJsonExistedDuringStream = false
        let configContentDuringStream = ''

        const createEngine = (config: AiEngineConfig) => ({
            async *stream() {
                // The plan's file.path is an absolute forward-slashed path under mcpConfigRoot.
                // Verify it exists at that exact path before the engine returns.
                if (capturedFilePath) {
                    mcpJsonExistedDuringStream = fs.existsSync(capturedFilePath)
                    if (mcpJsonExistedDuringStream) configContentDuringStream = fs.readFileSync(capturedFilePath, 'utf8')
                }
                const engineConfig = config as CliEngineConfig
                expect(engineConfig.mcpTools?.command).toContain('--mcp-config')
                yield { delta: 'ok' }
            },
            async complete() { return { text: 'ok' } },
            async dryRun() { return { prompt: '', replacements: [] } },
        })

        const { endpoint } = fakeMcpEndpoint()
        const fakeBridgePath = path.join(os.tmpdir(), 'docsToolBridge.js')
        const provider: ContextProvider = {
            name: 'docs',
            tools: () => [{ name: 'search_docs', description: 's', parameters: {} }],
            callTool: async () => ({ content: 'r' }),
        }
        const cliProfile: AiProfile = {
            id: 'cli:claude', name: 'Claude Code', adapter: 'cli', cliKind: 'claude',
            model: '', isLocal: true, redactionEnabled: false, hasKey: false,
        }

        // Override tokenSource so we can predict the file path the plan will produce.
        const token = 'tok2'

        const svc = new AiService(
            fakeProfileStore(cliProfile) as never,
            ssdp,
            fakeStore() as never,
            {
                createEngine,
                contextProviders: [provider],
                resolveEnv: async () => ({ PATH: '' }),
                detectClis: async () => ['claude'] as never,
                mcpEndpoint: endpoint,
                tokenSource: () => token,
                mcpConfigDir: mcpConfigRoot,
                bridgePath: fakeBridgePath,
            },
        )

        // Determine the per-request dir by peeking after it is created but before stream yields.
        // We intercept by delaying slightly; instead, resolve the expected path after the stream
        // so we can look up what was written. To find the absolute path, look inside the req dir.
        let reqDir = ''
        const origMkdtemp = fs.mkdtempSync.bind(fs)
        const mkdtempSpy = vi.spyOn(fs, 'mkdtempSync').mockImplementation((prefix, ...rest) => {
            const result = origMkdtemp(prefix, ...rest)
            if (typeof prefix === 'string' && prefix.includes('req-')) {
                reqDir = result
                capturedFilePath = reqDir.replace(/\\/g, '/') + '/mcp.json'
            }
            return result
        })

        for await (const _ of svc.stream({ messages: [{ role: 'user', content: 'q' }] } as AiRequest, new AbortController().signal)) { /* drain */ }

        mkdtempSpy.mockRestore()

        expect(mcpJsonExistedDuringStream).toBe(true)
        // The config must carry ELECTRON_RUN_AS_NODE so the Electron binary runs the bridge as Node.
        const parsedConfig = JSON.parse(configContentDuringStream)
        expect(parsedConfig.mcpServers.rokdock.env.ELECTRON_RUN_AS_NODE).toBe('1')
        // The per-request dir must have been removed after the stream completed.
        expect(fs.readdirSync(mcpConfigRoot)).toHaveLength(0)

        fs.rmSync(mcpConfigRoot, { recursive: true, force: true })
    })

    it('cleans up the per-request dir when plan() throws before the stream starts', async () => {
        const mcpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-mcp-test-'))
        const { endpoint } = fakeMcpEndpoint()
        const provider: ContextProvider = {
            name: 'docs',
            tools: () => [{ name: 'search_docs', description: 's', parameters: {} }],
            callTool: async () => ({ content: 'r' }),
        }
        // A shell-unsafe model makes the plan's assertShellSafeModel throw inside streamWithMcp,
        // after the per-request dir is created. The finally must still remove the dir.
        const cliProfile: AiProfile = {
            id: 'cli:claude', name: 'Claude Code', adapter: 'cli', cliKind: 'claude',
            model: 'bad; rm -rf /', isLocal: true, redactionEnabled: false, hasKey: false,
        }
        const svc = new AiService(
            fakeProfileStore(cliProfile) as never,
            ssdp,
            fakeStore() as never,
            {
                createEngine: () => { throw new Error('engine should never be built when plan throws') },
                contextProviders: [provider],
                resolveEnv: async () => ({ PATH: '' }),
                detectClis: async () => ['claude'] as never,
                mcpEndpoint: endpoint,
                tokenSource: () => 'leak-token',
                mcpConfigDir,
                bridgePath: path.join(os.tmpdir(), 'docsToolBridge.js'),
            },
        )

        const drain = (async () => {
            for await (const _ of svc.stream({ messages: [{ role: 'user', content: 'q' }] } as AiRequest, new AbortController().signal)) { /* drain */ }
        })()
        await expect(drain).rejects.toThrow()

        // The dir created by mkdtempSync must not leak even though plan() threw before the stream.
        // (plan() throws before the MCP session is registered, so there is no session to revoke.)
        expect(fs.readdirSync(mcpConfigDir)).toHaveLength(0)

        fs.rmSync(mcpConfigDir, { recursive: true, force: true })
    })

    it('falls through to the normal engine path when no mcpEndpoint is injected', async () => {
        const capturedConfigs: AiEngineConfig[] = []
        const createEngine = (config: AiEngineConfig) => {
            capturedConfigs.push(config)
            return {
                async *stream() { yield { delta: 'ok' } },
                async complete() { return { text: 'ok' } },
                async dryRun() { return { prompt: '', replacements: [] } },
            }
        }

        const provider: ContextProvider = {
            name: 'docs',
            tools: () => [{ name: 'search_docs', description: 's', parameters: {} }],
            callTool: async () => ({ content: 'r' }),
        }
        const cliProfile: AiProfile = {
            id: 'cli:claude', name: 'Claude Code', adapter: 'cli', cliKind: 'claude',
            model: '', isLocal: true, redactionEnabled: false, hasKey: false,
        }

        // No mcpEndpoint injected -- normal path.
        const svc = new AiService(
            fakeProfileStore(cliProfile) as never,
            ssdp,
            fakeStore() as never,
            { createEngine, contextProviders: [provider], resolveEnv: async () => ({ PATH: '' }), detectClis: async () => ['claude'] as never },
        )

        for await (const _ of svc.stream({ messages: [{ role: 'user', content: 'q' }] } as AiRequest, new AbortController().signal)) { /* drain */ }

        expect(capturedConfigs).toHaveLength(1)
        const config = capturedConfigs[0] as CliEngineConfig
        expect(config.mcpTools).toBeUndefined()
    })
})

// ---------------------------------------------------------------------------
// Conversation session tests
// ---------------------------------------------------------------------------

describe('AiService conversation sessions', () => {
    it('a new conversationId starts a session: full transcript, start wiring, handle recorded', async () => {
        const mcpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-mcp-test-'))
        const seenConfigs: CliEngineConfig[] = []
        const seenMessages: number[] = []
        const createEngine = (config: AiEngineConfig) => {
            seenConfigs.push(config as CliEngineConfig)
            return {
                async *stream(req: AiRequest) { seenMessages.push(req.messages.length); yield { delta: 'a1' } },
                async complete() { return { text: '' } }, async dryRun() { return { prompt: '', replacements: [] } },
            }
        }
        const { endpoint } = fakeMcpEndpoint()
        const provider: ContextProvider = { name: 'docs', tools: () => [{ name: 'search_docs', description: 's', parameters: {} }], callTool: async () => ({ content: 'r' }) }
        const cliProfile: AiProfile = { id: 'cli:claude', name: 'Claude', adapter: 'cli', cliKind: 'claude', model: '', isLocal: true, redactionEnabled: false, hasKey: false }
        const svc = new AiService(fakeProfileStore(cliProfile) as never, ssdp, fakeStore() as never, {
            createEngine, contextProviders: [provider], resolveEnv: async () => ({ PATH: '' }),
            detectClis: async () => ['claude'] as never, mcpEndpoint: endpoint, tokenSource: () => 'tok',
            mcpConfigDir, bridgePath: path.join(os.tmpdir(), 'docsToolBridge.js'),
        })

        const messages = [{ role: 'user' as const, content: 'u1' }]
        for await (const _ of svc.stream({ messages } as AiRequest, new AbortController().signal, 'conv-1')) { /* drain */ }

        expect(seenMessages[0]).toBe(1)
        expect(seenConfigs[0].mcpTools!.command).toContain('--session-id')
        fs.rmSync(mcpConfigDir, { recursive: true, force: true })
    })

    it('the same conversationId resumes: only the delta is sent and the command carries resume wiring', async () => {
        const mcpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-mcp-test-'))
        const seenConfigs: CliEngineConfig[] = []
        const seenMessages: number[] = []
        const createEngine = (config: AiEngineConfig) => {
            seenConfigs.push(config as CliEngineConfig)
            return {
                async *stream(req: AiRequest) { seenMessages.push(req.messages.length); yield { delta: 'a1' } },
                async complete() { return { text: '' } }, async dryRun() { return { prompt: '', replacements: [] } },
            }
        }
        const { endpoint } = fakeMcpEndpoint()
        const provider: ContextProvider = { name: 'docs', tools: () => [{ name: 'search_docs', description: 's', parameters: {} }], callTool: async () => ({ content: 'r' }) }
        const cliProfile: AiProfile = { id: 'cli:claude', name: 'Claude', adapter: 'cli', cliKind: 'claude', model: '', isLocal: true, redactionEnabled: false, hasKey: false }
        const svc = new AiService(fakeProfileStore(cliProfile) as never, ssdp, fakeStore() as never, {
            createEngine, contextProviders: [provider], resolveEnv: async () => ({ PATH: '' }),
            detectClis: async () => ['claude'] as never, mcpEndpoint: endpoint, tokenSource: () => 'tok',
            mcpConfigDir, bridgePath: path.join(os.tmpdir(), 'docsToolBridge.js'),
        })

        // Turn 1: [u1] -> START
        for await (const _ of svc.stream({ messages: [{ role: 'user' as const, content: 'u1' }] } as AiRequest, new AbortController().signal, 'conv-1')) { /* drain */ }
        // Turn 2: [u1, a1, u2] -> RESUME, engine sees only u2 (1 message)
        const turn2Messages = [
            { role: 'user' as const, content: 'u1' },
            { role: 'assistant' as const, content: 'a1' },
            { role: 'user' as const, content: 'u2' },
        ]
        for await (const _ of svc.stream({ messages: turn2Messages } as AiRequest, new AbortController().signal, 'conv-1')) { /* drain */ }

        expect(seenMessages).toEqual([1, 1])
        expect(seenConfigs[1].mcpTools!.command).toContain('--resume')
        fs.rmSync(mcpConfigDir, { recursive: true, force: true })
    })

    it('resume failure retries as a fresh start with the full transcript', async () => {
        const mcpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-mcp-test-'))
        const seenConfigs: CliEngineConfig[] = []
        const seenMessages: number[] = []
        const createEngine = (config: AiEngineConfig) => {
            seenConfigs.push(config as CliEngineConfig)
            const isResume = (config as CliEngineConfig).mcpTools?.command.includes('--resume') ?? false
            return {
                async *stream(req: AiRequest) {
                    seenMessages.push(req.messages.length)
                    if (isResume) throw new Error('session expired')
                    yield { delta: 'ok' }
                },
                async complete() { return { text: '' } }, async dryRun() { return { prompt: '', replacements: [] } },
            }
        }
        const { endpoint } = fakeMcpEndpoint()
        const provider: ContextProvider = { name: 'docs', tools: () => [{ name: 'search_docs', description: 's', parameters: {} }], callTool: async () => ({ content: 'r' }) }
        const cliProfile: AiProfile = { id: 'cli:claude', name: 'Claude', adapter: 'cli', cliKind: 'claude', model: '', isLocal: true, redactionEnabled: false, hasKey: false }
        const svc = new AiService(fakeProfileStore(cliProfile) as never, ssdp, fakeStore() as never, {
            createEngine, contextProviders: [provider], resolveEnv: async () => ({ PATH: '' }),
            detectClis: async () => ['claude'] as never, mcpEndpoint: endpoint, tokenSource: () => 'tok',
            mcpConfigDir, bridgePath: path.join(os.tmpdir(), 'docsToolBridge.js'),
        })

        // Turn 1: START succeeds, records conv-1
        for await (const _ of svc.stream({ messages: [{ role: 'user' as const, content: 'u1' }] } as AiRequest, new AbortController().signal, 'conv-1')) { /* drain */ }
        // Turn 2: RESUME throws -> fallback START with full transcript, no error propagated
        const turn2Messages = [
            { role: 'user' as const, content: 'u1' },
            { role: 'assistant' as const, content: 'a1' },
            { role: 'user' as const, content: 'u2' },
        ]
        const chunks: unknown[] = []
        for await (const chunk of svc.stream({ messages: turn2Messages } as AiRequest, new AbortController().signal, 'conv-1')) { chunks.push(chunk) }

        // The retry was a START (full transcript = 3 messages)
        expect(seenMessages[2]).toBe(3)
        expect(seenConfigs[2].mcpTools!.command).toContain('--session-id')
        expect(chunks).toHaveLength(1)
        fs.rmSync(mcpConfigDir, { recursive: true, force: true })
    })

    it('a different model for the same conversationId forces a start', async () => {
        const mcpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-mcp-test-'))
        const seenConfigs: CliEngineConfig[] = []
        const seenMessages: number[] = []
        const createEngine = (config: AiEngineConfig) => {
            seenConfigs.push(config as CliEngineConfig)
            return {
                async *stream(req: AiRequest) { seenMessages.push(req.messages.length); yield { delta: 'ok' } },
                async complete() { return { text: '' } }, async dryRun() { return { prompt: '', replacements: [] } },
            }
        }
        const { endpoint } = fakeMcpEndpoint()
        const provider: ContextProvider = { name: 'docs', tools: () => [{ name: 'search_docs', description: 's', parameters: {} }], callTool: async () => ({ content: 'r' }) }

        // The CLI model is tracked via getCliOverrides() because resolveProvider for CLI ids
        // calls detectedProvider(), which reads the model from the override rather than a stored profile.
        let activeModel = 'claude-opus-4'
        const profileStore = {
            listProfiles: () => [],
            getProfile: () => undefined,
            getActiveId: () => 'cli:claude',
            getKey: () => undefined,
            saveProfile: vi.fn(), deleteProfile: vi.fn(), setActiveId: vi.fn(),
            getCliOverrides: () => ({ claude: { model: activeModel, redactionEnabled: false } }),
            setCliOverride: vi.fn(),
        }

        const svc = new AiService(profileStore as never, ssdp, fakeStore() as never, {
            createEngine, contextProviders: [provider], resolveEnv: async () => ({ PATH: '' }),
            detectClis: async () => ['claude'] as never, mcpEndpoint: endpoint, tokenSource: () => 'tok',
            mcpConfigDir, bridgePath: path.join(os.tmpdir(), 'docsToolBridge.js'),
        })

        // Turn 1 with model claude-opus-4 -> START
        for await (const _ of svc.stream({ messages: [{ role: 'user' as const, content: 'u1' }] } as AiRequest, new AbortController().signal, 'conv-1')) { /* drain */ }
        // Switch model
        activeModel = 'claude-sonnet-4'
        // Turn 2 with different model -> should also be START (full transcript, not resume)
        const turn2Messages = [{ role: 'user' as const, content: 'u1' }, { role: 'assistant' as const, content: 'a1' }, { role: 'user' as const, content: 'u2' }]
        for await (const _ of svc.stream({ messages: turn2Messages } as AiRequest, new AbortController().signal, 'conv-1')) { /* drain */ }

        expect(seenMessages[1]).toBe(3)
        expect(seenConfigs[1].mcpTools!.command).toContain('--session-id')
        fs.rmSync(mcpConfigDir, { recursive: true, force: true })
    })

    it('evictConversation drops the entry so the next message is a start', async () => {
        const mcpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-mcp-test-'))
        const seenConfigs: CliEngineConfig[] = []
        const seenMessages: number[] = []
        const createEngine = (config: AiEngineConfig) => {
            seenConfigs.push(config as CliEngineConfig)
            return {
                async *stream(req: AiRequest) { seenMessages.push(req.messages.length); yield { delta: 'ok' } },
                async complete() { return { text: '' } }, async dryRun() { return { prompt: '', replacements: [] } },
            }
        }
        const { endpoint } = fakeMcpEndpoint()
        const provider: ContextProvider = { name: 'docs', tools: () => [{ name: 'search_docs', description: 's', parameters: {} }], callTool: async () => ({ content: 'r' }) }
        const cliProfile: AiProfile = { id: 'cli:claude', name: 'Claude', adapter: 'cli', cliKind: 'claude', model: '', isLocal: true, redactionEnabled: false, hasKey: false }
        const svc = new AiService(fakeProfileStore(cliProfile) as never, ssdp, fakeStore() as never, {
            createEngine, contextProviders: [provider], resolveEnv: async () => ({ PATH: '' }),
            detectClis: async () => ['claude'] as never, mcpEndpoint: endpoint, tokenSource: () => 'tok',
            mcpConfigDir, bridgePath: path.join(os.tmpdir(), 'docsToolBridge.js'),
        })

        for await (const _ of svc.stream({ messages: [{ role: 'user' as const, content: 'u1' }] } as AiRequest, new AbortController().signal, 'conv-1')) { /* drain */ }
        svc.evictConversation('conv-1')
        // After eviction, the next message should be a START (full transcript)
        const turn2Messages = [{ role: 'user' as const, content: 'u1' }, { role: 'assistant' as const, content: 'a1' }, { role: 'user' as const, content: 'u2' }]
        for await (const _ of svc.stream({ messages: turn2Messages } as AiRequest, new AbortController().signal, 'conv-1')) { /* drain */ }

        expect(seenMessages[1]).toBe(3)
        expect(seenConfigs[1].mcpTools!.command).toContain('--session-id')
        fs.rmSync(mcpConfigDir, { recursive: true, force: true })
    })

    it('a codex profile never creates a session entry and always sends the full transcript', async () => {
        const mcpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-mcp-test-'))
        const seenMessages: number[] = []
        const createEngine = (config: AiEngineConfig) => ({
            async *stream(req: AiRequest) { seenMessages.push(req.messages.length); yield { delta: 'ok' } },
            async complete() { return { text: '' } }, async dryRun() { return { prompt: '', replacements: [] } },
        })
        const { endpoint } = fakeMcpEndpoint()
        const provider: ContextProvider = { name: 'docs', tools: () => [{ name: 'search_docs', description: 's', parameters: {} }], callTool: async () => ({ content: 'r' }) }
        const codexProfile: AiProfile = { id: 'cli:codex', name: 'Codex', adapter: 'cli', cliKind: 'codex', model: '', isLocal: true, redactionEnabled: false, hasKey: false }
        const svc = new AiService(fakeProfileStore(codexProfile) as never, ssdp, fakeStore() as never, {
            createEngine, contextProviders: [provider], resolveEnv: async () => ({ PATH: '' }),
            detectClis: async () => ['codex'] as never, mcpEndpoint: endpoint, tokenSource: () => 'tok',
            mcpConfigDir, bridgePath: path.join(os.tmpdir(), 'docsToolBridge.js'),
        })

        // Turn 1: codex gets the full 1-message array even with a conversationId
        for await (const _ of svc.stream({ messages: [{ role: 'user' as const, content: 'u1' }] } as AiRequest, new AbortController().signal, 'conv-codex')) { /* drain */ }
        // Turn 2: codex still gets the full 3-message array (not a delta)
        const turn2Messages = [
            { role: 'user' as const, content: 'u1' },
            { role: 'assistant' as const, content: 'a1' },
            { role: 'user' as const, content: 'u2' },
        ]
        for await (const _ of svc.stream({ messages: turn2Messages } as AiRequest, new AbortController().signal, 'conv-codex')) { /* drain */ }

        // Both turns send the full message array because codex never creates a session entry.
        expect(seenMessages).toEqual([1, 3])
        fs.rmSync(mcpConfigDir, { recursive: true, force: true })
    })

    it('a gemini profile reuses a stable dir across turns and evictConversation removes it', async () => {
        const mcpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-mcp-test-'))
        const spawnedDirs: Array<string | undefined> = []
        const spawnedCommands: string[] = []
        const createEngine = (config: AiEngineConfig) => ({
            async *stream() {
                const cliConfig = config as CliEngineConfig
                spawnedDirs.push(cliConfig.mcpTools?.cwd)
                spawnedCommands.push(cliConfig.mcpTools?.command ?? '')
                yield { delta: 'ok' }
            },
            async complete() { return { text: '' } }, async dryRun() { return { prompt: '', replacements: [] } },
        })
        const { endpoint } = fakeMcpEndpoint()
        const provider: ContextProvider = { name: 'docs', tools: () => [{ name: 'search_docs', description: 's', parameters: {} }], callTool: async () => ({ content: 'r' }) }
        const geminiProfile: AiProfile = { id: 'cli:gemini', name: 'Gemini', adapter: 'cli', cliKind: 'gemini', model: 'gemini-2.5-pro', isLocal: true, redactionEnabled: false, hasKey: false }
        const svc = new AiService(fakeProfileStore(geminiProfile) as never, ssdp, fakeStore() as never, {
            createEngine, contextProviders: [provider], resolveEnv: async () => ({ PATH: '' }),
            detectClis: async () => ['gemini'] as never, mcpEndpoint: endpoint, tokenSource: () => 'tok',
            mcpConfigDir, bridgePath: path.join(os.tmpdir(), 'docsToolBridge.js'),
        })

        // Turn 1: START, a new stable dir is created
        for await (const _ of svc.stream({ messages: [{ role: 'user' as const, content: 'u1' }] } as AiRequest, new AbortController().signal, 'conv-gemini')) { /* drain */ }
        const firstDir = spawnedDirs[0]
        expect(firstDir).toBeTruthy()

        // Turn 1 was a START.
        expect(spawnedCommands[0]).toContain('--session-id')

        // Turn 2: RESUME reuses the same stable dir and carries --resume wiring.
        const turn2Messages = [
            { role: 'user' as const, content: 'u1' },
            { role: 'assistant' as const, content: 'a1' },
            { role: 'user' as const, content: 'u2' },
        ]
        for await (const _ of svc.stream({ messages: turn2Messages } as AiRequest, new AbortController().signal, 'conv-gemini')) { /* drain */ }

        // Turn 2 used the same stable dir and resumed the session.
        expect(spawnedDirs[1]).toBe(firstDir)
        expect(spawnedCommands[1]).toContain('--resume')
        // The stable dir still exists between turns.
        expect(firstDir && fs.existsSync(firstDir)).toBe(true)

        // evictConversation must remove the stable dir.
        svc.evictConversation('conv-gemini')
        expect(firstDir && fs.existsSync(firstDir)).toBe(false)

        fs.rmSync(mcpConfigDir, { recursive: true, force: true })
    })

    it('an HTTP profile ignores conversationId and sends the full message array', async () => {
        const seenMessages: number[] = []
        const createEngine = () => ({
            async *stream(req: AiRequest) { seenMessages.push(req.messages.length); yield { delta: 'ok' } },
            async complete() { return { text: '' } }, async dryRun() { return { prompt: '', replacements: [] } },
        })
        const httpProfile: AiProfile = { id: 'p-http', name: 'Claude', adapter: 'anthropic', model: 'claude-opus-4', isLocal: false, redactionEnabled: false, hasKey: true }
        const svc = new AiService(fakeProfileStore(httpProfile, 'sk') as never, ssdp, fakeStore() as never, { createEngine })

        const turn1 = [{ role: 'user' as const, content: 'u1' }]
        for await (const _ of svc.stream({ messages: turn1 } as AiRequest, new AbortController().signal, 'conv-x')) { /* drain */ }
        const turn2 = [{ role: 'user' as const, content: 'u1' }, { role: 'assistant' as const, content: 'a1' }, { role: 'user' as const, content: 'u2' }]
        for await (const _ of svc.stream({ messages: turn2 } as AiRequest, new AbortController().signal, 'conv-x')) { /* drain */ }

        // Both turns send the full array (HTTP does not slice)
        expect(seenMessages).toEqual([1, 3])
    })
})
