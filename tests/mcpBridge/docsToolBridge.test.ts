import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'http'
import { existsSync } from 'fs'
import { spawn } from 'child_process'
import path from 'path'

const bridgePath = path.resolve(import.meta.dirname, '../../out/mcpBridge/docsToolBridge.js')

// The stub tool definitions the endpoint will serve.
const STUB_TOOLS = [
    {
        name: 'search_docs',
        description: 'Search the Roku developer documentation.',
        parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: 'The search query.' } },
            required: ['query'],
        },
    },
    {
        name: 'fetch_page',
        description: 'Fetch the content of a documentation page.',
        parameters: {
            type: 'object',
            properties: { pagePath: { type: 'string', description: 'The path of the page.' } },
            required: ['pagePath'],
        },
    },
]

// Records the last call body sent to POST /call.
let lastCallBody: { name: string; args: Record<string, unknown> } | null = null

function startStubServer(): Promise<{ server: http.Server; url: string; token: string }> {
    return new Promise(resolve => {
        const token = 'test-token-abc'
        const server = http.createServer((request, response) => {
            let body = ''
            request.on('data', chunk => { body += chunk })
            request.on('end', () => {
                // Reject any request with a wrong token.
                const authHeader = request.headers.authorization ?? ''
                if (authHeader !== `Bearer ${token}`) {
                    response.writeHead(401)
                    response.end(JSON.stringify({ error: 'unauthorized' }))
                    return
                }

                if (request.method === 'GET' && request.url === '/tools') {
                    response.writeHead(200, { 'Content-Type': 'application/json' })
                    response.end(JSON.stringify({ tools: STUB_TOOLS }))
                    return
                }

                if (request.method === 'POST' && request.url === '/call') {
                    lastCallBody = JSON.parse(body) as { name: string; args: Record<string, unknown> }
                    response.writeHead(200, { 'Content-Type': 'application/json' })
                    response.end(JSON.stringify({ content: 'stub result for ' + lastCallBody.name }))
                    return
                }

                response.writeHead(404)
                response.end()
            })
        })

        server.listen(0, '127.0.0.1', () => {
            const address = server.address() as { port: number }
            resolve({ server, url: `http://127.0.0.1:${address.port}`, token })
        })
    })
}

// Send a JSON-RPC notification (no id, no response expected).
function sendNotification(bridgeProcess: ReturnType<typeof spawn>, method: string): void {
    const message = JSON.stringify({ jsonrpc: '2.0', method })
    bridgeProcess.stdin?.write(message + '\n')
}

// Send a raw JSON-RPC line to the bridge process and wait for a line in response.
function sendJsonRpc(
    bridgeProcess: ReturnType<typeof spawn>,
    method: string,
    params: unknown,
    id: number,
): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        const message = JSON.stringify({ jsonrpc: '2.0', id, method, params })

        let buffer = ''
        const onData = (chunk: Buffer): void => {
            buffer += chunk.toString()
            const lines = buffer.split('\n')
            for (const line of lines) {
                const trimmed = line.trim()
                if (!trimmed) continue
                try {
                    const parsed = JSON.parse(trimmed) as Record<string, unknown>
                    if (parsed.id === id) {
                        bridgeProcess.stdout?.removeListener('data', onData)
                        resolve(parsed)
                        return
                    }
                } catch {
                    // Not a complete JSON line yet; keep buffering.
                }
            }
            buffer = lines[lines.length - 1] ?? ''
        }

        bridgeProcess.stdout?.on('data', onData)
        bridgeProcess.stdin?.write(message + '\n')

        setTimeout(() => {
            bridgeProcess.stdout?.removeListener('data', onData)
            reject(new Error(`timeout waiting for RPC response to id=${id}`))
        }, 5000)
    })
}

// Spawn the bridge and run the MCP initialization handshake.
async function spawnAndInitialize(
    stubUrl: string,
    stubToken: string,
): Promise<ReturnType<typeof spawn>> {
    const bridge = spawn('node', [bridgePath], {
        env: { ...process.env, ROKDOCK_TOOL_URL: stubUrl, ROKDOCK_TOOL_TOKEN: stubToken },
        stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Perform the MCP initialize handshake so the server is ready.
    // The server responds to initialize, then the client sends notifications/initialized
    // to complete the 2024-11-05 handshake before any further requests.
    await sendJsonRpc(bridge, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '0.0.1' },
    }, 1)
    sendNotification(bridge, 'notifications/initialized')

    return bridge
}

let stubServer: http.Server
let stubUrl: string
let stubToken: string

beforeAll(async () => {
    // This suite spawns the compiled bridge from out/, so it depends on a build.
    // Fail fast with an actionable message instead of letting the spawn of a
    // missing file hang until the per-test timeout.
    if (!existsSync(bridgePath)) {
        throw new Error(`Bridge not built at ${bridgePath}. Run \`npm run build\` before the unit suite.`)
    }
    const result = await startStubServer()
    stubServer = result.server
    stubUrl = result.url
    stubToken = result.token
})

afterAll(() => {
    stubServer.close()
})

describe('docsToolBridge', () => {
    it('exits with a non-zero code when env vars are missing', () =>
        new Promise<void>((resolve, reject) => {
            const bridge = spawn('node', [bridgePath], {
                env: { PATH: process.env.PATH ?? '' },
                stdio: ['pipe', 'pipe', 'pipe'],
            })
            bridge.on('exit', code => {
                try {
                    expect(code).not.toBe(0)
                    resolve()
                } catch (err) {
                    reject(err)
                }
            })
            setTimeout(() => reject(new Error('timeout waiting for bridge exit')), 3000)
        }),
    )

    it('returns both tools from tools/list', async () => {
        const bridge = await spawnAndInitialize(stubUrl, stubToken)
        try {
            const response = await sendJsonRpc(bridge, 'tools/list', {}, 2)
            const result = response.result as { tools: Array<{ name: string; description: string }> }
            expect(result.tools).toHaveLength(2)
            const names = result.tools.map(tool => tool.name)
            expect(names).toContain('search_docs')
            expect(names).toContain('fetch_page')
        } finally {
            bridge.kill()
        }
    })

    it('tools include their parameter schemas', async () => {
        const bridge = await spawnAndInitialize(stubUrl, stubToken)
        try {
            const response = await sendJsonRpc(bridge, 'tools/list', {}, 3)
            const result = response.result as {
                tools: Array<{ name: string; inputSchema: { properties?: Record<string, unknown> } }>
            }
            const searchTool = result.tools.find(tool => tool.name === 'search_docs')
            expect(searchTool).toBeDefined()
            expect(searchTool?.inputSchema?.properties?.query).toBeDefined()
        } finally {
            bridge.kill()
        }
    })

    it('forwards a tools/call to the endpoint and returns the result', async () => {
        lastCallBody = null
        const bridge = await spawnAndInitialize(stubUrl, stubToken)
        try {
            const response = await sendJsonRpc(bridge, 'tools/call', {
                name: 'search_docs',
                arguments: { query: 'BrightScript arrays' },
            }, 4)

            // Verify the endpoint received the correct call.
            expect(lastCallBody?.name).toBe('search_docs')
            expect(lastCallBody?.args?.query).toBe('BrightScript arrays')

            // Verify the response carries the stub content.
            const result = response.result as { content: Array<{ type: string; text: string }> }
            expect(result.content[0]?.type).toBe('text')
            expect(result.content[0]?.text).toContain('search_docs')
        } finally {
            bridge.kill()
        }
    })
})
