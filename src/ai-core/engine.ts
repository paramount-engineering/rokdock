/**
 * The portable AI engine. Built from one fully-resolved config (adapter + model +
 * connection fields + redaction policy + secret set + context providers). Per request it
 * runs providers, renders retrieved context onto the last user turn, redacts each message,
 * then folds to a single-prompt resolved shape before dispatching to the adapter. Output is
 * an AsyncIterable of chunks. complete() drains it. The core reads no storage and knows
 * nothing about Roku.
 */
import type {
    AiEngineConfig, AiRequest, AiStreamChunk, AiActivityChunk, AiResult, AiDryRun, ResolvedRequest, RedactSecrets, RedactionReplacement, ContextBlock, ChatMessage, AdapterToolkit, ToolDef,
} from './types'
import { redact } from './redaction'
import { foldMessages } from './transcript'
import { buildCliCommand } from './adapters/cliRegistry'
import { buildToolRouting } from './toolRouting'

function mergeSecrets(base: RedactSecrets, extra?: Partial<RedactSecrets>): RedactSecrets {
    if (!extra) return base
    return {
        ips: [...base.ips, ...(extra.ips ?? [])],
        deviceNames: [...base.deviceNames, ...(extra.deviceNames ?? [])],
        serials: [...base.serials, ...(extra.serials ?? [])],
        custom: [...base.custom, ...(extra.custom ?? [])],
    }
}

function renderContext(blocks: ContextBlock[]): string {
    return blocks
        .map(block => (block.title ? `## ${block.title}\n${block.text}` : block.text))
        .join('\n\n')
}

/** Combine replacement tallies from several redact() calls by label. */
function mergeReplacements(...lists: RedactionReplacement[][]): RedactionReplacement[] {
    const tally = new Map<string, number>()
    for (const list of lists) {
        for (const replacement of list) tally.set(replacement.label, (tally.get(replacement.label) ?? 0) + replacement.count)
    }
    return Array.from(tally, ([label, count]) => ({ label, count }))
}

/** Index of the last user message, or -1. */
function lastUserIndex(messages: ChatMessage[]): number {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') return i
    return -1
}

export function createAiEngine(config: AiEngineConfig) {
    // Run context providers, assemble (context blocks onto the last user turn), and redact
    // each message. Shared by resolve() (which then dispatches) and dryRun() (which returns
    // the redacted view), so the inspect-only preview can never diverge from what is sent.
    async function assembleAndRedact(request: AiRequest, signal: AbortSignal): Promise<AiDryRun & { messages: ChatMessage[] }> {
        const gathered: ContextBlock[] = [...(request.context ?? [])]
        for (const provider of config.providers ?? []) {
            if (provider.retrieve) gathered.push(...await provider.retrieve(request, signal))
        }
        const secrets = mergeSecrets(config.secrets, request.redactContext)
        const contextText = gathered.length > 0 ? renderContext(gathered) : ''
        const contextIndex = lastUserIndex(request.messages)

        const replacementLists: RedactionReplacement[][] = []
        const messages: ChatMessage[] = request.messages.map((message, i) => {
            const raw = (i === contextIndex && contextText) ? `${contextText}\n\n${message.content}` : message.content
            const redacted = redact(raw, secrets, config.redaction)
            replacementLists.push(redacted.replacements)
            return { role: message.role, content: redacted.text }
        })
        const systemResult = request.system ? redact(request.system, secrets, config.redaction) : undefined

        return {
            messages,
            prompt: foldMessages(messages),
            system: systemResult?.text,
            replacements: mergeReplacements(...replacementLists, systemResult?.replacements ?? []),
        }
    }

    async function resolve(request: AiRequest, signal: AbortSignal): Promise<ResolvedRequest> {
        const redacted = await assembleAndRedact(request, signal)
        const base = { model: config.model, system: redacted.system, messages: redacted.messages }
        if (config.transport === 'cli') {
            // MCP mode: the host pre-built the full command (built-ins off + bridge attached).
            // The engine passes it through and the adapter single-spawns.
            if (config.mcpTools) {
                return { ...base, transport: 'cli', command: config.mcpTools.command, cwd: config.mcpTools.cwd, env: config.env }
            }
            // No-tool path (Test Connection, a no-tool chat): build the plain command directly.
            return { ...base, transport: 'cli', command: buildCliCommand(config.cliKind, config.model, { policyFilePath: config.cliPolicyFilePath }), env: config.env }
        }
        return { ...base, transport: 'http', baseUrl: config.baseUrl, apiKey: config.apiKey }
    }

    function buildToolkit(): AdapterToolkit | undefined {
        const { specs, ownerByToolName } = buildToolRouting(config.providers ?? [])
        if (specs.length === 0) return undefined
        return {
            specs,
            async call(name, args, signal) {
                const owner = ownerByToolName.get(name)
                if (!owner?.callTool) return { content: `Unknown tool: ${name}`, isError: true }
                return owner.callTool(name, args, signal)
            },
        }
    }

    async function* stream(request: AiRequest, signal: AbortSignal): AsyncIterable<AiStreamChunk | AiActivityChunk> {
        // CLI transports drive tools via the MCP bridge natively; the adapter single-spawns with
        // no toolkit. HTTP adapters use a native function-calling loop and need the toolkit.
        const toolkit = config.transport === 'http' ? buildToolkit() : undefined
        const resolved = await resolve(request, signal)
        for await (const event of config.adapter.stream(resolved, signal, toolkit)) {
            if (typeof event === 'string') yield { delta: event }
            else yield { activity: event.tool }
        }
    }

    async function complete(request: AiRequest, signal: AbortSignal): Promise<AiResult> {
        let text = ''
        for await (const chunk of stream(request, signal)) {
            if ('delta' in chunk) text += chunk.delta
        }
        return { text }
    }

    /**
     * Assemble and redact a request exactly as a real send would (same context, same
     * redaction), but return the redacted payload instead of dispatching. Backs the
     * inspect-only "what will be sent" preview so it cannot understate the real payload.
     */
    async function dryRun(request: AiRequest, signal: AbortSignal): Promise<AiDryRun> {
        const { prompt, system, replacements } = await assembleAndRedact(request, signal)
        return { prompt, system, replacements }
    }

    return { stream, complete, dryRun }
}

export type AiEngine = ReturnType<typeof createAiEngine>
