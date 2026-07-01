/**
 * IPC handler registration entry point.
 *
 * Instantiates the shared IpcContext and calls every handler registrar exactly
 * once at app startup. All ipcMain.handle() and ipcMain.on() registrations happen
 * inside the individual registerXxx() calls - this file is the single place that
 * wires them together.
 *
 * Handler files are organized by feature area under src/main/ipc/handlers/.
 * Adding a new feature requires: creating a handler file, calling registerXxx(context)
 * here, and adding the corresponding preload namespace in src/preload/preload.ts.
 */

import path from 'path'
import { BrowserWindow, app } from 'electron'
import { AiProfileStore } from '../services/ai/aiProfileStore'
import { AiService } from '../services/ai/aiService'
import { DocsService } from '../services/docsService'
import { DocsRagIndex } from '../services/docsRagIndex'
import { createDocsContextProvider } from '../services/ai/docsContextProvider'
import { SsdpService } from '../services/ssdp'
import { TcpManager } from '../services/tcpManager'
import { EcpService } from '../services/ecp'
import { StoreService } from '../services/store'
import { TelnetSessionService } from '../services/telnetSession'
import type { IpcContext } from './types'
import { registerAppHandlers } from './handlers/app'
import { registerContextMenuHandlers } from './handlers/contextMenu'
import { registerEditHandlers } from './handlers/edit'
import { registerDeviceScreenshotHandlers } from './handlers/deviceScreenshot'
import { registerDialogHandlers } from './handlers/dialog'
import { registerDiscoveryHandlers, repopulateConfiguredDevices } from './handlers/discovery'
import { registerEcpHandlers } from './handlers/ecp'
import { registerJsonEditorHandlers } from './handlers/jsonEditor'
import { registerNinepatchEditorHandlers } from './handlers/ninepatchEditor'
import { registerSvgExporterHandlers } from './handlers/svgExporter'
import { registerDocsHandlers } from './handlers/docs'
import { registerScriptEditorHandlers } from './handlers/scriptEditor'
import { registerShellHandlers } from './handlers/shell'
import { registerThemeHandlers } from './handlers/theme'
import { registerStoreHandlers } from './handlers/store'
import { registerCaptureHandlers } from './handlers/capture'
import { registerTcpHandlers } from './handlers/tcp'
import { registerTerminalHandlers } from './handlers/terminal'
import { registerDeeplinkHandlers } from './handlers/deeplinks'
import { registerSideloadHandlers } from './handlers/sideload'
import { registerUpdatesHandlers } from './handlers/updates'
import { registerAiHandlers } from './handlers/ai'
import { isCliKind } from '../../ai-core'
import { createMcpToolEndpoint } from '../services/ai/mcpToolEndpoint'

/**
 * Entry point for all IPC handler registration.
 *
 * Builds the shared IpcContext (service references + convenience helpers), applies initial
 * discovery tuning from stored preferences, then calls every registerXxx() function in the
 * correct dependency order. All ipcMain.handle() and ipcMain.on() calls are made inside
 * those individual registrars - nothing is registered directly here.
 *
 * @param ssdp - SSDP discovery service for Roku device detection.
 * @param tcp - Raw TCP connection manager.
 * @param ecp - ECP remote control service.
 * @param store - Persistent settings and preferences store.
 * @param terminalManager - Telnet session service for terminal tabs.
 * @param getMainWindow - Returns the primary BrowserWindow; used by app handlers for show/focus.
 */
export function registerIpcHandlers(
    ssdp: SsdpService,
    tcp: TcpManager,
    ecp: EcpService,
    store: StoreService,
    terminalManager: TelnetSessionService,
    getMainWindow: () => BrowserWindow | null
): IpcContext {
    registerAppHandlers(store, getMainWindow)
    registerEditHandlers()

    const initialPrefs = store.getPreferences()
    ssdp.setDiscoveryTuning({
        scanIntervalMs: initialPrefs.discoveryScanIntervalMs,
        requestTimeoutMs: initialPrefs.discoveryRequestTimeoutMs
    })

    const aiProfileStore = new AiProfileStore(store, app.getPath('userData'))
    const docs = new DocsService(path.join(app.getPath('userData'), 'docs-cache'))
    const ragIndex = new DocsRagIndex(docs)
    // When the ROKDOCK_E2E_CLIS env var is set (e2e test runs only), inject a
    // fixed detectClis function so the test controls which CLIs appear without
    // depending on the host PATH. Matches the ROKDOCK_E2E / userData isolation
    // conventions used by the rest of the e2e harness.
    const e2eCliKinds = process.env.ROKDOCK_E2E_CLIS
    const mcpEndpoint = createMcpToolEndpoint()
    const aiService = new AiService(aiProfileStore, ssdp, store, {
        contextProviders: [createDocsContextProvider({ query: (queryText, topK) => ragIndex.query(queryText, topK), getPage: (pagePath) => docs.getPage(pagePath) })],
        policyDir: app.getPath('userData'),
        mcpEndpoint,
        ...(e2eCliKinds ? { detectClis: async () => e2eCliKinds.split(',').filter(isCliKind) } : {}),
    })

    const context: IpcContext = {
        ssdp,
        tcp,
        ecp,
        store,
        terminalManager,
        docs,
        ai: aiService,
        mcpEndpoint,
        sendToAllWindows: (channel: string, ...args: unknown[]) => {
            for (const win of BrowserWindow.getAllWindows()) {
                if (!win.isDestroyed()) win.webContents.send(channel, ...args)
            }
        },
        getFocusedOrFirstWindow: () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    }

    registerDiscoveryHandlers(context)
    registerTcpHandlers(context)
    registerEcpHandlers(context)
    registerStoreHandlers(context)
    registerTerminalHandlers(context)
    registerContextMenuHandlers()
    registerDialogHandlers(context.getFocusedOrFirstWindow)
    registerDeviceScreenshotHandlers(context)
    registerShellHandlers()
    registerJsonEditorHandlers(context)
    registerNinepatchEditorHandlers(context)
    registerSvgExporterHandlers(context)
    registerDocsHandlers(context)
    registerScriptEditorHandlers(context)
    registerThemeHandlers(context)
    registerCaptureHandlers(context)
    registerDeeplinkHandlers(context)
    registerSideloadHandlers(context)
    registerUpdatesHandlers(context)
    registerAiHandlers(context)

    repopulateConfiguredDevices(ssdp, store)

    return context
}
