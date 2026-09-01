/**
 * Persistent application settings store (main process).
 *
 * Wraps electron-store (JSON file in userData) to provide typed read/write access
 * for all persistent state: user preferences, device credentials, window layout,
 * port/deeplink configs, and device ordering.
 *
 * Security: device credentials (username/password) are encrypted at rest using
 * Electron's safeStorage API (OS keychain-backed, with a platform-dependent cipher).
 * The ENC_PREFIX distinguishes encrypted values from legacy plaintext entries, which
 * are migrated to encrypted form in the constructor at startup.
 *
 * The StoreService instance is created once in main.ts and shared via IpcContext so
 * all IPC handlers read and write through the same instance.
 *
 * Storage file: <userData>/rokdock-config.json
 */

import { safeStorage } from 'electron'
import Store from 'electron-store'
import { cloneDefaultPortConfigs } from '../../shared/ports'
import { DEFAULT_SCREENSHOT_NAMING_FORMAT } from '../../shared/toolbarConstants'
import { isEncrypted, encryptToField, decryptField as decryptEncField } from '../utils/encryptedField'
import type { PortConfig, DeeplinkConfig, AppPreferences, StoreSettings, SettingsUpdate, DeviceAuth, PanelState } from '../../shared/types'

const LAST_CONNECTED_MAX = 200
const LAST_CONNECTED_TTL_MS = 90 * 24 * 60 * 60 * 1000

/**
 * Encrypts a credential field for storage in the JSON config file.
 * Falls back to returning the plaintext value when encryption is unavailable,
 * keeping the config portable across machines without a usable keychain.
 *
 * @param value - Plaintext string to encrypt.
 * @returns `'enc:<base64>'` when encryption is available, otherwise `value` unchanged.
 */
function encryptField(value: string): string {
    if (!safeStorage.isEncryptionAvailable()) return value
    return encryptToField(value)
}

/**
 * Decrypts a credential field previously stored by `encryptField`.
 *
 * Detects legacy plaintext values (missing the `enc:` prefix) and returns them as-is
 * to support migration of credentials stored before encryption was introduced.
 *
 * @param value - Raw stored string (`'enc:<base64>'` or legacy plaintext).
 * @returns The decrypted plaintext, or an empty string if the ciphertext is unreadable.
 */
function decryptField(value: string): string {
    if (!isEncrypted(value)) return value  // legacy plaintext - return as-is
    return decryptEncField(value) ?? ''  // corrupted/unreadable ciphertext -> ''
}

// electron-store publishes different default exports depending on CJS/ESM resolution.
const StoreCtor = (Store as unknown as { default?: typeof Store }).default ?? Store

// Stored credentials use encrypted strings (prefixed with ENC_PREFIX) when
// safeStorage is available, falling back to plaintext for portability.
interface StoredCredential {
    username: string  // may be plaintext or `enc:<base64>`
    password: string  // may be plaintext or `enc:<base64>`
}

interface StoreSchema {
    windowBounds: { x: number; y: number; width: number; height: number } | null
    windowMaximized: boolean
    manualDevices: Array<{ ip: string; name: string }>
    panelState: PanelState
    preferences: AppPreferences
    lastConnected: Record<string, number>
    deviceOrder: string[]
    ports: PortConfig[]
    deeplinks: DeeplinkConfig[]
    deviceNicknames: Record<string, string>
    deviceAuth: Record<string, StoredCredential>
}

const defaults: StoreSchema = {
    windowBounds: null,
    windowMaximized: false,
    manualDevices: [],
    panelState: { leftOpen: true, rightOpen: true },
    preferences: {
        autoScroll: true,
        wordWrap: false,
        fontSize: 12,
        fontFamily: '',
        terminalFallbackColor: '#e0e0e0',
        terminalUseThemeBackground: true,
        terminalSyntaxThemePreset: 'rokdockDark',
        terminalSyntaxThemeCustomColors: {},
        terminalCommandHistory: [],
        terminalFilterHistory: [],
        tabLabelMode: 'displayName',
        terminalHighlightAppLaunchLines: true,
        themeMode: 'dark',
        tint: { hue: 0, saturation: 1, brightness: 0 },
        aiProfiles: [],
        aiActiveProfileId: null,
        aiCliOverrides: {},
        aiConfirmDeviceControl: true,
        discoveryScanIntervalMs: 60000,
        discoveryRequestTimeoutMs: 5000,
        devAppPollIntervalMs: 3000,
        appZoomLevel: 0,
        uiFontScale: 0,
        screenshotZoomPercent: 100,
        screenshotAutoRefreshEnabled: false,
        screenshotAutoRefreshIntervalSec: 30,
        screenshotOnionOpacityPercent: 50,
        screenshotOnionOverlayHistory: [],
        splitRatio: 0.5,
        collapsedPanels: ['scripts'],
        expandedPanels: [],
        captureDeviceId: null,
        captureDeviceLabel: null,
        captureMuted: true,
        captureVolume: 80,
        captureMode: 'docked' as const,
        captureDockSide: 'left' as const,
        capturePipBounds: null,
        captureAspectRatio: 'auto' as const,
        captureIdleTimeoutSec: 3600,
        screenshotFolder: '',
        screenshotNamingFormat: DEFAULT_SCREENSHOT_NAMING_FORMAT,
        remoteKeyBindings: {
            PowerOff: '',
            Back: 'Escape',
            Home: 'Home',
            Up: 'ArrowUp',
            Down: 'ArrowDown',
            Left: 'ArrowLeft',
            Right: 'ArrowRight',
            Select: 'Enter',
            InstantReplay: '',
            Info: '',
            Rev: '',
            Play: '',
            Fwd: '',
            VolumeUp: '',
            VolumeDown: '',
            VolumeMute: ''
        }
    },
    lastConnected: {},
    deviceOrder: [],
    ports: cloneDefaultPortConfigs(),
    deeplinks: [],
    deviceNicknames: {},
    deviceAuth: {}
}

/**
 * Typed wrapper around `electron-store` providing read/write access to all persisted
 * application settings. Handles credential encryption/decryption transparently.
 */
export class StoreService {
    private store: Store<StoreSchema>

    /**
     * Initialises the electron-store instance and migrates any plaintext credentials
     * written by older app versions to the encrypted format.
     */
    constructor() {
        this.store = new StoreCtor<StoreSchema>({
            defaults,
            name: 'rokdock-config'
        })
        this.migrateCredentials()
    }

    /** Encrypt any plaintext credentials left over from earlier app versions. */
    private migrateCredentials(): void {
        if (!safeStorage.isEncryptionAvailable()) return
        const auth = this.store.get('deviceAuth')
        let changed = false
        for (const [ip, entry] of Object.entries(auth)) {
            const needsEncUser = entry.username && !isEncrypted(entry.username)
            const needsEncPass = entry.password && !isEncrypted(entry.password)
            if (needsEncUser || needsEncPass) {
                auth[ip] = {
                    username: needsEncUser ? encryptField(entry.username) : entry.username,
                    password: needsEncPass ? encryptField(entry.password) : entry.password
                }
                changed = true
            }
        }
        if (changed) this.store.set('deviceAuth', auth)
    }

    /** Returns the last saved window position and size, or `null` on first launch. */
    getWindowBounds() {
        return this.store.get('windowBounds')
    }

    /**
     * Persists the window position and size for restore on next launch.
     *
     * @param bounds - Window geometry to save.
     */
    setWindowBounds(bounds: { x: number; y: number; width: number; height: number }) {
        this.store.set('windowBounds', bounds)
    }

    /** Returns whether the main window was maximized when last closed. */
    getWindowMaximized() {
        return this.store.get('windowMaximized')
    }

    /**
     * Persists the window maximized state.
     *
     * @param maximized - `true` if the window is currently maximized.
     */
    setWindowMaximized(maximized: boolean) {
        this.store.set('windowMaximized', maximized)
    }

    /** Returns the list of manually-added device IP/name pairs. */
    getManualDevices() {
        return this.store.get('manualDevices')
    }

    /**
     * Replaces the entire manual-device list.
     *
     * @param devices - New list of `{ ip, name }` records.
     */
    setManualDevices(devices: Array<{ ip: string; name: string }>) {
        this.store.set('manualDevices', devices)
    }

    /**
     * Appends a manual device if one with the same IP is not already stored.
     *
     * @param ip - Device IP address.
     * @param name - Display name for the device.
     */
    addManualDevice(ip: string, name: string) {
        const devices = this.getManualDevices()
        if (!devices.find(device => device.ip === ip)) {
            devices.push({ ip, name })
            this.setManualDevices(devices)
        }
    }

    /**
     * Removes the manual device entry matching the given IP address.
     *
     * @param ip - IP address of the device to remove.
     */
    removeManualDevice(ip: string) {
        const devices = this.getManualDevices().filter(device => device.ip !== ip)
        this.setManualDevices(devices)
    }

    /** Returns the open/closed state of the left and right side panels. */
    getPanelState() {
        return this.store.get('panelState')
    }

    /**
     * Persists the left/right panel open/closed state, including optional layout fields.
     *
     * @param state - Panel visibility flags and optional layout values.
     */
    setPanelState(state: PanelState) {
        this.store.set('panelState', state)
    }

    /** Returns the full user preferences object. */
    getPreferences(): AppPreferences {
        return this.store.get('preferences')
    }

    /**
     * Merges partial preference updates into the stored preferences object.
     *
     * @param preferences - Partial preferences to apply.
     */
    setPreferences(preferences: Partial<StoreSchema['preferences']>) {
        const current = this.getPreferences()
        this.store.set('preferences', { ...current, ...preferences })
    }

    /**
     * Returns a map of device IP to last-connected timestamp (ms since epoch).
     * Used to sort the device list by recency.
     */
    getLastConnected(): Record<string, number> {
        return this.store.get('lastConnected')
    }

    /** Returns the user's preferred device display order as an array of IP addresses. */
    getDeviceOrder(): string[] {
        return this.store.get('deviceOrder')
    }

    /**
     * Persists the preferred device display order.
     * Duplicate and blank IPs are removed before saving.
     *
     * @param order - Ordered array of device IP addresses.
     */
    setDeviceOrder(order: string[]) {
        const normalized = Array.from(new Set(order.map(ip => ip.trim()).filter(Boolean)))
        this.store.set('deviceOrder', normalized)
    }

    /**
     * Records a connection timestamp for the given device IP address.
     *
     * Prunes the map to at most `LAST_CONNECTED_MAX` entries, discarding those older
     * than `LAST_CONNECTED_TTL_MS` (90 days), keeping the most recently seen entries.
     *
     * @param ip - IP address of the device that was connected.
     */
    recordConnection(ip: string) {
        const now = Date.now()
        const current = this.getLastConnected()
        current[ip] = now
        const pruned = Object.entries(current)
            .filter(([, ts]) => Number.isFinite(ts) && now - ts <= LAST_CONNECTED_TTL_MS)
            .sort((entryA, entryB) => entryB[1] - entryA[1])
            .slice(0, LAST_CONNECTED_MAX)
            .reduce<Record<string, number>>((acc, [entryIp, ts]) => {
                acc[entryIp] = ts
                return acc
            }, {})
        this.store.set('lastConnected', pruned)
    }

    /** Returns the list of configured Telnet/TCP port entries. */
    getPorts(): PortConfig[] {
        return this.store.get('ports')
    }

    /**
     * Replaces the stored port configuration list.
     *
     * @param ports - New port configuration array.
     */
    setPorts(ports: PortConfig[]) {
        this.store.set('ports', ports)
    }

    /** Returns the list of saved deep-link configurations. */
    getDeeplinks(): DeeplinkConfig[] {
        return this.store.get('deeplinks')
    }

    /**
     * Replaces the stored deep-link configuration list.
     *
     * @param deeplinks - New deep-link configuration array.
     */
    setDeeplinks(deeplinks: DeeplinkConfig[]) {
        this.store.set('deeplinks', deeplinks)
    }

    /** Returns the map of device IP address to user-assigned nickname. */
    getDeviceNicknames(): Record<string, string> {
        return this.store.get('deviceNicknames')
    }

    /**
     * Sets or clears a nickname for a device.
     * Passing an empty or whitespace-only string removes the entry.
     *
     * @param ip - Device IP address.
     * @param nickname - Display nickname, or empty string to clear.
     */
    setDeviceNickname(ip: string, nickname: string) {
        const current = { ...this.getDeviceNicknames() }
        if (nickname.trim()) {
            current[ip] = nickname.trim()
        } else {
            delete current[ip]
        }
        this.store.set('deviceNicknames', current)
    }

    /**
     * Returns decrypted credentials for all devices that have stored auth.
     *
     * @returns Map of device IP to `{ username, password }` in plaintext.
     */
    getAllDeviceAuth(): Record<string, DeviceAuth> {
        const raw = this.store.get('deviceAuth')
        const result: Record<string, DeviceAuth> = {}
        for (const [ip, entry] of Object.entries(raw)) {
            result[ip] = {
                username: decryptField(entry.username),
                password: decryptField(entry.password)
            }
        }
        return result
    }

    /**
     * Returns decrypted credentials for a specific device, or `null` if none are stored.
     *
     * @param ip - Device IP address.
     * @returns `{ username, password }` in plaintext, or `null` if credentials are missing
     *   or cannot be decrypted.
     */
    getDeviceAuth(ip: string): DeviceAuth | null {
        const raw = this.store.get('deviceAuth')
        const entry = raw[ip]
        if (!entry?.username || !entry?.password) return null
        const username = decryptField(entry.username)
        const password = decryptField(entry.password)
        if (!username || !password) return null
        return { username, password }
    }

    /**
     * Encrypts and stores credentials for a device.
     * Passing blank username or password removes the entry instead.
     *
     * @param ip - Device IP address.
     * @param username - Plaintext username.
     * @param password - Plaintext password.
     */
    setDeviceAuth(ip: string, username: string, password: string) {
        const auth = { ...this.store.get('deviceAuth') }
        const trimmedUser = username.trim()
        const trimmedPass = password.trim()
        if (trimmedUser && trimmedPass) {
            auth[ip] = {
                username: encryptField(trimmedUser),
                password: encryptField(trimmedPass)
            }
        } else {
            delete auth[ip]
        }
        this.store.set('deviceAuth', auth)
    }

    /**
     * Clears all stored settings, restoring the electron-store defaults on next access.
     * This is a destructive operation used from the developer reset flow.
     */
    resetToDefaults() {
        this.store.clear()
    }

    /**
     * Returns the subset of settings surfaced in the Settings UI (ports and deep links).
     *
     * @returns `StoreSettings` containing current ports and deeplinks.
     */
    getSettings(): StoreSettings {
        return {
            ports: this.getPorts(),
            deeplinks: this.getDeeplinks()
        }
    }

    /**
     * Applies a partial settings update, writing only the provided fields.
     *
     * @param settings - Partial settings payload from the renderer's save action.
     */
    setSettings(settings: SettingsUpdate): void {
        if (settings.ports) this.setPorts(settings.ports)
        if (settings.deeplinks) this.setDeeplinks(settings.deeplinks)
    }
}
