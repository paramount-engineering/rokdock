import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { anthropicAdapter } from '@ai-core/adapters/anthropic'
import type { ResolvedRequest, AdapterToolkit } from '@ai-core/types'
import { MAX_TOOL_ROUNDS } from '@ai-core/types'

function sseResponse(events: string[]): Response {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const e of events) controller.enqueue(encoder.encode(e))
            controller.close()
        },
    })
    return new Response(body, { status: 200 })
}

async function collect(req: ResolvedRequest): Promise<string> {
    let text = ''
    for await (const ev of anthropicAdapter.stream(req, new AbortController().signal)) {
        if (typeof ev === 'string') text += ev
    }
    return text
}

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => vi.unstubAllGlobals())

const base: ResolvedRequest = { transport: 'http', model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hi' }], apiKey: 'k' }

describe('anthropicAdapter', () => {
    it('posts to the default messages endpoint with the api key header and yields text deltas', async () => {
        const fetchMock = vi.fn(async () => sseResponse([
            'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}\n\n',
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}\n\ndata: [DONE]\n\n',
        ]))
        vi.stubGlobal('fetch', fetchMock)
        expect(await collect(base)).toBe('Hello')
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe('https://api.anthropic.com/v1/messages')
        expect((init as RequestInit).headers).toMatchObject({ 'x-api-key': 'k', 'anthropic-version': '2023-06-01' })
        expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ model: 'claude-opus-4-8', stream: true })
    })

    it('honors a custom baseUrl', async () => {
        const fetchMock = vi.fn(async () => sseResponse(['data: [DONE]\n\n']))
        vi.stubGlobal('fetch', fetchMock)
        await collect({ ...base, baseUrl: 'https://proxy.local' })
        expect(fetchMock.mock.calls[0][0]).toBe('https://proxy.local/v1/messages')
    })

    it('throws on a non-ok response', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 429, statusText: 'Too Many Requests' })))
        await expect(collect(base)).rejects.toThrow(/429/)
    })

    it('maps prior turns into the messages array', async () => {
        const fetchMock = vi.fn(async () => sseResponse(['data: [DONE]\n\n']))
        vi.stubGlobal('fetch', fetchMock)
        await collect({ ...base, messages: [
            { role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' },
        ] })
        const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
        expect(body.messages).toEqual([
            { role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' },
        ])
    })
})

function toolUseRound(): string[] {
    return [
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu_1","name":"search_docs","input":{}}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"query\\":\\"ro"}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"SGNode\\"}"}}\n\n',
        'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\ndata: [DONE]\n\n',
    ]
}
function textRound(): string[] {
    return [
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"It is a node."}}\n\ndata: [DONE]\n\n',
    ]
}

async function collectEvents(req: ResolvedRequest, toolkit?: AdapterToolkit): Promise<{ text: string; tools: string[] }> {
    let text = ''
    const tools: string[] = []
    for await (const ev of anthropicAdapter.stream(req, new AbortController().signal, toolkit)) {
        if (typeof ev === 'string') text += ev
        else tools.push(ev.tool.name)
    }
    return { text, tools }
}

describe('anthropicAdapter tool loop', () => {
    it('runs a tool round then streams the answer', async () => {
        const rounds = [toolUseRound(), textRound()]
        let i = 0
        const bodies: string[] = []
        const fetchMock = vi.fn(async (_url: string, init: RequestInit) => { bodies.push(init.body as string); return sseResponse(rounds[i++]) })
        vi.stubGlobal('fetch', fetchMock)
        const called: Array<{ name: string; args: unknown }> = []
        const toolkit: AdapterToolkit = {
            specs: [{ name: 'search_docs', description: 'd', parameters: { type: 'object' } }],
            call: async (name, args) => { called.push({ name, args }); return { content: '[]' } },
        }
        const out = await collectEvents(base, toolkit)
        expect(out.text).toBe('It is a node.')
        expect(out.tools).toEqual(['search_docs'])
        expect(called).toEqual([{ name: 'search_docs', args: { query: 'roSGNode' } }])
        // round 2 body carries the tool_result
        expect(bodies[1]).toContain('tool_result')
        expect(bodies[0]).toContain('"tools"')
    })

    it('stops at MAX_TOOL_ROUNDS even if the model keeps requesting tools', async () => {
        const bodies: string[] = []
        const fetchMock = vi.fn(async (_url: string, init: RequestInit) => { bodies.push(init.body as string); return sseResponse(toolUseRound()) })
        vi.stubGlobal('fetch', fetchMock)
        const toolkit: AdapterToolkit = {
            specs: [{ name: 'search_docs', description: 'd', parameters: {} }],
            call: async () => ({ content: '[]' }),
        }
        await collectEvents(base, toolkit)
        expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(MAX_TOOL_ROUNDS)
        // The last request must not include tools so the model is forced to answer with text.
        const lastBody = JSON.parse(bodies[bodies.length - 1])
        expect(lastBody).not.toHaveProperty('tools')
    })

    it('yields text on the forced final round when the model always requests tools', async () => {
        const finalText = [
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Fallback answer."}}\n\ndata: [DONE]\n\n',
        ]
        let call = 0
        const fetchMock = vi.fn(async () => {
            call++
            return sseResponse(call < MAX_TOOL_ROUNDS ? toolUseRound() : finalText)
        })
        vi.stubGlobal('fetch', fetchMock)
        const toolkit: AdapterToolkit = {
            specs: [{ name: 'search_docs', description: 'd', parameters: {} }],
            call: async () => ({ content: '[]' }),
        }
        const out = await collectEvents(base, toolkit)
        expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(MAX_TOOL_ROUNDS)
        expect(out.text).toBe('Fallback answer.')
    })
})
