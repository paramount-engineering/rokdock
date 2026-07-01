/**
 * Tests for removeConfiguredDevice: removing a manually-added device must clear
 * its persisted store entry even after SSDP has discovered it and cleared the
 * in-memory `manual` flag (migrating the row to the SSDP UUID id). Otherwise the
 * device reappears on the next launch despite the user removing it.
 */

import { describe, it, expect, afterEach } from 'vitest'
import type dgram from 'dgram'
import { SsdpService } from '@main/services/ssdp'
import { removeConfiguredDevice, withConfiguredFlag } from '@main/ipc/handlers/discovery'
import type { StoreService } from '@main/services/store'
import type { DeviceInfo } from '@shared/device'
import { FakeDeviceInfoServer } from '../../services/fakeDeviceInfoServer'

/** A minimal DeviceInfo with the given ip; other fields are placeholders. */
function deviceWithIp(id: string, ip: string, manual: boolean): DeviceInfo {
    return {
        id, ip, port: 8060, name: id, codename: '', model: '', modelNumber: '',
        serialNumber: '', softwareVersion: '', location: '', lastSeen: 0,
        manual, hasAuth: false, discoveredOnNetwork: !manual,
        activeAppId: '', activeAppName: '', reachable: true,
    }
}

async function waitFor(predicate: () => boolean, maxMs = 3000, intervalMs = 20): Promise<void> {
    const deadline = Date.now() + maxMs
    while (Date.now() < deadline) {
        if (predicate()) return
        await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
    if (!predicate()) throw new Error(`waitFor timed out after ${maxMs}ms`)
}

/** Minimal in-memory StoreService stand-in covering the manual-device + auth methods. */
function fakeStore(manual: Array<{ ip: string; name: string }>) {
    const clearedAuth: string[] = []
    const store = {
        getManualDevices: () => manual,
        removeManualDevice: (ip: string) => {
            const index = manual.findIndex((device) => device.ip === ip)
            if (index >= 0) manual.splice(index, 1)
        },
        setDeviceAuth: (ip: string, username: string, password: string) => {
            if (!username && !password) clearedAuth.push(ip)
        },
    }
    return { store: store as unknown as StoreService, manual, clearedAuth }
}

describe('withConfiguredFlag', () => {
    it('marks devices whose IP is in the persisted manual list, regardless of the in-memory manual flag', () => {
        const store = { getManualDevices: () => [{ ip: '10.0.0.1', name: 'Manual' }] } as unknown as StoreService
        const devices = [
            deviceWithIp('uuid:promoted', '10.0.0.1', false), // persisted manual, but discovered (manual flag cleared)
            deviceWithIp('uuid:discovered', '10.0.0.2', false), // never manually added
        ]

        const result = withConfiguredFlag(devices, store)

        expect(result.find((device) => device.ip === '10.0.0.1')?.configured).toBe(true)
        expect(result.find((device) => device.ip === '10.0.0.2')?.configured).toBe(false)
    })

    it('does not mutate the input devices', () => {
        const store = { getManualDevices: () => [{ ip: '10.0.0.1', name: 'Manual' }] } as unknown as StoreService
        const devices = [deviceWithIp('uuid:a', '10.0.0.1', false)]

        withConfiguredFlag(devices, store)

        expect(devices[0].configured).toBeUndefined()
    })
})

describe('removeConfiguredDevice', () => {
    let svc: SsdpService
    let fake: FakeDeviceInfoServer

    afterEach(async () => {
        svc.stopDiscovery()
        await fake.stop()
    })

    /** Drive an SSDP response so the IP is discovered (manual=false, UUID id). */
    async function discover(usn: string): Promise<string> {
        svc = new SsdpService()
        fake = new FakeDeviceInfoServer('default', { userDeviceName: 'Basement Roku' })
        const port = await fake.start()
        const raw =
            'HTTP/1.1 200 OK\r\n' +
            `Location: http://127.0.0.1:${port}/\r\n` +
            `USN: uuid:roku:ecp:${usn}\r\n` +
            '\r\n'
        const rinfo: dgram.RemoteInfo = { address: '127.0.0.1', family: 'IPv4', port: 1900, size: raw.length }
        ;(svc as unknown as { handleResponse(r: string, i: dgram.RemoteInfo): void }).handleResponse(raw, rinfo)
        await waitFor(() => {
            const device = svc.getDevices().find((x) => x.ip === '127.0.0.1')
            return device !== undefined && device.manual === false
        })
        return svc.getDevices().find((x) => x.ip === '127.0.0.1')!.id
    }

    it('clears the persisted manual entry for a discovered (non-manual) device still listed in the store', async () => {
        const id = await discover('DISCOVERED001')
        // The store still lists this IP as a manual device (added before discovery).
        const { store, manual, clearedAuth } = fakeStore([{ ip: '127.0.0.1', name: 'Basement Roku' }])

        const device = svc.getDevices().find((x) => x.ip === '127.0.0.1')!
        expect(device.manual).toBe(false)
        expect(device.id).not.toMatch(/^manual-/)

        removeConfiguredDevice(svc, store, id)

        expect(manual).toEqual([])
        expect(clearedAuth).toEqual(['127.0.0.1'])
        expect(svc.getDevices().some((x) => x.ip === '127.0.0.1')).toBe(false)
    })

    it('leaves the store untouched for a discovered device that was never manually added', async () => {
        const id = await discover('DISCOVERED002')
        const { store, manual } = fakeStore([{ ip: '192.168.1.50', name: 'Other Roku' }])

        removeConfiguredDevice(svc, store, id)

        // The removed device's IP is not in the manual list, so nothing is dropped.
        expect(manual).toEqual([{ ip: '192.168.1.50', name: 'Other Roku' }])
        expect(svc.getDevices().some((x) => x.ip === '127.0.0.1')).toBe(false)
    })
})
