/**
 * IPC handlers for the persistent settings store.
 *
 * Provides the renderer with read/write access to all persisted state: preferences,
 * panel layout, manual device list, connection history, device ordering, device
 * nicknames and credentials, and port/deeplink configs.
 *
 * On preference writes, relevant side effects are applied immediately:
 *  - Discovery tuning (scan interval, timeout) is forwarded to SsdpService.
 *  - Config reset also clears the screenshot history and onion overlay cache.
 *
 * All write handlers validate input before persisting to prevent corrupt store state.
 */

import { ipcMain } from 'electron'
import type { SettingsUpdate } from '../../../shared/types'
import type { StoreService } from '../../services/store'
import { clearOnionOverlayPersistDir } from '../../utils/onionOverlayPersist'
import { isNonEmptyString, isValidPanelState, isValidPortConfig, isValidDeeplinkConfig } from '../../utils/validation'
import type { IpcContext } from '../types'
import { screenshotHistoryService, getDefaultScreenshotFolder } from '../../services/screenshotHistory'
import { getScreenshotPreviewWindow } from './deviceScreenshot'
import { repopulateConfiguredDevices } from './discovery'
import { clearPreviewAndBroadcast } from './theme'

/**
 * Registers all persistent store IPC handlers.
 *
 * @param context - Shared IPC context providing store, SSDP, and cross-service helpers.
 */
export function registerStoreHandlers(context: IpcContext): void {
    const { store, ssdp } = context

    /**
     * Returns the current panel layout state (open/collapsed panels, sizes, etc.).
     * @returns The panel state object.
     */
    ipcMain.handle('store:get-panel-state', () => store.getPanelState())
    /**
     * Persists the panel layout state. Silently ignores invalid input.
     * @param state - Panel state object (validated by isValidPanelState before saving).
     */
    ipcMain.handle('store:set-panel-state', (_event, state: unknown) => {
        if (!isValidPanelState(state)) return
        store.setPanelState(state)
    })

    /**
     * Returns the full AppPreferences object with all user preferences.
     * @returns The current preferences object.
     */
    ipcMain.handle('store:get-preferences', () => store.getPreferences())
    /**
     * Returns the absolute default screenshot folder (used when no custom folder is set), so the
     * Capture settings can show where screenshots land and Browse can open into it.
     * @returns The absolute default screenshot folder path.
     */
    ipcMain.handle('store:get-default-screenshot-folder', () => getDefaultScreenshotFolder())
    /**
     * Merges the provided preferences into the persisted preferences object.
     * Side effects: updates SSDP discovery tuning if scan/timeout settings changed,
     * and reloads screenshot history if the screenshot folder changed.
     * @param preferences - Partial AppPreferences object with fields to update.
     */
    ipcMain.handle('store:set-preferences', (_event, preferences: Partial<ReturnType<StoreService['getPreferences']>>) => {
        const safePreferences = preferences && typeof preferences === 'object' ? preferences : {}
        store.setPreferences(safePreferences)
        const currentPreferences = store.getPreferences()
        ssdp.setDiscoveryTuning({
            scanIntervalMs: safePreferences.discoveryScanIntervalMs ?? currentPreferences.discoveryScanIntervalMs,
            requestTimeoutMs: safePreferences.discoveryRequestTimeoutMs ?? currentPreferences.discoveryRequestTimeoutMs
        })
        if ('screenshotFolder' in safePreferences) {
            screenshotHistoryService.reload(safePreferences.screenshotFolder ?? '')
        }
    })

    /**
     * No-op handler retained for backward compatibility.
     * Theme updates are now handled by preload CSS variable injection via theme:css-vars-updated.
     */
    ipcMain.handle('window:set-theme-mode', (_event, _themeMode: unknown) => {
        // Theme updates are now handled by preload CSS var injection.
        // This handler is retained for backward compatibility with callers.
    })

    /**
     * Returns the list of manually added devices from the persistent store.
     * @returns Array of { ip, name } objects.
     */
    ipcMain.handle('store:get-manual-devices', () => store.getManualDevices())
    /**
     * Returns the map of device IP addresses to their last-connected timestamps.
     * @returns A Record mapping device IP to the last-connected time (ms since epoch).
     */
    ipcMain.handle('store:get-last-connected', () => store.getLastConnected())
    /**
     * Returns the persisted device display order as an array of IP addresses.
     * @returns Array of IP address strings in the user's preferred order.
     */
    ipcMain.handle('store:get-device-order', () => store.getDeviceOrder())
    /**
     * Persists the device display order. Non-string entries are silently dropped.
     * @param order - Array of IP address strings in the desired display order.
     */
    ipcMain.handle('store:set-device-order', (_event, order: string[]) => {
        if (!Array.isArray(order)) return
        // Only accept string entries; silently drop invalid ones
        const safe = order.filter(item => typeof item === 'string')
        store.setDeviceOrder(safe)
    })
    /**
     * Records a device connection event, updating the last-connected IP in the store.
     * Silently ignores empty or invalid IP values.
     * @param ip - The IP address of the device that was connected.
     */
    ipcMain.handle('store:record-connection', (_event, ip: string) => {
        if (isNonEmptyString(ip)) store.recordConnection(ip)
    })
    /**
     * Returns the AppSettings object containing port configs, deeplinks, etc.
     * @returns The current app settings object.
     */
    ipcMain.handle('store:get-settings', () => store.getSettings())
    /**
     * Validates and persists app settings updates (ports and deeplinks).
     * Only saves fields that pass their respective validators; silently ignores invalid entries.
     * @param settings - Partial SettingsUpdate with ports and/or deeplinks arrays.
     */
    ipcMain.handle('store:set-settings', (_event, settings: SettingsUpdate) => {
        if (!settings || typeof settings !== 'object') return
        const safe: SettingsUpdate = {}
        if (Array.isArray(settings.ports)) {
            const validPorts = settings.ports.filter(isValidPortConfig)
            if (validPorts.length === settings.ports.length) safe.ports = validPorts
        }
        if (Array.isArray(settings.deeplinks)) {
            const validLinks = settings.deeplinks.filter(isValidDeeplinkConfig)
            if (validLinks.length === settings.deeplinks.length) safe.deeplinks = validLinks
        }
        store.setSettings(safe)
    })
    /**
     * Returns the map of device IP addresses to user-assigned nicknames.
     * @returns Record<string, string> mapping IP to nickname.
     */
    ipcMain.handle('store:get-device-nicknames', () => store.getDeviceNicknames())
    /**
     * Sets or updates the nickname for a device identified by IP address.
     * Silently ignores empty or invalid IP values.
     * @param ip - The device IP address.
     * @param nickname - The display name to assign to the device.
     */
    ipcMain.handle('store:set-device-nickname', (_event, ip: string, nickname: string) => {
        if (isNonEmptyString(ip)) store.setDeviceNickname(ip, nickname)
    })
    /**
     * Returns the stored Digest auth credentials for a device by IP address.
     * @param ip - The device IP address.
     * @returns The { username, password } object, or null if no credentials are stored.
     */
    ipcMain.handle('store:get-device-auth', (_event, ip: string) => {
        if (!isNonEmptyString(ip)) return null
        return store.getDeviceAuth(ip)
    })
    /**
     * Returns a map of device IP addresses to boolean credential presence flags.
     * True means both username and password are non-empty. False means credentials are incomplete or missing.
     * Used by the renderer to show credential status indicators without exposing the credentials themselves.
     * @returns Record<string, boolean> mapping IP to hasCredentials.
     */
    ipcMain.handle('store:get-all-device-auth-states', () => {
        const all = store.getAllDeviceAuth()
        const states: Record<string, boolean> = {}
        for (const [ip, auth] of Object.entries(all)) {
            states[ip] = !!(auth.username?.trim() && auth.password?.trim())
        }
        return states
    })
    /**
     * Stores Digest auth credentials for a device. If credentials are provided for a device
     * that is not yet in the SSDP list, it is automatically added as a manual device so it
     * still appears in the list.
     *
     * This never removes a manual device entry: manual devices persist until the user
     * explicitly removes them (see discovery:remove-device) and must not be wiped by
     * transient SSDP discovery state. Clearing credentials only clears the auth flag.
     * @param ip - The device IP address.
     * @param username - The developer mode username (empty string to clear).
     * @param password - The developer mode password (empty string to clear).
     */
    ipcMain.handle('store:set-device-auth', (_event, ip: string, username: string, password: string) => {
        if (!isNonEmptyString(ip)) return
        store.setDeviceAuth(ip, username, password)
        const device = ssdp.getDevices().find((item) => item.ip === ip)
        const hasAuth = !!(username.trim() && password.trim())

        if (hasAuth && !device) {
            const fallbackName = `Roku ${ip}`
            store.addManualDevice(ip, fallbackName)
            ssdp.addManualDevice(ip, fallbackName, { hasAuth })
            return
        }
        ssdp.setDeviceAuthState(ip, hasAuth)
    })

    /**
     * Resets all app configuration to a clean-install state.
     * Side effects: kills all terminal sessions, disconnects all TCP connections,
     * clears the preference store, deletes the AI secrets and in-memory AI state,
     * reverts the appearance on every open window (dock and tool windows), clears
     * screenshot history and the onion overlay cache, resets the SSDP device list,
     * re-populates manually configured devices from the (now reset) store, and
     * triggers a fresh scan.
     */
    ipcMain.handle('store:reset-config', async () => {
        context.terminalManager.killAll()
        context.tcp.disconnectAll()
        store.resetToDefaults()
        // The store reset clears the AI metadata but not the separate secrets file or
        // the AiService main-process state, which the renderer reload cannot reach.
        context.ai.clearForReset()
        // Revert appearance on every open window, not just the dock that reloads.
        clearPreviewAndBroadcast(store)
        screenshotHistoryService.clearForReset()
        clearOnionOverlayPersistDir()
        screenshotHistoryService.notifyPreviewReset(getScreenshotPreviewWindow)
        ssdp.clearAllDevices()
        repopulateConfiguredDevices(context.ssdp, context.store)
        ssdp.sendSearch()
    })
}
