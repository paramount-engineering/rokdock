/**
 * IPC handlers for native file system dialogs (save, open, folder picker).
 *
 * Provides the renderer with controlled access to file I/O operations that require
 * native dialog prompts. All file paths are validated before read/write operations:
 *  - Paths must be absolute.
 *  - Paths are checked for traversal sequences (../) after normalization.
 *
 * These handlers are used by the terminal log export, JSON save/load, and folder
 * picker features. Tool window editors (JSON, SVG, 9-patch) have their own dialog
 * calls since they need the dialog attached to their specific window instance.
 */

import { BrowserWindow, dialog, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { isNonEmptyString } from '../../utils/validation'
import type { IpcResult } from '../types'

/**
 * Validates that a file path is absolute and free of directory traversal sequences.
 * Normalization is applied before the traversal check to handle encoded or relative-style inputs.
 * @param filePath - The file path to validate.
 * @returns True if the path is safe to use for file I/O; false otherwise.
 */
function isSafeAbsolutePath(filePath: string): boolean {
    if (!path.isAbsolute(filePath)) return false
    const normalized = path.normalize(filePath)
    // Reject any path that still contains traversal sequences after normalization
    return !normalized.includes('..')
}

/**
 * Registers IPC handlers for native file system dialogs.
 *
 * @param getFocusedOrFirstWindow - Returns the window to attach dialogs to.
 *   Uses the focused window, falling back to the first open window.
 */
export function registerDialogHandlers(getFocusedOrFirstWindow: () => BrowserWindow | undefined): void {
    /**
     * Opens a native Save dialog and returns the chosen file path without writing anything.
     * Useful for letting the renderer determine the path before streaming output.
     * @param defaultName - The default filename shown in the dialog.
     * @returns { ok: true, path } on confirmation; { ok: false, error } if canceled or no window.
     */
    ipcMain.handle('dialog:pick-save-path', async (_event, defaultName: string): Promise<{ ok: boolean; path?: string; error?: string }> => {
        if (!isNonEmptyString(defaultName)) {
            return { ok: false, error: 'Invalid default file name.' }
        }
        const win = getFocusedOrFirstWindow()
        if (!win) return { ok: false, error: 'No window available.' }
        const result = await dialog.showSaveDialog(win, {
            defaultPath: defaultName,
            filters: [
                { name: 'Log Files', extensions: ['log', 'txt'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        })
        if (result.canceled || !result.filePath) return { ok: false, error: 'Save canceled.' }
        return { ok: true, path: result.filePath }
    })

    /**
     * Appends a string to an existing file at the given absolute path.
     * Path is validated as absolute with no traversal sequences before writing.
     * @param filePath - Absolute path to the target file.
     * @param content - String content to append.
     * @returns {IpcResult} ok: true on success; ok: false with error on invalid path or write failure.
     */
    ipcMain.handle('dialog:append-file', async (_event, filePath: string, content: string): Promise<IpcResult> => {
        if (!isNonEmptyString(filePath)) {
            return { ok: false, error: 'Invalid file path.' }
        }
        if (!isSafeAbsolutePath(filePath)) {
            return { ok: false, error: 'File path must be an absolute path with no traversal sequences.' }
        }
        if (typeof content !== 'string') {
            return { ok: false, error: 'Invalid file content.' }
        }
        try {
            fs.appendFileSync(filePath, content, 'utf-8')
            return { ok: true }
        } catch (error) {
            console.error('[rokdock] Failed to append file:', error)
            return { ok: false, error: 'Failed to append file.' }
        }
    })

    /**
     * Opens a native Save dialog (filtered to text/log files) and writes the content to the chosen path.
     * @param defaultName - The default filename shown in the dialog.
     * @param content - String content to write to the file.
     * @returns {IpcResult} ok: true on success; ok: false with error if canceled or write fails.
     */
    ipcMain.handle('dialog:save-file', async (_event, defaultName: string, content: string): Promise<IpcResult> => {
        if (!isNonEmptyString(defaultName)) {
            return { ok: false, error: 'Invalid default file name.' }
        }
        if (typeof content !== 'string') {
            return { ok: false, error: 'Invalid file content.' }
        }
        const win = getFocusedOrFirstWindow()
        if (!win) return { ok: false, error: 'No window available.' }
        const result = await dialog.showSaveDialog(win, {
            defaultPath: defaultName,
            filters: [
                { name: 'Text Files', extensions: ['txt', 'log'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        })
        if (result.canceled || !result.filePath) return { ok: false, error: 'Save canceled.' }
        try {
            fs.writeFileSync(result.filePath, content, 'utf-8')
            return { ok: true }
        } catch (error) {
            console.error('[rokdock] Failed to save file:', error)
            return { ok: false, error: 'Failed to save file.' }
        }
    })

    /**
     * Opens a native Save dialog (filtered to JSON files) and writes the content to the chosen path.
     * @param defaultName - The default filename shown in the dialog.
     * @param content - JSON string content to write.
     * @returns {IpcResult} ok: true on success; ok: false with error if canceled or write fails.
     */
    ipcMain.handle('dialog:save-json', async (_event, defaultName: string, content: string): Promise<IpcResult> => {
        if (!isNonEmptyString(defaultName) || typeof content !== 'string') {
            return { ok: false, error: 'Invalid arguments.' }
        }
        const win = getFocusedOrFirstWindow()
        if (!win) return { ok: false, error: 'No window available.' }
        const result = await dialog.showSaveDialog(win, {
            defaultPath: defaultName,
            filters: [
                { name: 'JSON Files', extensions: ['json'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        })
        if (result.canceled || !result.filePath) return { ok: false, error: 'Save canceled.' }
        try {
            fs.writeFileSync(result.filePath, content, 'utf-8')
            return { ok: true }
        } catch (error) {
            console.error('[rokdock] Failed to save JSON file:', error)
            return { ok: false, error: 'Failed to save file.' }
        }
    })

    /**
     * Opens a native Open dialog (filtered to JSON files) and returns the selected file's content.
     * @returns { ok: true, content } with the UTF-8 file content on success;
     *   { ok: false, error } if canceled, no window is available, or the read fails.
     */
    ipcMain.handle('dialog:open-json-file', async (): Promise<IpcResult & { content?: string }> => {
        const win = getFocusedOrFirstWindow()
        if (!win) return { ok: false, error: 'No window available.' }
        const result = await dialog.showOpenDialog(win, {
            properties: ['openFile'],
            filters: [
                { name: 'JSON Files', extensions: ['json'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        })
        if (result.canceled || !result.filePaths[0]) return { ok: false, error: 'Open canceled.' }
        try {
            const content = fs.readFileSync(result.filePaths[0], 'utf-8')
            return { ok: true, content }
        } catch (error) {
            console.error('[rokdock] Failed to read JSON file:', error)
            return { ok: false, error: 'Failed to read file.' }
        }
    })

    /**
     * Opens a native folder picker dialog and returns the selected directory path.
     * The dialog allows creating new directories.
     * @param defaultPath - Optional initial directory to show in the dialog.
     * @returns { ok: true, path } with the selected folder path; { ok: false } if canceled.
     */
    ipcMain.handle('dialog:pick-folder', async (_event, defaultPath?: string): Promise<{ ok: boolean; path?: string }> => {
        const win = getFocusedOrFirstWindow()
        if (!win) return { ok: false }
        const result = await dialog.showOpenDialog(win, {
            properties: ['openDirectory', 'createDirectory'],
            ...(defaultPath ? { defaultPath } : {})
        })
        if (result.canceled || !result.filePaths[0]) return { ok: false }
        return { ok: true, path: result.filePaths[0] }
    })
}
