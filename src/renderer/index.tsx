/**
 * Renderer process entry point.
 *
 * Imports the shared rokdock controls, component CSS, and fonts as modules (via
 * entryBootstrap) and applies the theme via bootBundledTheme (the same path the
 * pop-out tool windows use), so no preload injection is involved. The React root
 * is mounted only AFTER bootBundledTheme resolves (CSS vars applied and web fonts
 * ready), so the app is fully styled the instant the boot splash lifts. The splash
 * (static, system-font markup in index.html) covers that wait.
 */
import { bootBundledTheme } from '@shared/entryBootstrap'
import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles/terminalLinks.css'
import App from './app'
import { ErrorBoundary } from './components/errorBoundary'
import { formatError, reportRendererError } from './utils/errorLogging'
import packageJson from '../../package.json'

type BootMetadata = {
    version: string
    platform: string
    arch: string
    electron: string | null
    node: string | null
}

/**
 * Resolves when the DOM is ready to be interacted with. If the document is
 * already past the loading state the promise resolves immediately; otherwise
 * it waits for DOMContentLoaded.
 */
function waitForDomReady(): Promise<void> {
    if (document.readyState === 'interactive' || document.readyState === 'complete') {
        return Promise.resolve()
    }
    return new Promise((resolve) => {
        document.addEventListener('DOMContentLoaded', () => resolve(), { once: true })
    })
}

/** Maps a Node.js process.platform string to a human-readable OS name. */
function toPlatformLabel(platform: string): string {
    if (platform === 'win32') return 'Windows'
    if (platform === 'darwin') return 'macOS'
    if (platform === 'linux') return 'Linux'
    return platform
}

/**
 * Populates the static boot-splash DOM elements (version badge, subtitle,
 * platform chip row, status label) with live data from the main process.
 * Default splash copy is also in index.html for first paint before the module runs.
 */
function populateBootSplash(metadata: BootMetadata): void {
    const versionEl = document.getElementById('boot-splash-version')
    const subtitleEl = document.getElementById('boot-splash-subtitle')
    const chipsEl = document.getElementById('boot-splash-chips')
    const statusEl = document.getElementById('boot-splash-status')

    if (versionEl) {
        versionEl.textContent = metadata.version ? `v${metadata.version}` : ''
    }
    if (subtitleEl) {
        subtitleEl.textContent = 'Preparing workspace, terminals, and device services...'
    }
    if (chipsEl) {
        const chips: string[] = []
        const platform = `${toPlatformLabel(metadata.platform)} ${metadata.arch}`.trim()
        if (platform) chips.push(platform)
        if (metadata.electron) chips.push(`Electron ${metadata.electron}`)
        if (metadata.node) chips.push(`Node ${metadata.node}`)
        chipsEl.textContent = chips.join('  |  ')
    }
    if (statusEl) {
        statusEl.textContent = 'Launching'
    }
}

/**
 * Fetches boot metadata (version, platform, Electron/Node versions) from the
 * main process via the synchronous preload API. Falls back to package.json
 * version and unknown platform values if the IPC call fails.
 */
function resolveBootMetadata(): BootMetadata {
    const fallback: BootMetadata = {
        version: packageJson.version || '',
        platform: 'unknown',
        arch: '',
        electron: null,
        node: null
    }

    try {
        const boot = window.rokdock.app.getBootMetadataSync()
        return {
            version: boot?.version || fallback.version,
            platform: boot?.platform || fallback.platform,
            arch: boot?.arch || fallback.arch,
            electron: boot?.electron ?? fallback.electron,
            node: boot?.node ?? fallback.node
        }
    } catch {
        return fallback
    }
}

// Forward uncaught renderer errors to the main process log file.
// These handlers fire for errors that escape React's tree (e.g. promise rejections
// in event callbacks, async code outside components).
window.addEventListener('error', (event) => {
    reportRendererError('renderer:uncaughtError', formatError(event.error ?? event.message))
})

window.addEventListener('unhandledrejection', (event) => {
    reportRendererError('renderer:unhandledRejection', formatError(event.reason))
})

// Boot sequence, run strictly in order so the splash is painted and the window is
// shown BEFORE the heavy theme + React work. Running those concurrently let React's
// mount saturate the main thread and starve the requestAnimationFrame that gates
// showWindow, so the window lost the race to the main-process fallback timer and
// appeared blank. Serializing keeps showWindow early (the splash is the only thing
// rendered yet), then theme + React mount happen behind the visible splash.
void (async () => {
    await waitForDomReady()
    populateBootSplash(resolveBootMetadata())

    // Paint the populated splash (two frames) before making the window visible.
    await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
    try {
        await window.rokdock.app.showWindow()
    } catch (err) {
        console.error('showWindow failed:', err)
    }

    // Apply the theme (CSS vars + platform/theme classes) and await web fonts while
    // the splash covers the window, then mount React so the app is fully styled the
    // instant the splash lifts. bootBundledTheme always resolves (it reveals on
    // failure too), so a theme-fetch error cannot leave the app unmounted.
    await bootBundledTheme()
    const root = createRoot(document.getElementById('root')!)
    root.render(
        <React.StrictMode>
            <ErrorBoundary>
                <App />
            </ErrorBoundary>
        </React.StrictMode>
    )
})()
