/**
 * In-memory screenshot history service.
 *
 * Owns the in-memory history list, its persistence to disk, thumbnail helpers,
 * and the pixel-deduplication logic. Extracted from the deviceScreenshot handler
 * so that other handlers (capture, store) can import history operations without
 * creating handler-to-handler coupling.
 */

import { app, nativeImage } from 'electron'
import crypto from 'node:crypto'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import type { BrowserWindow } from 'electron'
import { DEFAULT_SCREENSHOT_NAMING_FORMAT } from '../../shared/toolbarConstants'
export type ScreenshotHistoryEntry = { path: string; timestamp: number }

/** Result of push(): whether history actually changed, and the path a caller should show. */
export interface ScreenshotPushResult {
    changed: boolean
    path: string
}

const SCREENSHOT_HISTORY_MAX = 20
const SCREENSHOT_HISTORY_MENU_ICON_SIZE = 32
const SCREENSHOT_HISTORY_INDEX = 'screenshot-history-index.json'
const SCREENSHOT_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg'])

type DecodedBitmap = { width: number; height: number; data: Buffer }

/**
 * Returns the directory used for screenshot history storage, creating it if needed.
 * Falls back to <userData>/screenshot-history when no custom folder is configured.
 * @param folder - Optional user-configured screenshot folder path.
 * @returns The absolute path to the history directory.
 */
function getScreenshotHistoryDir(folder?: string): string {
    const dir = (folder && folder.trim()) ? folder : path.join(app.getPath('userData'), 'screenshot-history')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    return dir
}

/**
 * The absolute folder screenshots are saved to when no custom folder is configured, created if
 * missing so the Settings UI can show it and Browse can open into it. Single source of truth for
 * the default, shared by the save path (getScreenshotHistoryDir) and the Capture settings field.
 * @returns The absolute path to the default screenshot folder.
 */
export function getDefaultScreenshotFolder(): string {
    return getScreenshotHistoryDir()
}

/**
 * Returns the absolute path to the screenshot history index JSON file,
 * stored in the app's userData directory.
 * @returns The path to screenshot-history-index.json.
 */
function getScreenshotHistoryIndexPath(): string {
    return path.join(app.getPath('userData'), SCREENSHOT_HISTORY_INDEX)
}

/**
 * Generates a screenshot filename by substituting date/time tokens in a format string.
 * Supported tokens: {YYYY}, {MM}, {DD}, {HH}, {mm}, {ss}.
 * Falls back to DEFAULT_SCREENSHOT_NAMING_FORMAT if the format string is empty.
 * @param format - Filename format string with optional date/time tokens.
 * @param ext - File extension without the leading dot (e.g. "png").
 * @param timestamp - Unix timestamp in ms, defaults to now.
 * @returns The formatted filename with extension appended.
 */
function formatScreenshotFilename(format: string, ext: string, timestamp: number = Date.now()): string {
    const date = new Date(timestamp)
    const pad = (num: number) => String(num).padStart(2, '0')
    const name = (format.trim() || DEFAULT_SCREENSHOT_NAMING_FORMAT)
        .replace('{YYYY}', String(date.getFullYear()))
        .replace('{MM}', pad(date.getMonth() + 1))
        .replace('{DD}', pad(date.getDate()))
        .replace('{HH}', pad(date.getHours()))
        .replace('{mm}', pad(date.getMinutes()))
        .replace('{ss}', pad(date.getSeconds()))
    return `${name}.${ext}`
}

/**
 * Decodes an image file to a raw BGRA bitmap at scale factor 1.
 * Used for pixel-exact comparison to detect duplicate screenshots.
 * @param filePath - Absolute path to the PNG or JPEG file.
 * @returns A DecodedBitmap with dimensions and raw pixel data, or null on failure.
 */
function tryDecodeImageBitmap(filePath: string): DecodedBitmap | null {
    if (!fs.existsSync(filePath)) return null
    try {
        const img = nativeImage.createFromPath(filePath)
        if (img.isEmpty()) return null
        const { width, height } = img.getSize(1)
        if (width < 1 || height < 1) return null
        const data = img.toBitmap({ scaleFactor: 1 })
        const expected = width * height * 4
        if (data.length !== expected) return null
        return { width, height, data }
    } catch {
        return null
    }
}

/** SHA-256 of raw bitmap + dimensions - used to find duplicate history files without keeping buffers in memory. */
function bitmapContentFingerprint(filePath: string): string | null {
    const decoded = tryDecodeImageBitmap(filePath)
    if (!decoded) return null
    const hash = crypto.createHash('sha256').update(decoded.data).digest('hex')
    return `${decoded.width}x${decoded.height}:${hash}`
}

/**
 * Formats a screenshot timestamp as a human-readable label for the history menu.
 * Today's screenshots include the short month, day, and time. Older entries also include the year.
 * @param timestamp - Unix timestamp in milliseconds.
 * @returns A locale-formatted date/time string.
 */
export function formatHistoryLabel(timestamp: number): string {
    const date = new Date(timestamp)
    const now = new Date()
    const isToday = date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()
    if (isToday) {
        return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    }
    return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/**
 * Creates a small thumbnail NativeImage from a screenshot file for use as a
 * menu item icon in the context menu history submenu.
 * The image is scaled to fit within SCREENSHOT_HISTORY_MENU_ICON_SIZE x SCREENSHOT_HISTORY_MENU_ICON_SIZE.
 * @param filePath - Absolute path to the source screenshot file.
 * @returns A scaled NativeImage, or undefined if the file cannot be read.
 */
export function createHistoryThumbnail(filePath: string, maxSize = SCREENSHOT_HISTORY_MENU_ICON_SIZE): Electron.NativeImage | undefined {
    try {
        if (!fs.existsSync(filePath)) return undefined
        const img = nativeImage.createFromPath(filePath)
        if (img.isEmpty()) return undefined
        const size = img.getSize()
        if (size.width < 1 || size.height < 1) return undefined
        const scale = Math.min(maxSize / size.width, maxSize / size.height, 1)
        const w = Math.round(size.width * scale)
        const h = Math.round(size.height * scale)
        return img.resize({ width: w, height: h })
    } catch {
        return undefined
    }
}

/**
 * Service that owns the in-memory screenshot history list and all persistence,
 * deduplication, and query operations on it.
 *
 * A single shared instance is exported as `screenshotHistoryService` so all
 * handlers operate on the same history. The class shape mirrors ScriptLibrary
 * and DeeplinkLibrary: no constructor arguments, stateful instance methods,
 * no global mutable state outside the class.
 */
export class ScreenshotHistoryService {
    private history: ScreenshotHistoryEntry[] = []
    private loaded = false

    // ------------------------------------------------------------------
    // Private helpers
    // ------------------------------------------------------------------

    /**
     * Persists the current in-memory history list to the JSON index file.
     * Errors are swallowed (best-effort, history is not critical data).
     */
    private save(): void {
        try {
            const indexPath = getScreenshotHistoryIndexPath()
            fs.writeFileSync(indexPath, JSON.stringify(this.history), 'utf-8')
        } catch {
            // best-effort
        }
    }

    /**
     * If `sourcePath` is pixel-identical to any existing history file (same dimensions + bitmap bytes),
     * returns that entry. Newest history entries are checked first (common case: unchanged screen on refresh).
     */
    private findPixelIdenticalEntry(sourcePath: string): ScreenshotHistoryEntry | null {
        const resolvedSource = path.resolve(sourcePath)
        const samePathEntry = this.history.find((e) => path.resolve(e.path) === resolvedSource)
        if (samePathEntry) return samePathEntry
        const fresh = tryDecodeImageBitmap(sourcePath)
        if (!fresh) return null
        for (let i = this.history.length - 1; i >= 0; i--) {
            const entry = this.history[i]!
            const cand = tryDecodeImageBitmap(entry.path)
            if (!cand || cand.width !== fresh.width || cand.height !== fresh.height) continue
            if (cand.data.equals(fresh.data)) return entry
        }
        return null
    }

    /**
     * Drop pixel-identical history items, keeping the newest (latest timestamp) of each image.
     * Deletes removed files from disk and rewrites the index when anything changes.
     */
    private prunePixelDuplicates(): boolean {
        if (this.history.length < 2) return false
        const toRemovePaths = new Set<string>()
        const seen = new Set<string>()
        for (let i = this.history.length - 1; i >= 0; i--) {
            const entry = this.history[i]!
            const fingerprint = bitmapContentFingerprint(entry.path)
            if (fingerprint === null) {
                const fallbackKey = `path:${path.resolve(entry.path)}`
                if (seen.has(fallbackKey)) toRemovePaths.add(entry.path)
                else seen.add(fallbackKey)
                continue
            }
            if (seen.has(fingerprint)) toRemovePaths.add(entry.path)
            else seen.add(fingerprint)
        }
        if (toRemovePaths.size === 0) return false
        for (const removedPath of toRemovePaths) {
            try {
                if (fs.existsSync(removedPath)) fs.unlinkSync(removedPath)
            } catch {
                // best-effort
            }
        }
        const kept = this.history.filter((e) => !toRemovePaths.has(e.path))
        this.history.splice(0, this.history.length, ...kept)
        this.save()
        return true
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    /**
     * Loads the screenshot history from disk into the in-memory list on first call.
     * Scans the history directory for image files, sorts them by modification time,
     * and keeps only the most recent SCREENSHOT_HISTORY_MAX entries. This is a metadata-only
     * scan (readdir + stat): it deliberately does NOT decode or hash images. Pixel-duplicate
     * detection is a capture-time concern (see push -> findPixelIdenticalEntry), and running it
     * here decoded up to 20 full-size images synchronously on the launch path (load runs before
     * the window exists), which stalled startup. Subsequent calls are no-ops (loaded flag).
     * @param folder - Optional user-configured screenshot folder to scan.
     */
    load(folder?: string): void {
        if (this.loaded) return
        this.loaded = true
        try {
            const dir = getScreenshotHistoryDir(folder)
            const entries = fs.readdirSync(dir)
                .filter(name => SCREENSHOT_IMAGE_EXTS.has(path.extname(name).toLowerCase()))
                .map(name => {
                    const filePath = path.join(dir, name)
                    try { return { path: filePath, timestamp: Math.round(fs.statSync(filePath).mtimeMs) } } catch { return null }
                })
                .filter((entry): entry is ScreenshotHistoryEntry => entry !== null)
            entries.sort((entryA, entryB) => entryA.timestamp - entryB.timestamp)
            this.history = entries.slice(-SCREENSHOT_HISTORY_MAX)
        } catch {
            this.history = []
        }
    }

    /** Resets the loaded flag and clears the list, then reloads from the given folder. */
    reload(folder?: string): void {
        this.loaded = false
        this.history.splice(0, this.history.length)
        this.load(folder)
    }

    /**
     * Returns the screenshot history in reverse-chronological order (newest first)
     * with file:// URLs and formatted labels ready for the renderer to display.
     * @returns Array of { path: file:// URL, label: formatted date string }.
     */
    getEntries(): Array<{ path: string; label: string }> {
        return [...this.history].reverse().map((entry) => ({
            path: pathToFileURL(entry.path).toString(),
            label: formatHistoryLabel(entry.timestamp)
        }))
    }

    /**
     * Returns the live history array (shared reference).
     * Callers that hold this reference see in-place mutations from push().
     */
    getArray(): ScreenshotHistoryEntry[] {
        return this.history
    }

    /**
     * Copies the capture into persisted history unless it is pixel-identical to an existing entry.
     * @returns `changed`: true if history was modified (new file and/or prune). `path`: the actual
     *   destination just saved, or the existing entry's path when the source was a pixel-identical
     *   duplicate (never a last-entry guess, since the matched entry need not be the newest one).
     *   Falls back to `sourcePath` if the save itself failed.
     */
    push(sourcePath: string, extension: string, opts?: { folder?: string; namingFormat?: string }): ScreenshotPushResult {
        try {
            this.load(opts?.folder)
            const changed = this.prunePixelDuplicates()
            const identical = this.findPixelIdenticalEntry(sourcePath)
            if (identical) {
                return { changed, path: identical.path }
            }
            const historyDir = getScreenshotHistoryDir(opts?.folder)
            const timestamp = Date.now()
            const name = formatScreenshotFilename(opts?.namingFormat ?? DEFAULT_SCREENSHOT_NAMING_FORMAT, extension, timestamp)
            const destPath = path.join(historyDir, name)
            fs.copyFileSync(sourcePath, destPath)
            this.history.push({ path: destPath, timestamp })
            while (this.history.length > SCREENSHOT_HISTORY_MAX) {
                const removed = this.history.shift()!
                try {
                    if (fs.existsSync(removed.path)) fs.unlinkSync(removed.path)
                } catch {
                    // best-effort cleanup
                }
            }
            this.save()
            return { changed: true, path: destPath }
        } catch {
            // best-effort: history is optional
            return { changed: false, path: sourcePath }
        }
    }

    /**
     * Wipes persisted screenshot thumbnails + index and clears the in-memory list.
     * Mutates the shared history array in place (same reference as open preview windows).
     */
    clearForReset(): void {
        this.history.splice(0, this.history.length)
        try {
            const indexPath = getScreenshotHistoryIndexPath()
            if (fs.existsSync(indexPath)) fs.unlinkSync(indexPath)
        } catch {
            /* best-effort */
        }
        try {
            const dir = getScreenshotHistoryDir()
            if (fs.existsSync(dir)) {
                for (const name of fs.readdirSync(dir)) {
                    try {
                        const filePath = path.join(dir, name)
                        if (fs.statSync(filePath).isFile()) fs.unlinkSync(filePath)
                    } catch {
                        /* best-effort */
                    }
                }
            }
        } catch {
            /* best-effort */
        }
        try {
            fs.writeFileSync(getScreenshotHistoryIndexPath(), '[]', 'utf-8')
        } catch {
            /* best-effort */
        }
    }

    /**
     * Tell an open screenshot preview to clear history thumbnails, overlay recent list, and active overlay
     * (after Reset to Defaults).
     * @param getPreviewWindow - Returns the current screenshot preview BrowserWindow, or null.
     */
    notifyPreviewReset(getPreviewWindow: () => BrowserWindow | null): void {
        const win = getPreviewWindow()
        if (!win || win.isDestroyed()) return
        const wc = win.webContents
        if (wc.isDestroyed()) return
        wc.send('screenshot-preview:message', { type: 'history-updated', entries: [] })
        wc.send('screenshot-preview:message', { type: 'onion-history-updated', entries: [] })
        wc.send('screenshot-preview:message', { type: 'clear-onion' })
    }
}

/**
 * Shared singleton instance used by all IPC handlers.
 * Created once at module load. All handlers import and call methods on this instance.
 */
export const screenshotHistoryService = new ScreenshotHistoryService()

