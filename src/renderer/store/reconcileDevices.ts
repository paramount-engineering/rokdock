/**
 * Reconciles a freshly-emitted device list against the one already in the store,
 * preserving object identity for devices that have not meaningfully changed.
 *
 * Why this exists: SSDP discovery re-emits the full device list on every scan tick
 * (roughly every 30 seconds) and rebuilds each `DeviceInfo` on every HTTP response.
 * Each emit crosses the IPC boundary, which structured-clones the payload, so a naive
 * `set({ devices })` replaces every device object with a brand-new reference on every
 * scan even when nothing about the device changed. That reference churn made React
 * consumers keyed on device identity misbehave: the Sideload dialog's `[device]` effect
 * refired and reset its result, and the status dot flickered.
 *
 * The reconcile keeps the existing object whenever every field except `lastSeen` matches.
 * `lastSeen` is a freshness stamp, not identity: a still-present device advances it on
 * every scan. We refresh it IN PLACE on the retained object rather than allocating a new
 * one, so the status dot's staleness math (which reads `device.lastSeen` at render time,
 * driven by the separate `lastScanAt` tick) stays accurate without churning the reference.
 *
 * When any device is added, removed, meaningfully changed, or reordered, a new array is
 * returned so React re-renders. When nothing structural changed, the SAME array reference
 * is returned so the caller can skip the state write entirely.
 */

import type { Device } from './appStore'

/** True when two devices are identical on every field except the volatile `lastSeen` stamp. */
function equalIgnoringLastSeen(existing: Device, incoming: Device): boolean {
    const keys = new Set<string>([...Object.keys(existing), ...Object.keys(incoming)])
    keys.delete('lastSeen')
    const existingRecord = existing as unknown as Record<string, unknown>
    const incomingRecord = incoming as unknown as Record<string, unknown>
    for (const key of keys) {
        if (existingRecord[key] !== incomingRecord[key]) return false
    }
    return true
}

/**
 * Merges `next` into `prev`, reusing existing object references for unchanged devices.
 *
 * @param prev - The device list currently held in the store.
 * @param next - The freshly-emitted device list from discovery.
 * @returns `prev` unchanged when nothing structural differs (only `lastSeen` refreshed in
 *   place); otherwise a new array reusing retained references and adopting new/changed ones.
 */
export function reconcileDevices(prev: Device[], next: Device[]): Device[] {
    const prevById = new Map(prev.map((device) => [device.id, device]))
    let changed = next.length !== prev.length

    const result = next.map((incoming, index) => {
        const existing = prevById.get(incoming.id)
        if (existing && equalIgnoringLastSeen(existing, incoming)) {
            // Keep identity; refresh the freshness stamp on the retained object in place.
            existing.lastSeen = incoming.lastSeen
            if (existing !== prev[index]) changed = true
            return existing
        }
        changed = true
        return incoming
    })

    return changed ? result : prev
}
