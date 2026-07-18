/**
 * Focused tests for ssdp.ts improvements:
 *  (a) Concurrent same-IP fetch race fix via inflightByIp abort.
 *  (b) Redundant devices-changed emission coalescing via scheduleEmit.
 *
 * Note: binding real UDP sockets and making real HTTP requests is impractical in unit
 * tests. These tests exercise the observable surface (emission counts and timing, inflight
 * map integrity) by using vitest fake timers and a minimal http.get stub.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import http from 'http'
import type { ClientRequest, IncomingMessage } from 'http'
import { EventEmitter } from 'events'
import { SsdpService } from '@main/services/ssdp'

/** Minimal valid device-info XML response body. */
const DEVICE_INFO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<device-info>
  <udn>rid:abc123</udn>
  <serial-number>X12345678901</serial-number>
  <device-id>AA:BB:CC:DD:EE:FF</device-id>
  <model-name>Roku Express</model-name>
  <model-number>3900X</model-number>
  <user-device-name>Living Room Roku</user-device-name>
  <software-version>12.0.0</software-version>
  <developer-enabled>false</developer-enabled>
</device-info>`

// ---------------------------------------------------------------------------
// Part (b): devices-changed coalescing
// ---------------------------------------------------------------------------

describe('scheduleEmit coalescing (part b)', () => {
    let svc: SsdpService

    beforeEach(() => {
        vi.useFakeTimers()
        svc = new SsdpService()
    })

    afterEach(() => {
        svc.stopDiscovery()
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('coalesces multiple synchronous state changes into a single emission', async () => {
        const emissions: unknown[][] = []
        svc.on('devices-changed', (devices) => emissions.push(devices))

        // Three operations that each used to emit independently.
        svc.addManualDevice('192.168.1.10', 'Roku A')
        svc.addManualDevice('192.168.1.11', 'Roku B')
        svc.addManualDevice('192.168.1.12', 'Roku C')

        // No emission yet: the setTimeout(0) debounce is still pending.
        expect(emissions).toHaveLength(0)

        // Flush the macrotask queue.
        await vi.runAllTimersAsync()

        // All three devices were added, but only one emission fired.
        expect(emissions).toHaveLength(1)
        expect((emissions[0] as { ip: string }[]).map((device) => device.ip)).toEqual(
            expect.arrayContaining(['192.168.1.10', '192.168.1.11', '192.168.1.12'])
        )
    })

    it('fires a second emission when a new change arrives after the first timer fires', async () => {
        const emissions: unknown[][] = []
        svc.on('devices-changed', (devices) => emissions.push(devices))

        svc.addManualDevice('192.168.1.10', 'Roku A')
        await vi.runAllTimersAsync()
        expect(emissions).toHaveLength(1)

        svc.addManualDevice('192.168.1.11', 'Roku B')
        await vi.runAllTimersAsync()
        expect(emissions).toHaveLength(2)
    })

    it('stopDiscovery cancels a pending emission', async () => {
        const emissions: unknown[][] = []
        svc.on('devices-changed', (devices) => emissions.push(devices))

        svc.addManualDevice('192.168.1.10', 'Roku A')
        // Cancel before the timer fires.
        svc.stopDiscovery()
        await vi.runAllTimersAsync()

        expect(emissions).toHaveLength(0)
    })

    it('removeDevice, clearDiscovered, and clearAllDevices all coalesce in the same turn', async () => {
        svc.addManualDevice('192.168.1.10', 'Roku A')
        await vi.runAllTimersAsync()

        const emissions: unknown[][] = []
        svc.on('devices-changed', (devices) => emissions.push(devices))

        // Three mutations in the same event-loop turn.
        svc.addManualDevice('192.168.1.11', 'Roku B')
        svc.clearDiscovered()
        svc.clearAllDevices()

        await vi.runAllTimersAsync()
        expect(emissions).toHaveLength(1)
        expect(emissions[0]).toEqual([])
    })
})

// ---------------------------------------------------------------------------
// Part (a): inflight fetch deduplication
// ---------------------------------------------------------------------------

/** Build a stub ClientRequest that tracks destroy() invocations. */
function makeStubReq(destroyedList: boolean[], responseCb?: (res: IncomingMessage) => void): ClientRequest {
    const req = new EventEmitter() as ClientRequest
    let _destroyed = false
    Object.assign(req, {
        destroy: () => {
            _destroyed = true
            destroyedList.push(true)
            req.emit('error', new Error('aborted'))
        },
        __destroyed: () => _destroyed,
        __responseCb: responseCb
    })
    return req
}

describe('fetchDeviceInfo inflight deduplication (part a)', () => {
    let svc: SsdpService
    let httpGetSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        vi.useFakeTimers()
        svc = new SsdpService()
    })

    afterEach(() => {
        svc.stopDiscovery()
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('destroys the previous in-flight request when a second fetch starts for the same IP', () => {
        const destroyedCalls: boolean[] = []

        httpGetSpy = vi.spyOn(http, 'get').mockImplementation(
            (_url, _opts, _cb) => makeStubReq(destroyedCalls, _cb as (res: IncomingMessage) => void)
        )

        // First manual add triggers fetchDeviceInfo for 192.168.1.10.
        svc.addManualDevice('192.168.1.10', 'Roku A')
        expect(httpGetSpy).toHaveBeenCalledTimes(1)
        expect(destroyedCalls).toHaveLength(0)

        // Second add for same IP: the first request must be destroyed before the new one starts.
        svc.addManualDevice('192.168.1.10', 'Roku A renamed')
        expect(httpGetSpy).toHaveBeenCalledTimes(2)
        expect(destroyedCalls).toHaveLength(1)
    })

    it('does not destroy a previous request when the IPs are different', () => {
        const destroyedCalls: boolean[] = []

        httpGetSpy = vi.spyOn(http, 'get').mockImplementation(
            (_url, _opts, _cb) => makeStubReq(destroyedCalls, _cb as (res: IncomingMessage) => void)
        )

        svc.addManualDevice('192.168.1.10', 'Roku A')
        svc.addManualDevice('192.168.1.11', 'Roku B')
        // Two different IPs: no destruction should occur.
        expect(destroyedCalls).toHaveLength(0)
    })

    it('stopDiscovery aborts in-flight fetches so a late completion cannot emit devices-changed or write device state', async () => {
        // Captures the response callback so we can fire it manually after stopDiscovery.
        let savedResponseCb: ((res: IncomingMessage) => void) | undefined

        httpGetSpy = vi.spyOn(http, 'get').mockImplementation((_url, _opts, callback) => {
            savedResponseCb = callback as (res: IncomingMessage) => void
            const resEmitter = new EventEmitter()
            const req = new EventEmitter() as ClientRequest
            let _destroyed = false
            Object.assign(req, {
                destroy: () => {
                    _destroyed = true
                    req.emit('error', new Error('aborted'))
                },
                __destroyed: () => _destroyed
            })
            return req
        })

        svc.addManualDevice('192.168.1.30', 'Roku Late')
        expect(savedResponseCb).toBeDefined()

        const emissions: unknown[] = []
        svc.on('devices-changed', (devices) => emissions.push(devices))

        // Stop discovery while the fetch is still in flight.
        svc.stopDiscovery()

        // Simulate the response arriving after shutdown: drive the full response body.
        const resEmitter = new EventEmitter() as unknown as IncomingMessage
        savedResponseCb!(resEmitter)
        ;(resEmitter as unknown as EventEmitter).emit('data', DEVICE_INFO_XML)
        ;(resEmitter as unknown as EventEmitter).emit('end')

        // Flush any timers that might have been (incorrectly) armed.
        await vi.runAllTimersAsync()

        // The late response must not have triggered a devices-changed emission.
        expect(emissions).toHaveLength(0)
        // The device state must not have been written by the late fetch.
        expect(svc.getDevices().find((device) => device.ip === '192.168.1.30')?.name).not.toBe('Living Room Roku')
    })

    it('only one device entry exists for an IP after two overlapping fetches', async () => {
        const resEmitters: EventEmitter[] = []

        httpGetSpy = vi.spyOn(http, 'get').mockImplementation((_url, _opts, callback) => {
            const resEmitter = new EventEmitter()
            resEmitters.push(resEmitter)
            const req = new EventEmitter() as ClientRequest
            let _destroyed = false
            Object.assign(req, {
                destroy: () => {
                    _destroyed = true
                    req.emit('error', new Error('aborted'))
                }
            })
            // Deliver the response after 10ms unless already destroyed.
            setTimeout(() => {
                if (!_destroyed && callback) {
                    const res = resEmitter as unknown as IncomingMessage
                    callback(res)
                }
            }, 10)
            return req
        })

        // First add starts a fetch for 192.168.1.20.
        svc.addManualDevice('192.168.1.20', 'First Name')
        // Immediately start a second fetch for the same IP. The first request is destroyed.
        svc.addManualDevice('192.168.1.20', 'Second Name')

        expect(resEmitters).toHaveLength(2)

        // Advance past the 10ms delay. The first request was destroyed so its response
        // callback should not fire. Only the second resEmitter is still active.
        await vi.advanceTimersByTimeAsync(20)

        // Drive the second response to completion.
        resEmitters[1].emit('data', DEVICE_INFO_XML)
        resEmitters[1].emit('end')

        // Flush the scheduleEmit debounce.
        await vi.runAllTimersAsync()

        // Exactly one device entry for 192.168.1.20 (no orphaned duplicates).
        const forIp = svc.getDevices().filter((device) => device.ip === '192.168.1.20')
        expect(forIp).toHaveLength(1)
    })
})
