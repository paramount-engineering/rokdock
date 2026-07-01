/**
 * OpenAI-compatible chat-completions adapter. Covers OpenAI, Gemini (compat),
 * Ollama, OpenRouter, LM Studio, vLLM, Azure. Streams over SSE. With a toolkit
 * it runs a native tool loop: send function tools, accumulate streamed
 * tool_calls by index, execute on finish_reason tool_calls, append the
 * assistant tool_calls message and a role:tool message per result, re-POST up
 * to MAX_TOOL_ROUNDS.
 */
import type { AiAdapter, ResolvedRequest, AdapterEvent, AdapterToolkit, ToolDef } from '../types'
import { MAX_TOOL_ROUNDS } from '../types'
import { parseSse, postJsonSse } from './sse'
import { safeJsonObject } from './json'

function buildHeaders(apiKey?: string): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`
    return headers
}

function toOpenAiTools(specs: ToolDef[]): unknown[] {
    return specs.map(spec => ({ type: 'function', function: { name: spec.name, description: spec.description, parameters: spec.parameters } }))
}

export const openAiCompatibleAdapter: AiAdapter = {
    type: 'openai-compatible',
    async *stream(request: ResolvedRequest, signal: AbortSignal, toolkit?: AdapterToolkit): AsyncIterable<AdapterEvent> {
        if (request.transport !== 'http') throw new Error('The OpenAI-compatible adapter received a non-HTTP request.')
        const base = (request.baseUrl ?? '').replace(/\/$/, '')
        const messages: Array<Record<string, unknown>> = [
            ...(request.system ? [{ role: 'system', content: request.system }] : []),
            ...request.messages.map(message => ({ role: message.role, content: message.content })),
        ]

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const offerTools = Boolean(toolkit) && round < MAX_TOOL_ROUNDS - 1
            const body = {
                model: request.model,
                messages,
                stream: true,
                ...(offerTools ? { tools: toOpenAiTools(toolkit!.specs) } : {}),
            }
            const calls = new Map<number, { id: string; name: string; args: string }>()
            let finish: string | undefined
            for await (const payload of parseSse(await postJsonSse(`${base}/chat/completions`, buildHeaders(request.apiKey), body, signal), signal)) {
                let choice: { delta?: { content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string } | undefined
                try { choice = JSON.parse(payload)?.choices?.[0] } catch { continue }
                if (choice?.delta?.content) yield choice.delta.content
                for (const toolCall of choice?.delta?.tool_calls ?? []) {
                    const cur = calls.get(toolCall.index) ?? { id: '', name: '', args: '' }
                    if (toolCall.id) cur.id = toolCall.id
                    if (toolCall.function?.name) cur.name = toolCall.function.name
                    if (toolCall.function?.arguments) cur.args += toolCall.function.arguments
                    calls.set(toolCall.index, cur)
                }
                if (choice?.finish_reason) finish = choice.finish_reason
            }

            const callList = [...calls.values()]
            if (!offerTools || finish !== 'tool_calls' || callList.length === 0) return

            messages.push({ role: 'assistant', content: null, tool_calls: callList.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.args } })) })
            for (const call of callList) {
                const args = safeJsonObject(call.args)
                yield { tool: { name: call.name, args } }
                const result = await toolkit!.call(call.name, args, signal)
                messages.push({ role: 'tool', tool_call_id: call.id, content: result.content })
            }
        }
    },
}
