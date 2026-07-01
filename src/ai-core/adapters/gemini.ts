/**
 * Google Gemini native (generativeLanguage) adapter. Streams over SSE via
 * streamGenerateContent. With a toolkit it runs a native tool loop: declare the
 * functions, collect streamed functionCall parts, execute them, append a model
 * turn and a user turn carrying functionResponse parts, re-POST up to
 * MAX_TOOL_ROUNDS.
 */
import type { AiAdapter, ResolvedRequest, AdapterEvent, AdapterToolkit, ToolDef } from '../types'
import { MAX_TOOL_ROUNDS } from '../types'
import { parseSse, postJsonSse } from './sse'

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com'

interface GeminiPart { text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }
interface GeminiChunk { candidates?: Array<{ content?: { parts?: GeminiPart[] } }> }

function toGeminiTools(specs: ToolDef[]): unknown {
    return [{ functionDeclarations: specs.map(spec => ({ name: spec.name, description: spec.description, parameters: spec.parameters })) }]
}

export const geminiAdapter: AiAdapter = {
    type: 'gemini',
    async *stream(request: ResolvedRequest, signal: AbortSignal, toolkit?: AdapterToolkit): AsyncIterable<AdapterEvent> {
        if (request.transport !== 'http') throw new Error('The Gemini adapter received a non-HTTP request.')
        const base = (request.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '')
        const url = `${base}/v1beta/models/${request.model}:streamGenerateContent?alt=sse`
        const headers: Record<string, string> = {
            'content-type': 'application/json',
            ...(request.apiKey ? { 'x-goog-api-key': request.apiKey } : {}),
        }
        const contents: Array<Record<string, unknown>> = request.messages.map(message => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: message.content }],
        }))

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const offerTools = Boolean(toolkit) && round < MAX_TOOL_ROUNDS - 1
            const body = {
                ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
                ...(offerTools ? { tools: toGeminiTools(toolkit!.specs) } : {}),
                contents,
            }
            const modelParts: GeminiPart[] = []
            const fcalls: Array<{ name: string; args: Record<string, unknown> }> = []
            for await (const payload of parseSse(await postJsonSse(url, headers, body, signal), signal)) {
                let chunk: GeminiChunk
                try { chunk = JSON.parse(payload) } catch { continue }
                for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
                    if (part.text) { yield part.text; modelParts.push({ text: part.text }) }
                    else if (part.functionCall) { modelParts.push({ functionCall: part.functionCall }); fcalls.push({ name: part.functionCall.name, args: part.functionCall.args ?? {} }) }
                }
            }

            if (!offerTools || fcalls.length === 0) return

            contents.push({ role: 'model', parts: modelParts })
            const responseParts: unknown[] = []
            for (const call of fcalls) {
                yield { tool: { name: call.name, args: call.args } }
                const result = await toolkit!.call(call.name, call.args, signal)
                responseParts.push({ functionResponse: { name: call.name, response: { content: result.content, ...(result.isError ? { error: true } : {}) } } })
            }
            contents.push({ role: 'user', parts: responseParts })
        }
    },
}
