/**
 * Window navigation hardening.
 *
 * A RokDock renderer is a local application shell, never a web browser. A top-level
 * navigation to an external page would replace the whole app UI with that page (and
 * is a security risk), and window.open would spawn an uncontrolled child window. This
 * guard blocks any off-origin top-level navigation and any window.open, and instead
 * routes http(s) targets to the system browser via shell.openExternal.
 *
 * Same-document navigations are allowed: a dev-server reload (http://localhost) and
 * a reload of the bundled file shell (the same file path) both pass through. Anything
 * else (an external web link clicked in rendered content, a file:// link to a
 * different path) is refused.
 */
import { shell } from 'electron'
import type { BrowserWindow } from 'electron'

/** True only for http(s) URLs, the protocols we will hand to the system browser. */
export function isWebUrl(url: string): boolean {
    try {
        const { protocol } = new URL(url)
        return protocol === 'http:' || protocol === 'https:'
    } catch {
        return false
    }
}

/**
 * Whether a top-level navigation from `currentUrl` to `targetUrl` should be allowed
 * to proceed in-window. Only same-document reloads pass: a file shell may reload its
 * own exact path, and a dev-server page may navigate within its own origin. Everything
 * else is refused (and the caller routes web targets to the browser).
 */
export function shouldAllowNavigation(currentUrl: string, targetUrl: string): boolean {
    try {
        const current = new URL(currentUrl)
        const target = new URL(targetUrl)
        // file:// origins are opaque (all compare equal), so require the same path to
        // distinguish a reload from a link to a different local file.
        if (current.protocol === 'file:' || target.protocol === 'file:') {
            return current.protocol === target.protocol && current.pathname === target.pathname
        }
        return current.origin === target.origin
    } catch {
        return false
    }
}

/** Apply to every BrowserWindow so a link click in rendered content never takes over the shell. */
export function hardenWindowNavigation(win: BrowserWindow): void {
    const webContents = win.webContents
    webContents.setWindowOpenHandler(({ url }) => {
        if (isWebUrl(url)) void shell.openExternal(url)
        return { action: 'deny' }
    })
    webContents.on('will-navigate', (event, url) => {
        if (shouldAllowNavigation(webContents.getURL(), url)) return
        event.preventDefault()
        if (isWebUrl(url)) void shell.openExternal(url)
    })
}
