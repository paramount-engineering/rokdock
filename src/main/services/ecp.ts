/**
 * Roku External Control Protocol (ECP) service.
 *
 * ECP is Roku's HTTP-based remote control API, exposed on port 8060 of every
 * developer-enabled Roku device. It provides keypress simulation, deep linking,
 * media player state queries, and device information endpoints.
 *
 * This module provides:
 *  - ecpRequest(): a raw HTTP helper for making ECP calls with proper timeout
 *    handling on both the connection and the response body.
 *  - EcpService: a higher-level class used throughout the app for common
 *    operations (keypress, text entry, deep link launch, media player query).
 *
 * All requests use a 5-second timeout. The EcpService instance is created once
 * in main.ts and passed through IpcContext to all handlers that need it.
 */

import http from 'http'
import { xmlParser } from '../utils/xml'
import { ECP_PORT } from '../../shared/ports'

export interface MediaPlayerState {
    state: 'play' | 'pause' | 'stop' | 'buffering' | 'finished'
    position?: number
    duration?: number
    audioCodec?: string
    videoCodec?: string
    drmType?: string
}

export interface ActiveAppInfo {
    id: string
    name: string
}

/** An installed channel: its ECP app id and display name. */
export interface InstalledApp {
    id: string
    name: string
}

const ECP_REQUEST_TIMEOUT_MS = 5000

/**
 * Serializes a key-value record into a URL query string.
 * Both keys and values are percent-encoded.
 *
 * @param params - Object whose own entries become `key=value` pairs.
 * @returns A `&`-separated query string, or an empty string when `params` is empty.
 */
export function buildQueryString(params: Record<string, string>): string {
    return Object.entries(params)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&')
}

/**
 * Makes a raw HTTP request to the ECP endpoint on the given Roku device.
 *
 * Enforces a two-level timeout: a connection timeout via `http.request` options and
 * a separate response-body timeout guarding against servers that stall mid-response.
 * Both limits are set to `ECP_REQUEST_TIMEOUT_MS` (5 seconds).
 *
 * @param ip - IPv4 address of the target Roku device.
 * @param method - HTTP method, typically `'GET'` or `'POST'`.
 * @param path - Absolute URL path including any query string, e.g. `/keypress/Home`.
 * @returns The full response body as a UTF-8 string.
 * @throws On connection timeout, body timeout, socket error, or an HTTP 4xx/5xx status.
 */
export function ecpRequest(ip: string, method: string, path: string): Promise<string> {
    return new Promise((resolve, reject) => {
        let settled = false
        const settle = (fn: () => void) => {
            if (settled) return
            settled = true
            fn()
        }

        const req = http.request(
            {
                hostname: ip,
                port: ECP_PORT,
                path,
                method,
                timeout: ECP_REQUEST_TIMEOUT_MS
            },
            (res) => {
                // Timeout the response body independently - guards against a
                // server that sends headers but stalls before completing the body.
                const bodyTimer = setTimeout(() => {
                    res.destroy()
                    settle(() => reject(new Error('ECP response body timed out')))
                }, ECP_REQUEST_TIMEOUT_MS)

                let data = ''
                res.on('data', (chunk) => { data += chunk })
                res.on('end', () => {
                    clearTimeout(bodyTimer)
                    if (res.statusCode && res.statusCode >= 400) {
                        settle(() => reject(new Error(`ECP request failed (${res.statusCode})`)))
                        return
                    }
                    settle(() => resolve(data))
                })
                res.on('error', (err) => {
                    clearTimeout(bodyTimer)
                    settle(() => reject(err))
                })
            }
        )

        req.on('error', (err) => settle(() => reject(err)))
        req.on('timeout', () => {
            req.destroy()
            settle(() => reject(new Error('ECP request timed out')))
        })
        req.end()
    })
}

/**
 * Extract an app id and display name from a parsed ECP `<app>` node (the shape shared by
 * /query/active-app and /query/apps). A bare string node is a name with no id.
 */
function parseAppNode(node: unknown): InstalledApp {
    if (typeof node === 'string') return { id: '', name: node }
    const record = (node ?? {}) as Record<string, unknown>
    return { id: String(record['@_id'] ?? record.id ?? ''), name: String(record['#text'] ?? record.name ?? '') }
}

/**
 * High-level ECP client that wraps `ecpRequest` with convenience methods for
 * common Roku remote-control and query operations.
 *
 * A single instance is created at app startup and shared via IpcContext.
 */
export class EcpService {
    /**
     * Sends a single key press-and-release event to the device.
     *
     * @param ip - Target Roku IP address.
     * @param key - ECP key name (e.g. `'Home'`, `'Select'`, `'VolumeUp'`).
     */
    async keypress(ip: string, key: string): Promise<void> {
        await ecpRequest(ip, 'POST', `/keypress/${encodeURIComponent(key)}`)
    }

    /**
     * Sends a key-down (press-hold) event without releasing.
     *
     * @param ip - Target Roku IP address.
     * @param key - ECP key name.
     */
    async keydown(ip: string, key: string): Promise<void> {
        await ecpRequest(ip, 'POST', `/keydown/${encodeURIComponent(key)}`)
    }

    /**
     * Sends a key-up (release) event to complement a prior `keydown`.
     *
     * @param ip - Target Roku IP address.
     * @param key - ECP key name.
     */
    async keyup(ip: string, key: string): Promise<void> {
        await ecpRequest(ip, 'POST', `/keyup/${encodeURIComponent(key)}`)
    }

    /**
     * Types a string on the device by sending each character as a `Lit_<char>` keypress.
     * Characters are percent-encoded before being included in the path.
     *
     * @param ip - Target Roku IP address.
     * @param text - The text string to type.
     */
    async sendText(ip: string, text: string): Promise<void> {
        for (const char of text) {
            const encoded = encodeURIComponent(char)
            await ecpRequest(ip, 'POST', `/keypress/Lit_${encoded}`)
        }
    }

    /**
     * Launches a channel with deep-link parameters via the ECP `/launch` endpoint.
     *
     * @param ip - Target Roku IP address.
     * @param appId - The Roku channel ID to launch.
     * @param params - Deep-link key/value pairs appended as a query string.
     */
    async launchDeeplink(ip: string, appId: string, params: Record<string, string>): Promise<void> {
        const query = buildQueryString(params)
        const path = `/launch/${encodeURIComponent(appId)}${query ? '?' + query : ''}`
        await ecpRequest(ip, 'POST', path)
    }

    /**
     * Sends an ECP `/input` command with arbitrary key/value parameters.
     * Used to send in-channel data (e.g. transport position) to a running app.
     *
     * @param ip - Target Roku IP address.
     * @param params - Input parameters encoded as a query string.
     */
    async sendInput(ip: string, params: Record<string, string>): Promise<void> {
        const query = buildQueryString(params)
        const path = `/input${query ? '?' + query : ''}`
        await ecpRequest(ip, 'POST', path)
    }

    /**
     * Queries the media player state from the ECP `/query/media-player` endpoint.
     *
     * Parses the XML response and normalises the raw state string via
     * `normalizePlayerState`. Returns `{ state: 'stop' }` on any error so callers
     * always receive a valid object.
     *
     * @param ip - Target Roku IP address.
     * @returns Normalized media player state including optional codec and DRM fields.
     */
    async queryMediaPlayer(ip: string): Promise<MediaPlayerState> {
        try {
            const xml = await ecpRequest(ip, 'GET', '/query/media-player')
            const parsed = xmlParser.parse(xml)
            const player = parsed?.['player'] ?? parsed?.['Player'] ?? {}
            const stateRaw = (player?.['@_state'] ?? player?.State ?? '').toLowerCase()
            const state = normalizePlayerState(stateRaw)

            const plugin = player?.Plugin ?? player?.plugin ?? {}
            const audioCodec = plugin?.['@_audioFormat'] ?? plugin?.audioFormat ?? undefined
            const videoCodec = plugin?.['@_videoFormat'] ?? plugin?.videoFormat ?? undefined
            const drmType = plugin?.['@_drmType'] ?? plugin?.drmType ?? undefined

            const position = parseMs(player?.Position ?? player?.position)
            const duration = parseMs(player?.Duration ?? player?.duration)

            return { state, audioCodec, videoCodec, drmType, position, duration }
        } catch {
            return { state: 'stop' }
        }
    }

    /**
     * Queries the currently active application from `/query/active-app`.
     *
     * @param ip - Target Roku IP address.
     * @returns The active app's numeric ID and display name. Both fields may be
     *   empty strings if no app is running or the XML structure is unexpected.
     */
    async queryActiveApp(ip: string): Promise<ActiveAppInfo> {
        const xml = await ecpRequest(ip, 'GET', '/query/active-app')
        const parsed = xmlParser.parse(xml)
        const appNode = parsed?.['active-app']?.app ?? parsed?.['active-app']?.App ?? {}
        return parseAppNode(appNode)
    }

    /**
     * Queries the channels installed on the device from `/query/apps`, returning each app's
     * id and display name. Shared by the AI device tools, the script editor, and the deeplink UI.
     *
     * @param ip - Target Roku IP address.
     * @returns Installed apps as `{ id, name }`, excluding any entry missing an id.
     */
    async queryApps(ip: string): Promise<InstalledApp[]> {
        const xml = await ecpRequest(ip, 'GET', '/query/apps')
        const parsed = xmlParser.parse(xml) as { apps?: { app?: unknown } }
        const raw = parsed?.apps?.app
        const list = Array.isArray(raw) ? raw : raw ? [raw] : []
        return list.map(parseAppNode).filter(app => app.id)
    }

    /**
     * Launches a channel by its ID using the ECP `/launch` endpoint.
     *
     * @param ip - Target Roku IP address.
     * @param channelId - The numeric or string channel ID to launch.
     */
    async launchApp(ip: string, channelId: string | number): Promise<void> {
        await ecpRequest(ip, 'POST', `/launch/${encodeURIComponent(String(channelId))}`)
    }

    /**
     * Terminates a running channel via ECP `/exit-app/<id>/true` (the `/true` forces a full
     * terminate even for Instant Resume apps). Requires Roku OS 13.0 or later with "Control by
     * mobile apps" enabled. Per the official ECP docs it only acts on apps installed under your
     * developer account (the sideloaded "dev" channel, or a production/beta app linked to that
     * account), so it is a no-op for store apps you do not own (observed: it does not terminate
     * Netflix). Pair with launchApp to cold-restart an already-running channel you own. For a
     * store app, background it with a Home keypress before launching instead.
     *
     * @param ip - Target Roku IP address.
     * @param channelId - The channel ID to terminate.
     */
    async exitApp(ip: string, channelId: string | number): Promise<void> {
        await ecpRequest(ip, 'POST', `/exit-app/${encodeURIComponent(String(channelId))}/true`)
    }

    /**
     * Verifies that the device is reachable by fetching `/query/device-info`.
     * Throws if the device does not respond within the ECP timeout.
     *
     * @param ip - Target Roku IP address.
     */
    async ping(ip: string): Promise<void> {
        await ecpRequest(ip, 'GET', '/query/device-info')
    }
}

/**
 * Maps raw ECP player state strings to the canonical `MediaPlayerState['state']` union.
 * Handles variant spellings returned by different firmware versions (e.g. `'playing'`
 * vs `'play'`, `'finish'` vs `'finished'`). Defaults to `'stop'` for unrecognised values.
 *
 * @param raw - Lowercase state string from the ECP response.
 * @returns Normalised state value.
 */
export function normalizePlayerState(raw: string): MediaPlayerState['state'] {
    switch (raw) {
        case 'play':
        case 'playing':
            return 'play'
        case 'pause':
        case 'paused':
            return 'pause'
        case 'buffering':
            return 'buffering'
        case 'finished':
        case 'finish':
            return 'finished'
        default:
            return 'stop'
    }
}

/**
 * Parses a millisecond value from an ECP XML field.
 *
 * ECP may return numeric strings with units (e.g. `"10 ms"`) or plain numbers.
 * Non-numeric, null, and empty values return `undefined`.
 *
 * @param value - Raw field value from the parsed XML object.
 * @returns Millisecond integer, or `undefined` if the value is absent or unparseable.
 */
export function parseMs(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined
    // ECP returns values like "10 ms" or plain numbers
    const parsed = typeof value === 'string' ? parseInt(value.replace(/[^\d]/g, ''), 10) : Number(value)
    if (isNaN(parsed) || parsed < 0) return undefined
    return parsed
}
