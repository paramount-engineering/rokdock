/**
 * Gathers the Roku-specific sensitive values (device IPs, friendly names, serials)
 * that the portable redactor should scrub before any payload leaves the machine.
 * This is the only place Roku knowledge meets the engine core. On-screen titles
 * are a TODO hook to add when vision features land.
 */
import type { SsdpService } from '../ssdp'
import type { StoreService } from '../store'
import type { RedactSecrets } from '../../../ai-core/types'

function pushUnique(list: string[], value: string | undefined | null): void {
    const trimmed = (value ?? '').trim()
    if (trimmed && !list.includes(trimmed)) list.push(trimmed)
}

export function gatherRokuSecrets(ssdp: SsdpService, store: StoreService): RedactSecrets {
    const ips: string[] = []
    const deviceNames: string[] = []
    const serials: string[] = []

    for (const device of ssdp.getDevices()) {
        pushUnique(ips, device.ip)
        pushUnique(deviceNames, device.name)
        pushUnique(serials, device.serialNumber)
    }

    for (const manual of store.getManualDevices()) {
        pushUnique(ips, manual.ip)
        pushUnique(deviceNames, manual.name)
    }

    return { ips, deviceNames, serials, custom: [] }
}
