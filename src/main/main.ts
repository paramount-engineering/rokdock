/**
 * RokDock main process entry point.
 *
 * This is the Electron main process - it runs in Node.js, has full system access,
 * and is responsible for creating windows, managing services, and wiring up IPC.
 *
 * Startup sequence:
 *  0. Acquire the single-instance lock. A second launch is routed by argv: a
 *     `--tool` request opens that tool in this instance, a bare launch focuses
 *     the dock (creating it if this instance started tool-only).
 *  1. app.whenReady(): instantiate all services (store, SSDP, TCP, ECP, terminal)
 *  2. Register all IPC handlers (registerIpcHandlers), capturing the IpcContext
 *  3. Route the launch argv (parseLaunchRequest): a `--tool` launch opens just
 *     that tool window and skips the dock. A bare launch creates the dock below
 *  4. For a bare launch, create the main BrowserWindow (hidden) and load the renderer
 *  5. Start SSDP device discovery
 *  6. Renderer calls app:show-window via IPC once it has loaded and applied theme
 *
 * The window is intentionally created hidden (show: false) and only made visible
 * after the renderer signals readiness to avoid showing an unstyled flash. A short
 * fallback timer ensures the window shows even if the IPC call never arrives.
 *
 * Window state (size, position, maximized) is persisted in the store across sessions.
 *
 * Screensaver handling is left to Chromium's default video wake lock: an actively
 * playing capture stream keeps the display awake, and the renderer-side capture idle
 * timeout (see useCaptureStream and the capturePreview bundled entry) stops the stream
 * after inactivity, which releases the wake lock so the screensaver can engage.
 */

import { app, BrowserWindow, Menu } from 'electron'
import { revealWindow } from './focusPolicy'
import { installGlobalErrorHandlers, registerRendererErrorBridge } from './utils/errorReporting'

// Register uncaughtException/unhandledRejection handlers before any other setup
// so errors during startup are captured and shown as a friendly dialog instead of
// Electron's raw "A JavaScript error occurred in the main process" crash dialog.
installGlobalErrorHandlers()

import path from 'path'
import { registerIpcHandlers } from './ipc/handlers'
import type { IpcContext } from './ipc/types'
import { APP_MENU, isMenuItem } from '../shared/appMenu'
import { nativeWindowBg } from '../shared/themeData'
import { asThemeMode } from './utils/validation'
import { APP_ICON_PATH } from './utils/resourcePaths'
import { hardenWindowNavigation } from './utils/hardenWindow'
import { SsdpService } from './services/ssdp'
import { TcpManager } from './services/tcpManager'
import { EcpService } from './services/ecp'
import { StoreService } from './services/store'
import { TelnetSessionService } from './services/telnetSession'
import { checkDevDependencies } from './utils/devDependencies'
import { parseLaunchRequest, toolForFile } from './launch/launchRequest'
import { openToolForLaunch } from './launch/openTool'
import { getScopedToolWindow } from './ipc/toolWindow'

let mainWindow: BrowserWindow | null = null
/** Fallback if renderer never calls showWindow() (e.g. IPC failure). Cleared when the window is destroyed. Keep short now that show-window resolves the real BrowserWindow. */
let bootWindowShowFallbackTimer: NodeJS.Timeout | null = null
let ssdpService: SsdpService | null = null
let tcpManager: TcpManager | null = null
let ecpService: EcpService | null = null
let storeService: StoreService | null = null
let terminalManager: TelnetSessionService | null = null
let ipcContext: IpcContext | null = null
let isAppQuitting = false
let isAppReady = false
/** Files delivered by the macOS open-file event before the app finished starting. */
const pendingOpenFiles: string[] = []
const MIN_ZOOM_LEVEL = -8
const MAX_ZOOM_LEVEL = 8

/**
 * Clamps and validates a zoom level value. Returns 0 for non-finite or
 * non-numeric inputs, otherwise clamps to [MIN_ZOOM_LEVEL, MAX_ZOOM_LEVEL].
 *
 * @param level - The raw zoom level value (typically from persisted preferences).
 * @returns A safe, clamped zoom level number.
 */
function normalizeZoomLevel(level: unknown): number {
    if (typeof level !== 'number' || !Number.isFinite(level)) return 0
    return Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, level))
}

/**
 * Creates the main BrowserWindow with persisted bounds and zoom level, wires
 * up keyboard shortcuts (Ctrl+Shift+M for native menu bar toggle, Alt
 * suppression on Windows), sets up the 'did-finish-load' fallback timer, and
 * loads the renderer URL or file. Window size and maximized state are
 * persisted to the store on close. All auxiliary windows are closed when the
 * main window closes.
 */
function createWindow(): void {
    const savedBounds = storeService?.getWindowBounds()
    const initialZoomLevel = normalizeZoomLevel(storeService?.getPreferences().appZoomLevel)

    const iconPath = APP_ICON_PATH

    mainWindow = new BrowserWindow({
        show: false,
        width: savedBounds?.width ?? 1400,
        height: savedBounds?.height ?? 900,
        x: savedBounds?.x,
        y: savedBounds?.y,
        minWidth: 800,
        minHeight: 600,
        backgroundColor: nativeWindowBg(asThemeMode(storeService?.getPreferences().themeMode), storeService?.getPreferences().tint),
        title: 'RokDock',
        icon: iconPath,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, '../preload/preload.js').replace('app.asar', 'app.asar.unpacked'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            // Keep requestAnimationFrame responsive for terminal rendering even when backgrounded.
            backgroundThrottling: false
        }
    })

    hardenWindowNavigation(mainWindow)

    const menu = buildAppMenu()
    Menu.setApplicationMenu(menu)
    mainWindow.setMenuBarVisibility(false)
    mainWindow.webContents.setZoomLevel(initialZoomLevel)
    mainWindow.webContents.on('before-input-event', (event, input) => {
        // Ctrl+Shift+M toggles the native menu bar visibility
        if (
            input.key.toLowerCase() === 'm'
            && input.control
            && input.shift
            && !input.alt
            && input.type === 'keyDown'
        ) {
            event.preventDefault()
            const win = mainWindow
            if (win && !win.isDestroyed()) {
                const visible = win.isMenuBarVisible()
                win.setAutoHideMenuBar(!visible)
                win.setMenuBarVisibility(!visible)
            }
            return
        }
        // Prevent Alt from activating the native menu bar on Windows.
        if (
            input.key === 'Alt'
            && !input.meta
            && (input.type === 'keyDown' || input.type === 'keyUp')
        ) {
            event.preventDefault()
            mainWindow?.setMenuBarVisibility(false)
        }
    })
    mainWindow.webContents.on('did-finish-load', () => {
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
        mainWindow.webContents.setZoomLevel(initialZoomLevel)
        // Renderer calls showWindow() after populating the splash (see index.tsx). Do not show
        // on a short timer here - that races the module bundle and causes a blank first frame.
        // Fallback only if the window is still hidden (e.g. IPC failure on some builds).
        if (bootWindowShowFallbackTimer) {
            clearTimeout(bootWindowShowFallbackTimer)
            bootWindowShowFallbackTimer = null
        }
        bootWindowShowFallbackTimer = setTimeout(() => {
            bootWindowShowFallbackTimer = null
            if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
                revealWindow(mainWindow)
            }
        }, 1200)
    })

    if (process.env.ELECTRON_RENDERER_URL) {
        mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
        mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
    }

    mainWindow.on('close', () => {
        if (mainWindow) {
            const maximized = mainWindow.isMaximized()
            storeService?.setWindowMaximized(maximized)
            // Persist restored bounds so normal-window launch size remains stable.
            const bounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds()
            storeService?.setWindowBounds(bounds)
            // Close auxiliary windows (screenshot preview, JSON editor, etc.) so they don't outlive the main window.
            // The standalone JSON editor is an independent persistent window. Spare it so its session survives.
            const standaloneJson = getScopedToolWindow('json', 'standalone')
            for (const w of BrowserWindow.getAllWindows()) {
                if (w !== mainWindow && w !== standaloneJson && !w.isDestroyed()) w.close()
            }
        }
    })

    mainWindow.on('closed', () => {
        if (bootWindowShowFallbackTimer) {
            clearTimeout(bootWindowShowFallbackTimer)
            bootWindowShowFallbackTimer = null
        }
        mainWindow = null
    })

}

/**
 * Sends an IPC message to the main window renderer process. No-ops if the
 * window or its WebContents have been destroyed.
 *
 * @param channel - The IPC channel name to send on.
 */
function sendToMainWindow(channel: string): void {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send(channel)
}

/**
 * Builds the Electron application Menu from the shared APP_MENU definition.
 * Menu items without a role send their id to the renderer via
 * {@link sendToMainWindow} (e.g. 'menu:screenshot'). The 'screenshot' item is
 * initially disabled; the renderer enables it via IPC once a device with
 * capture support is connected.
 *
 * @returns The constructed Electron Menu instance.
 */
function buildAppMenu(): Menu {
    const template: Electron.MenuItemConstructorOptions[] = APP_MENU.map(group => ({
        label: group.label,
        submenu: group.items.map((entry): Electron.MenuItemConstructorOptions =>
            isMenuItem(entry)
                ? {
                    id: entry.id,
                    label: entry.label,
                    accelerator: entry.accelerator,
                    enabled: entry.id !== 'screenshot',
                    ...(entry.role
                        ? { role: entry.role }
                        : { click: () => sendToMainWindow(`menu:${entry.id}`) })
                }
                : { type: 'separator' }
        )
    }))
    return Menu.buildFromTemplate(template)
}

/**
 * Surfaces the dock window, creating it if this instance launched tool-only.
 * Shared by the second-instance handler and an unrecognized file open.
 */
function showOrCreateDock(): void {
    if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow()
        return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    revealWindow(mainWindow)
}

/**
 * Routes an OS-opened file path to the matching tool, or to the dock when the
 * extension is unrecognized (or the IPC context is somehow not ready yet).
 */
function routeFileOpen(filePath: string): void {
    const tool = toolForFile(filePath)
    if (tool && ipcContext) {
        void openToolForLaunch(ipcContext, { tool, filePath })
    } else {
        showOrCreateDock()
    }
}

// Enforce a single instance. A second launch would resolve to the same userData
// directory and fight the first over the electron-store and the Chromium disk/GPU
// cache (the "Unable to move the cache: Access is denied" errors). Instead, the
// second instance hands focus to the first and exits. The lock is scoped to the
// userData dir, so launches with a separate --user-data-dir (E2E/doc tooling) are
// unaffected and never collide with a real install.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
    app.quit()
} else {
    app.on('second-instance', (_event, argv, workingDirectory) => {
        const launch = parseLaunchRequest(argv, workingDirectory)
        // ipcContext is assigned in whenReady, which always completes before a
        // second instance can launch, so the guard is satisfied in practice. If
        // it somehow were not, fall through to surfacing the dock.
        if (launch && ipcContext) {
            void openToolForLaunch(ipcContext, launch)
            return
        }
        // Bare second launch: show/focus the dock.
        showOrCreateDock()
    })

    // macOS delivers double-clicked / "Open with" files via this event, not argv.
    // It can fire before the app is ready, so queue early arrivals and replay them
    // once services and the IPC context exist.
    app.on('open-file', (event, filePath) => {
        event.preventDefault()
        if (isAppReady) routeFileOpen(filePath)
        else pendingOpenFiles.push(filePath)
    })

    app.whenReady().then(() => {
        checkDevDependencies()
        storeService = new StoreService()
        ssdpService = new SsdpService()
        tcpManager = new TcpManager()
        ecpService = new EcpService()
        terminalManager = new TelnetSessionService()

        ipcContext = registerIpcHandlers(ssdpService, tcpManager, ecpService, storeService, terminalManager, () => mainWindow)
        // Wire the renderer error-logging IPC bridge now that the app is ready.
        registerRendererErrorBridge()

        isAppReady = true

        let openedSomething = false
        let launch = parseLaunchRequest(process.argv, process.cwd())
        // Dev convenience: `npm run dev:docs` sets ROKDOCK_LAUNCH_TOOL so the
        // chosen tool opens directly. electron-vite does not forward CLI args to
        // Electron in dev, so this env var is the way to launch a tool with HMR.
        // Ignored in packaged builds (production launches use the --tool argv).
        if (!launch && !app.isPackaged && process.env.ROKDOCK_LAUNCH_TOOL) {
            launch = parseLaunchRequest(['--tool', process.env.ROKDOCK_LAUNCH_TOOL], process.cwd())
        }
        if (launch) {
            void openToolForLaunch(ipcContext, launch)
            openedSomething = true
        }
        if (pendingOpenFiles.length > 0) {
            for (const filePath of pendingOpenFiles) routeFileOpen(filePath)
            pendingOpenFiles.length = 0
            openedSomething = true
        }
        if (!openedSomething) createWindow()

        ssdpService.startDiscovery()

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow()
            }
        })
    })
}

app.on('before-quit', (event) => {
    if (isAppQuitting) return

    event.preventDefault()
    isAppQuitting = true

    // Ensure active sessions are terminated before the process exits.
    Promise.resolve()
        .then(async () => {
            ssdpService?.stopDiscovery()
            tcpManager?.disconnectAll()
            if (terminalManager) {
                terminalManager.killAll()
            }
            if (ipcContext) {
                await ipcContext.mcpEndpoint.stop()
            }
        })
        .finally(() => {
            app.quit()
        })
})

app.on('window-all-closed', () => {
    app.quit()
})
