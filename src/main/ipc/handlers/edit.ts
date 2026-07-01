/**
 * IPC handlers for clipboard edit operations (copy, cut, paste, select all).
 *
 * Electron's WebContents exposes these operations directly. The custom React menu
 * bar calls these instead of relying on native menu role wiring, which doesn't
 * work correctly in all environments with the custom frameless setup.
 */

import { ipcMain } from 'electron'

/** Registers clipboard edit operation IPC handlers (copy, cut, paste, select all). */
export function registerEditHandlers(): void {
    /**
     * Executes a copy operation on the focused WebContents.
     * Copies the current selection to the system clipboard.
     */
    ipcMain.handle('edit:copy', (event) => {
        const wc = event.sender
        if (wc && !wc.isDestroyed()) wc.copy()
    })
    /**
     * Executes a cut operation on the focused WebContents.
     * Removes the current selection and places it on the system clipboard.
     */
    ipcMain.handle('edit:cut', (event) => {
        const wc = event.sender
        if (wc && !wc.isDestroyed()) wc.cut()
    })
    /**
     * Executes a paste operation on the focused WebContents.
     * Inserts the current system clipboard content at the cursor.
     */
    ipcMain.handle('edit:paste', (event) => {
        const wc = event.sender
        if (wc && !wc.isDestroyed()) wc.paste()
    })
    /**
     * Executes a select-all operation on the focused WebContents.
     * Selects all content in the currently focused editable element.
     */
    ipcMain.handle('edit:selectAll', (event) => {
        const wc = event.sender
        if (wc && !wc.isDestroyed()) wc.selectAll()
    })
}
