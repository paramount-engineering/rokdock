/**
 * Keyboard binding map for the on-screen Roku remote control.
 *
 * RemoteActionKey lists every button on the remote that can be triggered via
 * a keyboard shortcut. DEFAULT_REMOTE_KEY_BINDINGS provides sensible defaults
 * (arrow keys, Enter, Escape) that users can remap in Settings.
 *
 * These bindings are stored in AppPreferences and applied by the rokdock-remote
 * web component's keyboard listener.
 */

export type RemoteActionKey =
    | 'PowerOff'
    | 'Back'
    | 'Home'
    | 'Up'
    | 'Down'
    | 'Left'
    | 'Right'
    | 'Select'
    | 'InstantReplay'
    | 'Info'
    | 'Rev'
    | 'Play'
    | 'Fwd'
    | 'VolumeUp'
    | 'VolumeDown'
    | 'VolumeMute'

export const DEFAULT_REMOTE_KEY_BINDINGS: Record<RemoteActionKey, string> = {
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
