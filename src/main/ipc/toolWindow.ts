/**
 * Shared factory for tool-window BrowserWindows.
 *
 * Centralizes the common BrowserWindow construction, menu wiring, zoom sync,
 * and closed-event teardown that all pop-out tool windows share.
 *
 * Callers retain ownership of the module-scoped window reference. They load the
 * bundled entry via loadBundledEntryOrClose (which closes the window on a failed
 * load) or, when a failed-load window must stay alive, loadBundledEntry directly.
 */

import { BrowserWindow, Menu } from 'electron'
import { SUPPRESS_WINDOW_FOCUS } from '../focusPolicy'
import path from 'path'
import fs from 'fs'
import { nativeWindowBg } from '../../shared/themeData'
import { asThemeMode } from '../utils/validation'
import { APP_ICON_PATH } from '../utils/resourcePaths'
import { centeredBounds } from '../utils/windowBounds'
import { getPreloadScriptPath } from '../utils/preloadPath'
import { hardenWindowNavigation } from '../utils/hardenWindow'
import type { IpcContext } from './types'

const isMac = process.platform === 'darwin'

export type ToolWindowScope = 'standalone' | 'inDock'

// At most one live window per `${toolKey}:${scope}` key.
const scopedToolWindows = new Map<string, BrowserWindow>()

function scopeKey(toolKey: string, scope: ToolWindowScope): string {
    return `${toolKey}:${scope}`
}

/** The live (non-destroyed) window for a tool+scope, or null. */
export function getScopedToolWindow(toolKey: string, scope: ToolWindowScope): BrowserWindow | null {
    const win = scopedToolWindows.get(scopeKey(toolKey, scope))
    return win && !win.isDestroyed() ? win : null
}

/** Record a window for a tool+scope and drop the entry (identity-guarded) when it closes. */
export function setScopedToolWindow(toolKey: string, scope: ToolWindowScope, win: BrowserWindow): void {
    const key = scopeKey(toolKey, scope)
    scopedToolWindows.set(key, win)
    win.on('closed', () => {
        if (scopedToolWindows.get(key) === win) scopedToolWindows.delete(key)
    })
}

/** Test-only: clear the registry between cases. */
export function resetScopedToolWindowsForTest(): void {
    scopedToolWindows.clear()
}

/**
 * Loads a built bundled renderer entry into a tool window: the Vite dev server URL
 * in development, the packaged file in production. entryName is the html basename, e.g. 'svgConverter'.
 */
export async function loadBundledEntry(win: BrowserWindow, entryName: string): Promise<void> {
    if (process.env.ELECTRON_RENDERER_URL) {
        await win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${entryName}.html`)
    } else {
        await win.loadFile(path.join(__dirname, `../renderer/${entryName}.html`))
    }
}

/**
 * Loads a bundled entry, closing the window if the load throws (a broken or
 * missing build). Closing fires the window's onClosed teardown, which nulls the
 * caller's singleton so a retry can open a fresh window. The error is rethrown
 * so the caller can still report it. This is the default for tool-window open
 * paths whose onClosed nulls the singleton; call loadBundledEntry directly only
 * when the caller needs to keep a failed-load window alive.
 */
export async function loadBundledEntryOrClose(win: BrowserWindow, entryName: string): Promise<void> {
    try {
        await loadBundledEntry(win, entryName)
    } catch (err) {
        if (!win.isDestroyed()) win.close()
        throw err
    }
}

export interface ToolWindowOptions {
    /** Shared IPC context providing store and window helpers. */
    context: IpcContext
    /** Window title bar text. */
    title: string
    /** Initial width in pixels. */
    width: number
    /** Initial height in pixels. */
    height: number
    /** Minimum width in pixels. */
    minWidth: number
    /** Minimum height in pixels. */
    minHeight: number
    /**
     * When provided, sets the initial zoom level on the WebContents and
     * re-applies it after 'did-finish-load'.
     */
    sourceZoomLevel?: number
    /**
     * Optional factory for a custom application menu.
     * Receives the newly-created BrowserWindow so menu actions can reference it.
     */
    buildMenu?: (win: BrowserWindow) => Menu
    /**
     * Optional hook to attach a context-menu listener to the window's WebContents.
     * Called immediately after the menu (if any) is attached.
     */
    setupContextMenu?: (win: BrowserWindow) => void
    /**
     * Tool-specific teardown that runs when the window closes.
     * Use this for nulling module-scoped state (e.g. stopping a ScriptEngine,
     * resetting menu refs). The caller is also responsible for nulling its own
     * module-scoped window reference inside this callback.
     */
    onClosed?: () => void
    /**
     * Tool key for the per-tool window icon (resources/icons/tools/<key>.png), shown in
     * the taskbar and title bar on Windows and Linux (macOS uses the app bundle icon).
     * Falls back to the main app icon when absent or the file is missing.
     */
    iconKey?: string
}

/**
 * Creates a configured tool-window BrowserWindow.
 *
 * Builds the window with the standard shell (icon, background color, sandboxed
 * webPreferences, centered position), attaches an optional menu, optional context
 * menu, and optional zoom sync, then registers a single 'closed' listener that
 * calls onClosed().
 *
 * The caller is responsible for loading the bundled entry into the returned window.
 */
export function createToolWindow(opts: ToolWindowOptions): BrowserWindow {
    const { context, title, width, height, minWidth, minHeight } = opts

    const focused = context.getFocusedOrFirstWindow()
    const appIconPath = APP_ICON_PATH
    const toolIconPath = opts.iconKey
        ? path.join(__dirname, `../../resources/icons/tools/${opts.iconKey}.png`)
        : null
    const iconPath = toolIconPath && fs.existsSync(toolIconPath) ? toolIconPath : appIconPath
    const centered = centeredBounds(focused, width, height)

    const win = new BrowserWindow({
        width,
        height,
        minWidth,
        minHeight,
        title,
        modal: false,
        // Default (show: true) reveals and focuses on creation. Under e2e, start
        // hidden and reveal inactive below so a test run does not steal focus.
        show: !SUPPRESS_WINDOW_FOCUS,
        ...(centered ?? {}),
        icon: iconPath,
        backgroundColor: nativeWindowBg(asThemeMode(context.store.getPreferences().themeMode), context.store.getPreferences().tint),
        fullscreenable: false,
        fullscreen: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            preload: getPreloadScriptPath()
        }
    })

    hardenWindowNavigation(win)

    if (opts.buildMenu) {
        const menu = opts.buildMenu(win)
        win.setMenu(menu)
    }

    if (!isMac) {
        win.setMenuBarVisibility(false)
    }

    if (opts.setupContextMenu) {
        opts.setupContextMenu(win)
    }

    if (opts.sourceZoomLevel !== undefined) {
        win.webContents.setZoomLevel(opts.sourceZoomLevel)
        win.webContents.once('did-finish-load', () => {
            if (!win.isDestroyed()) win.webContents.setZoomLevel(opts.sourceZoomLevel!)
        })
    }

    win.on('closed', () => {
        opts.onClosed?.()
    })

    if (SUPPRESS_WINDOW_FOCUS) win.showInactive()

    return win
}
