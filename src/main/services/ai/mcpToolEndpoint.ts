/**
 * Token-authenticated loopback HTTP endpoint that the stdio MCP bridge forwards
 * tool calls to. Each active AI session registers itself with a unique bearer
 * token. The bridge presents that token on every request so calls are scoped to
 * the correct session.
 *
 * Only two routes are served:
 *   GET  /tools  -> { tools: ToolDef[] }
 *   POST /call   -> { content, isError }
 *
 * The server binds to 127.0.0.1:0 (OS-assigned ephemeral port) so it is
 * unreachable from any external network interface.
 */
import * as http from 'http'
import type { ToolDef, ToolResult, ToolActivity } from '../../../ai-core/types'

export interface McpToolSession {
    tools: ToolDef[]
    call(name: string, args: unknown, signal: AbortSignal): Promise<ToolResult>
    onActivity(activity: ToolActivity): void
    signal: AbortSignal
}

export interface McpToolEndpoint {
    start(): Promise<{ url: string }>
    stop(): Promise<void>
    registerSession(token: string, session: McpToolSession): void
    revokeSession(token: string): void
}

interface CallBody {
    name: string
    args: unknown
}

// 1 MiB cap to prevent a rogue bridge process from exhausting heap memory.
const MAX_REQUEST_BODY_BYTES = 1024 * 1024

function readRequestBody(request: http.IncomingMessage): Promise<string | null> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        let totalBytes = 0
        let tooLarge = false

        request.on('data', (chunk: Buffer) => {
            if (tooLarge) return
            totalBytes += chunk.byteLength
            if (totalBytes > MAX_REQUEST_BODY_BYTES) {
                // Stop buffering. The socket still reaches the end event so the 413
                // response is sent on the same connection (destroy would close the socket).
                tooLarge = true
                chunks.length = 0
                return
            }
            chunks.push(chunk)
        })
        request.on('end', () => resolve(tooLarge ? null : Buffer.concat(chunks).toString('utf8')))
        request.on('error', reject)
    })
}

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body)
    response.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
    })
    response.end(payload)
}

function parseBearer(request: http.IncomingMessage): string | null {
    const header = request.headers['authorization']
    if (typeof header !== 'string') return null
    const match = /^Bearer\s+(\S+)$/.exec(header)
    return match ? match[1] : null
}

export function createMcpToolEndpoint(): McpToolEndpoint {
    const sessions = new Map<string, McpToolSession>()
    let server: http.Server | null = null
    let resolvedUrl: string | null = null
    // In-flight start Promise: concurrent callers await the same bind so only one
    // server is ever created, even when start() is called before the first resolves.
    let startingPromise: Promise<{ url: string }> | null = null

    async function handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
        const token = parseBearer(request)
        const session = token ? sessions.get(token) : undefined

        if (!session) {
            sendJson(response, 401, { error: 'Unauthorized' })
            return
        }

        const { method, url: requestUrl } = request

        if (method === 'GET' && requestUrl === '/tools') {
            sendJson(response, 200, { tools: session.tools })
            return
        }

        if (method === 'POST' && requestUrl === '/call') {
            let body: CallBody
            try {
                const raw = await readRequestBody(request)
                if (raw === null) {
                    sendJson(response, 413, { error: 'Request body too large' })
                    return
                }
                body = JSON.parse(raw) as CallBody
            } catch {
                sendJson(response, 400, { error: 'Invalid JSON body' })
                return
            }

            // Cast args for the activity breadcrumb; the record shape is for display only.
            session.onActivity({ name: body.name, args: body.args as Record<string, unknown> })
            const result = await session.call(body.name, body.args, session.signal)
            // Respond with only the contract fields so extra ToolResult properties
            // never reach the bridge if the type grows in the future.
            sendJson(response, 200, { content: result.content, isError: result.isError })
            return
        }

        sendJson(response, 404, { error: 'Not found' })
    }

    return {
        start(): Promise<{ url: string }> {
            // Already bound: return the settled result immediately.
            if (resolvedUrl !== null) {
                return Promise.resolve({ url: resolvedUrl })
            }
            // Already binding: return the same in-flight Promise so a concurrent caller
            // awaits the same bind and no second server is created.
            if (startingPromise !== null) {
                return startingPromise
            }

            startingPromise = new Promise((resolve, reject) => {
                const newServer = http.createServer((request, response) => {
                    handleRequest(request, response).catch((requestError: unknown) => {
                        if (!response.headersSent) {
                            sendJson(response, 500, { error: 'Internal error' })
                        }
                        console.error('[mcpToolEndpoint] unhandled request error', requestError)
                    })
                })

                // Bind exclusively to loopback so the endpoint is never reachable
                // from external network interfaces.
                newServer.listen(0, '127.0.0.1', () => {
                    const address = newServer.address()
                    if (!address || typeof address === 'string') {
                        reject(new Error('Failed to resolve bound address'))
                        return
                    }
                    server = newServer
                    resolvedUrl = `http://127.0.0.1:${address.port}`
                    resolve({ url: resolvedUrl })
                })

                newServer.on('error', reject)
            })
            return startingPromise
        },

        stop(): Promise<void> {
            return new Promise((resolve) => {
                if (server === null) {
                    startingPromise = null
                    resolve()
                    return
                }
                server.close(() => {
                    server = null
                    resolvedUrl = null
                    startingPromise = null
                    resolve()
                })
            })
        },

        registerSession(token: string, session: McpToolSession): void {
            sessions.set(token, session)
        },

        revokeSession(token: string): void {
            sessions.delete(token)
        },
    }
}
