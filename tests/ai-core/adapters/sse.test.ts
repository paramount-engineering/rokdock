import { describe, it, expect } from 'vitest'
import { parseSse } from '@ai-core/adapters/sse'

/** Build a ReadableStream that emits the given string pieces as UTF-8 chunks. */
function streamOf(pieces: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder()
    let i = 0
    return new ReadableStream<Uint8Array>({
        pull(controller) {
            if (i < pieces.length) controller.enqueue(encoder.encode(pieces[i++]))
            else controller.close()
        },
    })
}

async function collect(iter: AsyncIterable<string>): Promise<string[]> {
    const out: string[] = []
    for await (const value of iter) out.push(value)
    return out
}

describe('parseSse', () => {
    it('yields each data payload and stops at [DONE]', async () => {
        const body = streamOf([
            'data: {"a":1}\n\n',
            'data: {"b":2}\n\ndata: [DONE]\n\n',
        ])
        const result = await collect(parseSse(body, new AbortController().signal))
        expect(result).toEqual(['{"a":1}', '{"b":2}'])
    })

    it('reassembles a data payload split across chunks', async () => {
        const body = streamOf(['data: {"a":', '1}\n\n'])
        const result = await collect(parseSse(body, new AbortController().signal))
        expect(result).toEqual(['{"a":1}'])
    })

    it('ignores comment and event lines', async () => {
        const body = streamOf([': keep-alive\n\n', 'event: ping\ndata: {"x":1}\n\n'])
        const result = await collect(parseSse(body, new AbortController().signal))
        expect(result).toEqual(['{"x":1}'])
    })
})
