/**
 * POST a JSON body and return the response body stream for SSE parsing. Throws a friendly error on a non-ok or bodyless response.
 */
export async function postJsonSse(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
    if (!response.ok || !response.body) {
        throw new Error(`AI request failed: ${response.status} ${response.statusText}`)
    }
    return response.body
}

/**
 * Minimal Server-Sent-Events reader. Yields each `data:` payload as a string,
 * reassembling payloads split across network chunks, and stops at the `[DONE]`
 * sentinel. Comment (`:`) and non-data field lines are ignored.
 */
export async function* parseSse(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncIterable<string> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
        while (true) {
            if (signal.aborted) return
            const { value, done } = await reader.read()
            if (done) break
            // Normalize CRLF so event framing works regardless of server line endings.
            buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '')
            let sep: number
            // SSE events are separated by a blank line.
            while ((sep = buffer.indexOf('\n\n')) !== -1) {
                const rawEvent = buffer.slice(0, sep)
                buffer = buffer.slice(sep + 2)
                for (const line of rawEvent.split('\n')) {
                    if (!line.startsWith('data:')) continue
                    const payload = line.slice(5).trim()
                    if (payload === '[DONE]') return
                    if (payload) yield payload
                }
            }
        }
    } finally {
        reader.releaseLock()
    }
}
