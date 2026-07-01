import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { geminiAdapter } from '@ai-core/adapters/gemini'
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
    return new Response(body, { status: 200 })
}

async function collect(req: ResolvedRequest): Promise<string> {
    let text = ''
    for await (const ev of geminiAdapter.stream(req, new AbortController().signal)) {
        if (typeof ev === 'string') text += ev
    }
    return text
}

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => vi.unstubAllGlobals())

const base: ResolvedRequest = { transport: 'http', model: 'gemini-2.0-flash', messages: [{ role: 'user', content: 'hi' }], apiKey: 'k' }

describe('geminiAdapter', () => {
    it('posts to streamGenerateContent with the goog api key header and yields part text', async () => {
        const fetchMock = vi.fn(async () => sseResponse([
            'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}\n\n',
            'data: {"candidates":[{"content":{"parts":[{"text":"lo"}]}}]}\n\n',
        ]))
        vi.stubGlobal('fetch', fetchMock)
        expect(await collect(base)).toBe('Hello')
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse')
        expect((init as RequestInit).headers).toMatchObject({ 'x-goog-api-key': 'k' })
    })

    it('throws on a non-ok response', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 403, statusText: 'Forbidden' })))
        await expect(collect(base)).rejects.toThrow(/403/)
    })

    it('maps prior turns to contents with assistant as model role', async () => {
        const fetchMock = vi.fn(async () => sseResponse([]))
        vi.stubGlobal('fetch', fetchMock)
        await collect({ ...base, messages: [
            { role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' },
        ] })
        const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
        expect(body.contents).toEqual([
            { role: 'user', parts: [{ text: 'q1' }] },
            { role: 'model', parts: [{ text: 'a1' }] },
            { role: 'user', parts: [{ text: 'q2' }] },
        ])
    })
})

function gemToolRound(): string[] {
    return ['data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"search_docs","args":{"query":"roSGNode"}}}]}}]}\n\n']
}
function gemTextRound(): string[] {
    return ['data: {"candidates":[{"content":{"parts":[{"text":"A node."}]}}]}\n\n']
}
async function collectEvents(req: ResolvedRequest, toolkit?: AdapterToolkit) {
    let text = ''; const tools: string[] = []
    for await (const ev of geminiAdapter.stream(req, new AbortController().signal, toolkit)) {
        if (typeof ev === 'string') text += ev; else tools.push(ev.tool.name)
    }
    return { text, tools }
}

describe('geminiAdapter tool loop', () => {
    it('runs a function-call round then streams the answer', async () => {
        const rounds = [gemToolRound(), gemTextRound()]; let i = 0; const bodies: string[] = []
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
        expect(bodies[0]).toContain('functionDeclarations')
        expect(bodies[1]).toContain('functionResponse')
    })

    it('stops at MAX_TOOL_ROUNDS and omits functionDeclarations on the final request', async () => {
        const bodies: string[] = []
        const fetchMock = vi.fn(async (_u: string, init: RequestInit) => { bodies.push(init.body as string); return sseResponse(gemToolRound()) })
        vi.stubGlobal('fetch', fetchMock)
        const toolkit: AdapterToolkit = {
            specs: [{ name: 'search_docs', description: 'd', parameters: {} }],
            call: async () => ({ content: '[]' }),
        }
        await collectEvents(base, toolkit)
        expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(MAX_TOOL_ROUNDS)
        const lastBody = JSON.parse(bodies[bodies.length - 1])
        expect(JSON.stringify(lastBody)).not.toContain('functionDeclarations')
    })

    it('yields text on the forced final round when the model always requests function calls', async () => {
        let call = 0
        const fetchMock = vi.fn(async () => {
            call++
            return sseResponse(call < MAX_TOOL_ROUNDS ? gemToolRound() : gemTextRound())
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
