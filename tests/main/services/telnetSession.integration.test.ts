/**
 * Integration tests for TelnetSessionService.
 *
 * These tests drive the REAL TelnetSessionService over a real TCP socket
 * against an in-process fake Roku debug-port server. Nothing is stubbed or
 * mocked. Every test exercises the actual connect/stream/teardown path.
 *
 * What is covered:
 *   - Data: server lines are received, IAC bytes are stripped, and the service
 *     emits tokenized 'data' events with the expected plain text.
 *   - IAC carryover: a three-byte IAC negotiation sequence split across two
 *     separate TCP writes is fully stripped end-to-end through the live socket.
 *   - Lifecycle (server-side close): the server dropping the connection causes
 *     the service to emit 'disconnected' status and an 'exit' event.
 *   - Lifecycle (client kill): calling kill() emits 'disconnected' + 'exit'
 *     and closes the socket cleanly with no dangling handles.
 *   - Error path: connecting to a port with nothing listening surfaces a clean
 *     'error' status event rather than an unhandled exception.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { TelnetSessionService } from '@main/services/telnetSession'
import { FakeTelnetServer } from './fakeTelnetServer'
import type { TerminalLineChunk } from '@shared/terminal'

// ---------------------------------------------------------------------------
// Constants mirroring the service's telnet byte values
// ---------------------------------------------------------------------------

const IAC = 0xff
const WILL = 0xfb
const DO = 0xfd

// ---------------------------------------------------------------------------
// Event collection helpers
// ---------------------------------------------------------------------------

/** Status payload shape emitted by TelnetSessionService. */
interface StatusEvent {
    id: string
    status: string
    error?: string
}

/** Exit payload shape emitted by TelnetSessionService. */
interface ExitEvent {
    id: string
    exitCode: number
}

/** Data payload shape emitted by TelnetSessionService. */
interface DataEvent {
    id: string
    chunk: TerminalLineChunk
}

/**
 * Returns a promise that resolves with the next event payload matching
 * the given predicate, or rejects after timeoutMs.
 */
function waitForEvent<T>(
    emitter: TelnetSessionService,
    event: string,
    predicate: (payload: T) => boolean,
    timeoutMs = 3000
): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            emitter.off(event, handler)
            reject(new Error(`Timed out waiting for '${event}' event after ${timeoutMs}ms`))
        }, timeoutMs)

        function handler(payload: T) {
            if (predicate(payload)) {
                clearTimeout(timer)
                emitter.off(event, handler)
                resolve(payload)
            }
        }

        emitter.on(event, handler)
    })
}

/**
 * Collects all 'data' events for a session ID until a given status event
 * arrives, then resolves with the array of collected text lines.
 */
function collectDataUntilStatus(
    svc: TelnetSessionService,
    id: string,
    targetStatus: string,
    timeoutMs = 3000
): Promise<string[]> {
    return new Promise((resolve, reject) => {
        const lines: string[] = []

        const timer = setTimeout(() => {
            svc.off('data', dataHandler)
            svc.off('status', statusHandler)
            reject(new Error(`Timed out collecting data waiting for status '${targetStatus}'`))
        }, timeoutMs)

        function dataHandler(payload: DataEvent) {
            if (payload.id === id) {
                lines.push(payload.chunk.text)
            }
        }

        function statusHandler(payload: StatusEvent) {
            if (payload.id === id && payload.status === targetStatus) {
                clearTimeout(timer)
                svc.off('data', dataHandler)
                svc.off('status', statusHandler)
                resolve(lines)
            }
        }

        svc.on('data', dataHandler)
        svc.on('status', statusHandler)
    })
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('TelnetSessionService integration', () => {
    let server: FakeTelnetServer
    let svc: TelnetSessionService

    beforeEach(async () => {
        server = new FakeTelnetServer()
        await server.start()
        svc = new TelnetSessionService()
    })

    afterEach(async () => {
        // Kill all sessions first so no socket events fire after server.stop().
        svc.killAll()
        await server.stop()
    })

    // -----------------------------------------------------------------------
    // Data: service emits tokenized output for received lines
    // -----------------------------------------------------------------------

    it('emits data events containing the plain text of each received line', async () => {
        const id = svc.createSession('127.0.0.1', 'test-roku', server.port)

        // Attach the data collector synchronously, before any socket event can
        // fire, so no data event (including the synthetic "Connected to" line)
        // is missed regardless of timing or system load.
        const linesPromise = collectDataUntilStatus(svc, id, 'disconnected')

        // Wait for connected before sending data so the socket is ready.
        await waitForEvent<StatusEvent>(svc, 'status', (payload) => payload.id === id && payload.status === 'connected')

        // Send two complete BrightScript debug lines.
        await server.send(Buffer.from('[sg.node] ComponentLibrary loaded\r\n'))
        await server.send(Buffer.from('BrightScript Debugger> \r\n'))

        await server.disconnect()
        const lines = await linesPromise

        // The "Connected to ..." synthetic line is always first.
        expect(lines.some((line) => line.includes('Connected to 127.0.0.1'))).toBe(true)
        expect(lines.some((line) => line.includes('[sg.node] ComponentLibrary loaded'))).toBe(true)
        expect(lines.some((line) => line.includes('BrightScript Debugger'))).toBe(true)
    })

    // -----------------------------------------------------------------------
    // IAC: negotiation bytes are stripped end-to-end through the live socket
    // -----------------------------------------------------------------------

    it('strips IAC negotiation bytes from the data stream end-to-end', async () => {
        const id = svc.createSession('127.0.0.1', 'test-roku', server.port)
        const linesPromise = collectDataUntilStatus(svc, id, 'disconnected')

        await waitForEvent<StatusEvent>(svc, 'status', (payload) => payload.id === id && payload.status === 'connected')

        // Build a payload: "prefix" + IAC WILL 0x01 + "suffix\r\n"
        // The IAC sequence should be stripped; only "prefixsuffix" should surface.
        const payload = Buffer.from([
            // "prefix"
            0x70, 0x72, 0x65, 0x66, 0x69, 0x78,
            // IAC WILL option
            IAC, WILL, 0x01,
            // "suffix\r\n"
            0x73, 0x75, 0x66, 0x66, 0x69, 0x78, 0x0d, 0x0a
        ])
        await server.send(payload)

        await server.disconnect()
        const lines = await linesPromise

        const dataLines = lines.filter((line) => !line.startsWith('Connected to'))
        expect(dataLines.some((line) => line === 'prefixsuffix')).toBe(true)
        // No raw IAC byte (0xFF) or negotiation command bytes in the output.
        const allText = lines.join('')
        expect(allText.includes('\xff')).toBe(false)
    })

    it('strips an IAC sequence split across two separate TCP writes (carryover path)', async () => {
        const id = svc.createSession('127.0.0.1', 'test-roku', server.port)
        const linesPromise = collectDataUntilStatus(svc, id, 'disconnected')

        await waitForEvent<StatusEvent>(svc, 'status', (payload) => payload.id === id && payload.status === 'connected')

        // Split the three-byte IAC DO <option> across two sends so the service
        // must carry the incomplete sequence over the chunk boundary.
        //   Write 1: "line1" + IAC (incomplete, ends the chunk)
        //   Write 2: DO 0x03 + "line2\r\n"  (completes the IAC, then plain text)
        await server.send(Buffer.from([0x6c, 0x69, 0x6e, 0x65, 0x31, IAC]))
        await server.send(Buffer.from([DO, 0x03, 0x6c, 0x69, 0x6e, 0x65, 0x32, 0x0d, 0x0a]))

        await server.disconnect()
        const lines = await linesPromise

        const allText = lines.join('')
        // Both plain-text fragments must appear without any IAC bytes.
        expect(allText.includes('line1')).toBe(true)
        expect(allText.includes('line2')).toBe(true)
        expect(allText.includes('\xff')).toBe(false)
    })

    // -----------------------------------------------------------------------
    // Lifecycle: server-side disconnect
    // -----------------------------------------------------------------------

    it('emits disconnected status and exit event when the server closes the connection', async () => {
        const id = svc.createSession('127.0.0.1', 'test-roku', server.port)

        await waitForEvent<StatusEvent>(svc, 'status', (payload) => payload.id === id && payload.status === 'connected')

        const statusPromise = waitForEvent<StatusEvent>(svc, 'status', (payload) => payload.id === id && payload.status === 'disconnected')
        const exitPromise = waitForEvent<ExitEvent>(svc, 'exit', (payload) => payload.id === id)

        await server.disconnect()

        const [statusPayload, exitPayload] = await Promise.all([statusPromise, exitPromise])

        expect(statusPayload.status).toBe('disconnected')
        expect(exitPayload.exitCode).toBe(0)
    })

    // -----------------------------------------------------------------------
    // Lifecycle: client-initiated kill
    // -----------------------------------------------------------------------

    it('emits disconnected status and exit event when kill() is called, then cleans up cleanly', async () => {
        const id = svc.createSession('127.0.0.1', 'test-roku', server.port)

        await waitForEvent<StatusEvent>(svc, 'status', (payload) => payload.id === id && payload.status === 'connected')

        const statusPromise = waitForEvent<StatusEvent>(svc, 'status', (payload) => payload.id === id && payload.status === 'disconnected')
        const exitPromise = waitForEvent<ExitEvent>(svc, 'exit', (payload) => payload.id === id)

        svc.kill(id)

        const [statusPayload, exitPayload] = await Promise.all([statusPromise, exitPromise])

        expect(statusPayload.status).toBe('disconnected')
        expect(exitPayload.exitCode).toBe(0)

        // After kill(), the session map should be empty (no dangling entries).
        // Verified indirectly: a second kill() on the same ID is a no-op (no throw).
        expect(() => svc.kill(id)).not.toThrow()
    })

    // -----------------------------------------------------------------------
    // Error path: connection refused
    // -----------------------------------------------------------------------

    it('emits an error status when connecting to a port with nothing listening', async () => {
        // Stop the fake server so nothing is listening on its former port.
        const refusedPort = server.port
        await server.stop()

        const id = svc.createSession('127.0.0.1', 'test-roku', refusedPort)

        const statusPayload = await waitForEvent<StatusEvent>(
            svc, 'status',
            (payload) => payload.id === id && payload.status === 'error'
        )

        expect(statusPayload.status).toBe('error')
        expect(typeof statusPayload.error).toBe('string')
        expect(statusPayload.error!.length).toBeGreaterThan(0)
    })
})
