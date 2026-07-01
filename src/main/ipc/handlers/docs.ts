/**
 * IPC handlers for the Developer Docs tool window.
 *
 * Manages the Developer Docs BrowserWindow in two scopes: 'standalone' (CLI launch)
 * and 'inDock' (opened from within the dock). The scoped registry in toolWindow.ts
 * tracks at most one live window per scope.
 *
 * The renderer never touches the network directly. It reads docs through the
 * handlers (docs:open, docs:get-tree, docs:get-page) that delegate to the shared
 * DocsService instance. The service eagerly builds the fully labeled, ordered tree
 * on first call and memoizes it.
 */

import { BrowserWindow, ipcMain, Menu } from 'electron'
import { focusWindow } from '../../focusPolicy'
import {
    createToolWindow,
    loadBundledEntryOrClose,
    getScopedToolWindow,
    setScopedToolWindow,
    type ToolWindowScope
} from '../toolWindow'
import type { IpcContext, IpcResult } from '../types'

const isMac = process.platform === 'darwin'

/**
 * Builds the application menu for a Developer Docs window.
 * Provides View controls for reload and zoom, and standard Edit roles.
 * @param win - The Developer Docs BrowserWindow instance.
 * @returns The constructed Electron Menu.
 */
function buildDocsMenu(win: BrowserWindow): Menu {
    return Menu.buildFromTemplate([
        ...(isMac ? [{ role: 'appMenu' as const }] : []),
        {
            label: 'Edit',
            submenu: [
                { role: 'copy' as const },
                { role: 'selectAll' as const }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' as const },
                { type: 'separator' as const },
                // No webFrame zoom roles here: Ctrl+=/-/0 drive the reading-pane
                // text zoom in the renderer instead, and the window UI scale is
                // owned by the Appearance settings. Menu zoom roles would capture
                // those accelerators before the renderer sees them.
                { role: 'toggleDevTools' as const }
            ]
        },
        ...(isMac ? [] : [
            {
                label: 'Window',
                submenu: [
                    { label: 'Close', accelerator: 'Alt+F4', click: () => { if (!win.isDestroyed()) win.close() } }
                ]
            }
        ])
    ])
}

/**
 * Creates a new Developer Docs BrowserWindow and registers it in the scoped registry.
 * Pass sourceZoomLevel to inherit the opener's zoom level.
 * @param context - Shared IPC context.
 * @param sourceZoomLevel - Optional zoom level inherited from the opener window.
 * @param scope - Whether this is a standalone or inDock window.
 * @returns The constructed BrowserWindow.
 */
function createDocsWindow(context: IpcContext, sourceZoomLevel: number | undefined, scope: ToolWindowScope): BrowserWindow {
    const win = createToolWindow({
        context,
        title: 'Developer Docs',
        width: 1100,
        height: 800,
        minWidth: 720,
        minHeight: 520,
        iconKey: 'docs',
        sourceZoomLevel,
        buildMenu: buildDocsMenu
    })
    // Register before loading the entry so docs IPC handlers can resolve this window's scope.
    setScopedToolWindow('docs', scope, win)
    return win
}

/**
 * Opens the Developer Docs window as a standalone CLI launch.
 * If a standalone window is already open, focuses it and returns.
 * @param context - Shared IPC context.
 * @param _filePath - Unused; docs takes no file argument.
 */
export async function openDocsStandalone(context: IpcContext, _filePath?: string): Promise<void> {
    const existingStandalone = getScopedToolWindow('docs', 'standalone')
    if (existingStandalone) {
        focusWindow(existingStandalone)
        return
    }

    const win = createDocsWindow(context, undefined, 'standalone')
    await loadBundledEntryOrClose(win, 'docs')
    void context.docs.prime()
}

let pendingLookupQuery: string | null = null

/**
 * Registers all Developer Docs IPC handlers.
 *
 * @param context - Shared IPC context providing store and window helpers.
 */
export function registerDocsHandlers(context: IpcContext): void {
    /**
     * Opens the Developer Docs window in the inDock scope. If already open, focuses it.
     * Creates the BrowserWindow with Edit/View menu and loads the bundled Vite entry.
     * @returns {IpcResult} ok: true if the window was opened or focused; ok: false with error on failure.
     */
    ipcMain.handle('docs:open', async (event): Promise<IpcResult> => {
        try {
            const existingInDock = getScopedToolWindow('docs', 'inDock')
            if (existingInDock) {
                focusWindow(existingInDock)
                return { ok: true }
            }

            const sourceZoomLevel = event.sender.getZoomLevel()
            const win = createDocsWindow(context, sourceZoomLevel, 'inDock')
            await loadBundledEntryOrClose(win, 'docs')
            void context.docs.prime()
            return { ok: true }
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : 'Failed to open Developer Docs.' }
        }
    })

    /**
     * Fetches the full nav tree and slug index from the docs repo.
     * Rejects on network failure; the renderer hook handles the error state.
     */
    ipcMain.handle('docs:get-tree', () => context.docs.getTree())

    /**
     * Fetches a single markdown page by its repo-relative path.
     * Rejects on network failure or a missing page.
     */
    ipcMain.handle('docs:get-page', (_event, pagePath: string) => context.docs.getPage(pagePath))

    /**
     * Fetches the "What's New" feed: docs pages changed on the live branch since
     * the given ISO date. Rejects on network failure or GitHub rate limiting.
     */
    ipcMain.handle('docs:get-whats-new', (_event, since: string) => context.docs.getWhatsNew(since))

    /**
     * Full-text search across all docs pages. Builds (and memoizes) the search
     * index on first use. An empty query just pre-warms the index.
     */
    ipcMain.handle('docs:search', (_event, query: string) => context.docs.searchDocs(query))

    /**
     * Returns the ISO date of the most recent commit touching the given page.
     * Returns null when the date is unknown or the network is unavailable.
     */
    ipcMain.handle('docs:get-page-updated', (_event, pagePath: string) => context.docs.getPageLastUpdated(pagePath))

    /**
     * Opens or focuses the Developer Docs window and delivers a lookup query.
     * The term is always stored in pendingLookupQuery (latest wins); the window
     * drains it via docs:get-pending-lookup both on boot and whenever it receives
     * the docs:lookup-query nudge. Keeping the buffer the single source of truth
     * avoids losing a term pushed before the renderer has mounted its listener
     * (the window is registered synchronously, before its content loads).
     * @returns IpcResult ok: true on success, ok: false with error on failure.
     */
    ipcMain.handle('docs:look-up', async (event, term: string): Promise<IpcResult> => {
        const trimmed = (term ?? '').trim()
        if (!trimmed) return { ok: true }
        pendingLookupQuery = trimmed
        const existing = getScopedToolWindow('docs', 'inDock')
        if (existing) {
            focusWindow(existing)
            existing.webContents.send('docs:lookup-query')
            return { ok: true }
        }
        try {
            const win = createDocsWindow(context, event.sender.getZoomLevel(), 'inDock')
            await loadBundledEntryOrClose(win, 'docs')
            void context.docs.prime()
            return { ok: true }
        } catch (err) {
            pendingLookupQuery = null
            return { ok: false, error: err instanceof Error ? err.message : 'Failed to open Developer Docs.' }
        }
    })

    /**
     * Returns the pending lookup query for a docs window (drained on boot and on
     * each docs:lookup-query nudge), then clears it. Returns null when none is
     * pending, so a nudge that races the boot pull resolves to a single delivery.
     */
    ipcMain.handle('docs:get-pending-lookup', (): string | null => {
        const query = pendingLookupQuery
        pendingLookupQuery = null
        return query
    })

    /**
     * Warms the docs cache by eagerly loading the tree and search index.
     * Best-effort, never throws. Used by the chat panel on open.
     */
    ipcMain.handle('docs:prime', async () => { await context.docs.prime() })

}
