/**
 * Ask the dock window for the focused terminal tab's line buffer, for roBot's terminal-output
 * tools. Single-window request/response keyed by a requestId (mirrors the HDMI frame-grab
 * pattern, but sends to the dock only rather than broadcasting: terminal tabs live only in the
 * dock). Resolves null if the window is absent or does not answer before the timeout.
 */
import { ipcMain, type BrowserWindow } from 'electron'
import crypto from 'crypto'
import type { FocusedTerminalPayload } from '../../../shared/terminal'

export function requestFocusedTerminal(win: BrowserWindow | null, timeoutMs = 2000): Promise<FocusedTerminalPayload | null> {
    if (!win || win.isDestroyed()) return Promise.resolve(null)
    return new Promise(resolve => {
        const requestId = crypto.randomUUID()
        let timer: ReturnType<typeof setTimeout>
        const onResponse = (_event: unknown, id: string, payload: FocusedTerminalPayload | null): void => {
            if (id !== requestId) return
            clearTimeout(timer)
            ipcMain.removeListener('terminal-output:response', onResponse)
            resolve(payload ?? null)
        }
        ipcMain.on('terminal-output:response', onResponse)
        win.webContents.send('terminal-output:request', requestId)
        timer = setTimeout(() => {
            ipcMain.removeListener('terminal-output:response', onResponse)
            resolve(null)
        }, timeoutMs)
    })
}
