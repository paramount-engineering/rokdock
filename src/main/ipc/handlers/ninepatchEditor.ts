/**
 * IPC handlers for the 9-Patch Editor tool window.
 *
 * Manages the 9-Patch Editor BrowserWindow in two scopes: 'standalone' (CLI launch)
 * and 'inDock' (opened from within the dock). The scoped registry in toolWindow.ts
 * tracks at most one live window per scope. Each window receives its own pending
 * initial data via ninepatch:get-initial-data, which identifies the requesting
 * window by comparing it to the registry entries.
 *
 * 9-patch PNGs are PNG files with a 1px black border encoding stretch zones
 * (top/left edges) and content regions (bottom/right edges). Roku uses them
 * for scalable UI assets like dialog backgrounds and buttons.
 *
 * The editor generates two files at export: a 1080p FHD variant and a 720p HD
 * variant, named with _fhd and _hd suffixes respectively. Import accepts regular
 * PNG/JPG images or existing .9.png files. Image data is passed between main and
 * renderer as base64 data URLs.
 */

import { BrowserWindow, dialog, ipcMain, Menu, nativeImage } from 'electron'
import { focusWindow } from '../../focusPolicy'
import fs from 'fs'
import path from 'path'
import {
    NINEPATCH_EDITOR_HEIGHT,
    NINEPATCH_EDITOR_MIN_HEIGHT,
    NINEPATCH_EDITOR_MIN_WIDTH,
    NINEPATCH_EDITOR_WIDTH
} from '../../constants/preview'
import {
    createToolWindow,
    loadBundledEntryOrClose,
    getScopedToolWindow,
    setScopedToolWindow,
    type ToolWindowScope
} from '../toolWindow'
import { dataUrlToBuffer } from '../../utils/dataUrl'
import { fileOpenError } from '../../utils/fileOpenError'
import type { IpcContext, IpcResult } from '../types'
import { sendToolWindowCommand } from '../toolWindowCommand'
import type { NinePatchCommand } from '../../../shared/toolWindowCommands'

const isMac = process.platform === 'darwin'

interface NinepatchInitialData {
    dataUrl: string
    isNinePatch: boolean
    fileName: string
}

/** What the renderer pulls on boot: the staged image (if any) and any read error. */
interface NinepatchInitialPayload {
    data: NinepatchInitialData | null
    error: string | null
}

let pendingNinepatchStandalone: NinepatchInitialPayload | null = null
let pendingNinepatchInDock: NinepatchInitialPayload | null = null

// Per-window dialog state. A WeakMap avoids retaining windows past their lifetime.
interface NinepatchWindowState {
    dialogInFlight: boolean
}
const windowStateMap = new WeakMap<BrowserWindow, NinepatchWindowState>()

function getWindowState(win: BrowserWindow): NinepatchWindowState {
    let state = windowStateMap.get(win)
    if (!state) {
        state = { dialogInFlight: false }
        windowStateMap.set(win, state)
    }
    return state
}

/**
 * Builds the application menu for the 9-Patch Editor window.
 * Menu actions are dispatched to the renderer via the typed tool-window command channel.
 * @param win - The 9-Patch Editor BrowserWindow instance.
 * @returns The constructed Electron Menu.
 */
function buildNinepatchMenu(win: BrowserWindow): Menu {
    const sendCommand = (command: NinePatchCommand) => sendToolWindowCommand(win, command)
    return Menu.buildFromTemplate([
        {
            label: 'File',
            submenu: [
                { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => sendCommand({ type: 'new' }) },
                { label: 'Import Image...', accelerator: 'CmdOrCtrl+O', click: () => sendCommand({ type: 'import' }) },
                { type: 'separator' },
                { label: 'Export 9-Patch...', accelerator: 'CmdOrCtrl+S', click: () => sendCommand({ type: 'export' }) },
                { type: 'separator' },
                isMac
                    ? { role: 'close' as const }
                    : { label: 'Close', accelerator: 'Alt+F4', click: () => { if (!win.isDestroyed()) win.close() } }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => sendCommand({ type: 'undo' }) },
                { label: 'Redo', accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y', click: () => sendCommand({ type: 'redo' }) }
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
}

/**
 * Creates and returns a new 9-Patch Editor BrowserWindow with the full window
 * configuration: title, dimensions, menu, context menu, and scoped registry entry.
 * @param context - Shared IPC context for store and window helpers.
 * @param scope - Whether this is a standalone (CLI) or inDock window.
 * @returns The newly created BrowserWindow.
 */
function createNinepatchWindow(context: IpcContext, scope: ToolWindowScope): BrowserWindow {
    const editor = createToolWindow({
        context,
        title: '9-Patch Editor',
        width: NINEPATCH_EDITOR_WIDTH,
        height: NINEPATCH_EDITOR_HEIGHT,
        minWidth: NINEPATCH_EDITOR_MIN_WIDTH,
        minHeight: NINEPATCH_EDITOR_MIN_HEIGHT,
        iconKey: 'ninepatch',
        buildMenu: buildNinepatchMenu,
        setupContextMenu: (win) => {
            win.webContents.on('context-menu', (_ctxEvent, params) => {
                if (win.isDestroyed()) return
                const sendCommand = (command: NinePatchCommand) => sendToolWindowCommand(win, command)
                const template: Electron.MenuItemConstructorOptions[] = [
                    {
                        label: 'Import Image...',
                        click: () => {
                            if (!win.isDestroyed()) {
                                void handleImport(win)
                            }
                        }
                    },
                    {
                        label: 'Export 9-Patch...',
                        click: () => sendCommand({ type: 'export' })
                    },
                    { type: 'separator' },
                    {
                        label: 'Undo',
                        accelerator: 'CmdOrCtrl+Z',
                        click: () => sendCommand({ type: 'undo' })
                    },
                    {
                        label: 'Redo',
                        accelerator: 'CmdOrCtrl+Y',
                        click: () => sendCommand({ type: 'redo' })
                    }
                ]
                const menu = Menu.buildFromTemplate(template)
                menu.popup({ window: win, x: params.x, y: params.y })
            })
        }
    })
    // Register before loading the entry so ninepatch:get-initial-data resolves this window's scope.
    setScopedToolWindow('ninepatch', scope, editor)
    return editor
}

/**
 * Opens the 9-Patch editor as a standalone CLI launch, optionally loading an
 * image. Main reads the file via nativeImage. A fresh window pulls the data via
 * ninepatch:get-initial-data. An already-open window gets an importData command.
 */
export async function openNinepatchStandalone(context: IpcContext, filePath?: string): Promise<void> {
    let data: NinepatchInitialData | null = null
    let error: string | null = null
    if (filePath) {
        try {
            const img = nativeImage.createFromPath(filePath)
            if (img.isEmpty()) throw new Error('Could not read image.')
            const fileName = path.basename(filePath)
            data = { dataUrl: img.toDataURL(), isNinePatch: fileName.endsWith('.9.png'), fileName }
        } catch (err) {
            error = fileOpenError(filePath, err)
        }
    }

    const existingStandalone = getScopedToolWindow('ninepatch', 'standalone')
    if (existingStandalone) {
        focusWindow(existingStandalone)
        if (data) sendToolWindowCommand(existingStandalone, { type: 'importData', ...data })
        else if (error) sendToolWindowCommand(existingStandalone, { type: 'toast', message: error })
        return
    }

    pendingNinepatchStandalone = { data, error }
    const editor = createNinepatchWindow(context, 'standalone')
    await loadBundledEntryOrClose(editor, 'ninepatchEditor')
}

/**
 * Registers all 9-Patch Editor IPC handlers.
 *
 * @param context - Shared IPC context providing store and window helpers.
 */
export function registerNinepatchEditorHandlers(context: IpcContext): void {
    /**
     * Opens the 9-Patch Editor window in the inDock scope. If the window is already
     * open, focuses it. Creates the BrowserWindow with a File/Edit/View native menu
     * and a matching context menu.
     * @param _themeMode - Unused; kept for consistency with other tool window openers.
     * @returns {IpcResult} ok: true if the window was opened or focused; ok: false with error on failure.
     */
    ipcMain.handle('ninepatch:open-editor', async (_event, _themeMode?: unknown): Promise<IpcResult> => {
        try {
            const existingInDock = getScopedToolWindow('ninepatch', 'inDock')
            if (existingInDock) {
                focusWindow(existingInDock)
                return { ok: true }
            }
            const editor = createNinepatchWindow(context, 'inDock')
            await loadBundledEntryOrClose(editor, 'ninepatchEditor')
            return { ok: true }
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : 'Failed to open 9-patch editor.' }
        }
    })

    /**
     * Pull handler for window boot: returns the pending image pre-loaded by the
     * opener (openNinepatchStandalone or ninepatch:open-editor) and clears that
     * scope's pending state. Resolves the requesting window by comparing it to the
     * scoped registry. Falls back to safe defaults if no pending data was set.
     */
    ipcMain.handle('ninepatch:get-initial-data', (event): NinepatchInitialPayload => {
        const sender = BrowserWindow.fromWebContents(event.sender)
        const isStandalone = sender !== null && sender === getScopedToolWindow('ninepatch', 'standalone')
        const isInDock = sender !== null && sender === getScopedToolWindow('ninepatch', 'inDock')
        const payload = isStandalone
            ? (pendingNinepatchStandalone ?? { data: null, error: null })
            : isInDock
                ? (pendingNinepatchInDock ?? { data: null, error: null })
                : { data: null, error: null }
        if (isStandalone) pendingNinepatchStandalone = null
        if (isInDock) pendingNinepatchInDock = null
        return payload
    })

    /**
     * Opens a native Open dialog to import an image (PNG/JPG) into the 9-Patch Editor.
     * Reads the file and sends an importData command to the editor renderer.
     * @returns {IpcResult} ok: true if an image was imported; ok: false if canceled, no window, or read fails.
     */
    ipcMain.handle('ninepatch:import-image', async (event): Promise<IpcResult> => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return { ok: false, error: 'Editor window is not open.' }
        return handleImport(win)
    })

    /**
     * Exports a single 9-patch PNG from the editor (no FHD/HD pairing).
     * Opens a native Save dialog and writes the image buffer from the data URL.
     * @param dataUrl - Base64-encoded PNG data URL of the 9-patch image.
     * @param defaultName - Default filename for the Save dialog (e.g. 'asset.9.png').
     * @returns {IpcResult} ok: true on success; ok: false if canceled, invalid data, or write fails.
     */
    ipcMain.handle('ninepatch:export-single', async (event, dataUrl: string, defaultName: unknown): Promise<IpcResult> => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return { ok: false, error: 'Editor window is not open.' }
        const state = getWindowState(win)
        if (state.dialogInFlight) return { ok: false, error: 'A dialog is already open.' }
        state.dialogInFlight = true
        try {
            if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
                return { ok: false, error: 'Invalid image data.' }
            }
            const result = await dialog.showSaveDialog(win, {
                defaultPath: typeof defaultName === 'string' && defaultName ? defaultName : 'asset.9.png',
                filters: [
                    { name: '9-Patch PNG', extensions: ['9.png'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
            })
            if (result.canceled || !result.filePath) return { ok: false, error: 'Export canceled.' }
            const buffer = dataUrlToBuffer(dataUrl)
            fs.writeFileSync(result.filePath, buffer)
            win.setTitle(`9-Patch Editor - ${path.basename(result.filePath)}`)
            return { ok: true }
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : 'Export failed.' }
        } finally {
            state.dialogInFlight = false
        }
    })

    /**
     * Exports a 9-patch PNG as a paired FHD (1080p) and HD (720p) set.
     * The FHD filename is chosen via a native Save dialog; the HD file is saved alongside
     * it automatically with an _hd suffix replacing _fhd.
     * @param dataUrl1080 - Base64-encoded PNG data URL for the 1080p variant.
     * @param dataUrl720 - Base64-encoded PNG data URL for the 720p variant.
     * @param zones - Unused stretch zone data (handled by the renderer).
     * @param baseName - Optional base name used as the default filename in the dialog.
     * @returns {IpcResult} ok: true on success; ok: false if canceled, invalid data, or write fails.
     */
    ipcMain.handle('ninepatch:export-image', async (event, dataUrl1080: string, dataUrl720: string, zones: unknown, baseName?: unknown): Promise<IpcResult> => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return { ok: false, error: 'Editor window is not open.' }
        return handleExport(win, dataUrl1080, dataUrl720, zones, typeof baseName === 'string' ? baseName : undefined)
    })
}

/**
 * Handles the import flow: shows an Open dialog, loads the selected image with nativeImage,
 * and sends an importData command to the editor renderer with image data and metadata.
 * @param editor - The 9-Patch Editor BrowserWindow to attach the dialog to.
 * @returns {IpcResult} ok: true if the image was loaded and sent; ok: false on cancel or error.
 */
async function handleImport(editor: BrowserWindow): Promise<IpcResult> {
    const state = getWindowState(editor)
    if (state.dialogInFlight) return { ok: false, error: 'A dialog is already open.' }
    state.dialogInFlight = true
    try {
        const result = await dialog.showOpenDialog(editor, {
            title: 'Import Image',
            properties: ['openFile'],
            filters: [
                { name: 'Images', extensions: ['png', 'jpg', 'jpeg'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        })
        if (result.canceled || !result.filePaths[0]) return { ok: false, error: 'Import canceled.' }

        const filePath = result.filePaths[0]
        const img = nativeImage.createFromPath(filePath)
        if (img.isEmpty()) return { ok: false, error: 'Could not read image.' }

        const fileName = path.basename(filePath)
        const isNinePatch = fileName.endsWith('.9.png')
        const dataUrl = img.toDataURL()

        sendToolWindowCommand(editor, { type: 'importData', dataUrl, isNinePatch, fileName })
        return { ok: true }
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Import failed.' }
    } finally {
        state.dialogInFlight = false
    }
}

/**
 * Handles the FHD/HD paired export flow: shows a Save dialog for the FHD file, writes it,
 * then derives the HD filename by replacing the _fhd suffix with _hd and writes that too.
 * Updates the editor window title to the saved FHD filename.
 * @param editor - The 9-Patch Editor BrowserWindow to attach the Save dialog to.
 * @param dataUrl1080 - Base64-encoded PNG data URL for the 1080p variant.
 * @param dataUrl720 - Base64-encoded PNG data URL for the 720p variant.
 * @param zones - Unused (stretch zone data is renderer-only).
 * @param baseName - Optional default stem for the Save dialog filename.
 * @returns {IpcResult} ok: true on success; ok: false if canceled, invalid data, or write fails.
 */
async function handleExport(editor: BrowserWindow, dataUrl1080: string, dataUrl720: string, zones: unknown, baseName?: string): Promise<IpcResult> {
    const state = getWindowState(editor)
    if (state.dialogInFlight) return { ok: false, error: 'A dialog is already open.' }
    state.dialogInFlight = true
    try {
        if (typeof dataUrl1080 !== 'string' || !dataUrl1080.startsWith('data:image')) {
            return { ok: false, error: 'Invalid image data.' }
        }

        const defaultBase = baseName || 'asset'
        const result = await dialog.showSaveDialog(editor, {
            defaultPath: `${defaultBase}_fhd.9.png`,
            filters: [
                { name: '9-Patch PNG', extensions: ['9.png'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        })
        if (result.canceled || !result.filePath) return { ok: false, error: 'Export canceled.' }

        // Save 1080p
        const buffer1080 = dataUrlToBuffer(dataUrl1080)
        fs.writeFileSync(result.filePath, buffer1080)

        // Save 720p alongside - replace _fhd suffix with _hd, or insert _hd before the extension
        const savedName = path.basename(result.filePath)
        const baseName720 = savedName.endsWith('.9.png')
            ? savedName.slice(0, -5).replace(/_fhd$/, '') + '_hd.9.png'
            : savedName.replace(/_fhd(\.[^.]+)$/, '_hd$1').replace(/(\.[^.]+)$/, '_hd$1')
        const filePath720 = path.join(path.dirname(result.filePath), baseName720)
        if (typeof dataUrl720 === 'string' && dataUrl720.startsWith('data:image')) {
            const buffer720 = dataUrlToBuffer(dataUrl720)
            fs.writeFileSync(filePath720, buffer720)
        }

        editor.setTitle(`9-Patch Editor - ${savedName}`)
        return { ok: true }
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Export failed.' }
    } finally {
        state.dialogInFlight = false
    }
}
