import { describe, it, expect } from 'vitest'
import { reconcileDevices } from '@renderer/store/reconcileDevices'
import type { Device } from '@renderer/store/appStore'

function makeDevice(overrides: Partial<Device> = {}): Device {
    return {
        id: 'uuid-1',
        ip: '192.168.1.10',
        port: 8060,
        name: 'Living Room',
        codename: 'Fort',
        model: 'Roku Ultra',
        modelNumber: '4800X',
        serialNumber: 'SN1',
        softwareVersion: '13.0',
        location: 'http://192.168.1.10:8060/',
        lastSeen: 1000,
        manual: false,
        hasAuth: true,
        discoveredOnNetwork: true,
        activeAppId: '',
        activeAppName: '',
        reachable: true,
        developerEnabled: true,
        configured: false,
        ...overrides
    }
}

describe('reconcileDevices', () => {
    it('returns the same array reference when nothing structural changed', () => {
        const prev = [makeDevice()]
        const next = [makeDevice()]
        expect(reconcileDevices(prev, next)).toBe(prev)
    })

    it('retains each device object reference when only lastSeen changed', () => {
        const prev = [makeDevice({ lastSeen: 1000 })]
        const next = [makeDevice({ lastSeen: 5000 })]
        const result = reconcileDevices(prev, next)
        // Same array (no structural change) and the same element object.
        expect(result).toBe(prev)
        expect(result[0]).toBe(prev[0])
    })

    it('refreshes lastSeen in place on the retained object so staleness math stays accurate', () => {
        const prev = [makeDevice({ lastSeen: 1000 })]
        const next = [makeDevice({ lastSeen: 5000 })]
        reconcileDevices(prev, next)
        expect(prev[0].lastSeen).toBe(5000)
    })

    it('allocates a new reference for a device whose meaningful field changed', () => {
        const prev = [makeDevice({ activeAppName: 'Home' })]
        const next = [makeDevice({ activeAppName: 'Netflix' })]
        const result = reconcileDevices(prev, next)
        expect(result).not.toBe(prev)
        expect(result[0]).not.toBe(prev[0])
        expect(result[0].activeAppName).toBe('Netflix')
    })

    it('treats a newly appearing optional field as a meaningful change', () => {
        const prev = [makeDevice({ developerEnabled: undefined })]
        const next = [makeDevice({ developerEnabled: true })]
        const result = reconcileDevices(prev, next)
        expect(result[0]).not.toBe(prev[0])
        expect(result[0].developerEnabled).toBe(true)
    })

    it('returns a new array when a device is added', () => {
        const prev = [makeDevice({ id: 'a' })]
        const next = [makeDevice({ id: 'a' }), makeDevice({ id: 'b', ip: '192.168.1.11' })]
        const result = reconcileDevices(prev, next)
        expect(result).not.toBe(prev)
        expect(result).toHaveLength(2)
        // The unchanged device keeps its identity.
        expect(result[0]).toBe(prev[0])
    })

    it('returns a new array when a device is removed', () => {
        const prev = [makeDevice({ id: 'a' }), makeDevice({ id: 'b', ip: '192.168.1.11' })]
        const next = [makeDevice({ id: 'a' })]
        const result = reconcileDevices(prev, next)
        expect(result).not.toBe(prev)
        expect(result).toHaveLength(1)
        expect(result[0]).toBe(prev[0])
    })

    it('returns a new array when devices reorder, keeping each reference', () => {
        const first = makeDevice({ id: 'a' })
        const second = makeDevice({ id: 'b', ip: '192.168.1.11' })
        const prev = [first, second]
        const next = [makeDevice({ id: 'b', ip: '192.168.1.11' }), makeDevice({ id: 'a' })]
        const result = reconcileDevices(prev, next)
        expect(result).not.toBe(prev)
        expect(result[0]).toBe(second)
        expect(result[1]).toBe(first)
    })
})
