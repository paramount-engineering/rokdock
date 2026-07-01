/**
 * IPC handlers for application lifecycle and native menu management.
 *
 * Handles app metadata queries (version, platform, build info), window show/restore,
 * and graceful quit. Also builds and sets the native application menu at startup
 * and responds to menu click events by broadcasting them to the renderer.
 *
 * The custom React menu bar (CustomMenuBar) mirrors the native menu structure defined
 * in src/shared/app-menu.ts; both use the same item IDs so menu events work the same
 * way regardless of which menu system the user interacts with.
 */

import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { revealWindow, SUPPRESS_WINDOW_FOCUS } from '../../focusPolicy'
import type { StoreService } from '../../services/store'
import type { IpcResult } from '../types'

/**
 * Registers all application lifecycle and native menu IPC handlers.
 *
 * @param store - Persistent settings store; used to restore maximized window state.
 * @param getMainWindow - Returns the main BrowserWindow. Preferred over
 *   BrowserWindow.fromWebContents, which often returns null for sandboxed
 *   renderers on Windows.
 */
export function registerAppHandlers(
    store: StoreService,
    /** Prefer this over BrowserWindow.fromWebContents - the latter often returns null for sandboxed renderers on Windows. */
    getMainWindow: () => BrowserWindow | null
): void {
    /**
     * Synchronous channel: returns the app version string via event.returnValue.
     * Use this only in preload contexts where async is not available.
     */
    ipcMain.on('app:get-version-sync', (event) => {
        event.returnValue = app.getVersion()
    })

    /**
     * Synchronous channel: returns a boot metadata object via event.returnValue.
     * Includes version, platform, arch, electron version, and node version.
     * Use this only in preload contexts where async is not available.
     */
    ipcMain.on('app:get-boot-metadata-sync', (event) => {
        event.returnValue = {
            version: app.getVersion(),
            platform: process.platform,
            arch: process.arch,
            electron: process.versions.electron ?? null,
            node: process.versions.node ?? null
        }
    })

    /**
     * Returns the running app version string.
     * @returns {string} The Electron app version (e.g. "1.2.3").
     */
    ipcMain.handle('app:get-version', (): string => app.getVersion())

    /**
     * Shows and focuses the main window. If the window was previously maximized
     * (persisted via store), it is re-maximized after showing.
     * @returns {IpcResult} ok: true if a window was found and shown; ok: false otherwise.
     */
    ipcMain.handle('app:show-window', (event): IpcResult => {
        const win =
            getMainWindow() ??
            BrowserWindow.fromWebContents(event.sender) ??
            BrowserWindow.getAllWindows()[0]
        if (!win || win.isDestroyed()) return { ok: false }
        const wasMaximized = store.getWindowMaximized()
        revealWindow(win)
        // maximize() activates the window, which would undo the inactive reveal and
        // steal focus under e2e. The e2e run does not care about maximized geometry,
        // so skip it there. revealWindow already handled the (inactive) show.
        if (wasMaximized && !SUPPRESS_WINDOW_FOCUS) win.maximize()
        return { ok: true }
    })

    /**
     * Gracefully quits the application.
     * @returns {IpcResult} Always returns ok: true (app.quit() is called synchronously).
     */
    ipcMain.handle('app:quit', (): IpcResult => {
        app.quit()
        return { ok: true }
    })

    /**
     * Enables or disables the native 'Tools > Screenshot' menu item.
     * Called by the renderer when a device is selected or deselected.
     * @param enabled - Pass true to enable the menu item, false/undefined to disable.
     */
    ipcMain.on('menu:set-tools-screenshot-enabled', (_event, enabled: unknown) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById('tools-screenshot')
        if (item) item.enabled = enabled === true
    })
}
