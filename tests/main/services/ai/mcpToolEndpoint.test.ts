import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createMcpToolEndpoint } from '@main/services/ai/mcpToolEndpoint'
import type { McpToolSession } from '@main/services/ai/mcpToolEndpoint'
import type { ToolDef, ToolResult } from '@ai-core/types'

const searchDocsDef: ToolDef = {
    name: 'search_docs',
    description: 'Search the documentation',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
}

const searchDocsResult: ToolResult = { content: 'found some docs', isError: false }

function makeSession(): { session: McpToolSession; activityLog: Array<{ name: string; args: unknown }>; callSpy: ReturnType<typeof vi.fn> } {
    const activityLog: Array<{ name: string; args: unknown }> = []
    const callSpy = vi.fn(async (_name: string, _args: unknown, _signal: AbortSignal): Promise<ToolResult> => searchDocsResult)
    const session: McpToolSession = {
        tools: [searchDocsDef],
        call: callSpy,
        onActivity: (activity) => { activityLog.push({ name: activity.name, args: activity.args }) },
        signal: new AbortController().signal,
    }
    return { session, activityLog, callSpy }
}

describe('mcpToolEndpoint', () => {
    const endpoint = createMcpToolEndpoint()
    let url: string
    const token = 'test-token-abc'

    beforeAll(async () => {
        const result = await endpoint.start()
        url = result.url
    })

    afterAll(async () => {
        await endpoint.stop()
    })

    it('start() returns a loopback url', () => {
        expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    })

    it('start() is idempotent -- second call returns the same url', async () => {
        const result2 = await endpoint.start()
        expect(result2.url).toBe(url)
    })

    it('concurrent start() calls return the same url and create only one server', async () => {
        // Create a fresh endpoint so we can race two start() calls before either resolves.
        const freshEndpoint = createMcpToolEndpoint()
        try {
            const [result1, result2] = await Promise.all([freshEndpoint.start(), freshEndpoint.start()])
            expect(result1.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
            expect(result2.url).toBe(result1.url)
        } finally {
            await freshEndpoint.stop()
        }
    })

    describe('GET /tools', () => {
        it('returns the registered session tools with a valid bearer', async () => {
            const { session } = makeSession()
            endpoint.registerSession(token, session)

            const response = await fetch(`${url}/tools`, {
                headers: { Authorization: `Bearer ${token}` },
            })

            endpoint.revokeSession(token)
            expect(response.status).toBe(200)
            const body = await response.json() as { tools: ToolDef[] }
            expect(body.tools).toEqual([searchDocsDef])
        })

        it('returns 401 for a missing token', async () => {
            const response = await fetch(`${url}/tools`)
            expect(response.status).toBe(401)
        })

        it('returns 401 for a wrong token', async () => {
            const response = await fetch(`${url}/tools`, {
                headers: { Authorization: 'Bearer wrong-token' },
            })
            expect(response.status).toBe(401)
        })

        it('returns 401 for a revoked token', async () => {
            const { session } = makeSession()
            const revokeToken = 'revoke-test-token'
            endpoint.registerSession(revokeToken, session)
            endpoint.revokeSession(revokeToken)

            const response = await fetch(`${url}/tools`, {
                headers: { Authorization: `Bearer ${revokeToken}` },
            })
            expect(response.status).toBe(401)
        })
    })

    describe('POST /call', () => {
        it('executes the tool and returns the result', async () => {
            const { session } = makeSession()
            const callToken = 'call-test-token'
            endpoint.registerSession(callToken, session)

            const response = await fetch(`${url}/call`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${callToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: 'search_docs', args: { query: 'x' } }),
            })

            endpoint.revokeSession(callToken)
            expect(response.status).toBe(200)
            const body = await response.json() as ToolResult
            expect(body.content).toBe('found some docs')
            expect(body.isError).toBe(false)
        })

        it('fires onActivity with the correct name and args', async () => {
            const { session, activityLog } = makeSession()
            const activityToken = 'activity-test-token'
            endpoint.registerSession(activityToken, session)

            await fetch(`${url}/call`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${activityToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: 'search_docs', args: { query: 'x' } }),
            })

            endpoint.revokeSession(activityToken)
            expect(activityLog).toEqual([{ name: 'search_docs', args: { query: 'x' } }])
        })

        it('returns 401 for a missing token and does not call the session', async () => {
            const { session, callSpy } = makeSession()
            const noCallToken = 'no-call-token'
            endpoint.registerSession(noCallToken, session)

            const response = await fetch(`${url}/call`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'search_docs', args: { query: 'x' } }),
            })

            endpoint.revokeSession(noCallToken)
            expect(response.status).toBe(401)
            expect(callSpy).not.toHaveBeenCalled()
        })

        it('returns 401 for a revoked token and does not call the session', async () => {
            const { session, callSpy } = makeSession()
            const revokedCallToken = 'revoked-call-token'
            endpoint.registerSession(revokedCallToken, session)
            endpoint.revokeSession(revokedCallToken)

            const response = await fetch(`${url}/call`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${revokedCallToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: 'search_docs', args: { query: 'x' } }),
            })

            expect(response.status).toBe(401)
            expect(callSpy).not.toHaveBeenCalled()
        })

        it('returns 413 for an oversized body and does not call the session', async () => {
            const { session, callSpy } = makeSession()
            const oversizedToken = 'oversized-body-token'
            endpoint.registerSession(oversizedToken, session)

            // Build a body that exceeds MAX_REQUEST_BODY_BYTES (1 MiB).
            const oversizedBody = 'x'.repeat(1024 * 1024 + 1)

            const response = await fetch(`${url}/call`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${oversizedToken}`,
                    'Content-Type': 'application/json',
                },
                body: oversizedBody,
            })

            endpoint.revokeSession(oversizedToken)
            expect(response.status).toBe(413)
            expect(callSpy).not.toHaveBeenCalled()
        })
    })
})
