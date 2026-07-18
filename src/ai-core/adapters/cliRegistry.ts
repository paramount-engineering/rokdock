/**
 * The CLIs RokDock recognizes, and how to invoke each one non-interactively with its own
 * built-in tools disabled. Pure data + a command builder: no filesystem, no Electron. The
 * prompt is delivered over stdin by the adapter, so a builder only produces the argv. Flags
 * were verified live against each CLI's --help and behavior. Gemini's tools cannot be turned
 * off with a flag (plan mode still web-searches), so it declares a deny-all Policy Engine
 * file whose content the host materializes and whose path is passed back in via opts.
 */
import type { CliKind } from '../types'

/** A model name is interpolated into a shell command, so it must be free of shell metacharacters. */
const SHELL_SAFE_MODEL = /^[A-Za-z0-9._:/+@-]*$/

export function assertShellSafeModel(model: string): void {
    if (!SHELL_SAFE_MODEL.test(model)) {
        throw new Error(`The model name ${JSON.stringify(model)} cannot be placed in a shell command: only letters, digits, and the characters . _ : / + @ - are allowed.`)
    }
}

/** Every native Claude Code tool, denied so only our tools drive it. AskUserQuestion is
 *  included so roBot uses our ask_user (up to 12 options), not the native 4-option prompt. */
const CLAUDE_DENYLIST = 'Task Bash BashOutput KillShell Glob Grep Read Edit Write NotebookEdit WebFetch WebSearch TodoWrite SlashCommand ExitPlanMode AskUserQuestion'

/** Gemini deny-all policy: a global deny excludes every tool from the model entirely. */
const GEMINI_DENY_POLICY = `[[rule]]
toolName = "*"
decision = "deny"
priority = 999
denyMessage = "Tools are disabled in this context."
`

/** Gemini MCP policy: allow the rokdock server's tools (priority 900), deny everything else (priority 100). */
const GEMINI_MCP_POLICY = `[[rule]]
mcpName = "rokdock"
toolName = "*"
decision = "allow"
priority = 900

[[rule]]
toolName = "*"
decision = "deny"
priority = 100
denyMessage = "Tools are disabled in this context."
`

export interface CliBuildOptions {
    /** Path to the policy file the host materialized for this CLI, if it declares policyFile. */
    policyFilePath?: string
}

/** A file the host materializes before spawning. The path is absolute so a CLI whose config
 *  must live outside the per-request dir (codex's profile in CODEX_HOME) can target it. */
export interface CliMcpFile {
    /** Absolute path the host writes (creating parent directories). */
    path: string
    content: string
}

export interface CliMcpPlan {
    /** Full MCP-mode command: built-in tools disabled AND the rokdock bridge attached + allowlisted. */
    command: string
    /** Files to write at their absolute paths before spawning. */
    files: CliMcpFile[]
    /** Working directory for the spawn, when the CLI reads project-scoped config from cwd (gemini). Undefined inherits the host cwd. */
    cwd?: string
}

/** Session continuation handle and whether this spawn starts or resumes it. */
export interface CliSessionPlan {
    /** The session handle: a uuid the host minted. */
    handle: string
    mode: 'start' | 'resume'
}

export interface CliMcpPlanOptions {
    model: string
    toolNames: string[]
    /** Absolute path of the per-request config dir the host created. */
    configDir: string
    /** Absolute path of codex's config home (process.env.CODEX_HOME or ~/.codex), where its profile file goes. */
    codexHome: string
    bridgePath: string
    nodePath: string
    url: string
    token: string
    /** Extra env for the bridge process (e.g. ELECTRON_RUN_AS_NODE=1), merged into the mcpServers env. */
    bridgeEnv: Record<string, string>
    session?: CliSessionPlan
}

/** MCP bridge wiring for a CLI that supports attaching an external MCP server. */
export interface CliMcp {
    /** Build the complete MCP-mode invocation (command + files to materialize) for this CLI. */
    plan(opts: CliMcpPlanOptions): CliMcpPlan
    /**
     * True when this CLI supports cross-message session reuse via --session-id / --resume.
     * Absent or false means the CLI always starts fresh (no session entry is created).
     */
    supportsSessionReuse?: boolean
    /**
     * True when session reuse requires a stable per-conversation cwd across turns (gemini only).
     * When false or absent, a fresh per-request dir is used for every spawn.
     */
    requiresStableSessionDir?: boolean
}

/** The trailing session flag for a CLI that uses --session-id (start) / a custom resume flag. */
function sessionFlag(session: CliSessionPlan | undefined, startFlag: string, resumeFlag: string): string {
    if (!session) return ''
    return session.mode === 'start' ? ` ${startFlag} ${session.handle}` : ` ${resumeFlag} ${session.handle}`
}

export interface CliDefinition {
    kind: CliKind
    /** Display name for the UI. */
    label: string
    /** One-line description for the settings UI. */
    description: string
    /** Executable name probed on PATH. */
    executable: string
    /** Static policy-file content the host must materialize before running this CLI. */
    policyFile?: { filename: string; content: string }
    /** MCP bridge wiring. Absent means this CLI does not support MCP in this context. */
    mcp?: CliMcp
    /** Build the full shell command (argv only; prompt goes to stdin). */
    buildCommand(model: string, opts: CliBuildOptions): string
}

const modelFlag = (flag: string, model: string): string => (model ? ` ${flag} ${model}` : '')

/** The single mcpServers JSON file the file-based CLIs (claude, copilot, gemini) consume. */
const MCP_CONFIG_FILENAME = 'mcp.json'

function mcpServerFile(opts: CliMcpPlanOptions, absolutePath: string): CliMcpFile {
    return { path: absolutePath, content: buildMcpConfigJson(opts.bridgePath, opts.nodePath, opts.url, opts.token, opts.bridgeEnv) }
}

/** Forward-slash a path so it is safe inside a double-quoted shell argument and TOML string. */
function shellPath(absolutePath: string): string {
    return absolutePath.replace(/\\/g, '/')
}

/** Build codex's layered-profile TOML for the rokdock MCP server. default_tools_approval_mode
 *  auto-approves the server's tools so `codex exec` (non-interactive) does not cancel the call. */
function buildCodexProfileToml(opts: CliMcpPlanOptions): string {
    const env: Record<string, string> = { ROKDOCK_TOOL_URL: opts.url, ROKDOCK_TOOL_TOKEN: opts.token, ...opts.bridgeEnv }
    const envLines = Object.entries(env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
    return [
        '[mcp_servers.rokdock]',
        `command = ${JSON.stringify(shellPath(opts.nodePath))}`,
        `args = [${JSON.stringify(shellPath(opts.bridgePath))}]`,
        'default_tools_approval_mode = "approve"',
        '',
        '[mcp_servers.rokdock.env]',
        ...envLines,
        '',
    ].join('\n')
}

export const CLI_DEFINITIONS: Record<CliKind, CliDefinition> = {
    claude: {
        kind: 'claude',
        label: 'Claude Code',
        description: 'Runs Claude Code non-interactively with its built-in web, file, and shell tools disabled.',
        executable: 'claude',
        buildCommand: (model) => `claude -p${modelFlag('--model', model)} --disallowedTools "${CLAUDE_DENYLIST}"`,
        mcp: {
            supportsSessionReuse: true,
            plan(opts): CliMcpPlan {
                assertShellSafeModel(opts.model)
                const allowedTools = opts.toolNames.map((name) => `mcp__rokdock__${name}`).join(' ')
                const configPath = shellPath(`${opts.configDir}/${MCP_CONFIG_FILENAME}`)
                const command = `claude -p${modelFlag('--model', opts.model)} --disallowedTools "${CLAUDE_DENYLIST}" --mcp-config "${configPath}" --allowedTools "${allowedTools}"${sessionFlag(opts.session, '--session-id', '--resume')}`
                return { command, files: [mcpServerFile(opts, configPath)] }
            },
        },
    },
    gemini: {
        kind: 'gemini',
        label: 'Gemini',
        description: 'Runs the Gemini CLI non-interactively with all of its tools denied via a policy file.',
        executable: 'gemini',
        policyFile: { filename: 'gemini-deny-tools.toml', content: GEMINI_DENY_POLICY },
        buildCommand: (model, opts) => {
            if (!opts.policyFilePath) throw new Error('Gemini requires a policy file path to disable its tools.')
            return `gemini --skip-trust --policy "${opts.policyFilePath}"${modelFlag('-m', model)} -p ""`
        },
        mcp: {
            supportsSessionReuse: true,
            // Gemini sessions are project/cwd-scoped, so the same directory must be reused
            // across all turns of a conversation or the CLI cannot find the prior session.
            requiresStableSessionDir: true,
            plan(opts): CliMcpPlan {
                assertShellSafeModel(opts.model)
                const settingsPath = shellPath(`${opts.configDir}/.gemini/settings.json`)
                const policyPath = shellPath(`${opts.configDir}/policy.toml`)
                const command = `gemini --skip-trust --policy "${policyPath}" --allowed-mcp-server-names rokdock${modelFlag('-m', opts.model)} -p ""${sessionFlag(opts.session, '--session-id', '--resume')}`
                return {
                    command,
                    files: [
                        mcpServerFile(opts, settingsPath),
                        { path: policyPath, content: GEMINI_MCP_POLICY },
                    ],
                    cwd: opts.configDir,
                }
            },
        },
    },
    codex: {
        kind: 'codex',
        label: 'Codex',
        description: 'Runs Codex non-interactively in a read-only sandbox; web search is off by default.',
        executable: 'codex',
        buildCommand: (model) => `codex exec${modelFlag('-m', model)} -s read-only --skip-git-repo-check`,
        mcp: {
            // Codex resume loses MCP tools (resume rejects -p, so the bridge profile cannot be
            // reloaded). Always START with a fresh profile so tools stay active every turn.
            plan(opts): CliMcpPlan {
                const profileName = `rokdock-mcp-${opts.token}`
                const command = `${buildCliCommand('codex', opts.model)} -p ${profileName}`
                return {
                    command,
                    files: [{ path: `${opts.codexHome}/${profileName}.config.toml`, content: buildCodexProfileToml(opts) }],
                }
            },
        },
    },
    copilot: {
        kind: 'copilot',
        label: 'GitHub Copilot',
        description: 'Runs GitHub Copilot CLI non-interactively with no tools available and clean text output.',
        executable: 'copilot',
        buildCommand: (model) => `copilot -s --no-ask-user --available-tools "" --no-remote --no-remote-export${modelFlag('--model', model)}`,
        mcp: {
            supportsSessionReuse: true,
            plan(opts): CliMcpPlan {
                assertShellSafeModel(opts.model)
                const configPath = shellPath(`${opts.configDir}/${MCP_CONFIG_FILENAME}`)
                // --available-tools takes the bare server name to expose ALL of the server's tools.
                // Enumerating per-tool ids (rokdock-<name>) silently exposes none once more than one
                // tool is attached, so the model sees the tools but cannot call them and emits the
                // raw function-call syntax as text. --allow-tool grants the whole server to match.
                const command = `copilot -s --no-ask-user --no-remote --no-remote-export${modelFlag('--model', opts.model)} --available-tools "rokdock" --allow-tool rokdock --additional-mcp-config @"${configPath}"${sessionFlag(opts.session, '--session-id', '--session-id')}`
                return { command, files: [mcpServerFile(opts, configPath)] }
            },
        },
    },
}

export const CLI_KINDS = Object.keys(CLI_DEFINITIONS) as CliKind[]

export function isCliKind(value: string): value is CliKind {
    return Object.prototype.hasOwnProperty.call(CLI_DEFINITIONS, value)
}

export function buildCliCommand(kind: CliKind, model: string, opts: CliBuildOptions = {}): string {
    const def = CLI_DEFINITIONS[kind]
    if (!def) throw new Error(`Unknown CLI kind: ${kind}`)
    assertShellSafeModel(model)
    return def.buildCommand(model, opts)
}

/**
 * Build the JSON content for the MCP config file the file-based CLIs (claude, copilot,
 * gemini) need to attach the bridge server.
 * The host writes this to a temp file and passes the path to the CLI via mcp.plan.
 * extraEnv is merged last so the host can inject environment specifics (such as
 * ELECTRON_RUN_AS_NODE) without coupling this portable module to any host runtime.
 */
export function buildMcpConfigJson(bridgePath: string, nodePath: string, url: string, token: string, extraEnv: Record<string, string> = {}): string {
    return JSON.stringify({
        mcpServers: {
            rokdock: {
                command: nodePath,
                args: [bridgePath],
                env: {
                    ROKDOCK_TOOL_URL: url,
                    ROKDOCK_TOOL_TOKEN: token,
                    ...extraEnv,
                },
            },
        },
    })
}

