import { describe, it, expect } from 'vitest'
import { gatherRokuSecrets } from '@main/services/ai/rokuSecrets'

const ssdp = {
    getDevices: () => [
        { ip: '192.168.1.50', name: 'Living Room', serialNumber: 'X005200ABCDE' },
        { ip: '192.168.1.51', name: 'Bedroom', serialNumber: '' },
        { ip: '10.0.0.5', name: 'Office', serialNumber: '' },
    ],
} as never

const store = {
    getManualDevices: () => [{ ip: '10.0.0.9', name: 'Lab Roku' }, { ip: '10.0.0.5', name: 'Office (manual)' }],
} as never

describe('gatherRokuSecrets', () => {
    it('collects ips, device names, and serials from ssdp and manual devices', () => {
        const secrets = gatherRokuSecrets(ssdp, store)
        expect(secrets.ips).toEqual(expect.arrayContaining(['192.168.1.50', '192.168.1.51', '10.0.0.9']))
        expect(secrets.deviceNames).toEqual(expect.arrayContaining(['Living Room', 'Bedroom', 'Lab Roku']))
        expect(secrets.serials).toContain('X005200ABCDE')
    })

    it('omits empty values and dedupes', () => {
        const secrets = gatherRokuSecrets(ssdp, store)
        expect(secrets.serials).not.toContain('')
        expect(new Set(secrets.ips).size).toBe(secrets.ips.length)
        expect(secrets.ips.filter(x => x === '10.0.0.5').length).toBe(1)
    })
})
