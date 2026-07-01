/**
 * Core device model shared between the main process (SSDP discovery, ECP polling)
 * and the renderer (device panel, remote, terminal tabs). DeviceInfo is the canonical
 * in-memory representation of a discovered or manually-added Roku device.
 *
 * Populated progressively: SSDP discovery fills ip/port/name, then ECP /query/device-info
 * backfills model, software version, developer mode status, and the active app.
 */

export interface DeviceInfo {
    id: string
    ip: string
    port: number
    name: string
    /** Roku hardware code name when known (from device-info XML or model-number lookup). */
    codename: string
    model: string
    modelNumber: string
    serialNumber: string
    softwareVersion: string
    location: string
    lastSeen: number
    manual: boolean
    hasAuth: boolean
    discoveredOnNetwork: boolean
    activeAppId: string
    activeAppName: string
    reachable: boolean
    /** Whether developer mode is enabled on the device, as reported by ECP /query/device-info. Undefined if not yet fetched. */
    developerEnabled?: boolean
    /**
     * True when the device's IP is in the persisted manual-device list. Stamped by
     * the discovery IPC layer for the renderer, so removal/configured decisions use
     * the persisted store rather than the transient `manual` flag (which SSDP clears
     * in place once it discovers a manually-added device).
     */
    configured?: boolean
}
