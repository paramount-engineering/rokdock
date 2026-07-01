import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { openAiCompatibleAdapter } from '@ai-core/adapters/openaiCompatible'
import type { ResolvedRequest } from '@ai-core/types'
import type { AdapterToolkit } from '@ai-core/types'
import { MAX_TOOL_ROUNDS } from '@ai-core/types'

function sseResponse(events: string[]): Response {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const e of events) controller.enqueue(encoder.encode(e))
            controller.close()
        },
    })
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

async function collect(req: ResolvedRequest): Promise<string> {
    let text = ''
    for await (const ev of openAiCompatibleAdapter.stream(req, new AbortController().signal)) {
        if (typeof ev === 'string') text += ev
    }
    return text
}

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => vi.unstubAllGlobals())

const base: ResolvedRequest = { transport: 'http', model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }], baseUrl: 'https://api.example.com/v1', apiKey: 'k' }

describe('openAiCompatibleAdapter', () => {
    it('posts to chat/completions and yields delta content', async () => {
        const fetchMock = vi.fn(async () => sseResponse([
            'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n',
        ]))
        vi.stubGlobal('fetch', fetchMock)
        expect(await collect(base)).toBe('Hello')
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe('https://api.example.com/v1/chat/completions')
        expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer k' })
        expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ model: 'gpt-x', stream: true })
    })

    it('omits the Authorization header when no key (local)', async () => {
        const fetchMock = vi.fn(async () => sseResponse(['data: [DONE]\n\n']))
        vi.stubGlobal('fetch', fetchMock)
        await collect({ ...base, apiKey: undefined })
        const init = fetchMock.mock.calls[0][1] as RequestInit
        expect(init.headers).not.toHaveProperty('Authorization')
    })

    it('throws a friendly error on a non-ok response', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401, statusText: 'Unauthorized' })))
        await expect(collect(base)).rejects.toThrow(/401/)
    })

    it('puts the system message first then maps prior turns', async () => {
        const fetchMock = vi.fn(async () => sseResponse(['data: [DONE]\n\n']))
        vi.stubGlobal('fetch', fetchMock)
        await collect({ ...base, system: 'be helpful', messages: [
            { role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' },
        ] })
        const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
        expect(body.messages).toEqual([
            { role: 'system', content: 'be helpful' },
            { role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' },
        ])
    })
})

function oaToolRound(): string[] {
    return [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"search_docs","arguments":"{\\"query\\":\\""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"roSGNode\\"}"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
    ]
}
function oaTextRound(): string[] {
    return ['data: {"choices":[{"delta":{"content":"A node."}}]}\n\ndata: [DONE]\n\n']
}
async function collectEvents(req: ResolvedRequest, toolkit?: AdapterToolkit) {
    let text = ''; const tools: string[] = []
    for await (const ev of openAiCompatibleAdapter.stream(req, new AbortController().signal, toolkit)) {
        if (typeof ev === 'string') text += ev; else tools.push(ev.tool.name)
    }
    return { text, tools }
}

describe('openAiCompatibleAdapter tool loop', () => {
    it('runs a tool round then streams the answer', async () => {
        const rounds = [oaToolRound(), oaTextRound()]; let i = 0; const bodies: string[] = []
        vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => { bodies.push(init.body as string); return sseResponse(rounds[i++]) }))
        const called: Array<{ name: string; args: unknown }> = []
        const toolkit: AdapterToolkit = {
            specs: [{ name: 'search_docs', description: 'd', parameters: { type: 'object' } }],
            call: async (name, args) => { called.push({ name, args }); return { content: '[]' } },
        }
        const out = await collectEvents(base, toolkit)
        expect(out.text).toBe('A node.')
        expect(out.tools).toEqual(['search_docs'])
        expect(called).toEqual([{ name: 'search_docs', args: { query: 'roSGNode' } }])
        expect(bodies[0]).toContain('"tools"')
        expect(bodies[1]).toContain('"role":"tool"')
    })

    it('stops at MAX_TOOL_ROUNDS and omits tools on the final request', async () => {
        const bodies: string[] = []
        const fetchMock = vi.fn(async (_u: string, init: RequestInit) => { bodies.push(init.body as string); return sseResponse(oaToolRound()) })
        vi.stubGlobal('fetch', fetchMock)
        const toolkit: AdapterToolkit = {
            specs: [{ name: 'search_docs', description: 'd', parameters: {} }],
            call: async () => ({ content: '[]' }),
        }
        await collectEvents(base, toolkit)
        expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(MAX_TOOL_ROUNDS)
        const lastBody = JSON.parse(bodies[bodies.length - 1])
        expect(lastBody).not.toHaveProperty('tools')
    })

    it('yields text on the forced final round when the model always requests tools', async () => {
        let call = 0
        const fetchMock = vi.fn(async () => {
            call++
            return sseResponse(call < MAX_TOOL_ROUNDS ? oaToolRound() : oaTextRound())
        })
        vi.stubGlobal('fetch', fetchMock)
        const toolkit: AdapterToolkit = {
            specs: [{ name: 'search_docs', description: 'd', parameters: {} }],
            call: async () => ({ content: '[]' }),
        }
        const out = await collectEvents(base, toolkit)
        expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(MAX_TOOL_ROUNDS)
        expect(out.text).toBe('A node.')
    })
})
