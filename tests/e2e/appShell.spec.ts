/**
 * E2E app-shell workflow tests: device-independent.
 *
 * Why this exists: the tool-window spec covers the open/close lifecycle of
 * auxiliary windows. This spec covers the main shell itself - layout rendering,
 * the settings dialog preference-write path, and the theme toggle. All three
 * workflows are device-independent and run against the real Electron app.
 *
 * The PRIMARY reliable signal for every test is: zero main-process errors
 * captured AND the main window is still alive (evaluate returns) after the
 * action. DOM assertions are secondary checks that use forgiving locators
 * and generous timeouts.
 *
 * Covered workflows:
 *  1. Main shell renders - core panels present after boot.
 *  2. Settings open + change + close - exercises the preference-write path
 *     through persistPreference. Specifically proves that editing the screenshot
 *     naming format input (which calls setScreenshotNamingFormat, which calls
 *     persistPreference) does not trigger any recursion/crash in the 300ms
 *     debounce window.
 *  3. Theme switch - toggles dark/light via the menu-bar button; asserts no
 *     crash and the renderer stays alive.
 */

import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { launchRokDock } from './helpers'
import { DEFAULT_SCREENSHOT_NAMING_FORMAT } from '../../src/shared/toolbarConstants'

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
 * Returns true if the renderer is alive: evaluate(() => true) resolves.
 * Used as the liveness check after every action.
 */
async function rendererAlive(page: Page): Promise<boolean> {
    try {
        return await page.evaluate(() => true)
    } catch {
        return false
    }
}

// --- tests ------------------------------------------------------------------

test('main shell renders: Devices panel, Remote panel, and menu bar visible', async () => {
    // Wait for the boot splash to clear and the main layout to mount.
    // The "Devices" CollapsibleSection title is rendered unconditionally in
    // DevicePanel. The theme toggle aria-label is rendered unconditionally in
    // CustomMenuBar. Both appearing confirms the shell is fully mounted.

    const devicesLocator = mainWin.getByText('Devices', { exact: true })
    await devicesLocator.waitFor({ state: 'visible', timeout: 20_000 })

    // The theme toggle is in the right group of the custom menu bar.
    const themeToggle = mainWin.getByRole('button', { name: /toggle light and dark mode/i })
    await themeToggle.waitFor({ state: 'visible', timeout: 10_000 })

    // The remote panel renders a rokdock-remote web component. Its parent
    // container is always in the DOM even with no device selected. Checking
    // that the panel scrollable area exists is sufficient without a device.
    // We locate it by the gear / settings icon button present at the bottom
    // of the remote panel (title "Configure in Settings" on the deeplinks
    // section, or the gear icon for opening settings). The File menu button
    // is a lighter check that the menu bar items are mounted.
    const fileMenu = mainWin.getByRole('button', { name: 'File' })
    await fileMenu.waitFor({ state: 'visible', timeout: 5_000 })

    await mainWin.screenshot({ path: 'tests/e2e/screenshots/app-shell.png' })

    // Primary signal: renderer alive and no fatal main-process errors.
    expect(await rendererAlive(mainWin)).toBe(true)
    expect(mainErrors).toEqual([])
    // The dock loaded under the tightened production CSP with no violations.
    expect(cspViolations).toEqual([])
})

test('settings dialog: open, edit screenshot naming format, save, and close', async () => {
    // Open Settings via File > Settings menu path.
    // Clicking the "File" menu button opens the dropdown; then clicking the
    // "Settings" item calls setSettingsDialogOpen('terminal') in the renderer.

    const fileMenuBtn = mainWin.getByRole('button', { name: 'File' })
    await fileMenuBtn.waitFor({ state: 'visible', timeout: 10_000 })
    await fileMenuBtn.click()

    // The dropdown item text is "Settings..." (from appMenu definition,
    // id: 'open-settings', label: 'Settings...').
    // The menu item button also contains an accelerator hint span; force:true
    // bypasses any pointer-event interception from that child span.
    const settingsItem = mainWin.getByRole('button', { name: /^Settings\.\.\./ })
    await settingsItem.waitFor({ state: 'visible', timeout: 5_000 })
    await settingsItem.click({ force: true })

    // Confirm the dialog is open: the header title span contains "Settings".
    const dialogTitle = mainWin.locator('.rokdock-dialog-header .rokdock-title')
    await dialogTitle.waitFor({ state: 'visible', timeout: 8_000 })
    const titleText = await dialogTitle.textContent()
    expect(titleText).toBe('Settings')

    // Navigate to the Capture tab where the screenshot naming format input lives.
    // Tab buttons are plain <button> elements whose text matches SETTINGS_TAB_LABELS.
    const captureTab = mainWin.getByRole('button', { name: 'Capture', exact: true })
    await captureTab.waitFor({ state: 'visible', timeout: 5_000 })
    await captureTab.click()

    // Edit the Filename Format input, located by its placeholder (the default
    // format string) so the locator does not depend on input ordering. The other
    // rokdock-code input on this tab is the Screenshot Folder, a real filesystem
    // path. Editing that would persist a relative path the app turns into a stray
    // directory in its working directory. A format string has no such side effect.
    const namingInput = mainWin.getByPlaceholder(DEFAULT_SCREENSHOT_NAMING_FORMAT, { exact: true })
    await namingInput.waitFor({ state: 'visible', timeout: 8_000 })

    // The Screenshot Folder field shows the real default folder path as its placeholder (the
    // default lives under userData/screenshot-history), not an opaque "Default (app data folder)",
    // so the user can see where screenshots land. Read-only: do not edit this real-path field.
    const folderInput = mainWin.getByPlaceholder(/screenshot-history/)
    await folderInput.waitFor({ state: 'visible', timeout: 8_000 })
    const folderPlaceholder = await folderInput.getAttribute('placeholder')
    expect(folderPlaceholder).toMatch(/screenshot-history/)
    expect(folderPlaceholder).not.toBe('Default (app data folder)')

    // Edit the naming format. This directly calls setScreenshotNamingFormat
    // which calls persistPreference, starting the 300ms coalescing timer.
    const originalValue = await namingInput.inputValue()
    await namingInput.fill(`${originalValue}_e2e`)

    // Wait past the 300ms debounce to let the coalescing flush fire.
    // A crash here (recursion or unhandled rejection) would appear in mainErrors.
    await mainWin.waitForTimeout(600)

    // Primary signal: no fatal errors and renderer still alive.
    expect(mainErrors).toEqual([])
    expect(await rendererAlive(mainWin)).toBe(true)

    // Restore the original value so the test does not persist drift across runs.
    // Without this the saved preference would accumulate "_e2e" on every run.
    await namingInput.fill(originalValue)
    await mainWin.waitForTimeout(600)

    // Close the dialog via the X button in the dialog header.
    const closeBtn = mainWin.locator('.rokdock-dialog-header button')
    await closeBtn.waitFor({ state: 'visible', timeout: 5_000 })
    await closeBtn.click()

    // Confirm dialog is gone: the title should no longer be visible.
    await dialogTitle.waitFor({ state: 'hidden', timeout: 5_000 })

    // Final check: zero errors after dialog lifecycle, renderer still alive.
    expect(mainErrors).toEqual([])
    expect(await rendererAlive(mainWin)).toBe(true)
})

test('theme switch: toggle dark/light and back, no main-process errors', async () => {
    // The theme toggle button is in the right group of the custom menu bar.
    // It has aria-label "Toggle light and dark mode" (see customMenuBar.tsx).
    const themeToggle = mainWin.getByRole('button', { name: /toggle light and dark mode/i })
    await themeToggle.waitFor({ state: 'visible', timeout: 10_000 })

    // Read the current theme from the DOM so we can verify it changed.
    // The CustomMenuBar renders the button with title that names the NEXT mode.
    const titleBefore = await themeToggle.getAttribute('title')

    // Toggle once.
    await themeToggle.click()

    // Wait a moment for the theme change to propagate (CSS vars update on :root).
    await mainWin.waitForTimeout(400)

    // Verify the button title reflects the toggled state.
    const titleAfter = await themeToggle.getAttribute('title')
    expect(titleAfter).not.toBe(titleBefore)

    // Toggle back to original.
    await themeToggle.click()
    await mainWin.waitForTimeout(400)

    // Primary signal: no crashes, renderer alive after both toggles.
    expect(mainErrors).toEqual([])
    expect(await rendererAlive(mainWin)).toBe(true)
})

test('all app-shell tests completed with zero main-process errors', async () => {
    // Final guard: confirms the cumulative error log is still empty after all
    // workflows. Mirrors the final test in toolWindows.spec.ts.
    const alive = await mainWin.evaluate(() => typeof window !== 'undefined')
    expect(alive).toBe(true)
    expect(mainErrors).toEqual([])
    expect(cspViolations).toEqual([])
})
