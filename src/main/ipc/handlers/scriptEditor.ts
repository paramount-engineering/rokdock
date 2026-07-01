/**
 * IPC handlers for the Script Editor tool window.
 *
 * Manages the script editor BrowserWindow in two scopes: 'standalone' (CLI launch or
 * file-association) and 'inDock' (opened from within the dock). The scoped registry in
 * toolWindow.ts tracks at most one live window per scope. Each window owns its own
 * ScriptEngine instance via a per-window WeakMap record so two coexisting script windows
 * can run scripts independently without interfering with each other.
 *
 * The ScriptLibrary instance is created here (singleton per app session) and provides
 * persistent JSON storage for scripts in userData/scripts/.
 *
 * Playback uses a ScriptEngine per window. Engine events (step-start, step-complete,
 * engine-failed, etc.) are pushed to the owning window and to all windows so the main
 * window Scripts panel can show running state without the editor being open.
 */

import { BrowserWindow, dialog, ipcMain } from 'electron'
import { focusWindow } from '../../focusPolicy'
import fs from 'fs'
import http from 'http'
import path from 'path'
import {
    SCRIPT_EDITOR_WIDTH, SCRIPT_EDITOR_HEIGHT,
    SCRIPT_EDITOR_MIN_WIDTH, SCRIPT_EDITOR_MIN_HEIGHT
} from '../../constants/preview'
import { ScriptLibrary } from '../../services/scriptLibrary'
import { ScriptEngine, EngineEvent } from '../../services/scriptEngine'
import { importRasp, exportRasp, isRaspFile } from '../../utils/raspInterop'
import { fileOpenError } from '../../utils/fileOpenError'
import { fileStem } from '../../utils/fileStem'
import { ecpRequest } from '../../services/ecp'
import { isValidIp } from '../../utils/validation'
import { xmlParser } from '../../utils/xml'
import {
    createToolWindow,
    loadBundledEntryOrClose,
    getScopedToolWindow,
    setScopedToolWindow,
    type ToolWindowScope
} from '../toolWindow'
import { sendToolWindowCommand } from '../toolWindowCommand'
import type { IpcContext, IpcResult } from '../types'
import type { ScriptFile, Step } from '../../../shared/script'
import { ECP_PORT } from '../../../shared/ports'

const library = new ScriptLibrary()

interface PendingInitialData {
    script: ScriptFile
    startRecording: boolean
    initialDeviceIp: string
    initialFilePath: string | null
    initialError: string | null
    /** Lossy-conversion notices from a RASP import, surfaced once the editor boots. */
    initialWarnings: string[]
}

let pendingScriptStandalone: PendingInitialData | null = null
let pendingScriptInDock: PendingInitialData | null = null

/** Per-window state: the running engine (if any) and the native-dialog guard. */
interface ScriptWindowState {
    engine: ScriptEngine | null
    dialogInFlight: boolean
}

// A WeakMap avoids retaining windows past their lifetime.
const windowStateMap = new WeakMap<BrowserWindow, ScriptWindowState>()

function getWindowState(win: BrowserWindow): ScriptWindowState {
    let state = windowStateMap.get(win)
    if (!state) {
        state = { engine: null, dialogInFlight: false }
        windowStateMap.set(win, state)
    }
    return state
}

/** The empty script used when no file is loaded (CLI launch with no path, or a dev hot-reload). */
function blankScriptFile(): ScriptFile {
    return { version: 1, name: '(untitled)', raspMode: true, metadata: { defaultKeypressWait: 1 }, steps: [] }
}

/**
 * Sends an IPC message to a specific Script Editor window if it is open and not destroyed.
 * @param win - The target BrowserWindow.
 * @param channel - The IPC channel name.
 * @param args - Arguments to pass to the renderer.
 */
function sendToEditor(win: BrowserWindow, channel: string, ...args: unknown[]): void {
    if (!win.isDestroyed()) {
        win.webContents.send(channel, ...args)
    }
}

/**
 * Creates the Script Editor BrowserWindow. The title varies (it carries the script name),
 * so callers pass it in. Closing the window stops that window's engine and removes it from
 * the scoped registry.
 * @param context - Shared IPC context providing window helpers.
 * @param title - Window title, typically `Script Editor - ${scriptName}`.
 * @param scope - Whether this is a standalone (CLI) or inDock window.
 */
function createScriptWindow(context: IpcContext, title: string, scope: ToolWindowScope): BrowserWindow {
    const win = createToolWindow({
        context,
        title,
        width: SCRIPT_EDITOR_WIDTH,
        height: SCRIPT_EDITOR_HEIGHT,
        minWidth: SCRIPT_EDITOR_MIN_WIDTH,
        minHeight: SCRIPT_EDITOR_MIN_HEIGHT,
        iconKey: 'script',
        onClosed: () => {
            const state = windowStateMap.get(win)
            if (state) {
                state.engine?.stop()
                state.engine = null
            }
        }
    })
    // Register before loading the entry so script-editor:get-initial-data resolves this window's scope.
    setScopedToolWindow('script', scope, win)
    return win
}

/**
 * Opens the script editor as a standalone CLI launch, optionally loading a
 * script file. Main parses it via library.load. A fresh window pulls the script
 * via script-editor:get-initial-data. An already-open window gets load-steps.
 */
export async function openScriptEditorStandalone(context: IpcContext, filePath?: string): Promise<void> {
    let script: ScriptFile | null = null
    let warnings: string[] = []
    let error: string | null = null
    if (filePath) {
        try {
            // .rasp/.yaml/.yml come through the (lossy) RASP importer, whose warnings
            // are carried to the renderer so the open surfaces the same notice the
            // in-app import does. A native .rscript is full-fidelity (no warnings).
            if (isRaspFile(filePath)) {
                const imported = importRasp(fs.readFileSync(filePath, 'utf-8'), fileStem(filePath))
                script = imported.script
                warnings = imported.warnings
            } else {
                script = library.load(filePath)
            }
        } catch (err) {
            error = fileOpenError(filePath, err)
        }
    }

    const existingStandalone = getScopedToolWindow('script', 'standalone')
    if (existingStandalone) {
        focusWindow(existingStandalone)
        if (script) sendToEditor(existingStandalone, 'script-editor:load-steps', script.steps, script.name, filePath ?? null)
        else if (error) sendToolWindowCommand(existingStandalone, { type: 'toast', message: error })
        return
    }

    pendingScriptStandalone = {
        script: script ?? blankScriptFile(),
        startRecording: false,
        initialDeviceIp: '',
        // Only retain the path when the file actually loaded, so a failed load
        // does not leave the editor pointed at an unreadable file.
        initialFilePath: script !== null ? (filePath ?? null) : null,
        initialError: error,
        initialWarnings: warnings,
    }
    const win = createScriptWindow(context, `Script Editor - ${script ? script.name : '(untitled)'}`, 'standalone')
    await loadBundledEntryOrClose(win, 'scriptEditor')
}

/**
 * Registers all Script Editor IPC handlers and initializes the script library.
 *
 * @param context - Shared IPC context providing ECP, store, and window helpers.
 */
export function registerScriptEditorHandlers(context: IpcContext): void {
    library.init()

    // Open editor window

    /**
     * Opens the Script Editor window in the inDock scope with optional initial content.
     * If the window is already open, sends the provided steps to the existing window
     * (replacing its current content) and focuses it.
     * @param options.steps - Pre-loaded script steps for the editor.
     * @param options.name - Script name shown in the title bar and script name field.
     * @param options.metadata - Optional script metadata (description, author, etc.).
     * @param options.filePath - File path of an existing script being edited.
     * @param options.themeMode - Unused; kept for consistency with other tool openers.
     * @param options.recording - Whether to start the editor in recording mode.
     * @param options.deviceIp - Pre-fills the target device IP in the editor.
     * @returns {IpcResult} ok: true on success; ok: false with error on failure.
     */
    ipcMain.handle('script-editor:open', async (_event, options?: {
        steps?: Step[]
        name?: string
        metadata?: ScriptFile['metadata']
        filePath?: string
        themeMode?: 'dark' | 'light'
        recording?: boolean
        deviceIp?: string
    }): Promise<IpcResult> => {
        try {
            const existingInDock = getScopedToolWindow('script', 'inDock')
            if (existingInDock) {
                if (options?.steps) {
                    sendToEditor(existingInDock, 'script-editor:load-steps', options.steps, options.name ?? '', options.filePath ?? null)
                }
                focusWindow(existingInDock)
                return { ok: true }
            }

            const initialScript: ScriptFile = {
                version: 1,
                name: options?.name ?? '(untitled)',
                raspMode: true,
                metadata: options?.metadata,
                steps: options?.steps ?? []
            }

            pendingScriptInDock = {
                script: initialScript,
                startRecording: options?.recording ?? false,
                initialDeviceIp: options?.deviceIp ?? '',
                initialFilePath: options?.filePath ?? null,
                initialError: null,
                initialWarnings: []
            }

            const win = createScriptWindow(context, `Script Editor - ${initialScript.name}`, 'inDock')
            await loadBundledEntryOrClose(win, 'scriptEditor')
            return { ok: true }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            return { ok: false, error: message }
        }
    })

    // Pull-model initial data

    /**
     * Returns the initial data payload for the requesting window and clears it so
     * subsequent calls (e.g. hot-reload during development) receive a blank script.
     * Resolves the requesting window by comparing it to the scoped registry entries.
     */
    ipcMain.handle('script-editor:get-initial-data', (event): PendingInitialData => {
        const sender = BrowserWindow.fromWebContents(event.sender)
        const isStandalone = sender !== null && sender === getScopedToolWindow('script', 'standalone')
        const isInDock = sender !== null && sender === getScopedToolWindow('script', 'inDock')
        const blankPayload: PendingInitialData = {
            script: blankScriptFile(),
            startRecording: false,
            initialDeviceIp: '',
            initialFilePath: null,
            initialError: null,
            initialWarnings: []
        }
        const payload = isStandalone
            ? (pendingScriptStandalone ?? blankPayload)
            : isInDock
                ? (pendingScriptInDock ?? blankPayload)
                : blankPayload
        if (isStandalone) pendingScriptStandalone = null
        if (isInDock) pendingScriptInDock = null
        return payload
    })

    // Script library operations

    /**
     * Returns the list of all scripts from the persistent script library.
     * @returns {IpcResult & { scripts? }} ok: true with the script list on success.
     */
    ipcMain.handle('script-editor:list', async (): Promise<IpcResult & { scripts?: ReturnType<ScriptLibrary['list']> }> => {
        try {
            return { ok: true, scripts: library.list() }
        } catch (err) {
            return { ok: false, error: String(err) }
        }
    })

    /**
     * Loads a script from the library by its file path and updates the sender window title.
     * @param filePath - Absolute path to the script JSON file.
     * @returns { ok: true, script } with the parsed ScriptFile on success; { ok: false, error } on failure.
     */
    ipcMain.handle('script-editor:load', async (event, filePath: string): Promise<IpcResult & { script?: ScriptFile }> => {
        try {
            const script = library.load(filePath)
            const win = BrowserWindow.fromWebContents(event.sender)
            if (win && !win.isDestroyed()) {
                win.setTitle(`Script Editor - ${script.name}`)
            }
            return { ok: true, script }
        } catch (err) {
            return { ok: false, error: String(err) }
        }
    })

    /**
     * Saves a script to the persistent library and broadcasts a scripts-changed event.
     * Updates the sender window title.
     * @param script - The ScriptFile object to persist.
     * @returns { ok: true, filePath } with the saved path; { ok: false, error } on failure.
     */
    ipcMain.handle('script-editor:save', async (event, script: ScriptFile): Promise<IpcResult & { filePath?: string }> => {
        try {
            const filePath = library.save(script)
            const win = BrowserWindow.fromWebContents(event.sender)
            if (win && !win.isDestroyed()) {
                win.setTitle(`Script Editor - ${script.name}`)
            }
            context.sendToAllWindows('script-editor:scripts-changed')
            return { ok: true, filePath }
        } catch (err) {
            return { ok: false, error: String(err) }
        }
    })

    /**
     * Deletes a script from the library and broadcasts a scripts-changed event.
     * @param filePath - Absolute path to the script JSON file to delete.
     * @returns {IpcResult} ok: true on success; ok: false with error on failure.
     */
    ipcMain.handle('script-editor:delete', async (_event, filePath: string): Promise<IpcResult> => {
        try {
            library.delete(filePath)
            context.sendToAllWindows('script-editor:scripts-changed')
            return { ok: true }
        } catch (err) {
            return { ok: false, error: String(err) }
        }
    })

    /**
     * Deletes all scripts from the library and broadcasts a scripts-changed event.
     * @returns {IpcResult} ok: true on success; ok: false with error on failure.
     */
    ipcMain.handle('script-editor:delete-all', async (): Promise<IpcResult> => {
        try {
            library.deleteAll()
            context.sendToAllWindows('script-editor:scripts-changed')
            return { ok: true }
        } catch (err) {
            return { ok: false, error: String(err) }
        }
    })

    /**
     * Persists the user-defined sort order for the script library.
     * @param order - Array of script file paths in the desired display order.
     * @returns {IpcResult} ok: true on success; ok: false with error on failure.
     */
    ipcMain.handle('script-editor:save-sort-order', async (_event, order: string[]): Promise<IpcResult> => {
        try {
            library.saveSortOrder(order)
            context.sendToAllWindows('script-editor:scripts-changed')
            return { ok: true }
        } catch (err) {
            return { ok: false, error: String(err) }
        }
    })

    // RASP import / export

    /**
     * Parses a RASP YAML string into a ScriptFile without showing a file dialog.
     * Used when the user pastes RASP text directly into the import field.
     * @param yamlText - The RASP YAML content to parse.
     * @param name - Optional name override for the resulting script.
     * @returns { ok: true, script, warnings } on success; { ok: false, error } on parse failure.
     */
    ipcMain.handle('script-editor:import-rasp-text', async (_event, yamlText: string, name?: string): Promise<IpcResult & { script?: ScriptFile; warnings?: string[] }> => {
        try {
            const { script, warnings } = importRasp(yamlText, name ?? 'Pasted Script')
            return { ok: true, script, warnings }
        } catch (err) {
            return { ok: false, error: String(err) }
        }
    })

    /**
     * Opens a native Open dialog filtered to RASP files (.rasp, .yaml, .yml)
     * and imports the selected file as a ScriptFile. The dialog is parented to the
     * sender window, with a fallback to the focused or first window.
     * @returns { ok: true, script, warnings } on success; { ok: false } if canceled; { ok: false, error } on parse failure.
     */
    ipcMain.handle('script-editor:import-rasp', async (event): Promise<IpcResult & { script?: ScriptFile; warnings?: string[] }> => {
        const senderWin = BrowserWindow.fromWebContents(event.sender)
        const win = senderWin ?? context.getFocusedOrFirstWindow()
        const state = senderWin ? getWindowState(senderWin) : null
        if (state?.dialogInFlight) return { ok: false, error: 'A dialog is already open.' }
        if (state) state.dialogInFlight = true
        try {
            // Dialogs need a parent. win is realistically always the sender window;
            // guard the impossible no-window case with a hidden throwaway we destroy
            // after use, matching sideload.ts (never a visible, leaked, focus-stealing one).
            const parent = win ?? new BrowserWindow({ show: false })
            try {
                const result = await dialog.showOpenDialog(parent, {
                    title: 'Import RASP File',
                    filters: [{ name: 'RASP Files', extensions: ['rasp', 'yaml', 'yml'] }, { name: 'All Files', extensions: ['*'] }],
                    properties: ['openFile']
                })
                if (result.canceled || result.filePaths.length === 0) return { ok: false }
                const yamlText = fs.readFileSync(result.filePaths[0], 'utf-8')
                const name = fileStem(result.filePaths[0])
                const { script, warnings } = importRasp(yamlText, name)
                return { ok: true, script, warnings }
            } finally {
                if (!win) parent.destroy()
            }
        } catch (err) {
            return { ok: false, error: String(err) }
        } finally {
            if (state) state.dialogInFlight = false
        }
    })

    /**
     * Converts a ScriptFile to RASP YAML format and saves it via a native Save dialog.
     * The dialog is parented to the sender window, with a fallback to the focused or first window.
     * @param script - The script to export.
     * @returns { ok: true, warnings } on success; { ok: false } if canceled; { ok: false, error } on failure.
     */
    ipcMain.handle('script-editor:export-rasp', async (event, script: ScriptFile): Promise<IpcResult & { warnings?: string[] }> => {
        const senderWin = BrowserWindow.fromWebContents(event.sender)
        const win = senderWin ?? context.getFocusedOrFirstWindow()
        const state = senderWin ? getWindowState(senderWin) : null
        if (state?.dialogInFlight) return { ok: false, error: 'A dialog is already open.' }
        if (state) state.dialogInFlight = true
        try {
            const { yaml, warnings } = exportRasp(script)
            // Hidden throwaway parent for the impossible no-window case (see import-rasp).
            const parent = win ?? new BrowserWindow({ show: false })
            try {
                const result = await dialog.showSaveDialog(parent, {
                    title: 'Export as RASP',
                    defaultPath: `${script.name}.yaml`,
                    filters: [{ name: 'RASP Files', extensions: ['yaml'] }]
                })
                if (result.canceled || !result.filePath) return { ok: false }
                fs.writeFileSync(result.filePath, yaml, 'utf-8')
                return { ok: true, warnings }
            } finally {
                if (!win) parent.destroy()
            }
        } catch (err) {
            return { ok: false, error: String(err) }
        } finally {
            if (state) state.dialogInFlight = false
        }
    })

    /**
     * Converts a ScriptFile to RASP YAML format and returns the YAML string without saving to disk.
     * Used to copy the RASP representation to the clipboard in the renderer.
     * @param script - The script to convert.
     * @returns { ok: true, yaml, warnings } on success; { ok: false, error } on failure.
     */
    ipcMain.handle('script-editor:copy-rasp', async (_event, script: ScriptFile): Promise<IpcResult & { yaml?: string; warnings?: string[] }> => {
        try {
            const { yaml, warnings } = exportRasp(script)
            return { ok: true, yaml, warnings }
        } catch (err) {
            return { ok: false, error: String(err) }
        }
    })

    /**
     * Queries the device's installed app list via ECP /query/apps and returns parsed results.
     * @param deviceIp - The IP address of the target Roku device.
     * @returns { ok: true, apps } with id/name pairs; { ok: false, error } on failure.
     */
    ipcMain.handle('script-editor:query-apps', async (_event, deviceIp: string): Promise<IpcResult & { apps?: { id: string; name: string }[] }> => {
        if (!isValidIp(deviceIp)) return { ok: false, error: 'Invalid device IP address' }
        try {
            const xml = await ecpRequest(deviceIp, 'GET', '/query/apps')
            const parsed = xmlParser.parse(xml)
            const raw = parsed?.apps?.app
            const rawApps: unknown[] = Array.isArray(raw) ? raw : raw ? [raw] : []
            const apps = rawApps.map((appElement: unknown) => {
                const app = appElement as Record<string, unknown>
                return {
                    id: String(app?.['@_id'] ?? ''),
                    name: String(app?.['#text'] ?? app?.name ?? '')
                }
            }).filter(appEntry => appEntry.id && appEntry.name)
            return { ok: true, apps }
        } catch (err) {
            return { ok: false, error: String(err) }
        }
    })

    /**
     * Fetches the icon for a specific app from the device via ECP /query/icon/:appId.
     * Returns the icon as a base64 data URI.
     * @param deviceIp - The IP address of the target Roku device.
     * @param appId - The Roku app/channel ID whose icon to fetch.
     * @returns { ok: true, dataUri } with the base64 image; { ok: false } on timeout or error.
     */
    ipcMain.handle('script-editor:query-app-icon', async (_event, deviceIp: string, appId: string): Promise<IpcResult & { dataUri?: string }> => {
        if (!isValidIp(deviceIp)) return { ok: false, error: 'Invalid device IP address' }
        try {
            const dataUri = await new Promise<string>((resolve, reject) => {
                const req = http.request({ hostname: deviceIp, port: ECP_PORT, path: `/query/icon/${encodeURIComponent(appId)}`, method: 'GET', timeout: 5000 }, res => {
                    const chunks: Buffer[] = []
                    res.on('data', (chunk: Buffer) => chunks.push(chunk))
                    res.on('end', () => {
                        const buf = Buffer.concat(chunks)
                        const mime = res.headers['content-type'] || 'image/png'
                        resolve(`data:${mime};base64,${buf.toString('base64')}`)
                    })
                    res.on('error', reject)
                })
                req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
                req.on('error', reject)
                req.end()
            })
            return { ok: true, dataUri }
        } catch {
            return { ok: false }
        }
    })

    // Playback

    /**
     * Starts playback of a script on the specified device for the requesting window.
     * Stops any engine already running in that window before starting a new one.
     * Engine events (step-start, step-complete, engine-failed, etc.) are pushed to the
     * owning window and to all windows so the main window Scripts panel can reflect
     * running state without the editor being open.
     * Playback runs non-blocking. Errors surface through engine events.
     * @param script - The ScriptFile to execute.
     * @param deviceIp - The IP address of the target Roku device.
     * @returns {IpcResult} ok: true immediately (engine runs asynchronously); ok: false on init error.
     */
    ipcMain.handle('script-editor:play', async (event, script: ScriptFile, deviceIp: string): Promise<IpcResult> => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return { ok: false, error: 'Editor window is not available.' }
        try {
            const state = getWindowState(win)
            if (state.engine) state.engine.stop()

            const engine = new ScriptEngine(context.ecp, (ev: EngineEvent) => {
                // Deliver engine events to the window that started the run and to every
                // non-script-editor window (the dock Scripts panel shows running state).
                // Skip the other scoped script editor window, which runs its own session,
                // so one window's playback never drives the other's step highlighting.
                const otherScriptWindows = [
                    getScopedToolWindow('script', 'standalone'),
                    getScopedToolWindow('script', 'inDock'),
                ]
                for (const target of BrowserWindow.getAllWindows()) {
                    if (target.isDestroyed()) continue
                    if (target !== win && otherScriptWindows.includes(target)) continue
                    target.webContents.send('script-editor:engine-event', ev)
                }
            })
            state.engine = engine

            // Run playback non-blocking - results come back via engine events
            engine.play(script, deviceIp).catch(() => { /* errors surfaced via events */ })
            return { ok: true }
        } catch (err) {
            return { ok: false, error: String(err) }
        }
    })

    /**
     * Stops the script engine running in the requesting window, if one is active.
     * @returns {IpcResult} Always returns ok: true.
     */
    ipcMain.handle('script-editor:stop-playback', async (event): Promise<IpcResult> => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (win) {
            getWindowState(win).engine?.stop()
        }
        return { ok: true }
    })

}
