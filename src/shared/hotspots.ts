/**
 * Hit-test regions for the on-screen Roku remote image.
 *
 * Coordinates are expressed as percentages of the remote image's natural
 * width/height so they scale correctly at any rendered size. The rokdock-remote
 * web component uses these hotspots to map pointer clicks to ECP key names,
 * and to render accessible button overlays for keyboard navigation.
 *
 * TEXT_ENTRY_OVERLAY defines the position of the text-entry input that appears
 * when the user activates keyboard text entry mode on the remote.
 */

export interface RemoteHotspot {
    key: string
    title: string
    x: number
    y: number
    w: number
    h: number
    round: boolean
    radius: number
}

export interface TextEntryOverlay {
    x: number
    y: number
    w: number
    h: number
    radius: number
}

export const HOTSPOTS: RemoteHotspot[] = [
    { key: 'Power', title: 'Power', x: 48.7, y: 7.7, w: 14, h: 5, round: true, radius: 6 },
    { key: 'Back', title: 'Back', x: 29.4, y: 18.3, w: 32.1, h: 5.8, round: false, radius: 8 },
    { key: 'Home', title: 'Home', x: 68.3, y: 18.3, w: 32.1, h: 5.8, round: false, radius: 8 },
    { key: 'Up', title: 'Up', x: 48.6, y: 29.5, w: 24, h: 7, round: false, radius: 8 },
    { key: 'Down', title: 'Down', x: 48.6, y: 46, w: 24, h: 7, round: false, radius: 8 },
    { key: 'Left', title: 'Left', x: 26.5, y: 37.8, w: 19, h: 9, round: false, radius: 8 },
    { key: 'Right', title: 'Right', x: 71.2, y: 37.7, w: 19, h: 9, round: false, radius: 8 },
    { key: 'Select', title: 'OK', x: 48.7, y: 37.7, w: 22, h: 8.4, round: true, radius: 6 },
    { key: 'InstantReplay', title: 'Instant Replay', x: 23.9, y: 56.7, w: 21.3, h: 5, round: false, radius: 8 },
    { key: 'Info', title: 'Options', x: 73.4, y: 56.7, w: 21.3, h: 5, round: false, radius: 8 },
    { key: 'Rev', title: 'Rewind', x: 20.1, y: 65.5, w: 14.2, h: 7.5, round: false, radius: 8 },
    { key: 'Play', title: 'Play/Pause', x: 49.1, y: 65.5, w: 31, h: 7.5, round: false, radius: 8 },
    { key: 'Fwd', title: 'Fast Forward', x: 77.2, y: 65.5, w: 14.2, h: 7.5, round: false, radius: 8 },
    { key: 'VolumeUp', title: 'Volume Up', x: 97.2, y: 29.7, w: 5.7, h: 8, round: false, radius: 6 },
    { key: 'VolumeDown', title: 'Volume Down', x: 97.2, y: 38.3, w: 5.7, h: 8, round: false, radius: 6 },
    { key: 'VolumeMute', title: 'Mute', x: 97.2, y: 50.9, w: 5.7, h: 6.4, round: false, radius: 6 },
]

export const TEXT_ENTRY_OVERLAY: TextEntryOverlay = {
    x: 48.7,
    y: 77,
    w: 72,
    h: 6.5,
    radius: 4
}
