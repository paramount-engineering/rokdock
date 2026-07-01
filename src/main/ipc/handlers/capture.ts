/**
 * IPC handlers for the Capture Preview (device screen streaming) subsystem.
 *
 * Manages the Capture Popout window (a frameless, always-on-top BrowserWindow for
 * floating the video stream), plus cross-window state synchronization for mute,
 * volume, mode changes, and screenshot-from-capture functionality.
 *
 * The capture stream itself runs in the renderer using browser APIs (getUserMedia
 * or similar). The main process only handles window lifecycle, preferences
 * persistence, and the frame-save flow (converting a captured frame to PNG and
 * adding it to the screenshot history).
 *
 * Mode values ('docked', 'pip', 'popout', 'screenshot-preview', 'off') determine
 * how the capture panel is displayed in the main window; 'popout' is the only
 * mode that opens a separate BrowserWindow here.
 */

import { BrowserWindow } from 'electron'
import { revealWindow, focusWindow } from '../../focusPolicy'
import { nativeWindowBg } from '../../../shared/themeData'
import { asThemeMode } from '../../utils/validation'
import { APP_ICON_PATH } from '../../utils/resourcePaths'
import { TOOLBAR_HEIGHT } from '../../../shared/toolbarConstants'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { getPreloadScriptPath } from '../../utils/preloadPath'
import { loadBundledEntryOrClose } from '../toolWindow'
import type { IpcContext, IpcResult } from '../types'
import { ipcMain } from 'electron'
import { screenshotHistoryService } from '../../services/screenshotHistory'

let capturePopoutWindow: BrowserWindow | null = null

interface PopoutConfig {
    deviceId: string
    muted: boolean
    idleTimeoutSec: number
}

/**
 * Holds the config for the next popout load. Set just before the window is
 * created so it is ready when the renderer calls capture:get-popout-config on
 * boot. Cleared once consumed.
 */
let pendingPopoutConfig: PopoutConfig | null = null

/**
 * Registers all capture subsystem IPC handlers.
 *
 * @param context - Shared IPC context providing store access and cross-window broadcast.
 */
export function registerCaptureHandlers(context: IpcContext): void {
    const { sendToAllWindows } = context

    /**
     * Opens the Capture Popout window for the specified device.
     * If the window is already open, focuses it instead of creating a new one.
     * The window is centered over the main window and sized to 960px wide at 16:9.
     * @param deviceId - The media device ID to stream in the popout.
     * @param muted - Whether the audio stream should start muted.
     * @returns {IpcResult} ok: true if the window was opened or focused successfully.
     */
    ipcMain.handle('capture:open-popout', async (_event, deviceId: string, muted: boolean): Promise<IpcResult> => {
        if (capturePopoutWindow && !capturePopoutWindow.isDestroyed()) {
            focusWindow(capturePopoutWindow)
            return { ok: true }
        }

        const preferences = context.store.getPreferences()

        // Store config before creating the window so it is available the moment
        // the renderer calls capture:get-popout-config during its boot sequence.
        pendingPopoutConfig = {
            deviceId,
            muted,
            idleTimeoutSec: preferences.captureIdleTimeoutSec ?? 3600
        }

        const iconPath = APP_ICON_PATH

        // Center on the main window
        const mainWin = BrowserWindow.getAllWindows().find(w => w !== capturePopoutWindow && !w.isDestroyed())
        const popWidth = 960
        const popHeight = Math.round(popWidth / (16 / 9)) + TOOLBAR_HEIGHT
        let x: number | undefined
        let y: number | undefined
        if (mainWin) {
            const [mx, my] = mainWin.getPosition()
            const [mw, mh] = mainWin.getSize()
            x = Math.round(mx + (mw - popWidth) / 2)
            y = Math.round(my + (mh - popHeight) / 2)
        }

        const win = new BrowserWindow({
            width: popWidth,
            height: popHeight,
            minWidth: 320,
            minHeight: 180,
            x,
            y,
            show: false,
            title: 'Capture Preview',
            frame: false,
            useContentSize: true,
            autoHideMenuBar: true,
            icon: iconPath,
            backgroundColor: nativeWindowBg(asThemeMode(context.store.getPreferences().themeMode), context.store.getPreferences().tint),
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                preload: getPreloadScriptPath()
            }
        })

        win.setAspectRatio(popWidth / popHeight)

        win.once('ready-to-show', () => {
            revealWindow(win)
        })

        win.on('closed', () => {
            capturePopoutWindow = null
            sendToAllWindows('capture:popout-closed')
        })

        // Track the window synchronously, before awaiting the load, so a second
        // open-popout call that arrives during the load sees it and focuses
        // instead of creating a duplicate window.
        capturePopoutWindow = win

        // Close the popout (clearing capturePopoutWindow via its closed handler) if
        // the bundle fails to load, so a retry opens a fresh window instead of
        // focusing a stranded blank one.
        await loadBundledEntryOrClose(win, 'capturePreview')

        return { ok: true }
    })

    /**
     * Returns the pending popout configuration set by capture:open-popout.
     * Called by the bundled renderer entry on boot to retrieve deviceId, muted
     * state, and idle-timeout threshold without requiring template injection.
     * @returns {PopoutConfig} The config for the current popout session.
     */
    ipcMain.handle('capture:get-popout-config', async (): Promise<PopoutConfig> => {
        const config = pendingPopoutConfig ?? {
            deviceId: '',
            muted: true,
            idleTimeoutSec: 3600
        }
        pendingPopoutConfig = null
        return config
    })

    /**
     * Closes the Capture Popout window if it is currently open.
     * @returns {IpcResult} Always returns ok: true.
     */
    ipcMain.handle('capture:close-popout', async (): Promise<IpcResult> => {
        if (capturePopoutWindow && !capturePopoutWindow.isDestroyed()) {
            capturePopoutWindow.close()
        }
        return { ok: true }
    })

    /**
     * Updates the Capture Popout window's enforced aspect ratio.
     * Accounts for the toolbar height so the video region itself maintains the correct ratio.
     * @param ratio - The video aspect ratio (width / height), e.g. 1.7778 for 16:9.
     * @returns {IpcResult} Always returns ok: true.
     */
    ipcMain.handle('capture:set-popout-aspect-ratio', async (_event, ratio: number): Promise<IpcResult> => {
        if (capturePopoutWindow && !capturePopoutWindow.isDestroyed()) {
            // Account for toolbar height: given the video aspect ratio,
            // compute the window aspect ratio including the toolbar
            const [w] = capturePopoutWindow.getContentSize()
            const videoHeight = Math.round(w / ratio)
            capturePopoutWindow.setAspectRatio(w / (videoHeight + TOOLBAR_HEIGHT))
        }
        return { ok: true }
    })

    /**
     * Sets the window-level opacity of the Capture Popout. Clamped to [0.1, 1].
     * @param opacity - Desired opacity in the range 0.0 to 1.0.
     * @returns {IpcResult} Always returns ok: true.
     */
    ipcMain.handle('capture:set-popout-opacity', async (_event, opacity: number): Promise<IpcResult> => {
        if (capturePopoutWindow && !capturePopoutWindow.isDestroyed()) {
            capturePopoutWindow.setOpacity(Math.max(0.1, Math.min(1, opacity)))
        }
        return { ok: true }
    })

    /**
     * Pins or unpins the Capture Popout window above all other windows.
     * @param onTop - True to enable always-on-top; false to allow normal z-ordering.
     * @returns {IpcResult} Always returns ok: true.
     */
    ipcMain.handle('capture:set-popout-always-on-top', async (_event, onTop: boolean): Promise<IpcResult> => {
        if (capturePopoutWindow && !capturePopoutWindow.isDestroyed()) {
            capturePopoutWindow.setAlwaysOnTop(onTop)
        }
        return { ok: true }
    })

    /**
     * Persists the mute state to preferences and broadcasts it to all windows.
     * @param muted - True if the capture stream should be muted.
     * @returns {IpcResult} Always returns ok: true.
     */
    ipcMain.handle('capture:sync-mute', async (_event, muted: boolean): Promise<IpcResult> => {
        context.store.setPreferences({ captureMuted: muted })
        sendToAllWindows('capture:mute-changed', muted)
        return { ok: true }
    })

    /**
     * Persists the volume level to preferences and broadcasts it to all windows.
     * @param volume - Volume level in the range 0 to 100.
     * @returns {IpcResult} Always returns ok: true.
     */
    ipcMain.handle('capture:sync-volume', async (_event, volume: number): Promise<IpcResult> => {
        context.store.setPreferences({ captureVolume: volume })
        sendToAllWindows('capture:volume-changed', volume)
        return { ok: true }
    })

    /**
     * Returns the persisted capture volume level.
     * @returns {IpcResult & { volume?: number }} ok: true with the volume (0-100); defaults to 80.
     */
    ipcMain.handle('capture:get-volume', async (): Promise<IpcResult & { volume?: number }> => {
        const preferences = context.store.getPreferences()
        return { ok: true, volume: preferences.captureVolume ?? 80 }
    })

    /**
     * Returns the persisted capture device ID (the media device selected for streaming).
     * @returns {IpcResult & { deviceId?: string | null }} ok: true with the device ID or null if not set.
     */
    ipcMain.handle('capture:get-device-id', async (): Promise<IpcResult & { deviceId?: string | null }> => {
        const preferences = context.store.getPreferences()
        return { ok: true, deviceId: preferences.captureDeviceId ?? null }
    })

    /**
     * Returns the persisted capture mute state.
     * @returns {IpcResult & { muted?: boolean }} ok: true with muted flag; defaults to true.
     */
    ipcMain.handle('capture:get-muted', async (): Promise<IpcResult & { muted?: boolean }> => {
        const preferences = context.store.getPreferences()
        return { ok: true, muted: preferences.captureMuted ?? true }
    })

    /**
     * Persists the capture display mode and broadcasts the change to all windows.
     * Valid modes: 'docked', 'pip', 'popout', 'screenshot-preview', 'off'.
     * @param mode - The new capture display mode string.
     * @returns {IpcResult} Always returns ok: true.
     */
    ipcMain.handle('capture:set-mode', async (_event, mode: string): Promise<IpcResult> => {
        context.store.setPreferences({ captureMode: mode as any })
        sendToAllWindows('capture:mode-changed', mode)
        return { ok: true }
    })

    /**
     * Saves a captured video frame (as a PNG data URL) to the screenshot history.
     * Writes the frame to a temp file, pushes it through the history pipeline, then
     * cleans up the temp file.
     * @param dataUrl - A base64 PNG data URL of the captured frame (data:image/png;base64,...).
     * @returns {IpcResult & { history?: Array<{ path: string; label: string }> }}
     *   ok: true with the updated screenshot history entries; ok: false if the data URL is invalid.
     */
    ipcMain.handle('capture:save-frame', async (_event, dataUrl: string): Promise<IpcResult & { history?: Array<{ path: string; label: string }> }> => {
        try {
            const match = dataUrl.match(/^data:image\/png;base64,(.+)$/)
            if (!match) return { ok: false }
            const buffer = Buffer.from(match[1], 'base64')
            const tmpPath = path.join(os.tmpdir(), `rokdock-capture-frame-${Date.now()}.png`)
            await fs.writeFile(tmpPath, buffer)
            const { screenshotFolder, screenshotNamingFormat } = context.store.getPreferences()
            screenshotHistoryService.push(tmpPath, 'png', { folder: screenshotFolder, namingFormat: screenshotNamingFormat })
            await fs.unlink(tmpPath).catch(() => {})
            return { ok: true, history: screenshotHistoryService.getEntries() }
        } catch {
            return { ok: false }
        }
    })
}
