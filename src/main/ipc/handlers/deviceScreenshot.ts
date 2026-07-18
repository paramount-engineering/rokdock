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

import { BrowserWindow, ipcMain, nativeImage } from 'electron'
import { focusWindow } from '../../focusPolicy'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ROKU_DEV_APP_ID } from '../../constants/preview'
import { captureRokuScreenshot, queryActiveApp } from '../../utils/screenshot'
import { isNonEmptyString } from '../../utils/validation'
import { mountScreenshotPreviewShell, registerScreenshotPreviewHandlers } from './screenshotPreviewShell'
import type { IpcContext, IpcResult } from '../types'
import { screenshotHistoryService, createHistoryThumbnail } from '../../services/screenshotHistory'

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

/** Max dimension of the inline chat thumbnail for an AI-captured screenshot. */
const CHAT_THUMBNAIL_MAX = 240

/**
 * Shared precondition check for a device screenshot: the sideloaded "dev" channel must be the
 * active app and Digest credentials must be stored. Returns the credentials or an error message.
 */
async function validateScreenshotPreconditions(context: IpcContext, ip: string): Promise<{ creds: { user: string; password: string } } | { error: string }> {
    const active = await queryActiveApp(ip)
    if (active.id !== ROKU_DEV_APP_ID) {
        return { error: 'Screenshot is only available when the active app is "dev".' }
    }
    const creds = readStoredCredentialsByIp(context.store, ip)
    if (!creds) {
        return { error: 'No device credentials found. Configure username/password in device settings.' }
    }
    return { creds }
}

/** A captured frame shown inline in the chat: a small JPEG thumbnail plus the saved history path. */
type ChatCapture = { ok: true; thumbnailDataUrl: string; filePath: string } | { ok: false; error: string }

/**
 * Push a captured frame's temp file into the screenshot history and build the inline-chat thumbnail.
 * The saved history copy (not the temp source) is what a later click opens. The caller removes the
 * temp file. Shared by the native and HDMI-fallback capture paths so their persist logic can't drift.
 */
function persistFrameToHistory(context: IpcContext, tempPath: string, extension: 'png' | 'jpg'): ChatCapture {
    const { screenshotFolder, screenshotNamingFormat } = context.store.getPreferences()
    screenshotHistoryService.reload(screenshotFolder)
    screenshotHistoryService.push(tempPath, extension, { folder: screenshotFolder, namingFormat: screenshotNamingFormat })
    const entries = screenshotHistoryService.getArray()
    const savedPath = entries.length > 0 ? entries[entries.length - 1]!.path : tempPath
    const thumb = createHistoryThumbnail(tempPath, CHAT_THUMBNAIL_MAX)
    if (!thumb) return { ok: false, error: 'Screenshot could not be read.' }
    return { ok: true, thumbnailDataUrl: `data:image/jpeg;base64,${thumb.toJPEG(80).toString('base64')}`, filePath: savedPath }
}

/** Native ECP screenshot into the history. Requires the sideloaded "dev" channel and stored auth. */
async function captureNativeToHistory(context: IpcContext, ip: string): Promise<ChatCapture> {
    const validated = await validateScreenshotPreconditions(context, ip)
    if ('error' in validated) return { ok: false, error: validated.error }
    let tempPath: string | null = null
    try {
        const capture = await captureRokuScreenshot(ip, validated.creds, os.tmpdir())
        tempPath = capture.filePath
        if (!fs.existsSync(capture.filePath)) return { ok: false, error: 'Screenshot file was not created.' }
        return persistFrameToHistory(context, capture.filePath, capture.extension === 'png' ? 'png' : 'jpg')
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Screenshot failed.' }
    } finally {
        // push() copies into the history folder, so the temp source is safe to remove.
        if (tempPath) { try { fs.unlinkSync(tempPath) } catch { /* best-effort */ } }
    }
}

/**
 * Ask the live HDMI capture stream (whichever window holds it: dock, popout, or screenshot preview)
 * for one frame as a PNG data URL. The request is broadcast to every window; windows without a live
 * frame reply with '' and are ignored, so the first window with an actual frame wins. Resolves null
 * if no window answers with a frame before the timeout (no capture preview is running).
 */
function requestCaptureFrame(context: IpcContext, timeoutMs = 2500): Promise<string | null> {
    return new Promise(resolve => {
        const requestId = crypto.randomUUID()
        let timer: ReturnType<typeof setTimeout>
        const onGrabbed = (_event: unknown, id: string, dataUrl: string): void => {
            // Ignore replies for other requests and empty replies from windows with no live frame,
            // so a not-yet-ready stream cannot shadow another window that does have a frame.
            if (id !== requestId || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) return
            clearTimeout(timer)
            ipcMain.removeListener('capture:frame-grabbed', onGrabbed)
            resolve(dataUrl)
        }
        ipcMain.on('capture:frame-grabbed', onGrabbed)
        context.sendToAllWindows('capture:grab-frame', requestId)
        timer = setTimeout(() => {
            ipcMain.removeListener('capture:frame-grabbed', onGrabbed)
            resolve(null)
        }, timeoutMs)
    })
}

/** Grab a frame from the live HDMI capture preview (if running) and save it to the history. */
async function captureHdmiToHistory(context: IpcContext): Promise<ChatCapture> {
    const dataUrl = await requestCaptureFrame(context)
    if (!dataUrl) return { ok: false, error: 'The HDMI capture preview is not running, so no fallback screenshot is available.' }
    const match = dataUrl.match(/^data:image\/png;base64,(.+)$/)
    if (!match) return { ok: false, error: 'Could not read the captured frame.' }
    const tempPath = path.join(os.tmpdir(), `rokdock-hdmi-frame-${Date.now()}.png`)
    try {
        fs.writeFileSync(tempPath, Buffer.from(match[1], 'base64'))
        return persistFrameToHistory(context, tempPath, 'png')
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Fallback capture failed.' }
    } finally {
        try { fs.unlinkSync(tempPath) } catch { /* best-effort */ }
    }
}

/**
 * Capture a screenshot to show inline in the chat, WITHOUT opening the preview window. Prefers the
 * native ECP capture (dev channel only) and falls back to a frame from the live HDMI capture preview
 * when native is unavailable. `viaHdmiCapture` is true when the HDMI fallback was used, so the caller
 * can note the caveat. Used by the roBot capture_screenshot tool (a click then opens the saved file).
 */
export async function captureDeviceScreenshotForChat(context: IpcContext, ip: string): Promise<ChatCapture & { viaHdmiCapture?: boolean }> {
    const native = await captureNativeToHistory(context, ip)
    if (native.ok) return native
    const fallback = await captureHdmiToHistory(context)
    if (fallback.ok) return { ...fallback, viaHdmiCapture: true }
    // Both paths failed. Prefer the native precondition message but note the fallback was tried.
    return { ok: false, error: `${native.error} The HDMI capture fallback was also unavailable.` }
}

/**
 * Captures a screenshot from the device and opens (or refreshes) the Screenshot Preview
 * window. Requires the sideloaded "dev" channel to be the active app and stored Digest auth.
 * Shared by the `device:capture-screenshot` IPC handler and the AI device-control tool.
 *
 * @param context - Shared IPC context (ssdp, store, window helpers).
 * @param ip - Target Roku IP address.
 * @param sourceZoomLevel - Zoom level to seed the preview window with.
 * @returns ok: true on success (window opened or refreshed); ok: false with an error otherwise.
 */
async function captureDeviceScreenshot(context: IpcContext, ip: string, sourceZoomLevel: number): Promise<IpcResult> {
    const { ssdp, store } = context
    const device = ssdp.getDevices().find((device) => device.ip === ip)
    const nicknames = store.getDeviceNicknames()
    const displayName = (nicknames[ip]?.trim() || device?.name?.trim() || 'Roku')
    const screenshotTitle = `${displayName} (${ip}) - Screenshot`
    const validated = await validateScreenshotPreconditions(context, ip)
    if ('error' in validated) return { ok: false, error: validated.error }
    const creds = validated.creds
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
            context, ip, screenshotTitle, sourceZoomLevel, creds, tempPath,
            pathsToDeleteOnClose: [], setScreenshotPreviewWindow, getScreenshotPreviewWindow, autoRefresh: true,
        })
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Screenshot failed.' }
    }
}

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
     * @param _themeMode - Optional theme hint (unused; the window resolves its own theme).
     * @param initialPath - Optional specific screenshot to show (e.g. the one clicked in chat); falls back to the latest.
     * @returns {IpcResult} ok: true if the window was opened or focused; ok: false with error on failure.
     */
    ipcMain.handle('device:open-screenshot-window', async (event, deviceIp: string, _themeMode?: 'dark' | 'light', initialPath?: string): Promise<IpcResult> => {
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
        const tempPath = (initialPath && fs.existsSync(initialPath))
            ? initialPath
            : (lastEntry && fs.existsSync(lastEntry.path) ? lastEntry.path : '')
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
    ipcMain.handle('device:capture-screenshot', async (event, deviceIp: string, _themeMode?: 'dark' | 'light'): Promise<IpcResult> => {
        if (!isNonEmptyString(deviceIp)) {
            return { ok: false, error: 'No device selected.' }
        }
        return captureDeviceScreenshot(context, deviceIp.trim(), event.sender.getZoomLevel())
    })
}
