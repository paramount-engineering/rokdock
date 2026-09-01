/**
 * Screenshot Preview tool window - BrowserWindow lifecycle and IPC handlers.
 *
 * Manages the full-featured screenshot viewer window (zoom, onion-skin overlay
 * comparison, auto-refresh, pixel measure, and live capture-device feed). The
 * window is a standalone bundled renderer entry (src/renderer/screenshotPreview).
 *
 * Three IPC flows, all defined in shared/screenshotPreviewProtocol:
 *  - a one-time initial-data pull on boot (screenshot-preview:get-initial-data),
 *  - typed action invokes from the renderer to main (refresh/save/copy/overlay/prefs),
 *  - typed messages pushed from main to the renderer (screenshot-preview:message),
 *    plus a renderer-to-main state push so the right-click menu reflects the live UI.
 *
 * All image payloads are `data:` URLs: the renderer runs under a tight CSP and
 * never receives a file:// URL. The handlers are registered once at startup and
 * operate on the single `activeSession`, which mountScreenshotPreviewShell sets
 * up per open and onClosed tears down.
 *
 * Onion-skin overlays:
 *  - Users pick PNG/JPG files to blend over the screenshot for design comparison.
 *  - Picked files are copied to a persistent userData folder (onion-overlay-persist.ts)
 *    so overlay history survives file moves/deletes.
 *  - Built-in overlays ('rokdock-builtin:<id>') are bitmaps embedded in the binary.
 *  - History is kept (max 20) in AppPreferences.screenshotOnionOverlayHistory.
 */

import { BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage } from 'electron'
import { focusWindow } from '../../focusPolicy'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
    AUTO_REFRESH_INTERVALS_SEC,
    ROKU_DEV_APP_ID,
    SCREENSHOT_PREVIEW_HEIGHT,
    SCREENSHOT_PREVIEW_MIN_HEIGHT,
    SCREENSHOT_PREVIEW_MIN_WIDTH,
    SCREENSHOT_PREVIEW_WIDTH
} from '../../constants/preview'
import { createToolWindow, loadBundledEntryOrClose } from '../toolWindow'
import {
    BUILTIN_OVERLAY_MENU,
    builtinOverlayDataUrl,
    type BuiltinOverlayDimensions,
    isBuiltinOverlayRef
} from '../../constants/onionOverlays'
import { captureRokuScreenshot, queryActiveApp } from '../../utils/screenshot'
import {
    deletePersistedOnionFileIfOwned,
    isPathUnderOnionPersistDir,
    persistOnionOverlayFile
} from '../../utils/onionOverlayPersist'
import { clampInt, normalizeAutoRefreshIntervalSec } from '../../utils/validation'
import { dataUrlToBuffer, fileToDataUrl } from '../../utils/dataUrl'
import {
    createHistoryThumbnail,
    formatHistoryLabel,
    screenshotHistoryService
} from '../../services/screenshotHistory'
import type { StoreService } from '../../services/store'
import type { IpcContext, IpcResult } from '../types'
import type {
    OnionOverlayMenuEntryForPreview,
    ScreenshotHistoryEntryForPreview,
    ScreenshotPreviewImageResult,
    ScreenshotPreviewInitialData,
    ScreenshotPreviewMessage,
    ScreenshotPreviewPrefs,
    ScreenshotPreviewState
} from '../../../shared/screenshotPreviewProtocol'

const MAX_ONION_OVERLAY_HISTORY = 20

/**
 * The live state of one open preview window. The handlers (registered once) and
 * the menu builders all operate on the single activeSession; mountScreenshotPreviewShell
 * sets it and onClosed clears it.
 */
interface PreviewSession {
    preview: BrowserWindow
    context: IpcContext
    ip: string
    creds: { user: string; password: string } | null
    title: string
    /** The file currently shown (used by copy/save). An fs path, '' when none. */
    displayedPath: string
    /** The latest captured temp file. An fs path, '' when none. */
    tempPath: string
    /** Temp capture files to delete on close - never includes persistent history paths. */
    createdTempFiles: Set<string>
    refreshInFlight: boolean
    /** True until the first initial-data pull when opened via capture-screenshot. */
    autoRefreshOnLoad: boolean
    /** Last UI state pushed by the renderer, read when building the right-click menu. */
    rendererState: ScreenshotPreviewState
}

let activeSession: PreviewSession | null = null

// -- Pure-ish store/overlay helpers (independent of a session) -------------------

/**
 * Removes stale or built-in entries from the persisted onion overlay history.
 * Built-in refs are excluded (they are shown under a separate UI group, not Recent).
 * File paths that no longer exist on disk are also removed.
 * Writes back to the store only if the list changed.
 */
function pruneOnionOverlayHistoryInStore(store: StoreService): void {
    const preferences = store.getPreferences()
    const raw = preferences.screenshotOnionOverlayHistory ?? []
    const pruned: string[] = []
    for (const ref of raw) {
        if (!ref || typeof ref !== 'string') continue
        // Built-ins are only under "Built-in" in the UI - never persist as Recent.
        if (isBuiltinOverlayRef(ref)) continue
        if (fs.existsSync(ref)) {
            pruned.push(ref)
        }
    }
    const limited = pruned.slice(0, MAX_ONION_OVERLAY_HISTORY)
    const prevKey = (Array.isArray(raw) ? raw : []).join('\0')
    if (limited.join('\0') !== prevKey) {
        store.setPreferences({ screenshotOnionOverlayHistory: limited })
    }
}

/**
 * Reads the pixel dimensions of a screenshot file, used to select the correct
 * resolution variant of a built-in overlay (1080p vs 720p).
 * @returns The image dimensions, or undefined if the file cannot be read.
 */
function readScreenshotDimensionsForBuiltinOverlay(filePath: string): BuiltinOverlayDimensions | undefined {
    if (!filePath || !fs.existsSync(filePath)) return undefined
    try {
        const img = nativeImage.createFromPath(filePath)
        if (img.isEmpty()) return undefined
        const { width, height } = img.getSize()
        if (width > 0 && height > 0) return { width, height }
    } catch {
        // best-effort
    }
    return undefined
}

/**
 * Resolves an overlay ref to a displayable `data:` URL for an <img> tag.
 * Built-in refs produce embedded-bitmap data URLs; file refs are read from disk.
 * @returns A `data:` URL, or null if the file no longer exists.
 */
function resolveOnionDisplayDataUrl(ref: string, dimensions?: BuiltinOverlayDimensions | null): string | null {
    if (isBuiltinOverlayRef(ref)) {
        return builtinOverlayDataUrl(ref, dimensions ?? undefined)
    }
    return fileToDataUrl(ref)
}

/**
 * Caches downscaled thumbnails by file path. A given path is an immutable image
 * (history dedups by content), so the decode+resize is done once and reused by
 * the history panel, the overlay menus, and the right-click menu (which would
 * otherwise re-decode up to 20 files on every open). Cleared when the window closes.
 */
const thumbnailCache = new Map<string, Electron.NativeImage | undefined>()

function cachedThumbnail(filePath: string): Electron.NativeImage | undefined {
    if (thumbnailCache.has(filePath)) return thumbnailCache.get(filePath)
    const thumb = createHistoryThumbnail(filePath)
    thumbnailCache.set(filePath, thumb)
    return thumb
}

/** A small `data:` URL thumbnail for an overlay ref (built-in bitmap or downscaled file). */
function overlayThumbnailDataUrl(ref: string): string {
    if (isBuiltinOverlayRef(ref)) {
        return builtinOverlayDataUrl(ref) ?? ''
    }
    return cachedThumbnail(ref)?.toDataURL() ?? ''
}

/**
 * Ensures a file-based overlay reference points to the canonical persisted copy.
 * If the file is not already under the onion persist directory, copies it there.
 * Built-in refs are returned unchanged.
 */
function canonicalizeFileOverlayRef(ref: string): string {
    if (isBuiltinOverlayRef(ref)) return ref
    if (!fs.existsSync(ref)) return ref
    if (isPathUnderOnionPersistDir(ref)) return ref
    const { path: persisted, copied } = persistOnionOverlayFile(ref)
    return copied ? persisted : ref
}

/**
 * Prepends a new overlay ref to the persisted history, deduplicates, and trims to the max.
 * Any entries beyond MAX_ONION_OVERLAY_HISTORY are removed from the persist directory.
 * Built-in refs are never added to the history list.
 * @param options.removeSecondaryPath - An additional path to remove (e.g. pre-canonical version).
 */
function pushOnionOverlayHistory(
    store: StoreService,
    ref: string,
    options?: { removeSecondaryPath?: string }
): void {
    if (isBuiltinOverlayRef(ref)) {
        return
    }
    const preferences = store.getPreferences()
    let cur = [...(preferences.screenshotOnionOverlayHistory ?? [])]
    if (options?.removeSecondaryPath) {
        cur = cur.filter((histRef) => histRef !== options.removeSecondaryPath)
    }
    const withoutDup = cur.filter((histRef) => histRef !== ref)
    const combined = [ref, ...withoutDup]
    const next = combined.slice(0, MAX_ONION_OVERLAY_HISTORY)
    const dropped = combined.slice(MAX_ONION_OVERLAY_HISTORY)
    for (const droppedRef of dropped) {
        deletePersistedOnionFileIfOwned(droppedRef)
    }
    store.setPreferences({ screenshotOnionOverlayHistory: next })
}

// -- Entry builders (data: URLs for the renderer) --------------------------------

/** Builds the screenshot history as preview entries (newest first, with thumbnails). */
function buildHistoryEntries(): ScreenshotHistoryEntryForPreview[] {
    return [...screenshotHistoryService.getArray()].reverse().map((entry) => ({
        path: entry.path,
        label: formatHistoryLabel(entry.timestamp),
        thumbnailDataUrl: cachedThumbnail(entry.path)?.toDataURL() ?? ''
    }))
}

/** Builds the built-in overlay menu entries for the preview. */
function buildOnionBuiltinEntries(): OnionOverlayMenuEntryForPreview[] {
    return BUILTIN_OVERLAY_MENU.map((builtinEntry) => ({
        ref: builtinEntry.ref,
        label: builtinEntry.label,
        thumbnailDataUrl: overlayThumbnailDataUrl(builtinEntry.ref)
    }))
}

/** Prunes then builds the recent (file) overlay history entries for the preview. */
function buildOnionOverlayHistoryEntries(store: StoreService): OnionOverlayMenuEntryForPreview[] {
    pruneOnionOverlayHistoryInStore(store)
    const list = store.getPreferences().screenshotOnionOverlayHistory ?? []
    return list.map((ref) => ({
        ref,
        label: path.basename(ref),
        thumbnailDataUrl: overlayThumbnailDataUrl(ref)
    }))
}

// -- Session-scoped helpers ------------------------------------------------------

/** Posts a typed message to the preview renderer (no-op if the window is gone). */
function postMessage(session: PreviewSession, message: ScreenshotPreviewMessage): void {
    if (!session.preview.isDestroyed()) {
        session.preview.webContents.send('screenshot-preview:message', message)
    }
}

/** Posts a status toast string to the preview renderer. */
function postStatus(session: PreviewSession, text: string): void {
    postMessage(session, { type: 'status', text })
}

/** True if a path is a persisted history file (a temp must not be cleaned up if it is one). */
function isKnownHistoryPath(filePath: string): boolean {
    const resolved = path.resolve(filePath)
    return screenshotHistoryService.getArray().some((e) => path.resolve(e.path) === resolved)
}

/** True if a path is one we are allowed to read and serve (a known screenshot or overlay). */
function isServeableImagePath(filePath: string): boolean {
    return isKnownHistoryPath(filePath) || isPathUnderOnionPersistDir(path.resolve(filePath))
}

/** Copies a screenshot file to the clipboard as an image, reporting status. */
function copyScreenshotFileToClipboard(session: PreviewSession, filePath: string): void {
    try {
        if (!filePath || !fs.existsSync(filePath)) {
            postStatus(session, 'No screenshot file available to copy.')
            return
        }
        const img = nativeImage.createFromPath(filePath)
        if (img.isEmpty()) {
            postStatus(session, 'Failed to load image for clipboard.')
            return
        }
        clipboard.writeImage(img)
        postStatus(session, 'Copied screenshot (no overlay)')
    } catch (err) {
        postStatus(session, err instanceof Error ? err.message : 'Failed to copy to clipboard.')
    }
}

// -- Action runners (invoked by IPC channels and menu items) ---------------------

/**
 * Captures a fresh screenshot from the device and updates the preview window.
 * Skips if a refresh is already in flight. Validates that the "dev" app is active,
 * pushes the new screenshot into history, and posts image-updated/history-updated.
 * @param isAutoRefresh - True when called by the auto-refresh timer (affects the
 *   message sent when the dev app is not running).
 */
async function runRefresh(session: PreviewSession, isAutoRefresh: boolean): Promise<void> {
    if (session.refreshInFlight) return
    session.refreshInFlight = true
    try {
        if (!session.creds) {
            postStatus(session, 'Add device credentials in Settings to capture or refresh screenshots.')
            return
        }
        const currentActive = await queryActiveApp(session.ip)
        if (currentActive.id !== ROKU_DEV_APP_ID) {
            if (isAutoRefresh) {
                postMessage(session, { type: 'auto-refresh-disabled', message: 'Auto-refresh paused (dev app not running)' })
            } else {
                postStatus(session, 'Refresh unavailable: active app is not "dev".')
            }
            return
        }
        const nextCapture = await captureRokuScreenshot(session.ip, session.creds, os.tmpdir())
        if (!fs.existsSync(nextCapture.filePath)) {
            postStatus(session, 'Refresh failed: screenshot file was not created.')
            return
        }
        const dataUrl = fileToDataUrl(nextCapture.filePath)
        if (!dataUrl) {
            postStatus(session, 'Refresh failed: could not read screenshot.')
            return
        }
        const oldTempPath = session.tempPath
        session.tempPath = nextCapture.filePath
        session.displayedPath = session.tempPath
        session.createdTempFiles.add(session.tempPath)
        const { screenshotFolder, screenshotNamingFormat } = session.context.store.getPreferences()
        const { changed: historyChanged } = screenshotHistoryService.push(
            session.tempPath,
            nextCapture.extension === 'png' ? 'png' : 'jpg',
            { folder: screenshotFolder, namingFormat: screenshotNamingFormat }
        )
        if (historyChanged) {
            postMessage(session, { type: 'history-updated', entries: buildHistoryEntries() })
        }
        postMessage(session, { type: 'image-updated', imageDataUrl: dataUrl })
        if (
            oldTempPath && oldTempPath !== session.tempPath &&
            fs.existsSync(oldTempPath) && !isKnownHistoryPath(oldTempPath)
        ) {
            try { fs.unlinkSync(oldTempPath) } catch { /* best-effort */ }
        }
    } catch (refreshErr) {
        postStatus(session, refreshErr instanceof Error ? refreshErr.message : 'Failed to refresh screenshot.')
    } finally {
        session.refreshInFlight = false
    }
}

/** Saves the currently displayed screenshot file via a native Save dialog. */
async function runSave(session: PreviewSession): Promise<void> {
    try {
        const pathToSave = session.displayedPath
        if (!pathToSave || !fs.existsSync(pathToSave)) {
            postStatus(session, 'No screenshot file available to save.')
            return
        }
        const ext = path.extname(pathToSave).toLowerCase().replace(/^\./, '') || 'png'
        const extension = ext === 'jpg' || ext === 'jpeg' ? 'jpg' : 'png'
        const filter = extension === 'png'
            ? { name: 'PNG Image', extensions: ['png'] }
            : { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }
        const saveResult = await dialog.showSaveDialog(session.preview, {
            defaultPath: `roku-screenshot-${Date.now()}.${extension}`,
            filters: [filter, { name: 'All Files', extensions: ['*'] }]
        })
        if (saveResult.canceled || !saveResult.filePath) return
        fs.copyFileSync(pathToSave, saveResult.filePath)
        postStatus(session, `Saved to ${saveResult.filePath}`)
    } catch (saveErr) {
        postStatus(session, saveErr instanceof Error ? saveErr.message : 'Failed to save screenshot.')
    }
}

/** Validates a renderer-supplied composite data URL and decodes it, reporting on failure. */
function decodeCompositeImage(session: PreviewSession, compositeDataUrl: string): Buffer | null {
    if (!compositeDataUrl.startsWith('data:image')) {
        postStatus(session, 'Could not build composite image.')
        return null
    }
    return dataUrlToBuffer(compositeDataUrl)
}

/** Saves a renderer-composited image (screenshot + overlay) via a native Save dialog. */
async function runSaveImage(session: PreviewSession, compositeDataUrl: string): Promise<void> {
    try {
        const buf = decodeCompositeImage(session, compositeDataUrl)
        if (!buf) return
        const saveResult = await dialog.showSaveDialog(session.preview, {
            defaultPath: `roku-screenshot-composite-${Date.now()}.png`,
            filters: [{ name: 'PNG Image', extensions: ['png'] }, { name: 'All Files', extensions: ['*'] }]
        })
        if (saveResult.canceled || !saveResult.filePath) return
        fs.writeFileSync(saveResult.filePath, buf)
        postStatus(session, `Saved to ${saveResult.filePath}`)
    } catch (err) {
        postStatus(session, err instanceof Error ? err.message : 'Failed to save composite screenshot.')
    }
}

/** Writes a renderer-composited image (screenshot + overlay) to the clipboard. */
function runCopyImage(session: PreviewSession, compositeDataUrl: string): void {
    try {
        const buf = decodeCompositeImage(session, compositeDataUrl)
        if (!buf) return
        const img = nativeImage.createFromBuffer(buf)
        if (img.isEmpty()) {
            postStatus(session, 'Failed to load composite for clipboard.')
            return
        }
        clipboard.writeImage(img)
        postStatus(session, 'Copied screenshot with overlay')
    } catch (e) {
        postStatus(session, e instanceof Error ? e.message : 'Failed to copy with overlay.')
    }
}

/** Opens a file picker for a comparison overlay, then applies and records it. */
async function runOnionPick(session: PreviewSession): Promise<void> {
    const store = session.context.store
    try {
        const pick = await dialog.showOpenDialog(session.preview, {
            title: 'Comparison overlay (design mockup)',
            properties: ['openFile'],
            filters: [
                { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        })
        if (pick.canceled || !pick.filePaths[0]) return
        const filePath = pick.filePaths[0]
        const dataUrl = fileToDataUrl(filePath)
        if (!dataUrl) {
            postStatus(session, 'Could not open comparison image.')
            return
        }
        pushOnionOverlayHistory(store, filePath)
        postMessage(session, { type: 'set-onion', dataUrl })
        postMessage(session, { type: 'onion-history-updated', entries: buildOnionOverlayHistoryEntries(store) })
    } catch {
        postStatus(session, 'Could not open comparison image.')
    }
}

/** Applies a built-in or recent overlay by its ref, canonicalizing file refs. */
function runOnionApply(session: PreviewSession, ref: string): void {
    const store = session.context.store
    try {
        if (!ref) return
        const canonical = canonicalizeFileOverlayRef(ref)
        const dims = readScreenshotDimensionsForBuiltinOverlay(session.displayedPath)
        const dataUrl = resolveOnionDisplayDataUrl(canonical, dims)
        if (!dataUrl) {
            postStatus(session, 'That overlay is no longer available.')
            postMessage(session, { type: 'onion-history-updated', entries: buildOnionOverlayHistoryEntries(store) })
            return
        }
        pushOnionOverlayHistory(store, canonical, {
            removeSecondaryPath: canonical !== ref ? ref : undefined
        })
        postMessage(session, { type: 'set-onion', dataUrl })
        postMessage(session, { type: 'onion-history-updated', entries: buildOnionOverlayHistoryEntries(store) })
    } catch {
        postStatus(session, 'Could not apply overlay.')
    }
}

// -- Menus -----------------------------------------------------------------------

/**
 * Builds and shows the native right-click menu for the preview. Reads the live UI
 * state from session.rendererState (pushed by the renderer) so item enabled/checked
 * flags match the window without an executeJavaScript round-trip.
 */
function buildPreviewContextMenu(session: PreviewSession, params: Electron.ContextMenuParams): void {
    const { autoRefreshEnabled, autoRefreshIntervalSec, overlayActive, captureActive } = session.rendererState
    const template: Electron.MenuItemConstructorOptions[] = [
        {
            label: 'Load comparison overlay...',
            click: () => { void runOnionPick(session) }
        },
        {
            label: 'Clear comparison overlay',
            enabled: overlayActive,
            click: () => postMessage(session, { type: 'clear-onion' })
        },
        { type: 'separator' },
        {
            label: 'Copy screenshot (no overlay)',
            enabled: !captureActive,
            click: () => copyScreenshotFileToClipboard(session, session.displayedPath)
        },
        {
            label: 'Copy screenshot with overlay',
            enabled: !captureActive && overlayActive,
            click: () => postMessage(session, { type: 'trigger-copy-with-overlay' })
        },
        { type: 'separator' },
        {
            label: 'Refresh',
            click: () => postMessage(session, { type: 'trigger-refresh' })
        },
        {
            label: 'Save',
            click: () => postMessage(session, { type: 'trigger-save' })
        },
        {
            label: 'Save with overlay',
            enabled: !captureActive && overlayActive,
            click: () => postMessage(session, { type: 'trigger-save-with-overlay' })
        },
        { type: 'separator' },
        {
            label: 'Auto-Refresh',
            enabled: !captureActive,
            submenu: [
                {
                    label: 'Disabled',
                    type: 'checkbox',
                    checked: !autoRefreshEnabled,
                    click: () => postMessage(session, { type: 'set-auto-refresh', enabled: false })
                },
                ...AUTO_REFRESH_INTERVALS_SEC.map((sec) => ({
                    label: `${sec}s`,
                    type: 'checkbox' as const,
                    checked: autoRefreshEnabled && autoRefreshIntervalSec === sec,
                    click: () => postMessage(session, { type: 'set-auto-refresh', enabled: true, intervalSec: sec })
                }))
            ]
        }
    ]
    const history = [...screenshotHistoryService.getArray()].reverse()
    if (history.length > 0) {
        template.push({ type: 'separator' })
        template.push({
            label: 'Screenshot history',
            submenu: history.map((entry) => {
                const icon = cachedThumbnail(entry.path)
                return {
                    label: formatHistoryLabel(entry.timestamp),
                    ...(icon && { icon }),
                    click: () => {
                        const dataUrl = fileToDataUrl(entry.path)
                        if (!dataUrl) {
                            postStatus(session, 'That screenshot is no longer available.')
                            return
                        }
                        session.displayedPath = entry.path
                        postMessage(session, { type: 'load-history-image', imageDataUrl: dataUrl })
                    }
                }
            })
        })
    }
    const menu = Menu.buildFromTemplate(template)
    menu.popup({ window: session.preview, x: params.x, y: params.y })
}

/** Builds the File/View native menu for the preview window. */
function buildPreviewNativeMenu(session: PreviewSession, win: BrowserWindow): Menu {
    const isMacMenu = process.platform === 'darwin'
    return Menu.buildFromTemplate([
        {
            label: 'File',
            submenu: [
                { label: 'Save...', click: () => { void runSave(session) } },
                { label: 'Save with Overlay...', click: () => postMessage(session, { type: 'trigger-save-with-overlay' }) },
                { type: 'separator' },
                { label: 'Copy', accelerator: 'CmdOrCtrl+C', click: () => copyScreenshotFileToClipboard(session, session.displayedPath) },
                { label: 'Copy with Overlay', accelerator: 'CmdOrCtrl+Shift+C', click: () => postMessage(session, { type: 'trigger-copy-with-overlay' }) },
                { type: 'separator' },
                isMacMenu
                    ? { role: 'close' as const }
                    : { label: 'Close', accelerator: 'Alt+F4', click: () => { if (!win.isDestroyed()) win.close() } }
            ]
        },
        {
            label: 'View',
            submenu: [
                { label: 'Refresh', click: () => postMessage(session, { type: 'trigger-refresh' }) },
                { label: 'Load Comparison Overlay...', click: () => { void runOnionPick(session) } },
                { label: 'Clear Overlay', click: () => postMessage(session, { type: 'clear-onion' }) },
                { type: 'separator' },
                { role: 'toggleDevTools' as const },
                { role: 'reload' as const }
            ]
        }
    ])
}

// -- IPC registration (once at startup) ------------------------------------------

/**
 * Registers the screenshot-preview IPC channels. Called once at startup. Every
 * handler operates on the current activeSession (set by mountScreenshotPreviewShell),
 * and no-ops when there is no live preview window.
 */
export function registerScreenshotPreviewHandlers(): void {
    ipcMain.handle('screenshot-preview:get-initial-data', (): ScreenshotPreviewInitialData => {
        const session = activeSession
        const fallback: ScreenshotPreviewInitialData = {
            title: 'Screenshot',
            imageDataUrl: null,
            zoomPercent: 100,
            autoRefreshEnabled: false,
            autoRefreshIntervalSec: 30,
            autoRefreshIntervalsSec: [...AUTO_REFRESH_INTERVALS_SEC],
            onionOpacityPercent: 50,
            screenshotHistory: [],
            onionBuiltinMenu: [],
            onionOverlayHistory: [],
            autoRefreshOnLoad: false
        }
        if (!session) return fallback
        const preferences = session.context.store.getPreferences()
        const data: ScreenshotPreviewInitialData = {
            title: session.title,
            imageDataUrl: session.tempPath ? fileToDataUrl(session.tempPath) : null,
            zoomPercent: clampInt(preferences.screenshotZoomPercent ?? 100, 10, 300),
            autoRefreshEnabled: preferences.screenshotAutoRefreshEnabled ?? false,
            autoRefreshIntervalSec: normalizeAutoRefreshIntervalSec(preferences.screenshotAutoRefreshIntervalSec ?? 30),
            autoRefreshIntervalsSec: [...AUTO_REFRESH_INTERVALS_SEC],
            onionOpacityPercent: clampInt(preferences.screenshotOnionOpacityPercent ?? 50, 0, 100),
            screenshotHistory: buildHistoryEntries(),
            onionBuiltinMenu: buildOnionBuiltinEntries(),
            onionOverlayHistory: buildOnionOverlayHistoryEntries(session.context.store),
            autoRefreshOnLoad: session.autoRefreshOnLoad
        }
        session.autoRefreshOnLoad = false
        return data
    })

    ipcMain.handle('screenshot-preview:refresh', async (_event, auto: boolean): Promise<void> => {
        if (activeSession) await runRefresh(activeSession, !!auto)
    })

    ipcMain.handle('screenshot-preview:save', async (): Promise<void> => {
        if (activeSession) await runSave(activeSession)
    })

    ipcMain.handle('screenshot-preview:save-image', async (_event, dataUrl: string): Promise<void> => {
        if (activeSession && typeof dataUrl === 'string') await runSaveImage(activeSession, dataUrl)
    })

    ipcMain.handle('screenshot-preview:copy', async (): Promise<void> => {
        if (activeSession) copyScreenshotFileToClipboard(activeSession, activeSession.displayedPath)
    })

    ipcMain.handle('screenshot-preview:copy-image', async (_event, dataUrl: string): Promise<void> => {
        if (activeSession && typeof dataUrl === 'string') runCopyImage(activeSession, dataUrl)
    })

    ipcMain.handle('screenshot-preview:onion-pick', async (): Promise<void> => {
        if (activeSession) await runOnionPick(activeSession)
    })

    ipcMain.handle('screenshot-preview:onion-apply', async (_event, ref: string): Promise<void> => {
        if (activeSession && typeof ref === 'string') runOnionApply(activeSession, ref)
    })

    ipcMain.handle('screenshot-preview:get-image', async (_event, filePath: string): Promise<ScreenshotPreviewImageResult> => {
        if (typeof filePath !== 'string' || !isServeableImagePath(filePath)) return { ok: false }
        const dataUrl = fileToDataUrl(filePath)
        return dataUrl ? { ok: true, dataUrl } : { ok: false }
    })

    ipcMain.handle('screenshot-preview:show-history-image', async (_event, filePath: string): Promise<ScreenshotPreviewImageResult> => {
        if (!activeSession || typeof filePath !== 'string' || !isServeableImagePath(filePath)) return { ok: false }
        const dataUrl = fileToDataUrl(filePath)
        if (!dataUrl) return { ok: false }
        activeSession.displayedPath = filePath
        return { ok: true, dataUrl }
    })

    ipcMain.handle('screenshot-preview:get-history', async (): Promise<ScreenshotHistoryEntryForPreview[]> => {
        return buildHistoryEntries()
    })

    ipcMain.handle('screenshot-preview:prefs', async (_event, previewPrefs: ScreenshotPreviewPrefs): Promise<void> => {
        if (!activeSession || !previewPrefs || typeof previewPrefs !== 'object') return
        activeSession.context.store.setPreferences({
            screenshotZoomPercent: clampInt(Number.isFinite(previewPrefs.zoomPercent) ? previewPrefs.zoomPercent : 100, 10, 300),
            screenshotAutoRefreshEnabled: !!previewPrefs.autoRefreshEnabled,
            screenshotAutoRefreshIntervalSec: normalizeAutoRefreshIntervalSec(
                Number.isFinite(previewPrefs.autoRefreshIntervalSec) ? previewPrefs.autoRefreshIntervalSec : 30
            ),
            screenshotOnionOpacityPercent: clampInt(
                Number.isFinite(previewPrefs.onionOpacityPercent) ? previewPrefs.onionOpacityPercent : 50, 0, 100
            )
        })
    })

    ipcMain.on('screenshot-preview:set-state', (_event, state: ScreenshotPreviewState) => {
        if (activeSession && state && typeof state === 'object') {
            activeSession.rendererState = {
                autoRefreshEnabled: !!state.autoRefreshEnabled,
                autoRefreshIntervalSec: Number(state.autoRefreshIntervalSec) || 30,
                overlayActive: !!state.overlayActive,
                captureActive: !!state.captureActive
            }
        }
    })
}

// -- Window mount --------------------------------------------------------------

export type PreviewShellParams = {
    context: IpcContext
    ip: string
    screenshotTitle: string
    sourceZoomLevel: number
    creds: { user: string; password: string } | null
    /** Initial displayed screenshot file path, '' for none (shows the placeholder). */
    tempPath: string
    /** Temp capture files to delete on close - never include persistent history paths. */
    pathsToDeleteOnClose: string[]
    setScreenshotPreviewWindow: (w: BrowserWindow | null) => void
    getScreenshotPreviewWindow: () => BrowserWindow | null
    /** Trigger a screenshot refresh automatically after the window loads. */
    autoRefresh?: boolean
}

/**
 * Creates and mounts the Screenshot Preview BrowserWindow as a bundled renderer
 * entry, sets it as the active session, and loads it. The renderer pulls its
 * initial data and (when autoRefresh is set) triggers the first capture itself.
 *
 * @returns {IpcResult} ok: true (setup errors are thrown to the caller).
 */
export async function mountScreenshotPreviewShell(params: PreviewShellParams): Promise<IpcResult> {
    const {
        context,
        ip,
        screenshotTitle,
        sourceZoomLevel,
        creds,
        tempPath,
        pathsToDeleteOnClose,
        setScreenshotPreviewWindow,
        getScreenshotPreviewWindow
    } = params
    const preferences = context.store.getPreferences()

    const session: PreviewSession = {
        preview: null as unknown as BrowserWindow, // filled in after createToolWindow
        context,
        ip,
        creds,
        title: screenshotTitle,
        displayedPath: tempPath || '',
        tempPath: tempPath || '',
        createdTempFiles: new Set<string>([...pathsToDeleteOnClose]),
        refreshInFlight: false,
        autoRefreshOnLoad: !!params.autoRefresh,
        rendererState: {
            autoRefreshEnabled: preferences.screenshotAutoRefreshEnabled ?? false,
            autoRefreshIntervalSec: normalizeAutoRefreshIntervalSec(preferences.screenshotAutoRefreshIntervalSec ?? 30),
            overlayActive: false,
            captureActive: false
        }
    }
    activeSession = session

    const preview = createToolWindow({
        context,
        title: screenshotTitle,
        width: SCREENSHOT_PREVIEW_WIDTH,
        height: SCREENSHOT_PREVIEW_HEIGHT,
        minWidth: SCREENSHOT_PREVIEW_MIN_WIDTH,
        minHeight: SCREENSHOT_PREVIEW_MIN_HEIGHT,
        sourceZoomLevel,
        buildMenu: (win) => buildPreviewNativeMenu(session, win),
        setupContextMenu: (win) => {
            win.webContents.on('context-menu', (ctxEvent, params) => {
                ctxEvent.preventDefault()
                buildPreviewContextMenu(session, params)
            })
        },
        onClosed: () => {
            if (getScreenshotPreviewWindow() === session.preview) setScreenshotPreviewWindow(null)
            if (activeSession === session) activeSession = null
            thumbnailCache.clear()
            for (const filePath of session.createdTempFiles) {
                try {
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
                } catch {
                    // best-effort
                }
            }
            session.createdTempFiles.clear()
        }
    })
    session.preview = preview

    // Hidden by default (factory calls setMenuBarVisibility(false) on non-Mac) but
    // revealable with Alt on Windows.
    preview.autoHideMenuBar = true
    setScreenshotPreviewWindow(preview)

    // Close the preview (its onClosed nulls the singleton, clears activeSession,
    // and deletes temp files) if the bundle fails to load, so no stranded blank
    // window is left behind on a broken build.
    await loadBundledEntryOrClose(preview, 'screenshotPreview')
    if (!preview.isDestroyed()) focusWindow(preview)

    return { ok: true }
}
