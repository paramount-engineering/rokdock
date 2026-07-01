/**
 * Electron preload script - the secure IPC bridge between the main process and renderer.
 *
 * This script runs in an isolated context with access to both Node.js (via ipcRenderer)
 * and the renderer DOM. It exposes a typed `window.rokdock` API via Electron's
 * contextBridge so the renderer can call main-process functionality without direct
 * Node.js access.
 *
 * Architecture:
 *  - The preload runs before any renderer JavaScript.
 *  - Each window applies its own theme in the renderer via bootBundledTheme (CSS vars,
 *    fonts, platform/theme classes); the preload only relays LIVE theme changes
 *    (theme:css-vars-updated) so open windows restyle without a reload.
 *  - Each namespace in the api object corresponds to a feature area. The event
 *    subscription helpers (onXxx) each return an unsubscribe function for cleanup.
 *
 * The exported RokDockAPI type is used in src/renderer/types/global.d.ts to type
 * the window.rokdock global in the renderer.
 */

import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { DeviceInfo } from '../shared/device'
import type { AppPreferences, DeeplinkConfig, DeviceAuth, IpcResult, PanelState, SettingsUpdate, StoreSettings, ThemeVars } from '../shared/types'
import type { TerminalLineChunk } from '../shared/terminal'
import type {
    ScreenshotHistoryEntryForPreview,
    ScreenshotPreviewImageResult,
    ScreenshotPreviewInitialData,
    ScreenshotPreviewMessage,
    ScreenshotPreviewPrefs,
    ScreenshotPreviewState
} from '../shared/screenshotPreviewProtocol'
import { extractTokens, type Step } from '../shared/script'
import { TOOL_WINDOW_COMMAND_CHANNEL } from '../shared/toolWindowCommands'
import type { JsonSessionSnapshot, JsonRestoredSession } from '../shared/jsonSession'
import type { UpdateCheckResult } from '../shared/updates'
import type { DocsTree, DocsPage, WhatsNewResult, DocsSearchResult } from '../shared/docs/types'
import type { AppearanceDraft } from '../shared/appearanceDraft'
import type { AiProfile, AiProfileInput, AiTestResult, RedactionPreview, AiRequest } from '../shared/ai/types'

// Live theme updates
//
// All windows (the dock and every bundled tool window) apply their initial theme
// in the renderer: the dock and tool windows call bootBundledTheme(), which fetches
// slim theme vars and imports fonts/components/controls as modules. The preload only
// relays LIVE theme changes here so open windows update without a reload.

/**
 * Writes all entries from a CSS custom property map onto the document root element.
 * @param cssVars - A record of CSS variable names (e.g. '--rokdock-bg') to values.
 */
function applyCssVars(cssVars: Record<string, string>): void {
    const root = document.documentElement
    for (const [key, value] of Object.entries(cssVars)) {
        root.style.setProperty(key, value)
    }
}

// Live CSS var updates (registered at module scope so all windows receive it).
ipcRenderer.on('theme:css-vars-updated', (_event, data: { themeMode: 'dark' | 'light'; cssVars: Record<string, string> }) => {
    const root = document.documentElement
    root.classList.remove('theme-dark', 'theme-light')
    root.classList.add(`theme-${data.themeMode}`)
    applyCssVars(data.cssVars)
    // Notify non-CSS consumers (e.g. React state, tool windows)
    window.dispatchEvent(new CustomEvent('rokdock-theme-changed', { detail: data }))
})

// Live UI-scale updates (every window applies the broadcast zoom level).
ipcRenderer.on('appearance:zoom-changed', (_event, level: number) => {
    try {
        webFrame.setZoomLevel(level)
    } catch {
        // ignore: zoom not available in this context
    }
})

// Live appearance updates: the full applied appearance draft (theme mode, zoom,
// tint, font, syntax, background, fallback). Dispatched as a CustomEvent so the
// dock's store-driven UI and the JSON editor can apply it without IPC coupling.
// CSS-var styling and webFrame zoom are handled by the two relays above; this
// carries the raw fields those relays cannot (e.g. the terminal syntax theme).
ipcRenderer.on('appearance:applied', (_event, detail) => {
    window.dispatchEvent(new CustomEvent('rokdock-appearance-applied', { detail }))
})


const api = {
    // Discovery
    discovery: {
        getDevices: (): Promise<DeviceInfo[]> =>
            ipcRenderer.invoke('discovery:get-devices'),
        refresh: (): Promise<void> =>
            ipcRenderer.invoke('discovery:refresh'),
        addManual: (ip: string, name?: string, hasAuth?: boolean): Promise<void> =>
            ipcRenderer.invoke('discovery:add-manual', ip, name, hasAuth),
        removeDevice: (id: string): Promise<void> =>
            ipcRenderer.invoke('discovery:remove-device', id),
        onDevicesChanged: (callback: (devices: DeviceInfo[]) => void) => {
            const handler = (_event: Electron.IpcRendererEvent, devices: DeviceInfo[]) => callback(devices)
            ipcRenderer.on('discovery:devices-changed', handler)
            return () => ipcRenderer.removeListener('discovery:devices-changed', handler)
        },
        onScanStarted: (callback: (timestamp: number) => void) => {
            const handler = (_event: Electron.IpcRendererEvent, timestamp: number) => callback(timestamp)
            ipcRenderer.on('discovery:scan-started', handler)
            return () => ipcRenderer.removeListener('discovery:scan-started', handler)
        }
    },

    // TCP Connections
    tcp: {
        connect: (deviceIp: string, port: number): Promise<string> =>
            ipcRenderer.invoke('tcp:connect', deviceIp, port),
        disconnect: (id: string): Promise<void> =>
            ipcRenderer.invoke('tcp:disconnect', id),
        sendInput: (id: string, data: string): void =>
            ipcRenderer.send('tcp:input', id, data),
        onData: (callback: (id: string, data: string) => void) => {
            const handler = (_event: Electron.IpcRendererEvent, id: string, data: string) => callback(id, data)
            ipcRenderer.on('tcp:data', handler)
            return () => ipcRenderer.removeListener('tcp:data', handler)
        },
        onStatus: (callback: (id: string, status: string, error?: string) => void) => {
            const handler = (_event: Electron.IpcRendererEvent, id: string, status: string, error?: string) =>
                callback(id, status, error)
            ipcRenderer.on('tcp:status', handler)
            return () => ipcRenderer.removeListener('tcp:status', handler)
        }
    },

    // ECP Remote
    ecp: {
        keypress: (ip: string, key: string): Promise<void> =>
            ipcRenderer.invoke('ecp:keypress', ip, key),
        keydown: (ip: string, key: string): Promise<void> =>
            ipcRenderer.invoke('ecp:keydown', ip, key),
        keyup: (ip: string, key: string): Promise<void> =>
            ipcRenderer.invoke('ecp:keyup', ip, key),
        sendText: (ip: string, text: string): Promise<void> =>
            ipcRenderer.invoke('ecp:send-text', ip, text),
        launchDeeplink: (ip: string, appId: string, params: Record<string, string>): Promise<void> =>
            ipcRenderer.invoke('ecp:launch-deeplink', ip, appId, params),
        sendInput: (ip: string, params: Record<string, string>): Promise<void> =>
            ipcRenderer.invoke('ecp:send-input', ip, params)
    },

    // Store / Preferences
    store: {
        getPanelState: (): Promise<PanelState> =>
            ipcRenderer.invoke('store:get-panel-state'),
        setPanelState: (state: PanelState): Promise<void> =>
            ipcRenderer.invoke('store:set-panel-state', state),
        getPreferences: (): Promise<AppPreferences> =>
            ipcRenderer.invoke('store:get-preferences'),
        setPreferences: (prefs: Partial<AppPreferences>): Promise<void> =>
            ipcRenderer.invoke('store:set-preferences', prefs),
        getManualDevices: (): Promise<Array<{ ip: string; name: string }>> =>
            ipcRenderer.invoke('store:get-manual-devices'),
        getLastConnected: (): Promise<Record<string, number>> =>
            ipcRenderer.invoke('store:get-last-connected'),
        getDeviceOrder: (): Promise<string[]> =>
            ipcRenderer.invoke('store:get-device-order'),
        setDeviceOrder: (order: string[]): Promise<void> =>
            ipcRenderer.invoke('store:set-device-order', order),
        recordConnection: (ip: string): Promise<void> =>
            ipcRenderer.invoke('store:record-connection', ip),
        getSettings: (): Promise<StoreSettings> =>
            ipcRenderer.invoke('store:get-settings'),
        setSettings: (settings: SettingsUpdate): Promise<void> =>
            ipcRenderer.invoke('store:set-settings', settings),
        getDeviceNicknames: (): Promise<Record<string, string>> =>
            ipcRenderer.invoke('store:get-device-nicknames'),
        setDeviceNickname: (ip: string, nickname: string): Promise<void> =>
            ipcRenderer.invoke('store:set-device-nickname', ip, nickname),
        getDeviceAuth: (ip: string): Promise<DeviceAuth | null> =>
            ipcRenderer.invoke('store:get-device-auth', ip),
        getAllDeviceAuthStates: (): Promise<Record<string, boolean>> =>
            ipcRenderer.invoke('store:get-all-device-auth-states'),
        setDeviceAuth: (ip: string, username: string, password: string): Promise<void> =>
            ipcRenderer.invoke('store:set-device-auth', ip, username, password),
        resetConfig: (): Promise<void> =>
            ipcRenderer.invoke('store:reset-config')
    },

    // Custom Terminal Sessions
    terminal: {
        createSession: (deviceIp: string, deviceName: string, port: number): Promise<string> =>
            ipcRenderer.invoke('terminal:create-session', deviceIp, deviceName, port),
        write: (id: string, data: string): void =>
            ipcRenderer.send('terminal:write', id, data),
        kill: (id: string): Promise<void> =>
            ipcRenderer.invoke('terminal:kill', id),
        reconnect: (id: string, deviceIp?: string, deviceName?: string, port?: number): Promise<void> =>
            ipcRenderer.invoke('terminal:reconnect', id, deviceIp, deviceName, port),
        onData: (callback: (id: string, chunk: TerminalLineChunk) => void) => {
            const handler = (_event: Electron.IpcRendererEvent, id: string, chunk: TerminalLineChunk) => callback(id, chunk)
            ipcRenderer.on('terminal:data', handler)
            return () => ipcRenderer.removeListener('terminal:data', handler)
        },
        onExit: (callback: (id: string, exitCode: number) => void) => {
            const handler = (_event: Electron.IpcRendererEvent, id: string, exitCode: number) => callback(id, exitCode)
            ipcRenderer.on('terminal:exit', handler)
            return () => ipcRenderer.removeListener('terminal:exit', handler)
        },
        onStatus: (callback: (id: string, status: string, error?: string) => void) => {
            const handler = (_event: Electron.IpcRendererEvent, id: string, status: string, error?: string) =>
                callback(id, status, error)
            ipcRenderer.on('terminal:status', handler)
            return () => ipcRenderer.removeListener('terminal:status', handler)
        }
    },

    // Context Menu
    contextMenu: {
        showTerminalMenu: (options: {
            tabId: string
            autoScroll: boolean
            wordWrap: boolean
            hasSelection: boolean
            lookupEligible: boolean
            aiAvailable: boolean
            isDisconnected: boolean
            isStreaming: boolean
        }): void =>
            ipcRenderer.send('context-menu:terminal', options),
        onAction: (callback: (tabId: string, action: string) => void) => {
            const handler = (_event: Electron.IpcRendererEvent, tabId: string, action: string) => callback(tabId, action)
            ipcRenderer.on('context-menu:action', handler)
            return () => ipcRenderer.removeListener('context-menu:action', handler)
        }
    },

    // Dialog
    dialog: {
        pickSavePath: async (defaultName: string): Promise<string | null> => {
            const result = await ipcRenderer.invoke('dialog:pick-save-path', defaultName) as IpcResult
            return result?.ok && result.path ? result.path : null
        },
        appendFile: async (filePath: string, content: string): Promise<boolean> => {
            const result = await ipcRenderer.invoke('dialog:append-file', filePath, content) as IpcResult
            return !!result?.ok
        },
        saveFile: async (defaultName: string, content: string): Promise<boolean> => {
            const result = await ipcRenderer.invoke('dialog:save-file', defaultName, content) as IpcResult
            return !!result?.ok
        },
        pickFolder: async (defaultPath?: string): Promise<string | null> => {
            const result = await ipcRenderer.invoke('dialog:pick-folder', defaultPath) as IpcResult
            return result?.ok && result.path ? result.path : null
        },
        saveJson: async (defaultName: string, content: string): Promise<boolean> => {
            const result = await ipcRenderer.invoke('dialog:save-json', defaultName, content) as IpcResult
            return !!result?.ok
        },
        openJsonFile: async (): Promise<string | null> => {
            const result = await ipcRenderer.invoke('dialog:open-json-file') as IpcResult & { content?: string }
            return result?.ok && result.content ? result.content : null
        }
    },

    // Device (Roku)
    device: {
        getActiveApp: (deviceIp: string): Promise<{ id: string; name: string }> =>
            ipcRenderer.invoke('device:get-active-app', deviceIp),
        captureScreenshot: (deviceIp: string, themeMode?: 'dark' | 'light'): Promise<{ ok: boolean; error?: string }> =>
            ipcRenderer.invoke('device:capture-screenshot', deviceIp, themeMode),
        openScreenshotWindow: (deviceIp: string, themeMode?: 'dark' | 'light'): Promise<{ ok: boolean; error?: string }> =>
            ipcRenderer.invoke('device:open-screenshot-window', deviceIp, themeMode)
    },

    // External
    external: {
        openUrl: async (url: string): Promise<boolean> => {
            const result = await ipcRenderer.invoke('shell:open-external', url) as IpcResult
            return !!result?.ok
        }
    },

    // JSON Editor
    json: {
        openEditor: (): Promise<IpcResult> =>
            ipcRenderer.invoke('json:open-editor') as Promise<IpcResult>,
        addTab: (prettyJson: string): Promise<IpcResult> =>
            ipcRenderer.invoke('json:add-tab', prettyJson) as Promise<IpcResult>,
        openFile: (): Promise<IpcResult & { content?: string; filePath?: string }> =>
            ipcRenderer.invoke('json:open-file') as Promise<IpcResult & { content?: string; filePath?: string }>,
        save: (content: string, filePath: string): Promise<IpcResult> =>
            ipcRenderer.invoke('json:save', content, filePath) as Promise<IpcResult>,
        saveAs: (content: string): Promise<IpcResult & { filePath?: string }> =>
            ipcRenderer.invoke('json:save-as', content) as Promise<IpcResult & { filePath?: string }>,
        getInitialData: (): Promise<{ initialContent: string | null; initialTitle: string | null; initialFilePath: string | null; initialError: string | null; fontFamily: string; fontSize: number; syntaxPreset: string; syntaxCustom: Record<string, string>; useThemeBackground: boolean; fallbackColor: string; persist: boolean; session: JsonRestoredSession | null }> =>
            ipcRenderer.invoke('json:get-initial-data') as Promise<{ initialContent: string | null; initialTitle: string | null; initialFilePath: string | null; initialError: string | null; fontFamily: string; fontSize: number; syntaxPreset: string; syntaxCustom: Record<string, string>; useThemeBackground: boolean; fallbackColor: string; persist: boolean; session: JsonRestoredSession | null }>,
        persistSession: (snapshot: JsonSessionSnapshot): void =>
            ipcRenderer.send('json:persist-session', snapshot),
    },

    // Tool-window command channel (main -> renderer)
    toolWindow: {
        // Each renderer casts the payload to its own window's command union.
        onCommand: (handler: (command: unknown) => void): (() => void) => {
            const listener = (_event: Electron.IpcRendererEvent, command: unknown) => handler(command)
            ipcRenderer.on(TOOL_WINDOW_COMMAND_CHANNEL, listener)
            return () => ipcRenderer.removeListener(TOOL_WINDOW_COMMAND_CHANNEL, listener)
        }
    },

    // Developer Docs
    docs: {
        open: (themeMode?: 'dark' | 'light'): Promise<IpcResult> =>
            ipcRenderer.invoke('docs:open', themeMode) as Promise<IpcResult>,
        getTree: (): Promise<DocsTree> => ipcRenderer.invoke('docs:get-tree') as Promise<DocsTree>,
        getPage: (path: string): Promise<DocsPage> => ipcRenderer.invoke('docs:get-page', path) as Promise<DocsPage>,
        getWhatsNew: (since: string): Promise<WhatsNewResult> =>
            ipcRenderer.invoke('docs:get-whats-new', since) as Promise<WhatsNewResult>,
        search: (query: string): Promise<DocsSearchResult[]> =>
            ipcRenderer.invoke('docs:search', query) as Promise<DocsSearchResult[]>,
        getPageUpdated: (path: string): Promise<string | null> =>
            ipcRenderer.invoke('docs:get-page-updated', path) as Promise<string | null>,
        lookUp: (term: string): Promise<IpcResult> =>
            ipcRenderer.invoke('docs:look-up', term) as Promise<IpcResult>,
        getPendingLookup: (): Promise<string | null> =>
            ipcRenderer.invoke('docs:get-pending-lookup') as Promise<string | null>,
        prime: (): Promise<void> => ipcRenderer.invoke('docs:prime') as Promise<void>,
        // A nudge (no payload) telling the window to drain the pending lookup
        // term via getPendingLookup. Returns an unsubscribe function.
        onLookupQuery: (cb: () => void): (() => void) => {
            const handler = (): void => cb()
            ipcRenderer.on('docs:lookup-query', handler)
            return () => ipcRenderer.removeListener('docs:lookup-query', handler)
        },
    },

    // SVG Converter
    svgExporter: {
        openEditor: (themeMode?: 'dark' | 'light'): Promise<IpcResult> =>
            ipcRenderer.invoke('svg-exporter:open', themeMode) as Promise<IpcResult>,
        importSvg: (): Promise<IpcResult & { svgText?: string; intrinsicWidth?: number; intrinsicHeight?: number; fileName?: string }> =>
            ipcRenderer.invoke('svg-exporter:import-svg') as Promise<IpcResult & { svgText?: string; intrinsicWidth?: number; intrinsicHeight?: number; fileName?: string }>,
        importSvgText: (svgText: string, fileName: string): Promise<IpcResult & { svgText?: string; intrinsicWidth?: number; intrinsicHeight?: number; fileName?: string }> =>
            ipcRenderer.invoke('svg-exporter:import-svg-text', svgText, fileName) as Promise<IpcResult & { svgText?: string; intrinsicWidth?: number; intrinsicHeight?: number; fileName?: string }>,
        quantize: (dataUrl: string, colors: number, dither: boolean): Promise<IpcResult & { dataUrl?: string; sizeBytes?: number }> =>
            ipcRenderer.invoke('svg-exporter:quantize', dataUrl, colors, dither) as Promise<IpcResult & { dataUrl?: string; sizeBytes?: number }>,
        savePng: (pngDataUrl: string, defaultName: string): Promise<IpcResult> =>
            ipcRenderer.invoke('svg-exporter:save-png', pngDataUrl, defaultName) as Promise<IpcResult>,
        getInitialData: (): Promise<{ data: { svgText: string; fileName: string; intrinsicWidth: number; intrinsicHeight: number } | null; error: string | null }> =>
            ipcRenderer.invoke('svg-exporter:get-initial-data') as Promise<{ data: { svgText: string; fileName: string; intrinsicWidth: number; intrinsicHeight: number } | null; error: string | null }>
    },

    // 9-Patch Editor
    ninepatch: {
        openEditor: (themeMode?: 'dark' | 'light'): Promise<IpcResult> =>
            ipcRenderer.invoke('ninepatch:open-editor', themeMode) as Promise<IpcResult>,
        importImage: (): Promise<IpcResult> =>
            ipcRenderer.invoke('ninepatch:import-image') as Promise<IpcResult>,
        exportImage: (dataUrl1080: string, dataUrl720: string, zones: unknown, baseName?: string): Promise<IpcResult> =>
            ipcRenderer.invoke('ninepatch:export-image', dataUrl1080, dataUrl720, zones, baseName) as Promise<IpcResult>,
        exportSingle: (dataUrl: string, defaultName: string): Promise<IpcResult> =>
            ipcRenderer.invoke('ninepatch:export-single', dataUrl, defaultName) as Promise<IpcResult>,
        getInitialData: (): Promise<{ data: { dataUrl: string; isNinePatch: boolean; fileName: string } | null; error: string | null }> =>
            ipcRenderer.invoke('ninepatch:get-initial-data') as Promise<{ data: { dataUrl: string; isNinePatch: boolean; fileName: string } | null; error: string | null }>
    },

    // Edit (clipboard / selection)
    edit: {
        copy: (): Promise<void> => ipcRenderer.invoke('edit:copy'),
        cut: (): Promise<void> => ipcRenderer.invoke('edit:cut'),
        paste: (): Promise<void> => ipcRenderer.invoke('edit:paste'),
        selectAll: (): Promise<void> => ipcRenderer.invoke('edit:selectAll')
    },

    // Menu events
    menu: {
        onNewConnection: (callback: () => void) => {
            const handler = () => callback()
            ipcRenderer.on('menu:new-connection', handler)
            return () => ipcRenderer.removeListener('menu:new-connection', handler)
        },
        onToggleDevicePanel: (callback: () => void) => {
            const handler = () => callback()
            ipcRenderer.on('menu:toggle-device-panel', handler)
            return () => ipcRenderer.removeListener('menu:toggle-device-panel', handler)
        },
        onToggleRemotePanel: (callback: () => void) => {
            const handler = () => callback()
            ipcRenderer.on('menu:toggle-remote-panel', handler)
            return () => ipcRenderer.removeListener('menu:toggle-remote-panel', handler)
        },
        onOpenSettings: (callback: () => void) => {
            const handler = () => callback()
            ipcRenderer.on('menu:open-settings', handler)
            return () => ipcRenderer.removeListener('menu:open-settings', handler)
        },
        onAbout: (callback: () => void) => {
            const handler = () => callback()
            ipcRenderer.on('menu:about', handler)
            return () => ipcRenderer.removeListener('menu:about', handler)
        },
        onScreenshot: (callback: () => void) => {
            const handler = () => callback()
            ipcRenderer.on('menu:screenshot', handler)
            return () => ipcRenderer.removeListener('menu:screenshot', handler)
        },
        setToolsScreenshotEnabled: (enabled: boolean): void => {
            ipcRenderer.send('menu:set-tools-screenshot-enabled', enabled)
        },
        onNinepatchEditor: (callback: () => void) => {
            const handler = () => callback()
            ipcRenderer.on('menu:ninepatch-editor', handler)
            return () => ipcRenderer.removeListener('menu:ninepatch-editor', handler)
        },
        onJsonEditor: (callback: () => void) => {
            const handler = () => callback()
            ipcRenderer.on('menu:json-editor', handler)
            return () => ipcRenderer.removeListener('menu:json-editor', handler)
        },
        onSvgExporter: (callback: () => void) => {
            const handler = () => callback()
            ipcRenderer.on('menu:svg-exporter', handler)
            return () => ipcRenderer.removeListener('menu:svg-exporter', handler)
        },
        onScriptEditor: (callback: () => void) => {
            const handler = () => callback()
            ipcRenderer.on('menu:script-editor', handler)
            return () => ipcRenderer.removeListener('menu:script-editor', handler)
        },
        onCheckForUpdates: (callback: () => void) => {
            const handler = () => callback()
            ipcRenderer.on('menu:check-for-updates', handler)
            return () => ipcRenderer.removeListener('menu:check-for-updates', handler)
        }
    },

    // Updates
    updates: {
        check: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('updates:check'),
        download: (): Promise<IpcResult> => ipcRenderer.invoke('updates:download'),
        onDownloadProgress: (callback: (percent: number) => void) => {
            const handler = (_event: Electron.IpcRendererEvent, percent: number) => callback(percent)
            ipcRenderer.on('updates:download-progress', handler)
            return () => ipcRenderer.removeListener('updates:download-progress', handler)
        }
    },

    // Script Editor
    scriptEditor: {
        getInitialData: (): Promise<{
            script: unknown
            startRecording: boolean
            initialDeviceIp: string
            initialFilePath: string | null
            initialError: string | null
            initialWarnings: string[]
        }> =>
            ipcRenderer.invoke('script-editor:get-initial-data') as Promise<{
                script: unknown
                startRecording: boolean
                initialDeviceIp: string
                initialFilePath: string | null
                initialError: string | null
                initialWarnings: string[]
            }>,
        open: (options?: {
            steps?: unknown[]
            name?: string
            metadata?: unknown
            filePath?: string
            themeMode?: 'dark' | 'light'
            recording?: boolean
            deviceIp?: string
        }): Promise<IpcResult> =>
            ipcRenderer.invoke('script-editor:open', options) as Promise<IpcResult>,
        list: (): Promise<IpcResult & { scripts?: { name: string; filePath: string; modifiedAt: number; stepCount: number }[] }> =>
            ipcRenderer.invoke('script-editor:list') as Promise<IpcResult & { scripts?: { name: string; filePath: string; modifiedAt: number; stepCount: number }[] }>,
        load: (filePath: string): Promise<IpcResult & { script?: unknown }> =>
            ipcRenderer.invoke('script-editor:load', filePath) as Promise<IpcResult & { script?: unknown }>,
        save: (script: unknown): Promise<IpcResult & { filePath?: string }> =>
            ipcRenderer.invoke('script-editor:save', script) as Promise<IpcResult & { filePath?: string }>,
        delete: (filePath: string): Promise<IpcResult> =>
            ipcRenderer.invoke('script-editor:delete', filePath) as Promise<IpcResult>,
        deleteAll: (): Promise<IpcResult> =>
            ipcRenderer.invoke('script-editor:delete-all') as Promise<IpcResult>,
        saveSortOrder: (order: string[]): Promise<IpcResult> =>
            ipcRenderer.invoke('script-editor:save-sort-order', order) as Promise<IpcResult>,
        importRasp: (): Promise<IpcResult & { script?: unknown; warnings?: string[] }> =>
            ipcRenderer.invoke('script-editor:import-rasp') as Promise<IpcResult & { script?: unknown; warnings?: string[] }>,
        importRaspText: (yamlText: string, name?: string): Promise<IpcResult & { script?: unknown; warnings?: string[] }> =>
            ipcRenderer.invoke('script-editor:import-rasp-text', yamlText, name) as Promise<IpcResult & { script?: unknown; warnings?: string[] }>,
        exportRasp: (script: unknown): Promise<IpcResult & { warnings?: string[] }> =>
            ipcRenderer.invoke('script-editor:export-rasp', script) as Promise<IpcResult & { warnings?: string[] }>,
        copyRasp: (script: unknown): Promise<IpcResult & { yaml?: string; warnings?: string[] }> =>
            ipcRenderer.invoke('script-editor:copy-rasp', script) as Promise<IpcResult & { yaml?: string; warnings?: string[] }>,
        extractTokens: (steps: unknown[]): string[] => extractTokens(steps as Step[]),
        queryApps: (deviceIp: string): Promise<IpcResult & { apps?: { id: string; name: string }[] }> =>
            ipcRenderer.invoke('script-editor:query-apps', deviceIp) as Promise<IpcResult & { apps?: { id: string; name: string }[] }>,
        queryAppIcon: (deviceIp: string, appId: string): Promise<IpcResult & { dataUri?: string }> =>
            ipcRenderer.invoke('script-editor:query-app-icon', deviceIp, appId) as Promise<IpcResult & { dataUri?: string }>,
        play: (script: unknown, deviceIp: string): Promise<IpcResult> =>
            ipcRenderer.invoke('script-editor:play', script, deviceIp) as Promise<IpcResult>,
        stopPlayback: (): Promise<IpcResult> =>
            ipcRenderer.invoke('script-editor:stop-playback') as Promise<IpcResult>,
        onEngineEvent: (callback: (event: unknown) => void) => {
            const handler = (_event: Electron.IpcRendererEvent, ev: unknown) => callback(ev)
            ipcRenderer.on('script-editor:engine-event', handler)
            return () => ipcRenderer.removeListener('script-editor:engine-event', handler)
        },
        onLoadSteps: (callback: (steps: unknown[], name: string, filePath: string | null) => void) => {
            const handler = (_event: Electron.IpcRendererEvent, steps: unknown[], name: string, filePath: string | null) => callback(steps, name, filePath)
            ipcRenderer.on('script-editor:load-steps', handler)
            return () => ipcRenderer.removeListener('script-editor:load-steps', handler)
        },
        onScriptsChanged: (callback: () => void) => {
            const handler = () => callback()
            ipcRenderer.on('script-editor:scripts-changed', handler)
            return () => ipcRenderer.removeListener('script-editor:scripts-changed', handler)
        }
    },

    // Zoom
    zoom: {
        getLevel: (): number => webFrame.getZoomLevel(),
        setLevel: (level: number): void => webFrame.setZoomLevel(level)
    },

    // Window Theme Sync
    window: {
        setAuxThemeMode: (themeMode: 'dark' | 'light'): Promise<void> =>
            ipcRenderer.invoke('window:set-theme-mode', themeMode),
    },

    // Capture Device Preview
    capture: {
        openPopout: (deviceId: string, muted: boolean): Promise<IpcResult> =>
            ipcRenderer.invoke('capture:open-popout', deviceId, muted),
        closePopout: (): Promise<IpcResult> =>
            ipcRenderer.invoke('capture:close-popout'),
        setPopoutAspectRatio: (ratio: number): Promise<IpcResult> =>
            ipcRenderer.invoke('capture:set-popout-aspect-ratio', ratio),
        setPopoutOpacity: (opacity: number): Promise<IpcResult> =>
            ipcRenderer.invoke('capture:set-popout-opacity', opacity),
        setPopoutAlwaysOnTop: (onTop: boolean): Promise<IpcResult> =>
            ipcRenderer.invoke('capture:set-popout-always-on-top', onTop),
        syncMute: (muted: boolean): Promise<IpcResult> =>
            ipcRenderer.invoke('capture:sync-mute', muted),
        syncVolume: (volume: number): Promise<IpcResult> =>
            ipcRenderer.invoke('capture:sync-volume', volume),
        getVolume: (): Promise<{ ok: boolean; volume?: number }> =>
            ipcRenderer.invoke('capture:get-volume'),
        onVolumeChanged: (callback: (volume: number) => void) => {
            const handler = (_event: Electron.IpcRendererEvent, volume: number) => callback(volume)
            ipcRenderer.on('capture:volume-changed', handler)
            return () => ipcRenderer.removeListener('capture:volume-changed', handler)
        },
        onPopoutClosed: (callback: () => void) => {
            const handler = () => callback()
            ipcRenderer.on('capture:popout-closed', handler)
            return () => ipcRenderer.removeListener('capture:popout-closed', handler)
        },
        onMuteChanged: (callback: (muted: boolean) => void) => {
            const handler = (_event: Electron.IpcRendererEvent, muted: boolean) => callback(muted)
            ipcRenderer.on('capture:mute-changed', handler)
            return () => ipcRenderer.removeListener('capture:mute-changed', handler)
        },
        getDeviceId: (): Promise<{ ok: boolean; deviceId?: string | null }> =>
            ipcRenderer.invoke('capture:get-device-id'),
        getMuted: (): Promise<{ ok: boolean; muted?: boolean }> =>
            ipcRenderer.invoke('capture:get-muted'),
        getPopoutConfig: (): Promise<{ deviceId: string; muted: boolean; idleTimeoutSec: number }> =>
            ipcRenderer.invoke('capture:get-popout-config'),
        setMode: (mode: string): Promise<IpcResult> =>
            ipcRenderer.invoke('capture:set-mode', mode),
        saveFrame: (dataUrl: string): Promise<IpcResult & { history?: Array<{ path: string; label: string }> }> =>
            ipcRenderer.invoke('capture:save-frame', dataUrl),
        onModeChanged: (callback: (mode: string) => void) => {
            const handler = (_event: Electron.IpcRendererEvent, mode: string) => callback(mode)
            ipcRenderer.on('capture:mode-changed', handler)
            return () => ipcRenderer.removeListener('capture:mode-changed', handler)
        }
    },

    // Sideload
    sideload: {
        pickFile: (): Promise<{ ok: boolean; filePath?: string; fileName?: string }> =>
            ipcRenderer.invoke('sideload:pick-file'),
        install: (ip: string, filePath: string): Promise<IpcResult & { message?: string }> =>
            ipcRenderer.invoke('sideload:install', ip, filePath) as Promise<IpcResult & { message?: string }>,
        onProgress: (callback: (data: { percent: number; status: string }) => void) => {
            const handler = (_event: Electron.IpcRendererEvent, data: { percent: number; status: string }) => callback(data)
            ipcRenderer.on('sideload:progress', handler)
            return () => ipcRenderer.removeListener('sideload:progress', handler)
        }
    },

    // Deeplinks
    deeplinks: {
        list: (): Promise<DeeplinkConfig[]> =>
            ipcRenderer.invoke('deeplink:list'),
        saveAll: (deeplinks: DeeplinkConfig[]): Promise<void> =>
            ipcRenderer.invoke('deeplink:save-all', deeplinks)
    },

    // Screenshot Preview
    screenshotPreview: {
        /** Pull the initial window state on boot (replaces template injection). */
        getInitialData: (): Promise<ScreenshotPreviewInitialData> =>
            ipcRenderer.invoke('screenshot-preview:get-initial-data'),
        /** Capture (or auto-refresh) a fresh screenshot from the device. */
        refresh: (auto: boolean): Promise<void> =>
            ipcRenderer.invoke('screenshot-preview:refresh', auto),
        /** Save the currently displayed screenshot via a native dialog. */
        save: (): Promise<void> =>
            ipcRenderer.invoke('screenshot-preview:save'),
        /** Save a renderer-composited image (screenshot + overlay) via a native dialog. */
        saveImage: (dataUrl: string): Promise<void> =>
            ipcRenderer.invoke('screenshot-preview:save-image', dataUrl),
        /** Copy the currently displayed screenshot (no overlay) to the clipboard. */
        copy: (): Promise<void> =>
            ipcRenderer.invoke('screenshot-preview:copy'),
        /** Copy a renderer-composited image (screenshot + overlay) to the clipboard. */
        copyImage: (dataUrl: string): Promise<void> =>
            ipcRenderer.invoke('screenshot-preview:copy-image', dataUrl),
        /** Open a file picker to choose a comparison overlay. */
        pickOverlay: (): Promise<void> =>
            ipcRenderer.invoke('screenshot-preview:onion-pick'),
        /** Apply a built-in or recent overlay by its ref. */
        applyOverlay: (ref: string): Promise<void> =>
            ipcRenderer.invoke('screenshot-preview:onion-apply', ref),
        /** Fetch a known image (history screenshot or overlay) as a data: URL. */
        getImage: (path: string): Promise<ScreenshotPreviewImageResult> =>
            ipcRenderer.invoke('screenshot-preview:get-image', path),
        /** Show a history screenshot: marks it displayed in main and returns its data: URL. */
        showHistoryImage: (path: string): Promise<ScreenshotPreviewImageResult> =>
            ipcRenderer.invoke('screenshot-preview:show-history-image', path),
        /** Fetch the current screenshot history as preview entries (with thumbnails). */
        getHistory: (): Promise<ScreenshotHistoryEntryForPreview[]> =>
            ipcRenderer.invoke('screenshot-preview:get-history'),
        /** Persist preview preferences (zoom, auto-refresh, overlay opacity). */
        savePrefs: (prefs: ScreenshotPreviewPrefs): Promise<void> =>
            ipcRenderer.invoke('screenshot-preview:prefs', prefs),
        /** Push live UI state so main's right-click menu reflects it (fire-and-forget). */
        pushState: (state: ScreenshotPreviewState): void =>
            ipcRenderer.send('screenshot-preview:set-state', state),
        /** Subscribe to messages pushed from main. Returns an unsubscribe function. */
        onMessage: (callback: (message: ScreenshotPreviewMessage) => void) => {
            const handler = (_event: Electron.IpcRendererEvent, message: ScreenshotPreviewMessage) => callback(message)
            ipcRenderer.on('screenshot-preview:message', handler)
            return () => ipcRenderer.removeListener('screenshot-preview:message', handler)
        }
    },

    // Theme
    theme: {
        /** Fetches slim theme vars from the main process. Used by bundled entries
         *  to apply CSS vars and theme classes before revealing the body. Bundled
         *  entries import fonts, component CSS, and controls JS as Vite modules so
         *  only the vars subset is needed here. */
        getVars: (): Promise<ThemeVars> =>
            ipcRenderer.invoke('theme:get-vars') as Promise<ThemeVars>
    },

    // Appearance Preview
    appearance: {
        /** Fire-and-forget: a Settings surface previews its full appearance draft
         *  across all windows. Main holds it as a live override until clearPreview. */
        previewDraft: (draft: AppearanceDraft): void =>
            ipcRenderer.send('appearance:preview-draft', draft),
        /** Fire-and-forget: drop the preview override and revert to persisted values.
         *  Called on Save (after persisting) and on Cancel/close. */
        clearPreview: (): void =>
            ipcRenderer.send('appearance:clear-preview'),
    },

    // AI Profiles + Streaming
    ai: {
        listProfiles: (): Promise<AiProfile[]> => ipcRenderer.invoke('ai:list-profiles'),
        saveProfile: (input: AiProfileInput): Promise<AiProfile> => ipcRenderer.invoke('ai:save-profile', input),
        deleteProfile: (id: string): Promise<void> => ipcRenderer.invoke('ai:delete-profile', id),
        getActive: (): Promise<string | null> => ipcRenderer.invoke('ai:get-active'),
        setActive: (id: string | null): Promise<void> => ipcRenderer.invoke('ai:set-active', id),
        testConnection: (profileId?: string): Promise<AiTestResult> => ipcRenderer.invoke('ai:test-connection', profileId),
        previewRedaction: (request: AiRequest, profileId?: string): Promise<RedactionPreview> => ipcRenderer.invoke('ai:preview-redaction', request, profileId),
        startStream: (request: AiRequest, conversationId?: string): Promise<{ sessionId: string }> => ipcRenderer.invoke('ai:start-stream', request, conversationId),
        cancelStream: (sessionId: string): void => ipcRenderer.send('ai:cancel-stream', sessionId),
        onStreamChunk: (cb: (data: { sessionId: string; delta: string }) => void): (() => void) => {
            const handler = (_event: Electron.IpcRendererEvent, data: { sessionId: string; delta: string }): void => cb(data)
            ipcRenderer.on('ai:stream-chunk', handler)
            return () => ipcRenderer.removeListener('ai:stream-chunk', handler)
        },
        onStreamActivity: (cb: (data: { sessionId: string; name: string; args: Record<string, unknown> }) => void): (() => void) => {
            const handler = (_e: Electron.IpcRendererEvent, data: { sessionId: string; name: string; args: Record<string, unknown> }): void => cb(data)
            ipcRenderer.on('ai:stream-activity', handler)
            return () => ipcRenderer.removeListener('ai:stream-activity', handler)
        },
        onStreamDone: (cb: (data: { sessionId: string; finalText: string; sources: import('../shared/ai/types').DocSource[] }) => void): (() => void) => {
            const handler = (_event: Electron.IpcRendererEvent, data: { sessionId: string; finalText: string; sources: import('../shared/ai/types').DocSource[] }): void => cb(data)
            ipcRenderer.on('ai:stream-done', handler)
            return () => ipcRenderer.removeListener('ai:stream-done', handler)
        },
        onStreamError: (cb: (data: { sessionId: string; message: string }) => void): (() => void) => {
            const handler = (_event: Electron.IpcRendererEvent, data: { sessionId: string; message: string }): void => cb(data)
            ipcRenderer.on('ai:stream-error', handler)
            return () => ipcRenderer.removeListener('ai:stream-error', handler)
        },
        getDocSymbols: (): Promise<Record<string, string>> => ipcRenderer.invoke('ai:get-doc-symbols'),
        getCliOverrides: (): Promise<import('../shared/ai/types').AiCliOverrides> => ipcRenderer.invoke('ai:get-cli-overrides'),
        setCliOverride: (kind: import('../ai-core/types').CliKind, override: import('../shared/ai/types').CliOverride): Promise<void> => ipcRenderer.invoke('ai:set-cli-override', kind, override),
        refreshCliDetection: (): Promise<void> => ipcRenderer.invoke('ai:refresh-cli-detection'),
    },

    // App Lifecycle
    app: {
        getBootMetadataSync: (): {
            version: string
            platform: string
            arch: string
            electron: string | null
            node: string | null
        } =>
            ipcRenderer.sendSync('app:get-boot-metadata-sync'),
        getVersionSync: (): string =>
            ipcRenderer.sendSync('app:get-version-sync'),
        getVersion: (): Promise<string> =>
            ipcRenderer.invoke('app:get-version'),
        showWindow: async (): Promise<boolean> => {
            const result = await ipcRenderer.invoke('app:show-window') as IpcResult
            return !!result?.ok
        },
        quit: async (): Promise<boolean> => {
            const result = await ipcRenderer.invoke('app:quit') as IpcResult
            return !!result?.ok
        },
        /** Forwards a renderer error to the main process log file. Fire-and-forget. */
        logError: (context: string, message: string): void =>
            ipcRenderer.send('app:log-error', context, message)
    }
}

contextBridge.exposeInMainWorld('rokdock', api)

export type RokDockAPI = typeof api
