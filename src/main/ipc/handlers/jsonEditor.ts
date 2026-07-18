/**
 * IPC handlers for the JSON Editor tool window.
 *
 * Manages the JSON Editor BrowserWindow in two scopes: 'standalone' (CLI launch,
 * persistent session) and 'inDock' (opened from within the dock, ephemeral). The
 * scoped registry in toolWindow.ts tracks at most one live window per scope. Each
 * window receives its own pending initial data via json:get-initial-data, which
 * identifies the requesting window by comparing it to the registry entries.
 *
 * The standalone scope loads and saves session state via JsonSessionStore so tabs
 * survive across launches. The inDock scope has no persistence: it opens with
 * content supplied by the caller and does not write session snapshots.
 *
 * File operations (open, save, save-as) use native dialogs attached to the editor
 * window instance. The editor window has a full application menu with File/Edit/View
 * and a matching context menu with the same actions.
 *
 * The renderer entry is a bundled Vite entry (jsonEditor.html). Initial content and
 * font/color settings are delivered to the renderer via the json:get-initial-data IPC
 * handler instead of baking them into the HTML.
 */

import { BrowserWindow, clipboard, dialog, ipcMain, Menu } from 'electron'
import { focusWindow } from '../../focusPolicy'
import fs from 'fs'
import path from 'path'
import { fileOpenError } from '../../utils/fileOpenError'
import {
    JSON_EDITOR_HEIGHT,
    JSON_EDITOR_MIN_HEIGHT,
    JSON_EDITOR_MIN_WIDTH,
    JSON_EDITOR_WIDTH
} from '../../constants/preview'
import {
    createToolWindow,
    loadBundledEntryOrClose,
    getScopedToolWindow,
    setScopedToolWindow,
    type ToolWindowScope
} from '../toolWindow'
import { sendToolWindowCommand } from '../toolWindowCommand'
import type { JsonEditorCommand } from '../../../shared/toolWindowCommands'
import type { IpcContext, IpcResult } from '../types'
import { JsonSessionStore } from '../../services/jsonSessionStore'
import type { JsonSessionSnapshot, JsonRestoredSession } from '../../../shared/jsonSession'

const isMac = process.platform === 'darwin'

const jsonSessionStore = new JsonSessionStore()

// -- Initial-data handoff --

interface InitialData {
    initialContent: string | null
    initialTitle: string | null
    /** Full path of a file launched on the CLI, used to dedupe against restored tabs. */
    initialFilePath: string | null
    initialError: string | null
    /**
     * Code-surface appearance (font, syntax theme, background, mono fallback),
     * overlaid fresh from the persisted prefs in get-initial-data so the editor
     * always opens matching the saved settings regardless of how it was launched.
     * The renderer resolves these raw fields into CodeMirror token colors itself.
     */
    fontFamily: string
    fontSize: number
    syntaxPreset: string
    syntaxCustom: Record<string, string>
    useThemeBackground: boolean
    fallbackColor: string
    /** True only for the standalone window. The renderer enables persistence and restore. */
    persist: boolean
    /** Restored session for the standalone window, or null. */
    session: JsonRestoredSession | null
}

let pendingStandalone: InitialData | null = null
let pendingInDock: InitialData | null = null

function blankInitialData(): InitialData {
    return {
        initialContent: null,
        initialTitle: null,
        initialFilePath: null,
        initialError: null,
        fontFamily: '',
        fontSize: 13,
        syntaxPreset: 'rokdockDark',
        syntaxCustom: {},
        useThemeBackground: false,
        fallbackColor: '#e0e0e0',
        persist: false,
        session: null,
    }
}

// -- Menu helpers --

/**
 * Returns the Edit menu items that are structurally and behaviorally identical
 * between the app menu and the context menu: Undo, Redo, separator.
 * Items that differ between the two menus (cut enabled-gating, copy click
 * routing, selectAll routing) are intentionally excluded and defined inline.
 * @param sendCommand - Sends a typed command to the editor renderer.
 * @returns Array of MenuItemConstructorOptions for Undo, Redo, and a separator.
 */
function editUndoRedoItems(
    sendCommand: (command: JsonEditorCommand) => void
): Electron.MenuItemConstructorOptions[] {
    return [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => sendCommand({ type: 'undo' }) },
        { label: 'Redo', accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y', click: () => sendCommand({ type: 'redo' }) },
        { type: 'separator' }
    ]
}

/**
 * Builds the full application menu for the JSON Editor window.
 * Menu actions delegate to the renderer via the typed tool-window command channel.
 * @param win - The JSON Editor BrowserWindow instance.
 * @returns The constructed Electron Menu.
 */
function buildEditorMenu(win: BrowserWindow): Menu {
    const sendCommand = (command: JsonEditorCommand) => sendToolWindowCommand(win, command)
    const template: Electron.MenuItemConstructorOptions[] = [
        {
            label: 'File',
            submenu: [
                { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => sendCommand({ type: 'newTab' }) },
                { label: 'Open...', accelerator: 'CmdOrCtrl+O', click: () => sendCommand({ type: 'openFile' }) },
                { type: 'separator' },
                { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendCommand({ type: 'save' }) },
                { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendCommand({ type: 'saveAs' }) },
                { type: 'separator' },
                { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => sendCommand({ type: 'closeTab' }) },
                { type: 'separator' },
                isMac
                    ? { role: 'close', label: 'Close Window' }
                    : { label: 'Close Window', accelerator: 'Alt+F4', click: () => { if (!win.isDestroyed()) win.close() } }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                ...editUndoRedoItems(sendCommand),
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' },
                { type: 'separator' },
                { label: 'Find', accelerator: 'CmdOrCtrl+F', click: () => sendCommand({ type: 'find' }) },
                { type: 'separator' },
                { label: 'Jump to Error', click: () => sendCommand({ type: 'jumpToError' }) }
            ]
        },
        {
            label: 'View',
            submenu: [
                { label: 'Format JSON', click: () => sendCommand({ type: 'format' }) },
                { label: 'Minify JSON', click: () => sendCommand({ type: 'minify' }) },
                { type: 'separator' },
                { label: 'Fold All', click: () => sendCommand({ type: 'foldAll' }) },
                { label: 'Unfold All', click: () => sendCommand({ type: 'unfoldAll' }) },
                { type: 'separator' },
                { label: 'Sort Keys at Cursor', click: () => sendCommand({ type: 'sortAtCursor' }) },
                { type: 'separator' },
                { label: 'Unescape Nested JSON', click: () => sendCommand({ type: 'unescapeNested' }) },
                { type: 'separator' },
                { role: 'toggleDevTools' },
                { role: 'reload' }
            ]
        }
    ]
    return Menu.buildFromTemplate(template)
}

/**
 * Attaches a context-menu listener to the JSON Editor window's WebContents.
 * The menu mirrors editor operations (undo, redo, cut, copy, paste, format, fold, etc.)
 * and respects whether there is an active text selection for copy/cut.
 * @param win - The JSON Editor BrowserWindow instance.
 */
function setupContextMenu(win: BrowserWindow): void {
    const sendCommand = (command: JsonEditorCommand) => sendToolWindowCommand(win, command)
    win.webContents.on('context-menu', (_event, params) => {
        if (win.isDestroyed()) return
        const hasSelection = (params.selectionText ?? '').length > 0
        const template: Electron.MenuItemConstructorOptions[] = [
            ...editUndoRedoItems(sendCommand),
            { role: 'cut', enabled: hasSelection },
            {
                label: 'Copy',
                accelerator: 'CmdOrCtrl+C',
                enabled: hasSelection,
                click: () => { clipboard.writeText(params.selectionText) }
            },
            { role: 'paste' },
            { type: 'separator' },
            { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: () => sendCommand({ type: 'selectAll' }) },
            { type: 'separator' },
            { label: 'Format JSON', click: () => sendCommand({ type: 'format' }) },
            { label: 'Minify JSON', click: () => sendCommand({ type: 'minify' }) },
            { type: 'separator' },
            { label: 'Fold All', click: () => sendCommand({ type: 'foldAll' }) },
            { label: 'Unfold All', click: () => sendCommand({ type: 'unfoldAll' }) },
            { type: 'separator' },
            { label: 'Sort Keys at Cursor', click: () => sendCommand({ type: 'sortAtCursor' }) },
            { type: 'separator' },
            { label: 'Unescape Nested JSON', click: () => sendCommand({ type: 'unescapeNested' }) },
            { label: 'Jump to Error', click: () => sendCommand({ type: 'jumpToError' }) }
        ]
        const menu = Menu.buildFromTemplate(template)
        menu.popup({ window: win, x: params.x, y: params.y })
    })
}

// -- Window factory --

/**
 * Creates and configures a JSON Editor BrowserWindow via the shared tool-window helper,
 * registers it in the scoped registry for the given scope, and sets up the menu,
 * context menu, and zoom level. The caller loads the bundled entry via
 * loadBundledEntryOrClose() after this returns.
 * @param context - Shared IPC context for store and window helpers.
 * @param sourceZoomLevel - Zoom level from the originating window, applied to the editor.
 * @param scope - Whether this is a standalone (CLI) or inDock window.
 * @returns The newly created BrowserWindow.
 */
function createEditorWindow(
    context: IpcContext,
    sourceZoomLevel: number,
    scope: ToolWindowScope
): BrowserWindow {
    const editorWin = createToolWindow({
        context,
        title: 'JSON Editor',
        width: JSON_EDITOR_WIDTH,
        height: JSON_EDITOR_HEIGHT,
        minWidth: JSON_EDITOR_MIN_WIDTH,
        minHeight: JSON_EDITOR_MIN_HEIGHT,
        iconKey: 'json',
        sourceZoomLevel,
        buildMenu: buildEditorMenu,
        setupContextMenu,
    })
    // Register before loading the entry so json:get-initial-data resolves this window's scope.
    setScopedToolWindow('json', scope, editorWin)
    return editorWin
}

// -- Handler registration --

/**
 * Registers all JSON Editor IPC handlers.
 *
 * @param context - Shared IPC context providing store and window helpers.
 */
export function registerJsonEditorHandlers(context: IpcContext): void {
    /**
     * Returns the pending initial data to the renderer on first load.
     * Resolves the requesting window by comparing it to the scoped registry so each
     * scope gets its own pending payload. Falls back to safe defaults if no pending
     * data was set (e.g. dev reload).
     */
    ipcMain.handle('json:get-initial-data', (event): InitialData => {
        const sender = BrowserWindow.fromWebContents(event.sender)
        const isStandalone = sender !== null && sender === getScopedToolWindow('json', 'standalone')
        const isInDock = sender !== null && sender === getScopedToolWindow('json', 'inDock')
        const data = isStandalone
            ? (pendingStandalone ?? blankInitialData())
            : isInDock
                ? (pendingInDock ?? blankInitialData())
                : blankInitialData()
        if (isStandalone) pendingStandalone = null
        if (isInDock) pendingInDock = null
        // Code-surface appearance always reflects the current persisted prefs, so the
        // editor opens matching the saved theme, font, syntax, and background no matter
        // which path launched it (dock menu, terminal View JSON, CLI, file association).
        // The renderer resolves these raw fields into token colors itself.
        const preferences = context.store.getPreferences()
        return {
            ...data,
            fontFamily: preferences.fontFamily ?? '',
            fontSize: preferences.fontSize ?? 13,
            syntaxPreset: preferences.terminalSyntaxThemePreset ?? 'rokdockDark',
            syntaxCustom: (preferences.terminalSyntaxThemeCustomColors ?? {}) as Record<string, string>,
            useThemeBackground: preferences.terminalUseThemeBackground ?? true,
            fallbackColor: preferences.terminalFallbackColor ?? '#e0e0e0',
        }
    })

    /**
     * Opens the JSON Editor window in the inDock scope. If the window is already
     * open, focuses it. Stores pending initial data and loads the bundled renderer entry.
     * Appearance (font, syntax, background) is read from prefs in get-initial-data,
     * so no appearance arguments are passed here.
     * @returns {IpcResult} ok: true if the window was opened or focused; ok: false with error on failure.
     */
    ipcMain.handle(
        'json:open-editor',
        async (event): Promise<IpcResult> => {
            try {
                const existing = getScopedToolWindow('json', 'inDock')
                if (existing) {
                    focusWindow(existing)
                    return { ok: true }
                }

                pendingInDock = blankInitialData()

                const sourceZoomLevel = event?.sender?.getZoomLevel?.() ?? 0
                const editorWin = createEditorWindow(context, sourceZoomLevel, 'inDock')
                await loadBundledEntryOrClose(editorWin, 'jsonEditor')
                return { ok: true }
            } catch (err) {
                return { ok: false, error: err instanceof Error ? err.message : 'Failed to open JSON editor.' }
            }
        }
    )

    /**
     * Adds a new tab to the inDock JSON Editor with the given content.
     * If the editor window is not open, creates it with the content as the initial tab.
     * If the window is already open, sends an addTab command to the renderer over the typed IPC channel.
     * Appearance is read from prefs in get-initial-data, so only the content is passed.
     * @param prettyJson - The JSON string to populate in the new tab.
     * @returns {IpcResult} ok: true on success; ok: false with error on failure.
     */
    ipcMain.handle(
        'json:add-tab',
        async (event, prettyJson: string): Promise<IpcResult> => {
            try {
                const existing = getScopedToolWindow('json', 'inDock')
                if (existing) {
                    sendToolWindowCommand(existing, { type: 'addTab', content: prettyJson })
                    focusWindow(existing)
                    return { ok: true }
                }

                pendingInDock = {
                    ...blankInitialData(),
                    initialContent: prettyJson,
                }

                const sourceZoomLevel = event?.sender?.getZoomLevel?.() ?? 0
                const editorWin = createEditorWindow(context, sourceZoomLevel, 'inDock')
                await loadBundledEntryOrClose(editorWin, 'jsonEditor')
                return { ok: true }
            } catch (err) {
                return { ok: false, error: err instanceof Error ? err.message : 'Failed to add JSON tab.' }
            }
        }
    )

    /**
     * Opens a native Open dialog (filtered to JSON files) and returns the selected file's content and path.
     * The dialog is attached to the editor window if open, otherwise the main window.
     * @returns { ok: true, content, filePath } on success; { ok: false, error } if canceled or read fails.
     */
    // A native dialog should parent to the window that invoked it. With both a
    // standalone and an in-dock JSON editor open, a hardcoded scope priority would
    // attach the dialog to the wrong window. Fall back to either editor, then the
    // focused/first window, when the sender cannot be resolved.
    const dialogParentWindow = (event: Electron.IpcMainInvokeEvent): BrowserWindow | null =>
        BrowserWindow.fromWebContents(event.sender)
        ?? getScopedToolWindow('json', 'standalone')
        ?? getScopedToolWindow('json', 'inDock')
        ?? context.getFocusedOrFirstWindow()
        ?? null

    ipcMain.handle('json:open-file', async (event): Promise<IpcResult & { content?: string; filePath?: string }> => {
        const win = dialogParentWindow(event)
        if (!win) return { ok: false, error: 'No window available.' }
        const result = await dialog.showOpenDialog(win, {
            properties: ['openFile'],
            filters: [
                { name: 'JSON', extensions: ['json', 'jsonc', 'json5'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        })
        if (result.canceled || !result.filePaths[0]) return { ok: false, error: 'Open canceled.' }
        try {
            const content = fs.readFileSync(result.filePaths[0], 'utf-8')
            return { ok: true, content, filePath: result.filePaths[0] }
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : 'Failed to read file.' }
        }
    })

    /**
     * Writes JSON content directly to a known file path (Save, not Save As).
     * No dialog is shown; the file path must be provided by the caller.
     * @param content - The JSON string to write.
     * @param filePath - The absolute path of the file to overwrite.
     * @returns {IpcResult} ok: true on success; ok: false with error on invalid args or write failure.
     */
    ipcMain.handle('json:save', async (_event, content: string, filePath: string): Promise<IpcResult> => {
        if (typeof content !== 'string' || typeof filePath !== 'string') {
            return { ok: false, error: 'Invalid arguments.' }
        }
        try {
            fs.writeFileSync(filePath, content, 'utf-8')
            return { ok: true }
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : 'Failed to save file.' }
        }
    })

    /**
     * Opens a native Save dialog (filtered to JSON) and writes the content to the chosen path.
     * @param content - The JSON string to save.
     * @returns { ok: true, filePath } with the saved path on success;
     *   { ok: false, error } if canceled, no window, or write fails.
     */
    ipcMain.handle('json:save-as', async (_event, content: string): Promise<IpcResult & { filePath?: string }> => {
        if (typeof content !== 'string') {
            return { ok: false, error: 'Invalid content.' }
        }
        const win = dialogParentWindow(_event)
        if (!win) return { ok: false, error: 'No window available.' }
        const result = await dialog.showSaveDialog(win, {
            defaultPath: `rokdock-json-${Date.now()}.json`,
            filters: [
                { name: 'JSON', extensions: ['json'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        })
        if (result.canceled || !result.filePath) return { ok: false, error: 'Save canceled.' }
        try {
            fs.writeFileSync(result.filePath, content, 'utf-8')
            return { ok: true, filePath: result.filePath }
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : 'Failed to save file.' }
        }
    })

    // The standalone renderer pushes session snapshots here, debounced on edits and
    // immediate on save / tab open / tab close / window close.
    ipcMain.on('json:persist-session', (_event, snapshot: JsonSessionSnapshot) => {
        jsonSessionStore.writeSession(snapshot)
    })
}

/**
 * Opens the JSON editor as a standalone CLI launch, optionally loading a file.
 * Reads the file in main, then delivers it to the renderer. A fresh window pulls
 * it via json:get-initial-data. An already-open window gets an addTab command.
 * A read failure still opens the editor, with the error surfaced as a toast.
 * The standalone window loads a restored session from disk (persist: true) so
 * tabs survive across launches.
 */
export async function openJsonEditorStandalone(context: IpcContext, filePath?: string): Promise<void> {
    let content: string | null = null
    let title: string | null = null
    let error: string | null = null
    if (filePath) {
        try {
            content = fs.readFileSync(filePath, 'utf-8')
            title = path.basename(filePath)
        } catch (err) {
            error = fileOpenError(filePath, err)
        }
    }

    const existing = getScopedToolWindow('json', 'standalone')
    if (existing) {
        focusWindow(existing)
        if (content !== null) sendToolWindowCommand(existing, { type: 'addTab', content, title: title ?? undefined })
        else if (error) sendToolWindowCommand(existing, { type: 'toast', message: error })
        return
    }

    pendingStandalone = {
        ...blankInitialData(),
        initialContent: content,
        initialTitle: title,
        initialFilePath: content !== null ? filePath ?? null : null,
        initialError: error,
        persist: true,
        session: jsonSessionStore.loadRestoredSession(),
    }
    const win = createEditorWindow(context, 0, 'standalone')
    await loadBundledEntryOrClose(win, 'jsonEditor')
}
