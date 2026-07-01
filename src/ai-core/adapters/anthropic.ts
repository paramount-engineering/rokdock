/**
 * Anthropic Messages API adapter. Streams over SSE. With a toolkit it runs a
 * native tool loop: it sends the tool specs, accumulates any tool_use blocks the
 * model streams, executes them via the toolkit, appends the assistant tool_use
 * turn and a tool_result user turn, and re-POSTs, up to MAX_TOOL_ROUNDS. Yields
 * string text deltas and { tool } breadcrumbs.
 */
import type { AiAdapter, ResolvedRequest, AdapterEvent, AdapterToolkit, ToolDef } from '../types'
import { MAX_TOOL_ROUNDS } from '../types'
import { parseSse, postJsonSse } from './sse'
import { safeJsonObject } from './json'

const DEFAULT_BASE = 'https://api.anthropic.com'
const ANTHROPIC_VERSION = '2023-06-01'
const MAX_TOKENS = 4096

function toAnthropicTools(specs: ToolDef[]): unknown[] {
    return specs.map(spec => ({ name: spec.name, description: spec.description, input_schema: spec.parameters }))
}

type Block = { kind: 'text'; text: string } | { kind: 'tool'; id: string; name: string; json: string }

export const anthropicAdapter: AiAdapter = {
    type: 'anthropic',
    async *stream(request: ResolvedRequest, signal: AbortSignal, toolkit?: AdapterToolkit): AsyncIterable<AdapterEvent> {
        if (request.transport !== 'http') throw new Error('The Anthropic adapter received a non-HTTP request.')
        const base = (request.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '')
        const headers: Record<string, string> = {
            'content-type': 'application/json',
            ...(request.apiKey ? { 'x-api-key': request.apiKey } : {}),
            'anthropic-version': ANTHROPIC_VERSION,
        }
        const messages: Array<Record<string, unknown>> = request.messages.map(message => ({ role: message.role, content: message.content }))

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const offerTools = Boolean(toolkit) && round < MAX_TOOL_ROUNDS - 1
            const body = {
                model: request.model,
                max_tokens: MAX_TOKENS,
                stream: true,
                ...(request.system ? { system: request.system } : {}),
                ...(offerTools ? { tools: toAnthropicTools(toolkit!.specs) } : {}),
                messages,
            }
            const blocks = new Map<number, Block>()
            let stopReason: string | undefined
            for await (const payload of parseSse(await postJsonSse(`${base}/v1/messages`, headers, body, signal), signal)) {
                let event: { type?: string; index?: number; content_block?: { type?: string; id?: string; name?: string }; delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string } }
                try { event = JSON.parse(payload) } catch { continue }
                if (event.type === 'content_block_start' && event.index !== undefined) {
                    const contentBlock = event.content_block
                    if (contentBlock?.type === 'text') blocks.set(event.index, { kind: 'text', text: '' })
                    else if (contentBlock?.type === 'tool_use') blocks.set(event.index, { kind: 'tool', id: contentBlock.id ?? '', name: contentBlock.name ?? '', json: '' })
                } else if (event.type === 'content_block_delta') {
                    const block = event.index !== undefined ? blocks.get(event.index) : undefined
                    if (event.delta?.type === 'text_delta' && event.delta.text) {
                        if (block?.kind === 'text') { block.text += event.delta.text }
                        yield event.delta.text
                    } else if (block?.kind === 'tool' && event.delta?.type === 'input_json_delta' && event.delta.partial_json) { block.json += event.delta.partial_json }
                } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
                    stopReason = event.delta.stop_reason
                }
            }

            const ordered = [...blocks.entries()].sort((entryA, entryB) => entryA[0] - entryB[0]).map(([, block]) => block)
            const toolBlocks = ordered.filter((block): block is Extract<Block, { kind: 'tool' }> => block.kind === 'tool')
            if (!offerTools || stopReason !== 'tool_use' || toolBlocks.length === 0) return

            messages.push({
                role: 'assistant',
                content: ordered.map(block => block.kind === 'text'
                    ? { type: 'text', text: block.text }
                    : { type: 'tool_use', id: block.id, name: block.name, input: safeJsonObject(block.json) }),
            })
            const toolResults: unknown[] = []
            for (const block of toolBlocks) {
                const args = safeJsonObject(block.json)
                yield { tool: { name: block.name, args } }
                const result = await toolkit!.call(block.name, args, signal)
                toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result.content, ...(result.isError ? { is_error: true } : {}) })
            }
            messages.push({ role: 'user', content: toolResults })
        }
    },
}
