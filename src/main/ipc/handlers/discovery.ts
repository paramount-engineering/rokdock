/**
 * IPC handlers for Roku device discovery.
 *
 * Bridges the renderer's device list UI with the SsdpService. The renderer can:
 *  - get the current device list
 *  - trigger an immediate M-SEARCH scan
 *  - add a device by IP address (manual entry)
 *  - remove a device (manual devices are also removed from the persisted store)
 */

import { ipcMain } from 'electron'
import { isNonEmptyString } from '../../utils/validation'
import type { SsdpService } from '../../services/ssdp'
import type { StoreService } from '../../services/store'
import type { DeviceInfo } from '../../../shared/device'
import type { IpcContext } from '../types'

/**
 * Stamps each device with `configured: true` when its IP is in the persisted
 * manual-device list, so the renderer can make removal/configured decisions from
 * the store rather than the transient in-memory `manual` flag (which SSDP clears
 * once it discovers a manually-added device).
 *
 * @param devices - The in-memory device snapshot from the SSDP service.
 * @param store - Persistent store providing the manual device list.
 */
export function withConfiguredFlag(devices: DeviceInfo[], store: StoreService): DeviceInfo[] {
    const manualIps = new Set(store.getManualDevices().map((entry) => entry.ip))
    return devices.map((device) => ({ ...device, configured: manualIps.has(device.ip) }))
}

/**
 * Restores manually-configured devices from the persistent store into the in-memory SSDP list.
 * Called at startup and after a config reset.
 *
 * @param ssdp - SSDP discovery service to populate.
 * @param store - Persistent store providing the manual device list and auth states.
 */
export function repopulateConfiguredDevices(ssdp: SsdpService, store: StoreService): void {
    const manualDevices = store.getManualDevices()
    for (const { ip, name } of manualDevices) {
        const hasAuth = !!store.getDeviceAuth(ip)
        ssdp.addManualDevice(ip, name, { hasAuth })
    }
}

/**
 * Removes a device from the in-memory SSDP list and, when it was manually added,
 * also clears its persisted manual entry and stored credentials.
 *
 * Manual membership is decided by the persistent store (the source of truth),
 * not the in-memory `manual` flag: once SSDP discovers a manual device it clears
 * that flag in place and migrates the row to the SSDP UUID id, so keying off the
 * flag would leave the stored entry behind and the device would reappear on the
 * next launch.
 *
 * @param ssdp - SSDP discovery service holding the in-memory device.
 * @param store - Persistent store providing the manual device list and auth.
 * @param id - The device's unique ID (from the device list, not its IP).
 */
export function removeConfiguredDevice(ssdp: SsdpService, store: StoreService, id: string): void {
    const device = ssdp.getDevices().find((item) => item.id === id)
    if (device && store.getManualDevices().some((entry) => entry.ip === device.ip)) {
        store.removeManualDevice(device.ip)
        store.setDeviceAuth(device.ip, '', '')
    }
    ssdp.removeDevice(id)
}

/**
 * Registers all Roku device discovery IPC handlers.
 *
 * @param context - Shared IPC context providing SSDP, store, and cross-window broadcast.
 */
export function registerDiscoveryHandlers(context: IpcContext): void {
    const { ssdp, store, sendToAllWindows } = context

    /**
     * Returns the current list of discovered and manually-added Roku devices.
     * @returns Array of device objects from the SsdpService.
     */
    ipcMain.handle('discovery:get-devices', () => withConfiguredFlag(ssdp.getDevices(), store))

    /**
     * Triggers an immediate M-SEARCH scan and re-populates manually configured devices.
     * Use this to force-refresh the device list without waiting for the periodic scan interval.
     */
    ipcMain.handle('discovery:refresh', () => {
        repopulateConfiguredDevices(ssdp, store)
        ssdp.sendSearch()
    })

    /**
     * Adds a device to the SSDP list and persists it as a manual device in the store.
     * Manual devices are retained across restarts and are not removed when SSDP scan results change.
     * @param ip - The device IP address.
     * @param name - Optional display name; defaults to 'Roku <ip>' in the store.
     * @param hasAuth - Whether credentials are already configured for this device.
     * @returns { ok: true } on success; { ok: false, error } if the IP is empty or invalid.
     */
    ipcMain.handle('discovery:add-manual', (_event, ip: string, name?: string, hasAuth?: boolean) => {
        if (!isNonEmptyString(ip)) return { ok: false, error: 'Invalid IP address.' }
        ssdp.addManualDevice(ip, name, { hasAuth: !!hasAuth })
        store.addManualDevice(ip, name || `Roku ${ip}`)
        return { ok: true }
    })

    /**
     * Removes a device from the in-memory SSDP list.
     * For manual devices, also removes the persisted store entry and clears any stored credentials.
     * @param id - The device's unique ID (not IP address; use the id field from the device list).
     */
    ipcMain.handle('discovery:remove-device', (_event, id: string) => {
        if (!isNonEmptyString(id)) return
        removeConfiguredDevice(ssdp, store, id)
    })

    /**
     * Forwards SSDP device list change events to all renderer windows.
     * Emitted as 'discovery:devices-changed' with the updated device array.
     */
    ssdp.on('devices-changed', (devices) => {
        sendToAllWindows('discovery:devices-changed', withConfiguredFlag(devices, store))
    })

    /**
     * Notifies all renderer windows when an SSDP M-SEARCH scan begins.
     * Emitted as 'discovery:scan-started' with the current timestamp (ms since epoch).
     */
    ssdp.on('scan-started', () => {
        sendToAllWindows('discovery:scan-started', Date.now())
    })

}
