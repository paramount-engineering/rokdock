/**
 * Window reveal policy, with a test-only carve-out for focus stealing.
 *
 * The e2e harness launches the real built app and sets ROKDOCK_E2E=1. In that
 * mode windows are revealed without taking OS focus, so a run of dozens of specs
 * does not repeatedly yank focus away from whatever the developer is working in.
 * In normal use the flag is unset and these helpers behave exactly as a direct
 * show()/focus() pair, so production behavior is unchanged.
 */
import type { BrowserWindow } from 'electron'

/** True when launched by the e2e harness (ROKDOCK_E2E=1); suppresses focus steal. */
export const SUPPRESS_WINDOW_FOCUS = process.env.ROKDOCK_E2E === '1'

/**
 * Reveal a window for the first time: normally show and focus it. Under e2e it is
 * shown inactive (visible to the test, but it does not grab OS focus).
 */
export function revealWindow(win: BrowserWindow): void {
    if (win.isDestroyed()) return
    if (SUPPRESS_WINDOW_FOCUS) {
        win.showInactive()
        return
    }
    win.show()
    win.focus()
}

/**
 * Bring an already-created window forward: normally focus it. Under e2e focus is
 * left untouched (a hidden window is shown inactive so the test can still drive it).
 */
export function focusWindow(win: BrowserWindow): void {
    if (win.isDestroyed()) return
    if (SUPPRESS_WINDOW_FOCUS) {
        if (!win.isVisible()) win.showInactive()
        return
    }
    win.focus()
}
