/**
 * Portable AI engine core types. No Electron, RokDock, or Roku knowledge.
 * Streaming is an AsyncIterable of text deltas and tool-activity breadcrumbs.
 * Cancellation is a standard AbortSignal.
 */

export type AiAdapterType = 'cli' | 'anthropic' | 'gemini' | 'openai-compatible'

/** The AI CLIs RokDock recognizes and can drive with their own tools disabled. */
export type CliKind = 'claude' | 'gemini' | 'codex' | 'copilot'

/** A block of provided knowledge injected into a request. */
export interface ContextBlock {
    title?: string
    text: string
    source?: string
}

/** A tool definition a provider may expose. Used by all HTTP adapters and the engine to drive native tool loops. */
export interface ToolDef {
    name: string
    description: string
    /** JSON Schema for the tool arguments. */
    parameters: Record<string, unknown>
}

/** The result of executing a tool call. Returned by a provider's callTool and forwarded to the model. */
export interface ToolResult {
    content: string
    isError?: boolean
}

/** A breadcrumb emitted when an adapter invokes a tool, surfaced to the UI. */
export interface ToolActivity {
    name: string
    args: Record<string, unknown>
}

/**
 * One streamed item from an adapter. A bare string is a text delta (the common
 * case, so existing text-only adapters need no change). An object is a tool
 * invocation breadcrumb. The engine maps these to AiStreamChunk / AiActivityChunk.
 */
export type AdapterEvent = string | { tool: ToolActivity }

/** Tool specs plus an executor, handed to an adapter so it can run a native tool loop. */
export interface AdapterToolkit {
    specs: ToolDef[]
    call(name: string, args: unknown, signal: AbortSignal): Promise<ToolResult>
}

/** Maximum tool-call rounds per user turn, an upper bound on cost and runaway loops. */
export const MAX_TOOL_ROUNDS = 5

/** A source of additional context. retrieve() supplies knowledge blocks. tools()/callTool() enable the native tool loop. */
export interface ContextProvider {
    name: string
    retrieve?(request: AiRequest, signal: AbortSignal): Promise<ContextBlock[]>
    tools?(): ToolDef[]
    callTool?(name: string, args: unknown, signal: AbortSignal): Promise<ToolResult>
}

/** One turn in a multi-turn conversation. */
export interface ChatMessage {
    role: 'user' | 'assistant'
    content: string
}

/** The engine-agnostic request a feature builds. The last entry in `messages` is the current user turn. */
export interface AiRequest {
    system?: string
    messages: ChatMessage[]
    /** Inline provided knowledge. */
    context?: ContextBlock[]
    /** Extra sensitive tokens this request wants scrubbed, merged with the engine's secrets. */
    redactContext?: Partial<RedactSecrets>
}

/** Fields shared by every resolved request, regardless of transport. */
interface ResolvedRequestBase {
    model: string
    system?: string
    messages: ChatMessage[]
}

/** A resolved request bound for an HTTP adapter (anthropic, gemini, openai-compatible). */
export interface ResolvedHttpRequest extends ResolvedRequestBase {
    transport: 'http'
    baseUrl?: string
    apiKey?: string
}

/** A resolved request bound for the CLI subprocess adapter. */
export interface ResolvedCliRequest extends ResolvedRequestBase {
    transport: 'cli'
    command?: string
    /** Environment for a CLI subprocess. The host injects an augmented PATH here. Undefined = inherit process.env. */
    env?: Record<string, string>
    /** Working directory for the subprocess. Undefined inherits the host cwd. */
    cwd?: string
    /** Kill the subprocess after this many ms of zero output. Catches a CLI stuck on a prompt. Undefined = default. */
    idleTimeoutMs?: number
}

/**
 * A request after the engine has assembled context and redacted. Adapters receive only this.
 * Discriminated by `transport` so an adapter sees only the connection fields its transport
 * uses (HTTP: baseUrl/apiKey; CLI: command/env), never the other transport's fields.
 */
export type ResolvedRequest = ResolvedHttpRequest | ResolvedCliRequest

export interface AiStreamChunk {
    delta: string
}

/** A tool-activity breadcrumb the engine yields between text chunks. */
export interface AiActivityChunk {
    activity: ToolActivity
}

export interface AiResult {
    text: string
}

/** Literal strings and labeled regexes to scrub. */
export interface RedactSecrets {
    ips: string[]
    deviceNames: string[]
    serials: string[]
    custom: Array<{ literal: string; label: string }>
}

export interface RedactionConfig {
    enabled: boolean
}

export interface RedactionReplacement {
    label: string
    count: number
}

export interface RedactionResult {
    text: string
    replacements: RedactionReplacement[]
}

/** An adapter turns a ResolvedRequest into a stream of text deltas and tool breadcrumbs. */
export interface AiAdapter {
    readonly type: AiAdapterType
    stream(request: ResolvedRequest, signal: AbortSignal, toolkit?: AdapterToolkit): AsyncIterable<AdapterEvent>
}

/** Configuration fields shared by every transport. */
interface AiEngineConfigBase {
    adapter: AiAdapter
    model: string
    redaction: RedactionConfig
    secrets: RedactSecrets
    providers?: ContextProvider[]
}

/** Engine config for an HTTP adapter. */
export interface HttpEngineConfig extends AiEngineConfigBase {
    transport: 'http'
    baseUrl?: string
    apiKey?: string
}

/** Engine config for the CLI subprocess adapter. */
export interface CliEngineConfig extends AiEngineConfigBase {
    transport: 'cli'
    cliKind: CliKind
    /** Path to a materialized policy file the host wrote for this CLI (Gemini). */
    cliPolicyFilePath?: string
    /** Environment for a CLI subprocess (host-augmented PATH). */
    env?: Record<string, string>
    /**
     * When present, the engine uses the native MCP tool loop instead of the text-protocol
     * round loop. The CLI is spawned once with the bridge attached. No toolkit is
     * passed to the adapter (the CLI calls tools directly via the bridge).
     */
    mcpTools?: {
        /** The full MCP-mode command the host built via CliMcp.plan. */
        command: string
        /** Working directory for the spawn, when the CLI reads project-scoped config from cwd (gemini). */
        cwd?: string
    }
}

/**
 * Fully resolved engine configuration. Injected by the host. The core reads no storage.
 * Discriminated by `transport` so a CLI config cannot carry baseUrl/apiKey and an HTTP
 * config cannot carry command/env: each transport's connection fields are type-enforced.
 */
export type AiEngineConfig = HttpEngineConfig | CliEngineConfig

/** The redacted payload a real send would produce, returned without dispatching. Backs the inspect-only preview. */
export interface AiDryRun {
    prompt: string
    system?: string
    replacements: RedactionReplacement[]
}
