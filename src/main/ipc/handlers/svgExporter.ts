/**
 * IPC handlers for the SVG Converter tool window.
 *
 * Manages the SVG Converter BrowserWindow in two scopes: 'standalone' (CLI launch
 * or file-association) and 'inDock' (opened from within the dock). The scoped
 * registry in toolWindow.ts tracks at most one live window per scope. Each window
 * has its own Export PNG enabled state tracked via a per-window WeakMap record.
 *
 * SVG conversion workflow:
 *  1. User imports an SVG file (via dialog or drag-and-drop paste as text).
 *  2. The renderer rasterizes the SVG to a canvas data URL at the desired size.
 *  3. For PNG, the main process quantizes the RGBA image to an indexed palette
 *     (compressPng) for Roku-compatible file sizes. For WebP, the renderer encodes
 *     the full-color raster with the browser's lossy WebP encoder (no main step).
 *  4. User saves the result via a native save dialog (save-image, PNG or WebP).
 *
 * The Export menu item is disabled until an SVG has been loaded. Each window tracks
 * its own loaded flag and menu reference in SvgWindowState so the two scopes manage
 * their Export state independently.
 */

import { BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { focusWindow } from '../../focusPolicy'
import fs from 'fs'
import path from 'path'
import {
    SVG_EXPORTER_HEIGHT,
    SVG_EXPORTER_MIN_HEIGHT,
    SVG_EXPORTER_MIN_WIDTH,
    SVG_EXPORTER_WIDTH
} from '../../constants/preview'
import { compressPng } from '../../utils/pngCompress'
import { fileOpenError } from '../../utils/fileOpenError'
import {
    createToolWindow,
    loadBundledEntryOrClose,
    getScopedToolWindow,
    setScopedToolWindow,
    type ToolWindowScope
} from '../toolWindow'
import { dataUrlToBuffer } from '../../utils/dataUrl'
import { parseSvgDimensions } from '../../utils/svgDimensions'
import type { IpcContext, IpcResult } from '../types'
import { sendToolWindowCommand } from '../toolWindowCommand'
import type { SvgConverterCommand } from '../../../shared/toolWindowCommands'

const isMac = process.platform === 'darwin'

interface SvgInitialData {
    svgText: string
    fileName: string
    intrinsicWidth: number
    intrinsicHeight: number
}

/** What the renderer pulls on boot: the staged SVG (if any) and any read error. */
interface SvgInitialPayload {
    data: SvgInitialData | null
    error: string | null
}

let pendingSvgStandalone: SvgInitialPayload | null = null
let pendingSvgInDock: SvgInitialPayload | null = null

/** Per-window state: the window's menu reference, loaded flag, and dialog guard. */
interface SvgWindowState {
    menu: Menu | null
    loaded: boolean
    dialogInFlight: boolean
}

// A WeakMap avoids retaining windows past their lifetime.
const windowStateMap = new WeakMap<BrowserWindow, SvgWindowState>()

function getWindowState(win: BrowserWindow): SvgWindowState {
    let state = windowStateMap.get(win)
    if (!state) {
        state = { menu: null, loaded: false, dialogInFlight: false }
        windowStateMap.set(win, state)
    }
    return state
}

/** Marks an SVG as loaded for the given window and enables its 'Export PNG' menu item. */
function enableExportMenuItem(win: BrowserWindow): void {
    const state = getWindowState(win)
    state.loaded = true
    if (state.menu) {
        const exportItem = state.menu.getMenuItemById('export-png')
        if (exportItem) exportItem.enabled = true
    }
}

/**
 * Pure read + parse of an SVG file. No window or menu side-effects.
 * @param filePath - Absolute path to the .svg file.
 * @returns Parsed SVG data.
 */
function readSvg(filePath: string): { svgText: string; intrinsicWidth: number; intrinsicHeight: number; fileName: string } {
    const svgText = fs.readFileSync(filePath, 'utf-8')
    const fileName = path.basename(filePath)
    const { width: intrinsicWidth, height: intrinsicHeight } = parseSvgDimensions(svgText)
    return { svgText, intrinsicWidth, intrinsicHeight, fileName }
}

function importSvgFromPath(win: BrowserWindow, filePath: string): IpcResult & { svgText: string; intrinsicWidth: number; intrinsicHeight: number; fileName: string } {
    const svg = readSvg(filePath)
    enableExportMenuItem(win)
    return { ok: true, ...svg }
}

/**
 * Builds the application menu for an SVG Converter window.
 * Stores the menu in that window's SvgWindowState so Export PNG can be enabled later.
 * @param win - The SVG Converter BrowserWindow instance.
 * @returns The constructed Electron Menu.
 */
function buildSvgExporterMenu(win: BrowserWindow): Menu {
    const sendCommand = (command: SvgConverterCommand) => sendToolWindowCommand(win, command)
    const menu = Menu.buildFromTemplate([
        {
            label: 'File',
            submenu: [
                { label: 'Import SVG...', accelerator: 'CmdOrCtrl+O', click: () => sendCommand({ type: 'import' }) },
                { type: 'separator' },
                { label: 'Export...', accelerator: 'CmdOrCtrl+S', enabled: false, id: 'export-png', click: () => sendCommand({ type: 'export' }) },
                { type: 'separator' },
                isMac
                    ? { role: 'close' as const }
                    : { label: 'Close', accelerator: 'Alt+F4', click: () => { if (!win.isDestroyed()) win.close() } }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'toggleDevTools' as const },
                { role: 'reload' as const }
            ]
        }
    ])
    // Store the menu in the per-window state so enableExportMenuItem can target it.
    getWindowState(win).menu = menu
    return menu
}

/**
 * Creates a new SVG Converter BrowserWindow and registers it in the scoped registry.
 * Pass sourceZoomLevel to inherit the opener's zoom level.
 * @param context - Shared IPC context.
 * @param sourceZoomLevel - Optional zoom level inherited from the opener window.
 * @param scope - Whether this is a standalone or inDock window.
 * @returns The constructed BrowserWindow.
 */
function createSvgWindow(context: IpcContext, sourceZoomLevel: number | undefined, scope: ToolWindowScope): BrowserWindow {
    const win = createToolWindow({
        context,
        title: 'SVG Converter',
        width: SVG_EXPORTER_WIDTH,
        height: SVG_EXPORTER_HEIGHT,
        minWidth: SVG_EXPORTER_MIN_WIDTH,
        minHeight: SVG_EXPORTER_MIN_HEIGHT,
        iconKey: 'svg',
        sourceZoomLevel,
        buildMenu: buildSvgExporterMenu
    })
    // Register before loading the entry so svg-exporter:get-initial-data resolves this window's scope.
    setScopedToolWindow('svg', scope, win)
    return win
}

/**
 * Registers all SVG Converter IPC handlers.
 *
 * @param context - Shared IPC context providing store and window helpers.
 */
export function registerSvgExporterHandlers(context: IpcContext): void {
    /**
     * Opens the SVG Converter window in the inDock scope. If already open, focuses it.
     * Creates the BrowserWindow with File/View menu and loads the bundled Vite entry.
     * @returns {IpcResult} ok: true if the window was opened or focused; ok: false with error on failure.
     */
    ipcMain.handle('svg-exporter:open', async (event): Promise<IpcResult> => {
        try {
            const existingInDock = getScopedToolWindow('svg', 'inDock')
            if (existingInDock) {
                focusWindow(existingInDock)
                return { ok: true }
            }

            const sourceZoomLevel = event.sender.getZoomLevel()
            pendingSvgInDock = { data: null, error: null }
            const win = createSvgWindow(context, sourceZoomLevel, 'inDock')
            await loadBundledEntryOrClose(win, 'svgConverter')
            return { ok: true }
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : 'Failed to open SVG Converter.' }
        }
    })

    /**
     * Pull handler for window boot: returns the pending SVG pre-loaded by the opener
     * (openSvgConverterStandalone or svg-exporter:open) and clears that scope's pending
     * state. Resolves the requesting window by comparing it to the scoped registry.
     * Falls back to safe defaults if no pending data was set.
     */
    ipcMain.handle('svg-exporter:get-initial-data', (event): SvgInitialPayload => {
        const sender = BrowserWindow.fromWebContents(event.sender)
        const isStandalone = sender !== null && sender === getScopedToolWindow('svg', 'standalone')
        const isInDock = sender !== null && sender === getScopedToolWindow('svg', 'inDock')
        const payload = isStandalone
            ? (pendingSvgStandalone ?? { data: null, error: null })
            : isInDock
                ? (pendingSvgInDock ?? { data: null, error: null })
                : { data: null, error: null }
        if (isStandalone) pendingSvgStandalone = null
        if (isInDock) pendingSvgInDock = null
        return payload
    })

    /**
     * Opens a native Open dialog filtered to .svg files and loads the selected file into the editor.
     * @returns { ok: true, svgText, intrinsicWidth, intrinsicHeight, fileName } on success;
     *   { ok: false, error } if the window is not open, the dialog is canceled, or the read fails.
     */
    ipcMain.handle('svg-exporter:import-svg', async (event): Promise<IpcResult> => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return { ok: false, error: 'SVG Converter window is not open.' }
        const state = getWindowState(win)
        if (state.dialogInFlight) return { ok: false, error: 'A dialog is already open.' }
        state.dialogInFlight = true
        try {
            const result = await dialog.showOpenDialog(win, {
                title: 'Import SVG',
                properties: ['openFile'],
                filters: [
                    { name: 'SVG Files', extensions: ['svg'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
            })
            if (result.canceled || !result.filePaths[0]) return { ok: false, error: 'Import canceled.' }
            return importSvgFromPath(win, result.filePaths[0])
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : 'Import failed.' }
        } finally {
            state.dialogInFlight = false
        }
    })

    /**
     * Loads an SVG directly from a text string (e.g. drag-and-drop paste) without a file dialog.
     * Parses intrinsic dimensions and enables the Export PNG menu item on the sender window.
     * @param svgText - The raw SVG markup string.
     * @param fileName - Optional display filename; defaults to 'dropped.svg'.
     * @returns { ok: true, svgText, intrinsicWidth, intrinsicHeight, fileName } on success;
     *   { ok: false, error } if the window is not open or the SVG content is empty/invalid.
     */
    ipcMain.handle('svg-exporter:import-svg-text', async (event, svgText: unknown, fileName: unknown): Promise<IpcResult> => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return { ok: false, error: 'SVG Converter window is not open.' }
        try {
            if (typeof svgText !== 'string' || !svgText) {
                return { ok: false, error: 'Invalid SVG content.' }
            }
            const name = typeof fileName === 'string' && fileName ? fileName : 'dropped.svg'
            const { width: intrinsicWidth, height: intrinsicHeight } = parseSvgDimensions(svgText)

            enableExportMenuItem(win)

            return { ok: true, svgText, intrinsicWidth, intrinsicHeight, fileName: name } as IpcResult & { svgText: string; intrinsicWidth: number; intrinsicHeight: number; fileName: string }
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : 'Import failed.' }
        }
    })

    /**
     * Quantizes a PNG to an indexed-color palette for Roku-compatible file sizes.
     * The renderer rasterizes the SVG to a canvas data URL, then calls this handler
     * to apply palette reduction (pngquant) before showing the result and file size.
     * @param dataUrl - Base64 PNG data URL to quantize.
     * @param colors - Target palette size (number of colors); defaults to 64.
     * @param dither - Whether to apply Floyd-Steinberg dithering; defaults to true.
     * @returns { ok: true, dataUrl, sizeBytes } with the quantized PNG;
     *   { ok: false, error } if the window is not open, the data is invalid, or quantization fails.
     */
    ipcMain.handle('svg-exporter:quantize', async (event, dataUrl: unknown, colors: unknown, dither: unknown): Promise<IpcResult & { dataUrl?: string; sizeBytes?: number }> => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return { ok: false, error: 'SVG Converter window is not open.' }
        try {
            if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
                return { ok: false, error: 'Invalid image data.' }
            }
            const rawBuffer = dataUrlToBuffer(dataUrl)
            const result = await compressPng(rawBuffer, {
                colors: typeof colors === 'number' ? colors : 64,
                dither: dither !== false
            })
            const resultDataUrl = `data:image/png;base64,${result.buffer.toString('base64')}`
            return { ok: true, dataUrl: resultDataUrl, sizeBytes: result.buffer.byteLength }
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : 'Quantization failed.' }
        }
    })

    /**
     * Saves an already-encoded image (PNG or WebP) to disk via a native Save dialog.
     * The bytes are written directly from the data URL - no re-compression is applied,
     * so the saved file size exactly matches the size shown in the UI.
     * @param dataUrl - Base64 image data URL (PNG or WebP) to save.
     * @param defaultName - Default filename for the Save dialog.
     * @param format - The image format, which selects the dialog file filter.
     * @returns {IpcResult} ok: true on success; ok: false if canceled, invalid data, or write fails.
     */
    ipcMain.handle('svg-exporter:save-image', async (event, dataUrl: unknown, defaultName: unknown, format: unknown): Promise<IpcResult> => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return { ok: false, error: 'SVG Converter window is not open.' }
        const state = getWindowState(win)
        if (state.dialogInFlight) return { ok: false, error: 'A dialog is already open.' }
        state.dialogInFlight = true
        try {
            if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
                return { ok: false, error: 'Invalid image data.' }
            }
            const buffer = dataUrlToBuffer(dataUrl)

            const isWebp = format === 'webp'
            const saveName = typeof defaultName === 'string' && defaultName
                ? defaultName
                : (isWebp ? 'export.webp' : 'export.png')
            const filter = isWebp
                ? { name: 'WebP Images', extensions: ['webp'] }
                : { name: 'PNG Images', extensions: ['png'] }
            const result = await dialog.showSaveDialog(win, {
                defaultPath: saveName,
                filters: [filter, { name: 'All Files', extensions: ['*'] }]
            })
            if (result.canceled || !result.filePath) return { ok: false, error: 'Export canceled.' }

            fs.writeFileSync(result.filePath, buffer)
            win.setTitle(`SVG Converter - ${path.basename(result.filePath)}`)
            return { ok: true }
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : 'Export failed.' }
        } finally {
            state.dialogInFlight = false
        }
    })
}

/**
 * Opens the SVG converter as a standalone CLI launch or file-association, optionally
 * loading an SVG. Main reads and parses the file. A fresh window pulls it via
 * svg-exporter:get-initial-data. An already-open window gets a loadSvg command.
 */
export async function openSvgConverterStandalone(context: IpcContext, filePath?: string): Promise<void> {
    let data: SvgInitialData | null = null
    let error: string | null = null
    if (filePath) {
        try {
            // readSvg is a pure read+parse with no menu side-effect; the branches
            // below enable the Export PNG menu item once the window (and its menu) exist.
            data = readSvg(filePath)
        } catch (err) {
            error = fileOpenError(filePath, err)
        }
    }

    const existingStandalone = getScopedToolWindow('svg', 'standalone')
    if (existingStandalone) {
        focusWindow(existingStandalone)
        if (data) {
            // Enable the native Export PNG menu item to match the loaded state, the
            // same way every other load path does (import-svg, import-svg-text, and
            // the fresh-window branch below).
            enableExportMenuItem(existingStandalone)
            sendToolWindowCommand(existingStandalone, { type: 'loadSvg', ...data })
        } else if (error) {
            sendToolWindowCommand(existingStandalone, { type: 'toast', message: error })
        }
        return
    }

    pendingSvgStandalone = { data, error }
    const win = createSvgWindow(context, undefined, 'standalone')
    // The menu now exists (createSvgWindow built it via buildSvgExporterMenu which stored it
    // in the WeakMap), so enable Export PNG to match the loaded state the renderer will pull.
    if (data) enableExportMenuItem(win)
    await loadBundledEntryOrClose(win, 'svgConverter')
}
