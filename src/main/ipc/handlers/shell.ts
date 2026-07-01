/**
 * IPC handler for opening URLs in the system default browser.
 *
 * The URL is validated as a well-formed URL string before being passed to
 * Electron's shell.openExternal(). This prevents opening arbitrary file:// paths
 * or other non-HTTP(S) protocols that could be a security risk.
 *
 * Used by the terminal's clickable URL overlays and the About dialog links.
 */

import { ipcMain, shell } from 'electron'
import { isNonEmptyString } from '../../utils/validation'
import type { IpcResult } from '../types'

/** Registers the shell:open-external IPC handler. */
export function registerShellHandlers(): void {
    /**
     * Opens a URL in the system default browser.
     * The URL is validated as a well-formed URL before passing to shell.openExternal.
     * This prevents opening file:// paths or other non-HTTP(S) protocols as a security measure.
     * @param url - The URL to open (must be a valid URL string).
     * @returns {IpcResult} ok: true on success; ok: false with error if the URL is invalid or the open fails.
     */
    ipcMain.handle('shell:open-external', async (_event, url: string): Promise<IpcResult> => {
        if (!isNonEmptyString(url)) {
            return { ok: false, error: 'URL is required.' }
        }
        try {
            const parsed = new URL(url)
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return { ok: false, error: 'Only http(s) URLs are allowed.' }
            }
            await shell.openExternal(url)
            return { ok: true }
        } catch (error) {
            console.warn('[rokdock] shell:open-external failed:', error)
            return { ok: false, error: 'Failed to open external URL.' }
        }
    })
}
