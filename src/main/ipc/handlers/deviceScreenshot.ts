/**
 * IPC handlers for the screenshot capture and viewer subsystem.
 *
 * Manages the screenshot workflow:
 *  - Trigger a screenshot capture on a Roku device via /plugin_inspect (Digest auth)
 *  - Open and manage the Screenshot Viewer window (screenshot-preview-shell)
 *  - Maintain a recent screenshot history (max 20 entries) with quick-access thumbnails
 *  - Support onion-skin comparison overlays for design review
 *  - Auto-refresh the screenshot at configurable intervals
 *
 * Screenshot files are saved to the user's configured folder (or userData/screenshots)
 * with timestamp-based naming. History entries persist across sessions via a JSON index
 * file in the same folder.
 *
 * The screenshot viewer window is a frameless BrowserWindow that loads a generated
 * HTML template with the screenshot URL and device info embedded.
 */

import { BrowserWindow, ipcMain } from 'electron'
import { focusWindow } from '../../focusPolicy'
import fs from 'fs'
import { ROKU_DEV_APP_ID } from '../../constants/preview'
import { captureRokuScreenshot, queryActiveApp } from '../../utils/screenshot'
import { isNonEmptyString } from '../../utils/validation'
import { mountScreenshotPreviewShell, registerScreenshotPreviewHandlers } from './screenshotPreviewShell'
import type { IpcContext, IpcResult } from '../types'
import { screenshotHistoryService } from '../../services/screenshotHistory'

/**
 * Looks up stored Digest auth credentials for a device by its IP address.
 * @param store - The persistent settings store.
 * @param ip - The device's IP address.
 * @returns The username/password pair, or null if no credentials are stored.
 */
function readStoredCredentialsByIp(store: IpcContext['store'], ip: string) {
    const entry = store.getDeviceAuth(ip)
    if (!entry) return null
    return { user: entry.username, password: entry.password }
}

let screenshotPreviewWindow: BrowserWindow | null = null

const setScreenshotPreviewWindow = (w: BrowserWindow | null) => {
    screenshotPreviewWindow = w
}
export const getScreenshotPreviewWindow = () => screenshotPreviewWindow

/**
 * Registers all device screenshot IPC handlers and initializes the screenshot history.
 *
 * @param context - Shared IPC context providing SSDP, store, and window helpers.
 */
export function registerDeviceScreenshotHandlers(context: IpcContext): void {
    screenshotHistoryService.load()
    registerScreenshotPreviewHandlers()
    const { ssdp, store } = context

    /**
     * Queries the ECP /query/active-app endpoint to find out which app is currently running.
     * @param deviceIp - The IP address of the Roku device.
     * @returns An object with the active app's id and name; returns empty strings on error.
     */
    ipcMain.handle('device:get-active-app', async (_event, deviceIp: string): Promise<{ id: string; name: string }> => {
        if (!isNonEmptyString(deviceIp)) return { id: '', name: '' }
        return queryActiveApp(deviceIp.trim())
    })

    /**
     * Opens the Screenshot Preview window for the specified device without triggering
     * a new capture. Shows the most recent screenshot from history, or the empty
     * placeholder if no history exists.
     * @param deviceIp - The IP address of the target Roku device.
     * @param themeMode - Optional theme hint ('dark' | 'light') for the preview window background.
     * @returns {IpcResult} ok: true if the window was opened or focused; ok: false with error on failure.
     */
    ipcMain.handle('device:open-screenshot-window', async (event, deviceIp: string, themeMode?: 'dark' | 'light'): Promise<IpcResult> => {
        if (!isNonEmptyString(deviceIp)) {
            return { ok: false, error: 'No device selected.' }
        }
        const ip = deviceIp.trim()
        if (screenshotPreviewWindow && !screenshotPreviewWindow.isDestroyed()) {
            focusWindow(screenshotPreviewWindow)
            return { ok: true }
        }
        const device = ssdp.getDevices().find((device) => device.ip === ip)
        const nicknames = store.getDeviceNicknames()
        const displayName = (nicknames[ip]?.trim() || device?.name?.trim() || 'Roku')
        const screenshotTitle = `${displayName} (${ip}) - Screenshot`
        const preferences = store.getPreferences()
        const sourceZoomLevel = event.sender.getZoomLevel()
        const creds = readStoredCredentialsByIp(store, ip)
        screenshotHistoryService.reload(preferences.screenshotFolder)
        const screenshotHistory = screenshotHistoryService.getArray()
        const lastEntry = screenshotHistory.length > 0 ? screenshotHistory[screenshotHistory.length - 1]! : null
        const tempPath = lastEntry && fs.existsSync(lastEntry.path) ? lastEntry.path : ''
        try {
            return await mountScreenshotPreviewShell({
                context,
                ip,
                screenshotTitle,
                sourceZoomLevel,
                creds,
                tempPath,
                pathsToDeleteOnClose: [],
                setScreenshotPreviewWindow,
                getScreenshotPreviewWindow
            })
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : 'Failed to open screenshot window.' }
        }
    })

    /**
     * Captures a screenshot from the Roku device and opens (or refreshes) the
     * Screenshot Preview window. Requires the "dev" app to be active and valid
     * Digest auth credentials to be stored for the device.
     * If the preview window is already open, sends a trigger-refresh message
     * instead of creating a new window.
     * @param deviceIp - The IP address of the target Roku device.
     * @param themeMode - Optional theme hint ('dark' | 'light') for the preview window background.
     * @returns {IpcResult} ok: true on success; ok: false with an error message on failure.
     */
    ipcMain.handle('device:capture-screenshot', async (event, deviceIp: string, themeMode?: 'dark' | 'light'): Promise<IpcResult> => {
        if (!isNonEmptyString(deviceIp)) {
            return { ok: false, error: 'No device selected.' }
        }
        const ip = deviceIp.trim()
        const device = ssdp.getDevices().find((device) => device.ip === ip)
        const nicknames = store.getDeviceNicknames()
        const displayName = (nicknames[ip]?.trim() || device?.name?.trim() || 'Roku')
        const screenshotTitle = `${displayName} (${ip}) - Screenshot`
        const sourceZoomLevel = event.sender.getZoomLevel()
        const active = await queryActiveApp(ip)
        if (active.id !== ROKU_DEV_APP_ID) {
            return { ok: false, error: 'Screenshot is only available when the active app is "dev".' }
        }
        const creds = readStoredCredentialsByIp(store, ip)
        if (!creds) {
            return { ok: false, error: 'No device credentials found. Configure username/password in device settings.' }
        }

        try {
            if (screenshotPreviewWindow && !screenshotPreviewWindow.isDestroyed()) {
                focusWindow(screenshotPreviewWindow)
                screenshotPreviewWindow.webContents.send('screenshot-preview:message', { type: 'trigger-refresh' })
                return { ok: true }
            }

            const preferences = store.getPreferences()
            screenshotHistoryService.reload(preferences.screenshotFolder)
            const screenshotHistory = screenshotHistoryService.getArray()
            const lastEntry = screenshotHistory.length > 0 ? screenshotHistory[screenshotHistory.length - 1]! : null
            const tempPath = lastEntry && fs.existsSync(lastEntry.path) ? lastEntry.path : ''

            return await mountScreenshotPreviewShell({
                context,
                ip,
                screenshotTitle,
                sourceZoomLevel,
                creds,
                tempPath,
                pathsToDeleteOnClose: [],
                setScreenshotPreviewWindow,
                getScreenshotPreviewWindow,
                autoRefresh: true
            })
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : 'Screenshot failed.' }
        }
    })
}
