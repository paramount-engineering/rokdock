import { describe, it, expect } from 'vitest'
import { buildCliCommand, buildMcpConfigJson, assertShellSafeModel, isCliKind, CLI_KINDS, CLI_DEFINITIONS } from '@ai-core/adapters/cliRegistry'

const POLICY = '/tmp/p.toml'

describe('cliRegistry', () => {
    it('lists exactly the four recognized kinds', () => {
        expect([...CLI_KINDS].sort()).toEqual(['claude', 'codex', 'copilot', 'gemini'])
    })

    it('builds claude with the model flag and the native-tool denylist', () => {
        const command = buildCliCommand('claude', 'claude-opus-4-8')
        expect(command).toBe('claude -p --model claude-opus-4-8 --disallowedTools "Task Bash BashOutput KillShell Glob Grep Read Edit Write NotebookEdit WebFetch WebSearch TodoWrite SlashCommand ExitPlanMode"')
    })

    it('omits the model flag when the model is empty', () => {
        expect(buildCliCommand('claude', '')).toBe('claude -p --disallowedTools "Task Bash BashOutput KillShell Glob Grep Read Edit Write NotebookEdit WebFetch WebSearch TodoWrite SlashCommand ExitPlanMode"')
        expect(buildCliCommand('codex', '')).toBe('codex exec -s read-only --skip-git-repo-check')
        expect(buildCliCommand('copilot', '')).toBe('copilot -s --no-ask-user --available-tools "" --no-remote --no-remote-export')
    })

    it('builds codex and copilot with their model flags', () => {
        expect(buildCliCommand('codex', 'gpt-5.3-codex')).toBe('codex exec -m gpt-5.3-codex -s read-only --skip-git-repo-check')
        expect(buildCliCommand('copilot', 'auto')).toBe('copilot -s --no-ask-user --available-tools "" --no-remote --no-remote-export --model auto')
    })

    it('builds gemini with the supplied policy path and skip-trust', () => {
        expect(buildCliCommand('gemini', 'gemini-3-flash', { policyFilePath: POLICY }))
            .toBe(`gemini --skip-trust --policy "${POLICY}" -m gemini-3-flash -p ""`)
    })

    it('throws when gemini is built without a policy path', () => {
        expect(() => buildCliCommand('gemini', 'gemini-3-flash')).toThrow(/policy/i)
    })

    it('rejects a model with shell metacharacters', () => {
        expect(() => buildCliCommand('claude', 'm; rm -rf /')).toThrow(/cannot be placed in a shell command/i)
    })

    it('allows the punctuation real model ids use', () => {
        expect(() => buildCliCommand('codex', 'qwen2.5-coder:7b')).not.toThrow()
    })

    it('throws on an unknown kind', () => {
        // @ts-expect-error exercising the runtime guard
        expect(() => buildCliCommand('nope', 'm')).toThrow(/unknown cli kind/i)
    })

    it('isCliKind narrows known values only', () => {
        expect(isCliKind('claude')).toBe(true)
        expect(isCliKind('ollama')).toBe(false)
    })

    it('declares a policy file only for gemini', () => {
        expect(CLI_DEFINITIONS.gemini.policyFile?.filename).toBe('gemini-deny-tools.toml')
        expect(CLI_DEFINITIONS.claude.policyFile).toBeUndefined()
    })

    it('keeps copilot sessions local (no GitHub export)', () => {
        const command = CLI_DEFINITIONS.copilot.buildCommand('', {})
        expect(command).toContain('--no-remote')
        expect(command).toContain('--no-remote-export')
    })
})

describe('MCP wiring', () => {
    it('claude has an mcp field', () => {
        expect(CLI_DEFINITIONS.claude.mcp).toBeDefined()
    })

    it('codex has an mcp field', () => {
        expect(CLI_DEFINITIONS.codex.mcp).toBeDefined()
    })

    it('claude mcp.plan includes --mcp-config and --allowedTools with prefixed tool names', () => {
        const plan = CLI_DEFINITIONS.claude.mcp!.plan({
            model: '', toolNames: ['search_docs', 'fetch_page'],
            configDir: 'C:/x', bridgePath: '/b.js', nodePath: 'node',
            url: 'http://127.0.0.1:1', token: 'tok', bridgeEnv: {},
        })
        expect(plan.command).toContain('--mcp-config "C:/x/mcp.json"')
        expect(plan.command).toContain('--allowedTools "mcp__rokdock__search_docs mcp__rokdock__fetch_page"')
    })

    it('buildMcpConfigJson returns correct JSON structure without extraEnv', () => {
        const json = buildMcpConfigJson('/b.js', 'node', 'http://127.0.0.1:1/', 'tok')
        expect(JSON.parse(json)).toEqual({
            mcpServers: {
                rokdock: {
                    command: 'node',
                    args: ['/b.js'],
                    env: {
                        ROKDOCK_TOOL_URL: 'http://127.0.0.1:1/',
                        ROKDOCK_TOOL_TOKEN: 'tok',
                    },
                },
            },
        })
    })

    it('buildMcpConfigJson merges extraEnv into the env block', () => {
        const parsed = JSON.parse(buildMcpConfigJson('/bridge.js', '/path/to/electron', 'http://x/', 'tok', { ELECTRON_RUN_AS_NODE: '1' }))
        expect(parsed.mcpServers.rokdock.env.ELECTRON_RUN_AS_NODE).toBe('1')
        expect(parsed.mcpServers.rokdock.env.ROKDOCK_TOOL_URL).toBe('http://x/')
        expect(parsed.mcpServers.rokdock.env.ROKDOCK_TOOL_TOKEN).toBe('tok')
    })
})

describe('claude mcp.plan', () => {
    const opts = {
        model: 'sonnet', toolNames: ['search_docs', 'fetch_page'],
        configDir: 'C:/tmp/req-x', codexHome: 'C:/Users/me/.codex', bridgePath: '/b.js', nodePath: 'node',
        url: 'http://127.0.0.1:1', token: 'tok', bridgeEnv: { ELECTRON_RUN_AS_NODE: '1' },
    }
    it('builds the claude command with disallowed built-ins, the mcp-config file, and the allowlist', () => {
        const plan = CLI_DEFINITIONS.claude.mcp!.plan(opts)
        expect(plan.command).toContain('claude -p --model sonnet')
        expect(plan.command).toContain('--disallowedTools')
        expect(plan.command).toContain('--mcp-config "C:/tmp/req-x/mcp.json"')
        expect(plan.command).toContain('--allowedTools "mcp__rokdock__search_docs mcp__rokdock__fetch_page"')
        expect(plan.cwd).toBeUndefined()
        expect(plan.files).toHaveLength(1)
        expect(plan.files[0].path).toBe('C:/tmp/req-x/mcp.json')
        expect(plan.files[0].content).toBe(buildMcpConfigJson('/b.js', 'node', 'http://127.0.0.1:1', 'tok', { ELECTRON_RUN_AS_NODE: '1' }))
    })
    it('rejects a shell-unsafe model', () => {
        expect(() => CLI_DEFINITIONS.claude.mcp!.plan({ ...opts, model: 'a; rm -rf /' })).toThrow()
    })
})

describe('copilot mcp.plan', () => {
    const opts = { model: '', toolNames: ['search_docs', 'fetch_page'], configDir: 'C:/tmp/req-x', codexHome: 'C:/Users/me/.codex', bridgePath: '/b.js', nodePath: 'node', url: 'http://127.0.0.1:1', token: 'tok', bridgeEnv: { ELECTRON_RUN_AS_NODE: '1' } }
    it('disables built-ins via the MCP whitelist and allows the rokdock server without a prompt', () => {
        const plan = CLI_DEFINITIONS.copilot.mcp!.plan(opts)
        expect(plan.command).toContain('copilot -s --no-ask-user --no-remote --no-remote-export')
        expect(plan.command).toContain('--available-tools "rokdock-search_docs rokdock-fetch_page"')
        expect(plan.command).toContain('--allow-tool rokdock')
        expect(plan.command).toContain('--additional-mcp-config @"C:/tmp/req-x/mcp.json"')
        expect(plan.command).not.toContain('--available-tools ""')
        expect(plan.files[0].path).toBe('C:/tmp/req-x/mcp.json')
        expect(plan.cwd).toBeUndefined()
    })
})

describe('gemini mcp.plan', () => {
    const opts = { model: 'gemini-2.5-pro', toolNames: ['search_docs', 'fetch_page'], configDir: 'C:/tmp/req-x', codexHome: 'C:/Users/me/.codex', bridgePath: '/b.js', nodePath: 'node', url: 'http://127.0.0.1:1', token: 'tok', bridgeEnv: { ELECTRON_RUN_AS_NODE: '1' } }
    it('writes project settings + an allow-mcp policy and runs in the config dir', () => {
        const plan = CLI_DEFINITIONS.gemini.mcp!.plan(opts)
        expect(plan.command).toContain('gemini --skip-trust')
        expect(plan.command).toContain('--policy "C:/tmp/req-x/policy.toml"')
        expect(plan.command).toContain('--allowed-mcp-server-names rokdock')
        expect(plan.command).toContain('-m gemini-2.5-pro')
        expect(plan.command).toContain('-p ""')
        expect(plan.cwd).toBe('C:/tmp/req-x')
        const settings = plan.files.find(file => file.path === 'C:/tmp/req-x/.gemini/settings.json')
        const policy = plan.files.find(file => file.path === 'C:/tmp/req-x/policy.toml')
        expect(settings).toBeDefined()
        expect(settings!.content).toContain('"rokdock"')
        expect(policy!.content).toContain('mcpName = "rokdock"')
        expect(policy!.content).toContain('decision = "deny"')
        // The allow rule must outrank the deny-all rule, or the MCP tool would also be denied.
        expect(policy!.content).toContain('priority = 900')
        expect(policy!.content).toContain('priority = 100')
    })
})

describe('codex mcp.plan', () => {
    const opts = { model: 'gpt-5.5', toolNames: ['search_docs', 'fetch_page'], configDir: 'C:/tmp/req-x', codexHome: 'C:/Users/me/.codex', bridgePath: 'C:/b/bridge.js', nodePath: 'C:/n/node.exe', url: 'http://127.0.0.1:1', token: 'tok-123', bridgeEnv: { ELECTRON_RUN_AS_NODE: '1' } }
    it('writes a layered profile file in codexHome and runs codex with -p (always START, no resume)', () => {
        const plan = CLI_DEFINITIONS.codex.mcp!.plan(opts)
        expect(plan.command).toContain('codex exec')
        expect(plan.command).toContain('-m gpt-5.5')
        expect(plan.command).toContain('-s read-only')
        expect(plan.command).toContain('-p rokdock-mcp-tok-123')
        expect(plan.command).toContain('--skip-git-repo-check')
        expect(plan.command).not.toContain('mcp_servers')
        expect(plan.command).not.toContain('resume')
        expect(plan.files).toHaveLength(1)
        expect(plan.files[0].path).toBe('C:/Users/me/.codex/rokdock-mcp-tok-123.config.toml')
        const toml = plan.files[0].content
        expect(toml).toContain('[mcp_servers.rokdock]')
        expect(toml).toContain('default_tools_approval_mode = "approve"')
        expect(toml).toContain('args = ["C:/b/bridge.js"]')
        expect(toml).toContain('[mcp_servers.rokdock.env]')
        expect(toml).toContain('ROKDOCK_TOOL_URL = "http://127.0.0.1:1"')
        expect(toml).toContain('ROKDOCK_TOOL_TOKEN = "tok-123"')
        expect(toml).toContain('ELECTRON_RUN_AS_NODE = "1"')
        expect(plan.cwd).toBeUndefined()
    })
})

describe('CLI session wiring in plan()', () => {
    const base = {
        toolNames: ['search_docs', 'fetch_page'], configDir: 'C:/tmp/req-x', codexHome: 'C:/Users/me/.codex',
        bridgePath: 'C:/b/bridge.js', nodePath: 'C:/n/node.exe', url: 'http://127.0.0.1:1', token: 'tok',
        bridgeEnv: { ELECTRON_RUN_AS_NODE: '1' },
    }
    it('claude start adds --session-id, resume adds --resume', () => {
        const start = CLI_DEFINITIONS.claude.mcp!.plan({ ...base, model: 'sonnet', session: { handle: 'S1', mode: 'start' } })
        expect(start.command).toContain('--session-id S1')
        const resume = CLI_DEFINITIONS.claude.mcp!.plan({ ...base, model: 'sonnet', session: { handle: 'S1', mode: 'resume' } })
        expect(resume.command).toContain('--resume S1')
        expect(resume.command).not.toContain('--session-id S1')
    })
    it('copilot uses --session-id for both start and resume', () => {
        for (const mode of ['start', 'resume'] as const) {
            const plan = CLI_DEFINITIONS.copilot.mcp!.plan({ ...base, model: '', session: { handle: 'S2', mode } })
            expect(plan.command).toContain('--session-id S2')
        }
    })
    it('gemini start adds --session-id, resume adds --resume', () => {
        const start = CLI_DEFINITIONS.gemini.mcp!.plan({ ...base, model: 'gemini-2.5-pro', session: { handle: 'S3', mode: 'start' } })
        expect(start.command).toContain('--session-id S3')
        const resume = CLI_DEFINITIONS.gemini.mcp!.plan({ ...base, model: 'gemini-2.5-pro', session: { handle: 'S3', mode: 'resume' } })
        expect(resume.command).toContain('--resume S3')
    })
    it('codex always builds the START command regardless of the session option', () => {
        // Codex does not support resume (resume drops -p, losing MCP tools), so the plan
        // ignores any session option and always produces the exec START form.
        const noSession = CLI_DEFINITIONS.codex.mcp!.plan({ ...base, model: 'gpt-5.5' })
        expect(noSession.command).toContain('codex exec')
        expect(noSession.command).not.toContain('resume')
        expect(noSession.command).toContain('-p rokdock-mcp-')
    })
    it('plans without a session option are unchanged (no session flags)', () => {
        const plan = CLI_DEFINITIONS.claude.mcp!.plan({ ...base, model: 'sonnet' })
        expect(plan.command).not.toContain('--session-id')
        expect(plan.command).not.toContain('--resume')
    })
    it('supportsSessionReuse is true for claude, copilot, and gemini; absent for codex', () => {
        expect(CLI_DEFINITIONS.claude.mcp!.supportsSessionReuse).toBe(true)
        expect(CLI_DEFINITIONS.copilot.mcp!.supportsSessionReuse).toBe(true)
        expect(CLI_DEFINITIONS.gemini.mcp!.supportsSessionReuse).toBe(true)
        expect(CLI_DEFINITIONS.codex.mcp!.supportsSessionReuse).toBeFalsy()
    })
    it('requiresStableSessionDir is true only for gemini', () => {
        expect(CLI_DEFINITIONS.gemini.mcp!.requiresStableSessionDir).toBe(true)
        expect(CLI_DEFINITIONS.claude.mcp!.requiresStableSessionDir).toBeFalsy()
        expect(CLI_DEFINITIONS.copilot.mcp!.requiresStableSessionDir).toBeFalsy()
        expect(CLI_DEFINITIONS.codex.mcp!.requiresStableSessionDir).toBeFalsy()
    })
})

describe('assertShellSafeModel', () => {
    it('accepts safe model names', () => {
        expect(() => assertShellSafeModel('claude-opus-4-8')).not.toThrow()
        expect(() => assertShellSafeModel('qwen2.5-coder:7b')).not.toThrow()
    })
    it('rejects model names with shell metacharacters', () => {
        expect(() => assertShellSafeModel('a; rm -rf /')).toThrow(/cannot be placed in a shell command/i)
    })
})
