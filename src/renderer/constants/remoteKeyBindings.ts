/**
 * Renderer-side remote key binding constants.
 *
 * Re-exports DEFAULT_REMOTE_KEY_BINDINGS and RemoteActionKey from
 * src/shared/remoteKeys for use in SettingsDialog and RemotePanel.
 *
 * REMOTE_ACTIONS: ordered array of { key, title } used to render the
 * keyboard binding editor rows in SettingsDialog's Remote tab. The ordering
 * matches the physical layout of the Roku remote image.
 *
 * formatKeyCodeLabel: converts a raw KeyboardEvent.code string (e.g.,
 * 'ArrowUp', 'KeyA', 'Digit1') to a human-readable label for display in the
 * binding editor.
 *
 * normalizeRemoteKeyBindings: fills in any missing keys from the default
 * binding map so the settings shape is always complete even after updates
 * add new remote actions.
 */
import { DEFAULT_REMOTE_KEY_BINDINGS } from '../../shared/remoteKeys'
import type { RemoteActionKey } from '../../shared/remoteKeys'

export type { RemoteActionKey }
export { DEFAULT_REMOTE_KEY_BINDINGS }

/**
 * Ordered list of remote actions with display titles, used to render the
 * keyboard-binding editor rows in SettingsDialog's Remote tab.
 * The ordering mirrors the physical layout of the Roku remote image.
 */
export const REMOTE_ACTIONS: Array<{ key: RemoteActionKey; title: string }> = [
    { key: 'PowerOff', title: 'Power' },
    { key: 'Back', title: 'Back' },
    { key: 'Home', title: 'Home' },
    { key: 'Up', title: 'Up' },
    { key: 'Down', title: 'Down' },
    { key: 'Left', title: 'Left' },
    { key: 'Right', title: 'Right' },
    { key: 'Select', title: 'OK / Select' },
    { key: 'InstantReplay', title: 'Instant Replay' },
    { key: 'Info', title: 'Options' },
    { key: 'Rev', title: 'Rewind' },
    { key: 'Play', title: 'Play / Pause' },
    { key: 'Fwd', title: 'Fast Forward' },
    { key: 'VolumeUp', title: 'Volume Up' },
    { key: 'VolumeDown', title: 'Volume Down' },
    { key: 'VolumeMute', title: 'Mute' }
]

/**
 * Merge a partial or legacy bindings map with the defaults, ensuring every
 * known `RemoteActionKey` has an entry. Any keys absent from `bindings` fall
 * back to the value from `DEFAULT_REMOTE_KEY_BINDINGS`, so the result is
 * always a complete map even after new remote actions are added in updates.
 *
 * @param bindings - Optional user-supplied bindings (may be partial or undefined).
 * @returns A fully-populated `Record<RemoteActionKey, string>`.
 */
export function normalizeRemoteKeyBindings(
    bindings?: Record<string, string>
): Record<RemoteActionKey, string> {
    const normalized = { ...DEFAULT_REMOTE_KEY_BINDINGS }
    if (!bindings) return normalized
    for (const action of Object.keys(DEFAULT_REMOTE_KEY_BINDINGS) as RemoteActionKey[]) {
        const code = bindings[action]
        if (typeof code === 'string') {
            normalized[action] = code
        }
    }
    return normalized
}

/**
 * Convert a raw `KeyboardEvent.code` value to a compact, human-readable label
 * suitable for display in the binding editor.
 *
 * Examples:
 *  - `'KeyA'`      -> `'A'`
 *  - `'Digit1'`    -> `'1'`
 *  - `'Numpad0'`   -> `'Numpad 0'`
 *  - `'ArrowUp'`   -> `'Arrow Up'`
 *  - `''`          -> `'Unassigned'`
 *
 * @param code - A `KeyboardEvent.code` string or empty string for unbound keys.
 * @returns A human-readable label for display.
 */
export function formatKeyCodeLabel(code: string): string {
    if (!code) return 'Unassigned'
    if (code.startsWith('Key')) return code.slice(3)
    if (code.startsWith('Digit')) return code.slice(5)
    if (code.startsWith('Numpad')) return `Numpad ${code.slice(6)}`
    return code.replace(/([a-z])([A-Z])/g, '$1 $2')
}
