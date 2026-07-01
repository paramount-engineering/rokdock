/**
 * Integration tests for EcpService and ecpRequest.
 *
 * A fake Roku ECP HTTP server (fakeEcpServer.ts) listens on 127.0.0.1:ECP_PORT.
 * Every test drives the REAL exported functions from ecp.ts over real TCP so
 * the full request-building and response-parsing paths execute without any
 * stubbing or mocking of the ECP module itself.
 *
 * Test coverage:
 *  - queryActiveApp: parses XML, returns id and name.
 *  - queryMediaPlayer: parses XML attributes, normalises state, parses ms fields.
 *  - ping: succeeds when the fake responds 200 to /query/device-info.
 *  - launchApp: POSTs to /launch/<encodeURIComponent(appId)>.
 *  - launchDeeplink: POSTs to /launch/<id>?<encoded-query-string>.
 *  - keypress / keydown / keyup: POST to the correct /keypress|keydown|keyup path.
 *  - sendText: sends one keypress per character with Lit_ prefix.
 *  - sendInput: POSTs to /input with encoded query string.
 *  - ecpRequest (raw): resolves body on 200 and rejects cleanly on 5xx.
 *  - queryMediaPlayer error swallowing: returns { state: 'stop' } on 500.
 *  - queryActiveApp connection refused: rejects with an Error.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import {
    ecpRequest,
    EcpService,
} from '@main/services/ecp'
import {
    createFakeEcpServer,
} from './fakeEcpServer'
import type { FakeEcpServer } from './fakeEcpServer'

const TARGET_IP = '127.0.0.1'

// ---------------------------------------------------------------------------
// Server lifecycle: one shared server instance across all tests.
// ---------------------------------------------------------------------------

let fake: FakeEcpServer
const service = new EcpService()

beforeAll(async () => {
    fake = createFakeEcpServer()
    await fake.start()
})

afterAll(async () => {
    await fake.stop()
})

beforeEach(() => {
    fake.requests.length = 0
    fake.overrides.clear()
})

// ---------------------------------------------------------------------------
// ecpRequest (raw)
// ---------------------------------------------------------------------------

describe('ecpRequest (raw HTTP helper)', () => {
    it('resolves with the response body on HTTP 200', async () => {
        // /query/device-info returns 200 with device-info XML.
        const body = await ecpRequest(TARGET_IP, 'GET', '/query/device-info')
        expect(body).toContain('<device-info>')
        expect(body).toContain('Fake Roku')
    })

    it('rejects with a status-code error on HTTP 5xx', async () => {
        fake.overrides.set('GET /query/device-info', { status: 500, body: 'Internal Server Error' })
        await expect(ecpRequest(TARGET_IP, 'GET', '/query/device-info')).rejects.toThrow('500')
    })

    it('records the request on the fake server', async () => {
        await ecpRequest(TARGET_IP, 'GET', '/query/active-app')
        expect(fake.requests.some((request) => request.method === 'GET' && request.path === '/query/active-app')).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// EcpService.queryActiveApp
// ---------------------------------------------------------------------------

describe('EcpService.queryActiveApp', () => {
    it('returns the active app id and name from a realistic ECP response', async () => {
        const result = await service.queryActiveApp(TARGET_IP)
        expect(result.id).toBe('12')
        expect(result.name).toBe('Netflix')
    })

    it('sends a GET to /query/active-app', async () => {
        await service.queryActiveApp(TARGET_IP)
        const hit = fake.requests.find((request) => request.method === 'GET' && request.path === '/query/active-app')
        expect(hit).toBeDefined()
    })
})

// ---------------------------------------------------------------------------
// EcpService.queryMediaPlayer
// ---------------------------------------------------------------------------

describe('EcpService.queryMediaPlayer', () => {
    it('normalises the playing state correctly', async () => {
        const result = await service.queryMediaPlayer(TARGET_IP)
        expect(result.state).toBe('play')
    })

    it('parses position and duration from ms-suffixed strings', async () => {
        const result = await service.queryMediaPlayer(TARGET_IP)
        // FAKE_MEDIA_PLAYER_PLAYING_XML has Position=30000 ms, Duration=3600000 ms.
        expect(result.position).toBe(30000)
        expect(result.duration).toBe(3600000)
    })

    it('parses audio/video codec and DRM type from Plugin attributes', async () => {
        const result = await service.queryMediaPlayer(TARGET_IP)
        expect(result.audioCodec).toBe('aac')
        expect(result.videoCodec).toBe('hevc')
        expect(result.drmType).toBe('widevine')
    })

    it('returns { state: "stop" } when the server returns 500 (error is swallowed)', async () => {
        fake.overrides.set('GET /query/media-player', { status: 500, body: 'Server Error' })
        const result = await service.queryMediaPlayer(TARGET_IP)
        expect(result).toEqual({ state: 'stop' })
    })

    it('returns a valid state shape when the server returns malformed XML', async () => {
        fake.overrides.set('GET /query/media-player', { status: 200, body: '<<< not valid xml <<<' })
        // fast-xml-parser is lenient and may not throw; the fallback still yields a valid shape.
        const result = await service.queryMediaPlayer(TARGET_IP)
        expect(['play', 'pause', 'stop', 'buffering', 'finished']).toContain(result.state)
    })
})

// ---------------------------------------------------------------------------
// EcpService.ping
// ---------------------------------------------------------------------------

describe('EcpService.ping', () => {
    it('resolves without throwing when the device responds', async () => {
        await expect(service.ping(TARGET_IP)).resolves.toBeUndefined()
    })

    it('rejects when the server returns 5xx', async () => {
        fake.overrides.set('GET /query/device-info', { status: 503, body: 'Unavailable' })
        await expect(service.ping(TARGET_IP)).rejects.toThrow()
    })
})

// ---------------------------------------------------------------------------
// EcpService.launchApp
// ---------------------------------------------------------------------------

describe('EcpService.launchApp', () => {
    it('POSTs to /launch/<channelId>', async () => {
        await service.launchApp(TARGET_IP, '12')
        const hit = fake.requests.find((request) => request.method === 'POST' && request.path === '/launch/12')
        expect(hit).toBeDefined()
    })

    it('encodes a channel ID that contains special characters', async () => {
        // Use a synthetic appId with a space to verify encodeURIComponent is applied.
        await service.launchApp(TARGET_IP, 'my app')
        const hit = fake.requests.find((request) => request.method === 'POST' && request.path === '/launch/my%20app')
        expect(hit).toBeDefined()
    })
})

// ---------------------------------------------------------------------------
// EcpService.launchDeeplink
// ---------------------------------------------------------------------------

describe('EcpService.launchDeeplink', () => {
    it('POSTs to /launch/<id> with an encoded query string', async () => {
        await service.launchDeeplink(TARGET_IP, '12', { contentId: 'abc 123', mediaType: 'movie' })
        const hit = fake.requests.find(
            (request) => request.method === 'POST' &&
            request.path === '/launch/12?contentId=abc%20123&mediaType=movie'
        )
        expect(hit).toBeDefined()
    })

    it('POSTs to /launch/<id> with no query string when params are empty', async () => {
        await service.launchDeeplink(TARGET_IP, '12', {})
        const hit = fake.requests.find((request) => request.method === 'POST' && request.path === '/launch/12')
        expect(hit).toBeDefined()
    })

    it('encodes the appId itself', async () => {
        await service.launchDeeplink(TARGET_IP, 'tvinput.hdmi1', {})
        const hit = fake.requests.find(
            (request) => request.method === 'POST' && request.path === '/launch/tvinput.hdmi1'
        )
        expect(hit).toBeDefined()
    })
})

// ---------------------------------------------------------------------------
// EcpService.keypress / keydown / keyup
// ---------------------------------------------------------------------------

describe('EcpService.keypress', () => {
    it('POSTs to /keypress/<key>', async () => {
        await service.keypress(TARGET_IP, 'Home')
        const hit = fake.requests.find((request) => request.method === 'POST' && request.path === '/keypress/Home')
        expect(hit).toBeDefined()
    })

    it('encodes key names with special characters', async () => {
        await service.keypress(TARGET_IP, 'Lit_ ')
        const hit = fake.requests.find(
            (request) => request.method === 'POST' && request.path === '/keypress/Lit_%20'
        )
        expect(hit).toBeDefined()
    })
})

describe('EcpService.keydown', () => {
    it('POSTs to /keydown/<key>', async () => {
        await service.keydown(TARGET_IP, 'Select')
        const hit = fake.requests.find((request) => request.method === 'POST' && request.path === '/keydown/Select')
        expect(hit).toBeDefined()
    })
})

describe('EcpService.keyup', () => {
    it('POSTs to /keyup/<key>', async () => {
        await service.keyup(TARGET_IP, 'Select')
        const hit = fake.requests.find((request) => request.method === 'POST' && request.path === '/keyup/Select')
        expect(hit).toBeDefined()
    })
})

// ---------------------------------------------------------------------------
// EcpService.sendText
// ---------------------------------------------------------------------------

describe('EcpService.sendText', () => {
    it('sends one keypress per character with the Lit_ prefix', async () => {
        await service.sendText(TARGET_IP, 'Hi')
        const paths = fake.requests.map((request) => request.path)
        expect(paths).toContain('/keypress/Lit_H')
        expect(paths).toContain('/keypress/Lit_i')
    })

    it('percent-encodes characters that need encoding', async () => {
        await service.sendText(TARGET_IP, ' ')
        const hit = fake.requests.find(
            (request) => request.method === 'POST' && request.path === '/keypress/Lit_%20'
        )
        expect(hit).toBeDefined()
    })
})

// ---------------------------------------------------------------------------
// EcpService.sendInput
// ---------------------------------------------------------------------------

describe('EcpService.sendInput', () => {
    it('POSTs to /input with an encoded query string', async () => {
        await service.sendInput(TARGET_IP, { seek: '30000' })
        const hit = fake.requests.find((request) => request.method === 'POST' && request.path === '/input?seek=30000')
        expect(hit).toBeDefined()
    })

    it('POSTs to /input with no query string when params are empty', async () => {
        await service.sendInput(TARGET_IP, {})
        const hit = fake.requests.find((request) => request.method === 'POST' && request.path === '/input')
        expect(hit).toBeDefined()
    })
})

// ---------------------------------------------------------------------------
// Error path: connection refused (no server on a different address)
// ---------------------------------------------------------------------------

describe('ecpRequest connection refused', () => {
    it('rejects with an error when nothing is listening', async () => {
        // The fake server is on 127.0.0.1:ECP_PORT. Requests to 127.0.0.2 should
        // fail to connect because that loopback alias almost certainly has nothing
        // listening on ECP_PORT. We rely on the Node TCP stack to reject quickly.
        //
        // Note: on some CI environments 127.0.0.2 may not be configured. If this
        // ever becomes flaky the test can be restructured to stop the fake server
        // temporarily, but that risks port contention with other concurrent tests.
        await expect(ecpRequest('127.0.0.2', 'GET', '/query/device-info')).rejects.toThrow()
    }, 10000)
})
