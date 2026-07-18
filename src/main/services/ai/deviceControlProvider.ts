/**
 * RokDock device-control tools for the assistant (roBot). Read tools (list devices, active
 * app, media state, installed channels) run silently. State-changing tools (press a remote
 * key, type text, launch a channel, open a deeplink) are the first side-effecting tools, so
 * each asks the host to confirm via the tool-call context before it acts.
 *
 * Privacy: tools address devices by NAME and never expose or accept an IP or serial, so a
 * device's IP address and serial never enter the model transcript (device names still do).
 * The default target is the device the user currently has selected in the app, so most
 * actions need no device argument.
 */
import type { ContextProvider, ToolDef, ToolResult, ToolCallContext } from '../../../ai-core/types'
import type { DeviceInfo } from '../../../shared/device'
import type { EcpService } from '../ecp'
import { ROKU_DEV_APP_ID } from '../../constants/preview'

/** ECP keys roBot may send: the standard navigation, playback, and volume set. */
const REMOTE_KEYS = [
    'Home', 'Back', 'Select', 'Up', 'Down', 'Left', 'Right',
    'InstantReplay', 'Info', 'Rev', 'Play', 'Fwd', 'Backspace', 'Enter',
    'VolumeUp', 'VolumeDown', 'VolumeMute', 'Power', 'PowerOff', 'PowerOn',
]
const MAX_KEY_REPEAT = 20

/** How long to wait after a Home keypress for the transition to settle before launching, so the
 *  launch does not land while the app is still in the foreground (where /launch is a no-op). */
const HOME_SETTLE_MS = 1000

const delay = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms) })

interface DeviceControlDeps {
    ecp: EcpService
    /** All known devices (SSDP-discovered plus manually added). */
    listDevices: () => DeviceInfo[]
    /** IP of the device the user currently has selected in the app, or null. */
    getActiveDeviceIp: () => string | null
    /**
     * Capture a screenshot and show it inline in the chat. Prefers the native ECP capture (dev
     * channel only). `viaHdmiCapture` is true when it fell back to a frame from the HDMI capture device.
     */
    captureScreenshot: (ip: string) => Promise<{ ok: boolean; error?: string; viaHdmiCapture?: boolean }>
}

type ResolvedDevice = { ip: string; name: string }

function asRecord(args: unknown): Record<string, unknown> {
    return (args ?? {}) as Record<string, unknown>
}

/** Case-insensitive exact-then-substring match over a named list. */
function matchByName<T>(items: T[], nameArg: string, nameOf: (item: T) => string): T | undefined {
    const needle = nameArg.trim().toLowerCase()
    return items.find(item => nameOf(item).toLowerCase() === needle)
        ?? items.find(item => nameOf(item).toLowerCase().includes(needle))
}

export function createDeviceControlProvider(deps: DeviceControlDeps): ContextProvider {
    /** Resolve the target device from an optional name, else the selected device, else the sole device. */
    function resolveDevice(nameArg?: string): ResolvedDevice | { error: string } {
        const devices = deps.listDevices()
        const knownNames = (): string => devices.map(device => `"${device.name}"`).join(', ')
        if (devices.length === 0) return { error: 'No Roku devices are known. Add or discover a device first.' }
        if (typeof nameArg === 'string' && nameArg.trim()) {
            const needle = nameArg.trim().toLowerCase()
            const exact = devices.find(device => device.name.toLowerCase() === needle)
            if (exact) return { ip: exact.ip, name: exact.name }
            // Substring is a convenience fallback, but only when it is unambiguous: acting on the
            // wrong device (reads have no confirm) would be worse than asking for the exact name.
            const partial = devices.filter(device => device.name.toLowerCase().includes(needle))
            if (partial.length === 1) return { ip: partial[0].ip, name: partial[0].name }
            if (partial.length > 1) return { error: `Device name ${JSON.stringify(nameArg)} is ambiguous. Matches: ${partial.map(device => `"${device.name}"`).join(', ')}. Use the exact name.` }
            return { error: `No device named ${JSON.stringify(nameArg)}. Known devices: ${knownNames()}.` }
        }
        const activeIp = deps.getActiveDeviceIp()
        const active = activeIp ? devices.find(device => device.ip === activeIp) : undefined
        if (active) return { ip: active.ip, name: active.name }
        const reachable = devices.filter(device => device.reachable)
        if (reachable.length === 1) return { ip: reachable[0].ip, name: reachable[0].name }
        if (devices.length === 1) return { ip: devices[0].ip, name: devices[0].name }
        return { error: `Multiple devices are available and none is selected. Specify one by name: ${knownNames()}.` }
    }

    /** Resolve a channel argument (numeric id or channel name) to an app id on the device. */
    async function resolveChannelId(ip: string, channelArg: string): Promise<{ id: string; name: string } | { error: string }> {
        const trimmed = channelArg.trim()
        if (/^\d+$/.test(trimmed)) return { id: trimmed, name: trimmed }
        const channels = await deps.ecp.queryApps(ip)
        // Match by exact app id first so non-numeric ids launch (e.g. the sideloaded "dev"
        // channel, or tvinput.* sources), then fall back to matching by channel name.
        const byId = channels.find(channel => channel.id.toLowerCase() === trimmed.toLowerCase())
        if (byId) return byId
        const byName = matchByName(channels, channelArg, channel => channel.name)
        if (!byName) return { error: `No installed channel matches ${JSON.stringify(channelArg)}.` }
        return byName
    }

    /** Ask the host to confirm a side-effecting action. Absent confirm hook = deny (fail-safe). */
    async function confirmed(context: ToolCallContext | undefined, summary: string): Promise<boolean> {
        if (!context?.confirm) return false
        return context.confirm(summary)
    }

    const DENIED: ToolResult = { content: 'The user declined the action.', isError: true }
    const ABORTED: ToolResult = { content: 'The action was cancelled before it ran.', isError: true }

    const tools: ToolDef[] = [
        {
            name: 'list_devices',
            description: 'List the Roku devices RokDock knows about, with model, reachability, and the app each is running. Use this to pick a device by name for the other tools.',
            parameters: { type: 'object', properties: {} },
        },
        {
            name: 'get_active_app',
            description: 'Get the app/channel currently running on a device.',
            parameters: { type: 'object', properties: { device: { type: 'string', description: 'Device name. Omit to use the selected device.' } } },
        },
        {
            name: 'get_media_state',
            description: 'Get the media player state (playing/paused/etc., with position and duration when available) on a device.',
            parameters: { type: 'object', properties: { device: { type: 'string', description: 'Device name. Omit to use the selected device.' } } },
        },
        {
            name: 'list_installed_channels',
            description: 'List the channels installed on a device, each with its name and app id.',
            parameters: { type: 'object', properties: { device: { type: 'string', description: 'Device name. Omit to use the selected device.' } } },
        },
        {
            name: 'capture_screenshot',
            description: 'Capture a screenshot of the device screen and show it to the user in the chat. Uses the native capture when the sideloaded "dev" channel is active, otherwise falls back to the HDMI capture device if its preview is running. You do not receive the image yourself.',
            parameters: { type: 'object', properties: { device: { type: 'string', description: 'Device name. Omit to use the selected device.' } } },
        },
        {
            name: 'press_remote_key',
            description: `Press a remote-control key on a device. Valid keys: ${REMOTE_KEYS.join(', ')}. Optionally repeat it.`,
            parameters: {
                type: 'object',
                properties: {
                    key: { type: 'string', description: `One of: ${REMOTE_KEYS.join(', ')}.` },
                    count: { type: 'number', description: `How many times to press it (1-${MAX_KEY_REPEAT}). Default 1.` },
                    device: { type: 'string', description: 'Device name. Omit to use the selected device.' },
                },
                required: ['key'],
            },
        },
        {
            name: 'type_text',
            description: 'Type a string on a device (e.g. into a search box), one character at a time.',
            parameters: {
                type: 'object',
                properties: {
                    text: { type: 'string', description: 'The text to type.' },
                    device: { type: 'string', description: 'Device name. Omit to use the selected device.' },
                },
                required: ['text'],
            },
        },
        {
            name: 'launch_channel',
            description: 'Launch a channel on a device, by channel name or app id. Always call this to launch OR relaunch a channel. Do not check whether it is already running and skip. When the user explicitly asks to relaunch, restart, or reopen a channel, set relaunch to true so the tool relaunches it directly instead of asking. When relaunch is not set and the channel is already the active app, the tool asks the user whether to relaunch.',
            parameters: {
                type: 'object',
                properties: {
                    channel: { type: 'string', description: 'Channel name (matched against installed channels) or numeric app id.' },
                    device: { type: 'string', description: 'Device name. Omit to use the selected device.' },
                    relaunch: { type: 'boolean', description: 'Set true when the user explicitly asked to relaunch, restart, or reopen the channel, so the tool relaunches without asking whether to leave it running.' },
                },
                required: ['channel'],
            },
        },
        {
            name: 'open_deeplink',
            description: 'Launch a channel into specific content via a deeplink (contentId + mediaType).',
            parameters: {
                type: 'object',
                properties: {
                    channel: { type: 'string', description: 'Channel name or numeric app id.' },
                    contentId: { type: 'string', description: 'The deeplink content id.' },
                    mediaType: { type: 'string', description: 'The deeplink media type, e.g. "movie", "series", "episode", "season".' },
                    device: { type: 'string', description: 'Device name. Omit to use the selected device.' },
                },
                required: ['channel', 'contentId', 'mediaType'],
            },
        },
    ]

    async function callTool(name: string, args: unknown, signal: AbortSignal, context?: ToolCallContext): Promise<ToolResult> {
        const record = asRecord(args)
        const deviceArg = typeof record.device === 'string' ? record.device : undefined

        if (name === 'list_devices') {
            const devices = deps.listDevices().map(device => ({
                name: device.name, model: device.model || 'Roku', reachable: device.reachable,
                runningApp: device.activeAppName || undefined,
            }))
            return { content: JSON.stringify(devices) }
        }

        const target = resolveDevice(deviceArg)
        if ('error' in target) return { content: target.error, isError: true }

        try {
            switch (name) {
                case 'get_active_app': {
                    const app = await deps.ecp.queryActiveApp(target.ip)
                    return { content: JSON.stringify({ device: target.name, app: app.name || '(home)', appId: app.id || null }) }
                }
                case 'get_media_state': {
                    const media = await deps.ecp.queryMediaPlayer(target.ip)
                    return { content: JSON.stringify({ device: target.name, ...media }) }
                }
                case 'list_installed_channels': {
                    const channels = await deps.ecp.queryApps(target.ip)
                    return { content: JSON.stringify({ device: target.name, channels }) }
                }
                case 'capture_screenshot': {
                    const result = await deps.captureScreenshot(target.ip)
                    if (!result.ok) return { content: result.error ?? 'Screenshot failed.', isError: true }
                    const caveat = result.viaHdmiCapture
                        ? ' The native (dev channel) screenshot was unavailable, so this was captured via the HDMI capture device. Mention this caveat to the user.'
                        : ''
                    return { content: `Captured a screenshot of ${target.name} and showed it to the user in the chat.${caveat}` }
                }
                case 'press_remote_key': {
                    const key = REMOTE_KEYS.find(valid => valid.toLowerCase() === String(record.key ?? '').toLowerCase())
                    if (!key) return { content: `Unknown key ${JSON.stringify(record.key)}. Valid keys: ${REMOTE_KEYS.join(', ')}.`, isError: true }
                    const count = Math.min(MAX_KEY_REPEAT, Math.max(1, Math.floor(Number(record.count) || 1)))
                    const label = count > 1 ? `Press "${key}" ${count} times` : `Press "${key}"`
                    if (!await confirmed(context, `${label} on "${target.name}"?`)) return DENIED
                    let sent = 0
                    for (let i = 0; i < count; i++) {
                        if (signal.aborted) break
                        await deps.ecp.keypress(target.ip, key)
                        sent++
                    }
                    if (sent === 0) return ABORTED
                    return { content: `Pressed ${key}${sent > 1 ? ` x${sent}` : ''} on ${target.name}.` }
                }
                case 'type_text': {
                    const text = String(record.text ?? '')
                    if (!text) return { content: 'type_text requires a non-empty text string.', isError: true }
                    if (!await confirmed(context, `Type ${JSON.stringify(text)} on "${target.name}"?`)) return DENIED
                    if (signal.aborted) return ABORTED
                    await deps.ecp.sendText(target.ip, text)
                    return { content: `Typed ${JSON.stringify(text)} on ${target.name}.` }
                }
                case 'launch_channel': {
                    const channel = await resolveChannelId(target.ip, String(record.channel ?? ''))
                    if ('error' in channel) return { content: channel.error, isError: true }
                    const active = await deps.ecp.queryActiveApp(target.ip)
                    // channel.id is a resolved, non-empty id, so a blank active.id can never match.
                    const alreadyActive = active.id === channel.id

                    if (!alreadyActive) {
                        if (!await confirmed(context, `Launch "${channel.name}" on "${target.name}"?`)) return DENIED
                        if (signal.aborted) return ABORTED
                        await deps.ecp.launchApp(target.ip, channel.id)
                        return { content: `Launched ${channel.name} on ${target.name}.` }
                    }

                    // The channel is already the active app. Offer the relaunch-or-leave choice only
                    // for a plain launch while confirmations are on, and that ask is itself the
                    // approval. When the user explicitly asked to relaunch, or confirmations are off
                    // (so prompting is unwanted), relaunch directly, gated by the normal confirm.
                    if (record.relaunch !== true && context?.ask && context.confirmationsEnabled !== false) {
                        const answer = await context.ask(`${channel.name} is already running on ${target.name}. Relaunch it?`, ['Relaunch', 'Leave it running'])
                        if (answer !== 'Relaunch') return { content: `Left ${channel.name} running on ${target.name}.` }
                    } else if (!await confirmed(context, `Relaunch "${channel.name}" on "${target.name}"?`)) {
                        return DENIED
                    }
                    if (signal.aborted) return ABORTED

                    // A plain /launch is a no-op on the already-active app, so the app has to leave the
                    // foreground first. exit-app only terminates apps under your developer account (the
                    // sideloaded "dev" channel), so it restarts dev but no-ops on a store app. For a store
                    // app, a Home keypress backgrounds it. Wait for the Home transition to settle first, or
                    // the following launch would land while the app is still foreground and no-op too.
                    if (channel.id === ROKU_DEV_APP_ID) {
                        try { await deps.ecp.exitApp(target.ip, channel.id) } catch { /* older firmware or app not running */ }
                    } else {
                        await deps.ecp.keypress(target.ip, 'Home')
                        await delay(HOME_SETTLE_MS)
                        if (signal.aborted) return ABORTED
                    }
                    await deps.ecp.launchApp(target.ip, channel.id)
                    return { content: `Relaunched ${channel.name} on ${target.name}.` }
                }
                case 'open_deeplink': {
                    const channel = await resolveChannelId(target.ip, String(record.channel ?? ''))
                    if ('error' in channel) return { content: channel.error, isError: true }
                    const contentId = String(record.contentId ?? '')
                    const mediaType = String(record.mediaType ?? '')
                    if (!contentId || !mediaType) return { content: 'open_deeplink requires contentId and mediaType.', isError: true }
                    if (!await confirmed(context, `Open ${mediaType} ${JSON.stringify(contentId)} in "${channel.name}" on "${target.name}"?`)) return DENIED
                    if (signal.aborted) return ABORTED
                    await deps.ecp.launchDeeplink(target.ip, channel.id, { contentId, mediaType })
                    return { content: `Opened a ${mediaType} deeplink in ${channel.name} on ${target.name}.` }
                }
                default:
                    return { content: `Unknown tool: ${name}`, isError: true }
            }
        } catch (err) {
            return { content: `Device action failed: ${err instanceof Error ? err.message : String(err)}`, isError: true }
        }
    }

    // Tell the model, each turn, which device the user is working with (from the terminal/remote
    // selection), so it acts on that device by default instead of asking which one to use.
    async function retrieve(): Promise<Array<{ text: string }>> {
        const activeIp = deps.getActiveDeviceIp()
        if (!activeIp) return []
        const device = deps.listDevices().find(entry => entry.ip === activeIp)
        if (!device) return []
        return [{ text: `The device the user currently has selected in the app is "${device.name}". Treat it as the default target for device tools (omit the device argument). Do not ask which device to use unless the user refers to a different one.` }]
    }

    return { name: 'roku-device', tools: () => tools, retrieve, callTool }
}
