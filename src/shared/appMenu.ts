/** Shared application menu structure - single source of truth for both
 *  the native Electron menu (main) and the custom React menu bar (renderer).
 *
 *  To add a menu item:
 *  1. Add it here
 *  2. If it needs a renderer action, add an entry in CustomMenuBar.tsx menuActions
 *  3. If it has a native Electron role, set the role field
 *  Both menus update automatically. */

export interface AppMenuItem {
    id: string
    label: string
    accelerator?: string
    /** Electron menu role */
    role?: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll' | 'quit'
        | 'reload' | 'toggleDevTools' | 'zoomIn' | 'zoomOut' | 'resetZoom'
    /** Only show in the native Electron menu, not the custom menu bar */
    nativeOnly?: boolean
}

export interface AppMenuSeparator {
    type: 'separator'
}

export type AppMenuEntry = AppMenuItem | AppMenuSeparator

export interface AppMenuGroup {
    id: string
    label: string
    items: AppMenuEntry[]
}

/**
 * Type guard that narrows an {@link AppMenuEntry} to an {@link AppMenuItem}.
 * Use this to distinguish clickable items from separators when iterating the menu.
 *
 * @param entry - The menu entry to test.
 * @returns `true` if the entry is an {@link AppMenuItem} (has an `id` field).
 */
export function isMenuItem(entry: AppMenuEntry): entry is AppMenuItem {
    return 'id' in entry
}

export const APP_MENU: AppMenuGroup[] = [
    {
        id: 'file',
        label: 'File',
        items: [
            { id: 'new-connection', label: 'New Connection...', accelerator: 'CmdOrCtrl+T' },
            { type: 'separator' },
            { id: 'open-settings', label: 'Settings...', accelerator: 'CmdOrCtrl+,' },
            { type: 'separator' },
            { id: 'exit', label: 'Exit', role: 'quit' },
        ]
    },
    {
        id: 'edit',
        label: 'Edit',
        items: [
            { id: 'undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
            { id: 'redo', label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
            { type: 'separator' },
            { id: 'cut', label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
            { id: 'copy', label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
            { id: 'paste', label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
            { type: 'separator' },
            { id: 'select-all', label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
        ]
    },
    {
        id: 'view',
        label: 'View',
        items: [
            { id: 'toggle-device-panel', label: 'Toggle Device Panel', accelerator: 'CmdOrCtrl+Shift+D' },
            { id: 'toggle-remote-panel', label: 'Toggle Remote Panel', accelerator: 'CmdOrCtrl+Shift+R' },
            { type: 'separator' },
            { id: 'toggle-dev-tools', label: 'Toggle Developer Tools', role: 'toggleDevTools', nativeOnly: true },
            { id: 'reload', label: 'Reload', role: 'reload', nativeOnly: true },
            { type: 'separator' },
            { id: 'zoom-in', label: 'Zoom In', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
            { id: 'zoom-out', label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
            { id: 'reset-zoom', label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        ]
    },
    {
        id: 'tools',
        label: 'Tools',
        items: [
            { id: 'screenshot', label: 'Screenshot Viewer' },
            { type: 'separator' },
            { id: 'ninepatch', label: '9-Patch Editor' },
            { id: 'svg-exporter', label: 'SVG Converter' },
            { type: 'separator' },
            { id: 'script-editor', label: 'Script Editor' },
            { type: 'separator' },
            { id: 'json-editor', label: 'JSON Editor' },
            { type: 'separator' },
            { id: 'docs', label: 'Developer Docs' },
        ]
    },
    {
        id: 'help',
        label: 'Help',
        items: [
            { id: 'check-for-updates', label: 'Check for Updates...' },
            { type: 'separator' },
            { id: 'about', label: 'About RokDock' },
        ]
    },
]

/**
 * Converts an Electron-style accelerator string to a platform-appropriate display hint.
 * `CmdOrCtrl` is replaced with `Cmd` on macOS and `Ctrl` on all other platforms.
 * Works in both the main process (via `process.platform`) and the renderer (via `navigator.platform`).
 *
 * @param accelerator - Electron accelerator string, e.g. `'CmdOrCtrl+S'`.
 * @returns Human-readable shortcut string, e.g. `'Ctrl+S'` on Windows/Linux or `'Cmd+S'` on macOS.
 */
export function acceleratorToHint(accelerator: string): string {
    const isMac = typeof navigator !== 'undefined'
        ? navigator.platform.toLowerCase().includes('mac')
        : process.platform === 'darwin'
    return accelerator.replace(/CmdOrCtrl/g, isMac ? 'Cmd' : 'Ctrl')
}
