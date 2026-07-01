/**
 * E2E smoke tests: tool-window open/close lifecycle.
 *
 * Why this exists: two crashes shipped in tool-window teardown (onClosed).
 * The bug pattern is a ReferenceError thrown in the main process during window
 * close, caused by stale variable references left behind after a refactor. An
 * open-only smoke never fires onClosed, so it misses the whole crash class.
 * This suite boots the real app, opens each tool window, CLOSES it, and asserts
 * zero main-process errors - the durable regression net for that class.
 *
 * Covered windows: JSON Editor, SVG Converter, 9-Patch Editor, Script Editor,
 * Screenshot Preview.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { launchRokDock, sendToolWindowCommand } from './helpers'

let app: ElectronApplication
let mainWin: Page
// Main-process stderr lines that matched a fatal pattern (populated by launchRokDock).
let mainErrors: string[]
// Renderer CSP-violation console messages across all windows (populated by launchRokDock).
let cspViolations: string[]

test.beforeAll(async () => {
    const launched = await launchRokDock()
    app = launched.app
    mainWin = launched.mainWin
    mainErrors = launched.mainErrors
    cspViolations = launched.cspViolations
})

test.afterAll(async () => {
    await app.close()
})

// --- helpers ----------------------------------------------------------------

/**
 * Opens a tool window by evaluating an opener expression in the main window,
 * waits for the new BrowserWindow to appear (up to 8 s), loads it, and returns
 * the Playwright Page for that window.
 *
 * @param opener - A JS expression that returns a Promise; evaluated in mainWin.
 * @returns The Page for the newly opened tool window.
 */
async function openToolWindow(opener: string): Promise<Page> {
    const before = app.windows().length

    // Evaluate the opener but do not await its result beyond the IPC round-trip.
    // Wrap in try/catch so renderer-side errors surface clearly.
    await mainWin.evaluate((expr: string) => {
        return new Promise<void>((resolve, reject) => {
            try {
                // eslint-disable-next-line no-eval
                const p = eval(expr) as Promise<unknown>
                if (p && typeof p.then === 'function') {
                    p.then(() => resolve(), reject)
                } else {
                    resolve()
                }
            } catch (e) {
                reject(e)
            }
        })
    }, opener)

    // Poll until a new window appears (the IPC handler creates it asynchronously).
    const deadline = Date.now() + 8_000
    let win: Page | undefined
    while (Date.now() < deadline) {
        const wins = app.windows()
        if (wins.length > before) {
            // Take the most recently added window.
            win = wins[wins.length - 1]
            break
        }
        await new Promise<void>(r => setTimeout(r, 100))
    }

    if (!win) throw new Error(`Tool window did not appear within 8 s (opener: ${opener})`)

    await win.waitForLoadState('domcontentloaded')
    return win
}

/**
 * Closes a tool window and waits for it to be removed from the window list.
 * This exercises the onClosed handler in the main process, which is where
 * the teardown crashes occurred.
 *
 * @param win - The tool-window Page to close.
 */
async function closeToolWindow(win: Page): Promise<void> {
    const beforeCount = app.windows().length

    // close() triggers the Electron window close flow (onClosed fires in main).
    await win.close().catch(() => {})

    // Wait up to 5 s for the window count to drop.
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
        if (app.windows().length < beforeCount) break
        await new Promise<void>(r => setTimeout(r, 100))
    }
}

// --- tests ------------------------------------------------------------------

test('main window boots with title RokDock and no main-process errors', async () => {
    const title = await mainWin.title()
    expect(title).toBe('RokDock')
    expect(mainErrors).toEqual([])
    await mainWin.screenshot({ path: 'tests/e2e/screenshots/main-window.png' })
})

test('JSON Editor: opens, shows correct title, closes cleanly', async () => {
    const win = await openToolWindow(`window.rokdock.json.openEditor()`)

    const title = await win.title()
    expect(title).toBe('JSON Editor')

    await closeToolWindow(win)

    // The regression guard: onClosed ran without a ReferenceError.
    expect(mainErrors).toEqual([])
})

test('SVG Converter: opens, shows correct title, closes cleanly', async () => {
    const win = await openToolWindow(`window.rokdock.svgExporter.openEditor('dark')`)

    const title = await win.title()
    expect(title).toBe('SVG Converter')

    await closeToolWindow(win)

    expect(mainErrors).toEqual([])
})

test('SVG Converter: import command reaches the renderer without error', async () => {
    const win = await openToolWindow(`window.rokdock.svgExporter.openEditor('dark')`)
    await sendToolWindowCommand(app, 'SVG Converter', { type: 'import' })
    expect(await win.title()).toBe('SVG Converter')
    await closeToolWindow(win)
    expect(mainErrors).toEqual([])
})

test('9-Patch Editor: opens, shows correct title, closes cleanly', async () => {
    const win = await openToolWindow(`window.rokdock.ninepatch.openEditor('dark')`)

    const title = await win.title()
    expect(title).toBe('9-Patch Editor')

    await closeToolWindow(win)

    expect(mainErrors).toEqual([])
})

test('9-Patch Editor: new command reaches the renderer without error', async () => {
    const win = await openToolWindow(`window.rokdock.ninepatch.openEditor('dark')`)
    await sendToolWindowCommand(app, '9-Patch Editor', { type: 'new' })
    expect(await win.title()).toBe('9-Patch Editor')
    await closeToolWindow(win)
    expect(mainErrors).toEqual([])
})

test('9-Patch Editor: importData command renders the imported asset', async () => {
    const win = await openToolWindow(`window.rokdock.ninepatch.openEditor('dark')`)

    // A 1x1 PNG. Bypasses the native Open dialog (unchanged, not headless-drivable)
    // and exercises the converted delivery path: importData command -> onCommand ->
    // applyImportedImage -> image decode and canvas render.
    const onePixelPng =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    await sendToolWindowCommand(app, '9-Patch Editor', {
        type: 'importData',
        dataUrl: onePixelPng,
        isNinePatch: false,
        fileName: 'e2e.png'
    })

    // The export button starts disabled and is enabled once the asset renders.
    // waitForFunction polls past the async Image decode.
    await win.waitForFunction(
        () => (document.getElementById('export1080Btn') as HTMLButtonElement | null)?.disabled === false,
        undefined,
        { timeout: 5_000 }
    )

    const emptyHidden = await win.evaluate(
        () => document.getElementById('emptyState')?.style.display === 'none'
    )
    expect(emptyHidden).toBe(true)

    await closeToolWindow(win)
    expect(mainErrors).toEqual([])
})

test('Script Editor: opens, shows correct title, closes cleanly', async () => {
    const win = await openToolWindow(
        `window.rokdock.scriptEditor.open({ name: 'e2e', steps: [], themeMode: 'dark' })`
    )

    const title = await win.title()
    expect(title).toBe('Script Editor - e2e')

    await closeToolWindow(win)

    expect(mainErrors).toEqual([])
})

test('Screenshot Preview: opens to themed placeholder, closes cleanly', async () => {
    // Opened with a fake IP and no stored history, so it boots to the placeholder
    // state (no real device or screenshot needed). This exercises the bundled-entry
    // boot (initial-data pull, icon injection, theme reveal) and the onClosed teardown
    // (activeSession clear + temp-file cleanup).
    const win = await openToolWindow(`window.rokdock.device.openScreenshotWindow('127.0.0.1', 'dark')`)

    const title = await win.title()
    expect(title).toContain('Screenshot')

    // Themed boot: bootBundledTheme removed the FOUC-guard class (no unstyled flash).
    await win.waitForFunction(
        () => !document.documentElement.classList.contains('rokdock-theme-pending'),
        undefined,
        { timeout: 5_000 }
    )

    // The renderer booted: it injected the refresh-button icon from its initial-data pull.
    const refreshHasIcon = await win.evaluate(
        () => !!document.getElementById('refreshBtn')?.querySelector('svg')
    )
    expect(refreshHasIcon).toBe(true)

    // No screenshot history -> the placeholder is visible (not hidden).
    const placeholderVisible = await win.evaluate(
        () => !document.getElementById('screenshotPlaceholder')?.classList.contains('hidden')
    )
    expect(placeholderVisible).toBe(true)

    await closeToolWindow(win)

    expect(mainErrors).toEqual([])
})

test('main window survives all tool-window cycles with zero main-process errors', async () => {
    // Confirm the main window is still alive and the error log is empty after all tests.
    const alive = await mainWin.evaluate(() => typeof window !== 'undefined')
    expect(alive).toBe(true)
    expect(mainErrors).toEqual([])
    // Every tool window opened above loaded under the tightened production CSP
    // with no violations.
    expect(cspViolations).toEqual([])
})
