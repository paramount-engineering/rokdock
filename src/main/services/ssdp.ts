/**
 * SSDP-based Roku device discovery service.
 *
 * Uses UPnP Simple Service Discovery Protocol (SSDP) to find Roku devices on the
 * local network. Sends M-SEARCH multicast packets to 239.255.255.250:1900 targeting
 * the 'roku:ecp' service type, then follows up each response with HTTP calls to
 * /query/device-info and /query/active-app to populate the device model.
 *
 * Discovery flow:
 *  1. startDiscovery() binds a UDP socket and immediately sends the first M-SEARCH.
 *  2. A recurring interval fires sendSearch() + emitDevicesChanged() to keep the list fresh.
 *  3. handleResponse() parses each SSDP reply - marks the device reachable immediately so
 *     the UI dot doesn't flicker, then kicks off async HTTP fetches for full device info.
 *  4. Devices stay in memory (with lastSeen timestamp) across scans; the renderer uses
 *     the lastSeen age to show stale / offline state.
 *
 * Manual devices can be added via addManualDevice() and are preserved even if SSDP
 * never discovers them. Once a manual device is seen on the network it is promoted to
 * a discovered entry (manual flag cleared).
 *
 * Socket errors trigger an automatic recovery (5 second delay, single attempt).
 *
 * Concurrency notes:
 *  - fetchDeviceInfo tracks one in-flight HTTP request per IP (inflight map). A second
 *    fetch for the same IP aborts the first, so only the most recent completion writes
 *    to devicesByIp, keeping the secondary index consistent with devices.
 *  - devices-changed emissions are coalesced: scheduleEmit() debounces via setTimeout(0)
 *    so a burst of discoveries within a single scan tick produces one snapshot.
 */

import dgram from 'dgram'
import http from 'http'
import { xmlParser, xmlParserSimple } from '../utils/xml'
import { EventEmitter } from 'events'
import type { DeviceInfo } from '../../shared/device'
import { rokuCodenameFromDeviceInfoXml } from '../../shared/rokuCodename'
import { clampInt } from '../utils/validation'
import { ECP_PORT } from '../../shared/ports'

const SSDP_ADDRESS = '239.255.255.250'
const SSDP_PORT = 1900
const SEARCH_TARGET = 'roku:ecp'
const SCAN_INTERVAL = 30000
const REQUEST_TIMEOUT_MS = 5000
const SOCKET_RECOVERY_DELAY_MS = 5000

/**
 * SSDP discovery service that finds Roku devices on the local network.
 *
 * Extends `EventEmitter` and emits:
 * - `'scan-started'` each time an M-SEARCH packet is sent.
 * - `'devices-changed'` with the current `DeviceInfo[]` whenever the device list changes.
 */
export class SsdpService extends EventEmitter {
    private socket: dgram.Socket | null = null
    private devices: Map<string, DeviceInfo> = new Map()
    /** Secondary index: ip -> device id. Kept in sync with every mutation of devices. */
    private devicesByIp: Map<string, string> = new Map()
    /**
     * At most one in-flight fetchDeviceInfo HTTP request per IP. A new fetch for the
     * same IP destroys the previous request so only one completion can write to
     * devicesByIp, preventing the secondary index from being orphaned by a stale write.
     */
    private inflightByIp: Map<string, http.ClientRequest> = new Map()
    private scanTimer: ReturnType<typeof setInterval> | null = null
    /** Pending debounce timer for coalescing devices-changed emissions. */
    private pendingEmitTimer: ReturnType<typeof setTimeout> | null = null
    private scanIntervalMs = SCAN_INTERVAL
    private requestTimeoutMs = REQUEST_TIMEOUT_MS
    private recoveryPending = false

    /**
     * Binds the UDP socket, sends the first M-SEARCH multicast, and starts the
     * recurring scan interval. Calling this more than once is safe - it is a no-op
     * when discovery is already running.
     */
    startDiscovery(): void {
        if (this.socket) return

        this.socket = this.createSocket()

        this.socket.bind(() => {
            this.sendSearch()
        })

        this.scanTimer = setInterval(() => {
            this.sendSearch()
            this.emitDevicesChanged()
        }, this.scanIntervalMs)
    }

    /**
     * Creates and configures a UDP socket with `message` and `error` listeners.
     * On error the socket is closed and `scheduleSocketRecovery` is called.
     *
     * @returns The newly created (unbound) UDP socket.
     */
    private createSocket(): dgram.Socket {
        const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

        socket.on('message', (msg, rinfo) => {
            this.handleResponse(msg.toString(), rinfo)
        })

        socket.on('error', (err) => {
            console.error('[rokdock] SSDP socket error:', err.message)
            socket.removeAllListeners()
            try { socket.close() } catch { /* already closed */ }
            this.socket = null
            this.scheduleSocketRecovery()
        })

        return socket
    }

    /**
     * Schedules a single socket-recovery attempt after `SOCKET_RECOVERY_DELAY_MS`.
     * Subsequent calls while a recovery is already pending are ignored.
     */
    private scheduleSocketRecovery(): void {
        // Prevent multiple concurrent recovery timers
        if (this.recoveryPending) return
        this.recoveryPending = true

        setTimeout(() => {
            this.recoveryPending = false
            if (this.socket || !this.scanTimer) return
            try {
                this.socket = this.createSocket()
                this.socket.bind(() => this.sendSearch())
            } catch (e) {
                console.error('[rokdock] SSDP socket recovery failed:', (e as Error).message)
                this.socket = null
            }
        }, SOCKET_RECOVERY_DELAY_MS)
    }

    /**
     * Stops the scan interval, closes the UDP socket, aborts all in-flight HTTP
     * fetches, and clears any pending debounced emission so no stale snapshot fires
     * after shutdown.
     *
     * In-flight requests are destroyed before the map is cleared. The per-request
     * error handler checks `inflightByIp.get(ip) === req` before acting, so once the
     * map is cleared that handler is a no-op and cannot write device state or
     * re-arm the emit timer.
     *
     * Safe to call when discovery is not running.
     */
    stopDiscovery(): void {
        if (this.scanTimer) {
            clearInterval(this.scanTimer)
            this.scanTimer = null
        }
        if (this.socket) {
            this.socket.close()
            this.socket = null
        }
        // Abort every in-flight device-info fetch, then clear the map. Each request's
        // completion and error handlers check inflightByIp.get(ip) === req before
        // writing state, so once the map is cleared a late completion finds no entry
        // and is a no-op. It cannot write device state or re-arm an emit.
        for (const req of this.inflightByIp.values()) {
            req.destroy()
        }
        this.inflightByIp.clear()
        if (this.pendingEmitTimer !== null) {
            clearTimeout(this.pendingEmitTimer)
            this.pendingEmitTimer = null
        }
    }

    /**
     * Sends a UPnP M-SEARCH multicast packet targeting the `roku:ecp` service type.
     * Emits `'scan-started'`. Does nothing if the socket has not been created yet.
     */
    sendSearch(): void {
        if (!this.socket) return
        this.emit('scan-started')

        const message = Buffer.from(
            'M-SEARCH * HTTP/1.1\r\n' +
            `Host: ${SSDP_ADDRESS}:${SSDP_PORT}\r\n` +
            'Man: "ssdp:discover"\r\n' +
            `ST: ${SEARCH_TARGET}\r\n` +
            'MX: 3\r\n' +
            '\r\n'
        )

        this.socket.send(message, 0, message.length, SSDP_PORT, SSDP_ADDRESS, (err) => {
            if (err) console.error('[rokdock] SSDP send error:', err.message)
        })
    }

    /**
     * Parses a raw SSDP response string and kicks off HTTP device-info fetching.
     *
     * Extracts `Location` and `USN` headers to determine the device IP and canonical ID.
     * If the device was previously tracked under a manual ID, the entry is migrated to
     * the SSDP UUID. The device is marked reachable immediately to prevent UI flicker.
     *
     * @param response - Raw SSDP response text.
     * @param rinfo - Remote address information from the UDP socket.
     */
    private handleResponse(response: string, rinfo: dgram.RemoteInfo): void {
        const locationMatch = response.match(/Location:\s*(.*)/i)
        const usnMatch = response.match(/USN:\s*(.*)/i)

        if (!locationMatch) return

        const location = locationMatch[1].trim()
        const usn = usnMatch ? usnMatch[1].trim() : `unknown-${rinfo.address}`

        const urlMatch = location.match(/http:\/\/([\d.]+):(\d+)/)
        if (!urlMatch) return

        const ip = urlMatch[1]
        const port = parseInt(urlMatch[2], 10)
        const id = usn.replace('uuid:roku:ecp:', '').trim()
        const existingId = this.devicesByIp.get(ip)
        const existingByIp = existingId !== undefined ? this.devices.get(existingId) : undefined
        const shouldKeepManualId = !!existingByIp
            && existingByIp.id.startsWith('manual-')
            && existingByIp.manual
            && !existingByIp.discoveredOnNetwork
        const effectiveId = shouldKeepManualId ? existingByIp.id : id

        // If a previously tracked IP is now discovered by SSDP under a canonical UUID,
        // migrate the entry while preserving source/auth metadata.
        if (existingByIp && existingByIp.id !== effectiveId) {
            this.devices.set(effectiveId, {
                ...existingByIp,
                id: effectiveId,
                // Discovery establishes this as a network-discovered row.
                manual: false,
                discoveredOnNetwork: true
            })
            this.devicesByIp.set(ip, effectiveId)
            this.devices.delete(existingByIp.id)
        }

        // SSDP response = device is on the network. Mark reachable immediately so the
        // dot doesn't flicker gray while the subsequent HTTP fetch is in flight.
        const knownDevice = this.devices.get(effectiveId)
        if (knownDevice) {
            knownDevice.reachable = true
            knownDevice.lastSeen = Date.now()
            this.devices.set(effectiveId, knownDevice)
            this.scheduleEmit()
        }

        this.fetchDeviceInfo(ip, port, effectiveId, location, true)
    }

    /**
     * Fetches `/query/device-info` from a Roku device and updates the in-memory device map.
     *
     * Preserves existing auth state, manual flag, and `discoveredOnNetwork` status across
     * updates. After a successful fetch, `fetchActiveAppInfo` is called to populate the
     * running app metadata.
     *
     * @param ip - Device IP address.
     * @param port - ECP port (typically 8060).
     * @param id - Device map key (SSDP UUID or manual ID).
     * @param location - SSDP Location header value (stored on the device record).
     * @param discoveredOnNetwork - Whether this call originated from an SSDP response.
     */
    private fetchDeviceInfo(ip: string, port: number, id: string, location: string, discoveredOnNetwork = false): void {
        const url = `http://${ip}:${port}/query/device-info`

        // Abort any in-flight fetch for this IP so only the most recent request can
        // write to devicesByIp. This prevents a stale completion from orphaning the
        // secondary index when two fetches for the same IP race to completion.
        const previous = this.inflightByIp.get(ip)
        if (previous) {
            previous.destroy()
            this.inflightByIp.delete(ip)
        }

        const req = http.get(url, { timeout: this.requestTimeoutMs }, (res) => {
            let data = ''
            res.on('data', (chunk) => { data += chunk })
            res.on('end', () => {
                // Guard: if this request was superseded and a newer one is registered,
                // its abort via destroy() should prevent this callback from firing, but
                // we check here as an extra safety net.
                if (this.inflightByIp.get(ip) !== req) return
                this.inflightByIp.delete(ip)

                try {
                    const parsed = xmlParserSimple.parse(data)
                    const info = parsed['device-info'] || {}
                    const existing = this.devices.get(id)
                    const keepDiscoveredOnNetwork = discoveredOnNetwork || existing?.discoveredOnNetwork || false
                    // Clear the manual flag once a device is seen on the network - it is a real discovered device.
                    const keepManual = !keepDiscoveredOnNetwork && (existing?.manual || id.startsWith('manual-'))
                    const keepHasAuth = existing?.hasAuth ?? false

                    const developerEnabled =
                        info['developer-enabled'] === true || info['developer-enabled'] === 'true'

                    const device: DeviceInfo = {
                        id,
                        ip,
                        port,
                        name: info['user-device-name'] || info['friendly-device-name'] || `Roku ${ip}`,
                        codename: rokuCodenameFromDeviceInfoXml(info as Record<string, unknown>),
                        model: info['model-name'] || 'Unknown',
                        modelNumber: info['model-number'] || '',
                        serialNumber: info['serial-number'] || id,
                        softwareVersion: info['software-version'] || '',
                        location,
                        lastSeen: Date.now(),
                        manual: !!keepManual,
                        hasAuth: keepHasAuth,
                        discoveredOnNetwork: keepDiscoveredOnNetwork,
                        activeAppId: existing?.activeAppId ?? '',
                        activeAppName: existing?.activeAppName ?? '',
                        reachable: true,
                        developerEnabled
                    }

                    this.devices.set(id, device)
                    this.devicesByIp.set(ip, id)
                    this.scheduleEmit()
                    this.fetchActiveAppInfo(ip, port, id)
                } catch (err) {
                    console.error('[rokdock] Failed to parse device info:', err)
                }
            })
        })

        this.inflightByIp.set(ip, req)

        req.on('error', (err) => {
            if (this.inflightByIp.get(ip) === req) this.inflightByIp.delete(ip)
            console.error(`[rokdock] Failed to fetch device info from ${ip}:`, err.message)
        })

        req.on('timeout', () => {
            req.destroy()
        })
    }

    /**
     * Schedules a coalesced `'devices-changed'` emission via `setTimeout(0)`.
     *
     * Multiple calls within the same event-loop turn collapse into a single emission,
     * so a scan burst that discovers several devices produces one snapshot rather than
     * one per device. A trailing emit always fires because the timer is only cleared on
     * stopDiscovery, not on each emission.
     */
    private scheduleEmit(): void {
        if (this.pendingEmitTimer !== null) return
        this.pendingEmitTimer = setTimeout(() => {
            this.pendingEmitTimer = null
            this.emit('devices-changed', this.getDevices())
        }, 0)
    }

    /**
     * Emits `'devices-changed'` with the current device list (debounced via scheduleEmit).
     * Called on every scan tick so the renderer gets updated lastSeen ages even when
     * no new devices are discovered.
     */
    private emitDevicesChanged(): void {
        // Keep discovered devices in-session even if they stop responding.
        // Renderer uses lastSeen aging to show stale/offline state (red dot).
        this.scheduleEmit()
    }

    /**
     * Fetches `/query/active-app` and updates the device's `activeAppId`/`activeAppName`.
     * Failures are silently ignored because active-app info is optional metadata.
     *
     * @param ip - Device IP address.
     * @param port - ECP port.
     * @param id - Device map key.
     */
    private fetchActiveAppInfo(ip: string, port: number, id: string): void {
        const url = `http://${ip}:${port}/query/active-app`
        const req = http.get(url, { timeout: this.requestTimeoutMs }, (res) => {
            let data = ''
            res.on('data', (chunk) => { data += chunk })
            res.on('end', () => {
                try {
                    const parsed = xmlParser.parse(data)
                    const active = parsed['active-app'] || {}
                    const app = active.app || {}
                    const appId = (() => {
                        if (typeof app === 'string') return ''
                        if (typeof app.id === 'string') return app.id
                        if (typeof app['@_id'] === 'string') return app['@_id']
                        return ''
                    })()
                    const appName = (() => {
                        if (typeof app === 'string') return app
                        if (typeof app['#text'] === 'string') return app['#text']
                        return ''
                    })()
                    const existing = this.devices.get(id)
                    if (!existing) return
                    existing.activeAppId = appId
                    existing.activeAppName = appName
                    this.devices.set(id, existing)
                    this.devicesByIp.set(existing.ip, id)
                    this.scheduleEmit()
                } catch {
                    // Ignore parse errors; active app is optional metadata.
                }
            })
        })
        req.on('error', () => { /* Ignore active-app query failures. */ })
        req.on('timeout', () => { req.destroy() })
    }

    /**
     * Returns a snapshot of all currently tracked devices (discovered and manual).
     *
     * @returns Array of `DeviceInfo` objects in insertion order.
     */
    getDevices(): DeviceInfo[] {
        return Array.from(this.devices.values())
    }

    /**
     * Registers a device by IP address without waiting for SSDP discovery.
     *
     * If a device with the same IP is already tracked, the existing entry is updated
     * in place rather than creating a duplicate row. Either way, `fetchDeviceInfo` is
     * called immediately to populate hardware metadata.
     *
     * @param ip - IPv4 address of the Roku device.
     * @param name - Optional display name; defaults to `"Roku <ip>"`.
     * @param options - Optional flags, currently only `hasAuth` (credentials stored).
     */
    addManualDevice(ip: string, name?: string, options?: { hasAuth?: boolean }): void {
        const existingId = this.devicesByIp.get(ip)
        const existingByIp = existingId !== undefined ? this.devices.get(existingId) : undefined
        if (existingByIp) {
            // Avoid duplicate rows for the same IP: promote existing entry to manual.
            existingByIp.manual = true
            if (options?.hasAuth !== undefined) existingByIp.hasAuth = options.hasAuth
            if (name?.trim()) existingByIp.name = name.trim()
            existingByIp.lastSeen = Date.now()
            this.devices.set(existingByIp.id, existingByIp)
            this.devicesByIp.set(ip, existingByIp.id)
            this.scheduleEmit()
            this.fetchDeviceInfo(existingByIp.ip, existingByIp.port, existingByIp.id, existingByIp.location)
            return
        }

        const id = `manual-${ip}`
        if (this.devices.has(id)) return

        const device: DeviceInfo = {
            id,
            ip,
            port: ECP_PORT,
            name: name || `Roku ${ip}`,
            codename: '',
            model: 'Manual',
            modelNumber: '',
            serialNumber: '',
            softwareVersion: '',
            location: `http://${ip}:${ECP_PORT}/`,
            lastSeen: Date.now(),
            manual: true,
            hasAuth: !!options?.hasAuth,
            discoveredOnNetwork: false,
            activeAppId: '',
            activeAppName: '',
            reachable: false
        }

        this.devices.set(id, device)
        this.devicesByIp.set(ip, id)

        // Try to fetch real device info
        this.fetchDeviceInfo(ip, ECP_PORT, id, device.location)

        this.scheduleEmit()
    }

    /**
     * Updates the `hasAuth` flag on the device matching `ip`.
     * Also clears the `manual` flag for network-discovered devices so they are no
     * longer treated as manually-added entries.
     *
     * @param ip - IPv4 address of the target device.
     * @param hasAuth - Whether stored credentials exist for this device.
     */
    setDeviceAuthState(ip: string, hasAuth: boolean): void {
        const existingId = this.devicesByIp.get(ip)
        const existingByIp = existingId !== undefined ? this.devices.get(existingId) : undefined
        if (!existingByIp) return
        existingByIp.hasAuth = hasAuth
        // If this device was discovered on the network, it is not a manual entry.
        if (existingByIp.discoveredOnNetwork) {
            existingByIp.manual = false
        }
        existingByIp.lastSeen = Date.now()
        this.devices.set(existingByIp.id, existingByIp)
        this.devicesByIp.set(ip, existingByIp.id)
        this.scheduleEmit()
    }

    /**
     * Removes a device from the in-memory map and emits `'devices-changed'`.
     *
     * @param id - Device ID to remove.
     */
    removeDevice(id: string): void {
        const device = this.devices.get(id)
        if (device) this.devicesByIp.delete(device.ip)
        this.devices.delete(id)
        this.scheduleEmit()
    }

    /**
     * Removes all SSDP-discovered devices while keeping manually-added entries.
     * Emits `'devices-changed'` after clearing.
     */
    clearDiscovered(): void {
        for (const [id, device] of this.devices) {
            if (!device.manual) {
                this.devicesByIp.delete(device.ip)
                this.devices.delete(id)
            }
        }
        this.scheduleEmit()
    }

    /**
     * Removes every device (discovered and manual) from the in-memory map.
     * Emits `'devices-changed'` with an empty array.
     */
    clearAllDevices(): void {
        this.devices.clear()
        this.devicesByIp.clear()
        this.scheduleEmit()
    }

    /**
     * Adjusts discovery timing parameters at runtime without restarting the service.
     *
     * `scanIntervalMs` is clamped to [3000, 300000] ms. When changed while discovery
     * is active, the existing interval timer is restarted immediately with the new value.
     * `requestTimeoutMs` is clamped to [1000, 30000] ms and takes effect on the next fetch.
     *
     * @param options - Tuning parameters to update. Omitted keys are left unchanged.
     */
    setDiscoveryTuning(options: { scanIntervalMs?: number; requestTimeoutMs?: number }): void {
        if (typeof options.scanIntervalMs === 'number' && Number.isFinite(options.scanIntervalMs)) {
            this.scanIntervalMs = clampInt(options.scanIntervalMs, 3000, 300000)
            if (this.scanTimer) {
                clearInterval(this.scanTimer)
                this.scanTimer = setInterval(() => {
                    this.sendSearch()
                    this.emitDevicesChanged()
                }, this.scanIntervalMs)
            }
        }
        if (typeof options.requestTimeoutMs === 'number' && Number.isFinite(options.requestTimeoutMs)) {
            this.requestTimeoutMs = clampInt(options.requestTimeoutMs, 1000, 30000)
        }
    }
}
