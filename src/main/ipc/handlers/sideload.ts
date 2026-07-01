/**
 * IPC handlers for Roku app sideloading (.zip dev builds and signed .pkg packages).
 *
 * Handles the two-step sideload flow:
 *  1. sideload:pick-file - opens a native file dialog filtered to .zip and .pkg files
 *  2. sideload:install - reads device credentials from the store, reads the zip
 *     file, and uploads it to /plugin_install via the pluginInstall() utility
 *     (HTTP Digest auth + chunked multipart upload with progress callbacks)
 *
 * Progress events are broadcast to all windows as sideload:progress so the
 * SideloadDialog component can update its upload progress bar in real time.
 *
 * Requires developer mode credentials to be configured in Device Properties.
 * Returns a result message from the Roku device response (e.g. "Application Installed").
 */

import { BrowserWindow, dialog, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { pluginInstall } from '../../utils/screenshot'
import type { IpcContext, IpcResult } from '../types'

/**
 * Registers IPC handlers for the Roku app sideloading workflow.
 *
 * @param context - Shared IPC context providing store access and window helpers.
 */
export function registerSideloadHandlers(context: IpcContext): void {
    /**
     * Opens a native Open dialog filtered to Roku app packages (.zip dev builds
     * and signed .pkg packages) so the user can select one to sideload.
     * @returns { ok: true, filePath, fileName } with the chosen file on success;
     *   { ok: false } if canceled; { ok: false, error } on unexpected error.
     */
    ipcMain.handle('sideload:pick-file', async (): Promise<IpcResult & { filePath?: string; fileName?: string }> => {
        try {
            const existing = context.getFocusedOrFirstWindow()
            const fallback = existing ?? new BrowserWindow({ show: false })
            try {
                const result = await dialog.showOpenDialog(fallback, {
                    title: 'Select Roku App Package',
                    filters: [{ name: 'Roku App', extensions: ['zip', 'pkg'] }, { name: 'All Files', extensions: ['*'] }],
                    properties: ['openFile']
                })
                if (result.canceled || result.filePaths.length === 0) return { ok: false }
                const filePath = result.filePaths[0]!
                return { ok: true, filePath, fileName: path.basename(filePath) }
            } finally {
                // Only destroy the window if we created the fallback. Never destroy a real window.
                if (!existing) fallback.destroy()
            }
        } catch (err) {
            return { ok: false, error: String(err) }
        }
    })

    /**
     * Installs a Roku app package (.zip dev build or signed .pkg) on the device via HTTP
     * Digest auth multipart upload.
     * Reads device credentials from the store. Fails if none are configured.
     * Broadcasts sideload:progress events to all windows during upload so the
     * SideloadDialog progress bar updates in real time.
     * @param ip - The IP address of the target Roku device.
     * @param filePath - Absolute path to the .zip or .pkg package to install.
     * @returns { ok: true, message } with the device response (e.g. "Application Installed")
     *   on success; { ok: false, error } if credentials are missing or the upload fails.
     */
    ipcMain.handle('sideload:install', async (_event, ip: string, filePath: string): Promise<IpcResult & { message?: string }> => {
        try {
            if (!path.isAbsolute(filePath)) {
                return { ok: false, error: 'Invalid file path.' }
            }
            const ext = path.extname(filePath).toLowerCase()
            if (ext !== '.zip' && ext !== '.pkg') {
                return { ok: false, error: 'Only .zip and .pkg files are supported.' }
            }
            if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
                return { ok: false, error: 'File not found.' }
            }
            const auth = context.store.getDeviceAuth(ip)
            if (!auth) {
                return { ok: false, error: 'No credentials set. Configure in Device Properties.' }
            }
            const creds = { user: auth.username, password: auth.password }
            const zipBuffer = fs.readFileSync(filePath)
            const fileName = path.basename(filePath)

            const result = await pluginInstall(ip, creds, zipBuffer, fileName, (percent) => {
                context.sendToAllWindows('sideload:progress', {
                    percent,
                    status: percent < 95 ? 'Uploading...' : 'Processing...'
                })
            })

            return { ok: result.ok, message: result.message }
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
    })
}
