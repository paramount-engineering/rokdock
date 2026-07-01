/**
 * Fake ECP HTTP server for integration testing.
 *
 * Stands up a real HTTP server on 127.0.0.1 at ECP_PORT that responds with
 * realistic Roku ECP XML payloads. Tests drive the actual EcpService against
 * this server over real TCP so the full request-building and response-parsing
 * paths run without any mocking.
 *
 * Usage:
 *
 *   const server = createFakeEcpServer()
 *   await server.start()
 *   // ... run tests ...
 *   await server.stop()
 *   const requests = server.requests  // recorded method + path pairs
 */

import http from 'http'
import { ECP_PORT } from '@shared/ports'

export interface RecordedRequest {
    method: string
    path: string
    body: string
}

export interface FakeEcpServer {
    start(): Promise<void>
    stop(): Promise<void>
    requests: RecordedRequest[]
    /** Override to control what specific paths return. */
    overrides: Map<string, { status: number; body: string }>
}

/** Minimal valid app-list XML matching how EcpService parses /query/apps. */
export const FAKE_APPS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<apps>
  <app id="12" subtype="ndka" type="appl" version="4.1.218">Netflix</app>
  <app id="tvinput.hdmi1" subtype="ndka" type="tvin" version="1.0.0">HDMI 1</app>
</apps>`

/** Minimal valid active-app XML matching how EcpService parses /query/active-app. */
export const FAKE_ACTIVE_APP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<active-app>
  <app id="12" subtype="ndka" type="appl" version="4.1.218">Netflix</app>
</active-app>`

/** Minimal valid device-info XML matching how EcpService parses /query/device-info. */
export const FAKE_DEVICE_INFO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<device-info>
  <udn>rid:fake-roku-udn-001</udn>
  <serial-number>X0FAKE00001</serial-number>
  <device-id>AA:BB:CC:DD:EE:FF</device-id>
  <model-name>Roku Express 4K</model-name>
  <model-number>3941X</model-number>
  <user-device-name>Fake Roku</user-device-name>
  <software-version>11.5.0</software-version>
  <developer-enabled>true</developer-enabled>
</device-info>`

/** Minimal valid media-player XML in the playing state. */
export const FAKE_MEDIA_PLAYER_PLAYING_XML = `<?xml version="1.0" encoding="UTF-8"?>
<player error="false" state="play">
  <Plugin bandwidth="18865731 bps" id="12" name="Netflix"
    audioFormat="aac" videoFormat="hevc" drmType="widevine" />
  <Format audio="aac" captions="vtt" drm="widevine" video="hevc" />
  <Buffering current="1000" max="1000" target="1000" />
  <NewStream speed="128000 bps" />
  <Position>30000 ms</Position>
  <Duration>3600000 ms</Duration>
  <IsLive>false</IsLive>
  <Runtime>3600000 ms</Runtime>
  <StreamSegment bitrate="4000000" height="2160" mediaSequence="0"
    segmentType="mux" time="30000" url="https://example.com/seg0.ts" width="3840" />
</player>`

/** Small valid 1x1 PNG image as bytes for icon endpoint testing. */
const FAKE_ICON_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
)

export function createFakeEcpServer(): FakeEcpServer {
    const requests: RecordedRequest[] = []
    const overrides: Map<string, { status: number; body: string }> = new Map()
    let server: http.Server | null = null

    function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
        req.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf-8')
            const method = req.method ?? 'GET'
            const path = req.url ?? '/'

            requests.push({ method, path, body })

            // Allow per-test overrides keyed by "METHOD path".
            const overrideKey = `${method} ${path}`
            const override = overrides.get(overrideKey)
            if (override) {
                res.writeHead(override.status, { 'Content-Type': 'text/plain' })
                res.end(override.body)
                return
            }

            // Route to realistic ECP responses.
            if (path === '/query/apps') {
                res.writeHead(200, { 'Content-Type': 'text/xml' })
                res.end(FAKE_APPS_XML)
                return
            }

            if (path === '/query/active-app') {
                res.writeHead(200, { 'Content-Type': 'text/xml' })
                res.end(FAKE_ACTIVE_APP_XML)
                return
            }

            if (path === '/query/device-info') {
                res.writeHead(200, { 'Content-Type': 'text/xml' })
                res.end(FAKE_DEVICE_INFO_XML)
                return
            }

            if (path === '/query/media-player') {
                res.writeHead(200, { 'Content-Type': 'text/xml' })
                res.end(FAKE_MEDIA_PLAYER_PLAYING_XML)
                return
            }

            if (path.startsWith('/query/icon/')) {
                res.writeHead(200, { 'Content-Type': 'image/png' })
                res.end(FAKE_ICON_PNG)
                return
            }

            // POST control endpoints (keypress/keydown/keyup/launch/input) all ack
            // with 200 OK. The request was already recorded above, so tests assert
            // on the recorded method+path rather than on the response body.
            const okPostPrefixes = ['/keypress/', '/keydown/', '/keyup/', '/launch/', '/input']
            if (method === 'POST' && okPostPrefixes.some(prefix => path.startsWith(prefix))) {
                res.writeHead(200, { 'Content-Type': 'text/plain' })
                res.end('OK')
                return
            }

            // Unrecognised path: return 404 to surface unexpected calls in tests.
            res.writeHead(404, { 'Content-Type': 'text/plain' })
            res.end(`Fake ECP server: no handler for ${method} ${path}`)
        })
    }

    return {
        requests,
        overrides,

        start(): Promise<void> {
            return new Promise((resolve, reject) => {
                server = http.createServer(handleRequest)

                server.once('error', (err: NodeJS.ErrnoException) => {
                    if (err.code === 'EADDRINUSE') {
                        reject(
                            new Error(
                                `FATAL: ECP_PORT ${ECP_PORT} is already in use. ` +
                                'Make sure no other process (or test run) is bound to this port before running ECP integration tests.'
                            )
                        )
                    } else {
                        reject(err)
                    }
                })

                server.listen(ECP_PORT, '127.0.0.1', () => resolve())
            })
        },

        stop(): Promise<void> {
            return new Promise((resolve, reject) => {
                if (!server) {
                    resolve()
                    return
                }
                server.close((err) => {
                    server = null
                    if (err) reject(err)
                    else resolve()
                })
            })
        }
    }
}
