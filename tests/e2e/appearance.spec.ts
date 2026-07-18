/**
 * E2E tests for the Appearance settings tab.
 *
 * Covered behaviors:
 *  1. Settings opens on Appearance as the first tab; no Terminal tab exists.
 *  2. Theme segmented control: clicking Light then Dark flips document.documentElement
 *     between theme-light and theme-dark via the IPC round-trip broadcast.
 *  3. Color > Hue slider: changing the hue shifts --rokdock-bg-base (brand purple) while
 *     --rokdock-state-error (outside the brand hue range) stays unchanged.
 *  4a. Terminal section visibility (device-free): open Settings, switch to Appearance,
 *      assert [data-section="terminal"] is visible and the "Tab Label Format" label
 *      is present -- proving the section renders without a connected device because
 *      context.surfaces.terminal is true in the dock shell.
 *  4b. Terminal gear deeplink (requires an open terminal tab): click the real gear icon
 *      and assert Settings opens on Appearance with [data-section="terminal"] visible.
 *      Marked test.skip when no terminal tab is open (device-free run), so the suite
 *      dashboard shows SKIPPED rather than a false PASSED.
 *
 * Design notes:
 *  - The segmented control buttons live inside a Shadow DOM. The tests interact with
 *    them via page.evaluate and shadowRoot queries rather than Playwright locators,
 *    which cannot pierce closed shadow roots in all cases.
 *  - Theme and tint changes travel through an IPC round-trip (main process sends
 *    theme:css-vars-updated), so all CSS-var and class assertions use expect.poll.
 */

import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { launchRokDock } from './helpers'
import type { AppPreferences } from '@shared/types'

let app: ElectronApplication
let mainWin: Page
let mainErrors: string[]
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

/** Opens the Settings dialog via File > Settings... and waits for it to appear. */
async function openSettings(page: Page): Promise<void> {
    const fileBtn = page.getByRole('button', { name: 'File' })
    await fileBtn.waitFor({ state: 'visible', timeout: 10_000 })
    await fileBtn.click()

    const settingsItem = page.getByRole('button', { name: /^Settings\.\.\./ })
    await settingsItem.waitFor({ state: 'visible', timeout: 5_000 })
    await settingsItem.click({ force: true })

    const title = page.locator('.rokdock-dialog-header .rokdock-title')
    await title.waitFor({ state: 'visible', timeout: 8_000 })
}

/**
 * Closes any open dialog by pressing Escape and waits for the title to disappear.
 * Uses count() to check presence so the check survives timing variations.
 */
async function closeSettings(page: Page): Promise<void> {
    const title = page.locator('.rokdock-dialog-header .rokdock-title')
    const count = await title.count()
    if (count === 0) return
    // A count > 0 element might not yet be in the visible state, so check
    // the first match directly before deciding to press Escape.
    const visible = await title.first().isVisible().catch(() => false)
    if (!visible) return
    await page.keyboard.press('Escape')
    await title.waitFor({ state: 'hidden', timeout: 5_000 })
}

/**
 * Clicks a button inside the rokdock-segmented shadow root by matching its
 * text content. Returns false if no matching button was found.
 */
async function clickSegmentedOption(page: Page, label: string): Promise<boolean> {
    return page.evaluate((targetLabel: string) => {
        const segmented = document.querySelector('rokdock-segmented')
        if (!segmented?.shadowRoot) return false
        const buttons = segmented.shadowRoot.querySelectorAll('button')
        for (const btn of buttons) {
            if (btn.textContent?.trim() === targetLabel) {
                btn.click()
                return true
            }
        }
        return false
    }, label)
}

/**
 * Reads the Code section's Syntax Theme select value. That select is the rokdock-select
 * carrying the preset options (identified by its githubDark option), distinct from the Font
 * Family select. Its .value getter returns the inner <select> value.
 */
function syntaxThemeValue(page: Page): Promise<string | null> {
    return page.evaluate(() => {
        const code = document.querySelector('[data-section="code"]')
        const selects = Array.from(code?.querySelectorAll('rokdock-select') ?? [])
        const syntax = selects.find(s => s.querySelector('option[value="githubDark"]')) as (HTMLElement & { value: string }) | undefined
        return syntax?.value ?? null
    })
}

/** Selects the GitHub Dark preset (a dark theme with a light companion) in the Code section. */
function seedGithubDarkSyntax(page: Page): Promise<void> {
    return page.evaluate(() => {
        const code = document.querySelector('[data-section="code"]')
        const selects = Array.from(code?.querySelectorAll('rokdock-select') ?? [])
        const syntax = selects.find(s => s.querySelector('option[value="githubDark"]'))
        syntax?.dispatchEvent(new CustomEvent('rokdock-change', { detail: { value: 'githubDark' }, bubbles: true, composed: true }))
    })
}

// --- tests ------------------------------------------------------------------

test('Settings opens on Appearance tab and the Terminal tab does not exist', async () => {
    await openSettings(mainWin)

    // The Appearance tab button should be visible as the active tab.
    const appearanceTab = mainWin.getByRole('button', { name: 'Appearance', exact: true })
    await appearanceTab.waitFor({ state: 'visible', timeout: 5_000 })

    // No Terminal tab should exist anywhere in the dialog.
    const terminalTab = mainWin.getByRole('button', { name: 'Terminal', exact: true })
    await expect(terminalTab).toHaveCount(0)

    expect(mainErrors).toEqual([])
    await closeSettings(mainWin)
})

test('theme segmented control flips document.documentElement class between theme-light and theme-dark', async () => {
    await openSettings(mainWin)

    // Navigate to the Appearance tab (it should already be active, but be explicit).
    const appearanceTab = mainWin.getByRole('button', { name: 'Appearance', exact: true })
    await appearanceTab.waitFor({ state: 'visible', timeout: 5_000 })
    await appearanceTab.click()

    // The segmented control inside the Theme collapsible section is the first
    // rokdock-segmented on the page. Click "Light".
    const clickedLight = await clickSegmentedOption(mainWin, 'Light')
    expect(clickedLight).toBe(true)

    // The theme change travels via IPC (setThemeMode -> broadcastThemeChange ->
    // main -> theme:css-vars-updated -> preload sets class on documentElement).
    // Poll until the class appears.
    await expect.poll(
        () => mainWin.evaluate(() => document.documentElement.classList.contains('theme-light')),
        { timeout: 5_000 }
    ).toBe(true)

    // Now click "Dark" and verify the class flips.
    const clickedDark = await clickSegmentedOption(mainWin, 'Dark')
    expect(clickedDark).toBe(true)

    await expect.poll(
        () => mainWin.evaluate(() => document.documentElement.classList.contains('theme-dark')),
        { timeout: 5_000 }
    ).toBe(true)

    expect(mainErrors).toEqual([])
    await closeSettings(mainWin)
})

test('Color hue slider retints --rokdock-bg-base but leaves --rokdock-state-error unchanged', async () => {
    await openSettings(mainWin)

    const appearanceTab = mainWin.getByRole('button', { name: 'Appearance', exact: true })
    await appearanceTab.waitFor({ state: 'visible', timeout: 5_000 })
    await appearanceTab.click()

    // Capture baseline values before touching the slider.
    const before = await mainWin.evaluate(() => {
        const style = getComputedStyle(document.documentElement)
        return {
            bg: style.getPropertyValue('--rokdock-bg-base').trim(),
            statusError: style.getPropertyValue('--rokdock-state-error').trim(),
        }
    })

    // Trigger a hue change by dispatching a rokdock-change event on the first
    // rokdock-slider (Hue, inside the Color collapsible section). The slider
    // event bridges to the React onChange which calls setTint. setTint persists
    // and calls broadcastThemeChange, which goes via IPC, updating CSS vars.
    // We use a non-zero hue value (180) that is guaranteed to shift the bg color.
    await mainWin.evaluate(() => {
        const sliders = document.querySelectorAll('rokdock-slider')
        // The Theme section sliders run: UI font size (index 0), then Hue (index 1),
        // Saturation, Brightness. Identify the Hue slider by its label slot content.
        let hueSlider: Element | null = null
        for (const slider of sliders) {
            const labelSlot = slider.querySelector('[slot="label"]')
            if (labelSlot?.textContent?.trim() === 'Hue') {
                hueSlider = slider
                break
            }
        }
        if (!hueSlider) {
            // Fallback: use the second rokdock-slider (index 1). UI font size is the first.
            hueSlider = sliders[1] ?? null
        }
        if (hueSlider) {
            hueSlider.dispatchEvent(
                new CustomEvent('rokdock-change', { detail: { value: 180 }, bubbles: true, composed: true })
            )
        }
    })

    // Poll until --rokdock-bg-base changes (the tint broadcast takes a round-trip).
    await expect.poll(
        () => mainWin.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--rokdock-bg-base').trim()
        ),
        { timeout: 8_000 }
    ).not.toBe(before.bg)

    // --rokdock-state-error is outside the brand hue range and must not change.
    const statusErrorAfter = await mainWin.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--rokdock-state-error').trim()
    )
    expect(statusErrorAfter).toBe(before.statusError)

    // Reset tint to identity so later tests start from a clean state.
    // Capture the expected post-reset value (the value at hue 0) before dispatching.
    // Because the reset is another IPC round-trip, poll until the var returns to its
    // baseline rather than sleeping.
    const bgAtHue0 = before.bg
    await mainWin.evaluate(() => {
        const sliders = document.querySelectorAll('rokdock-slider')
        let hueSlider: Element | null = null
        for (const slider of sliders) {
            const labelSlot = slider.querySelector('[slot="label"]')
            if (labelSlot?.textContent?.trim() === 'Hue') {
                hueSlider = slider
                break
            }
        }
        if (!hueSlider) hueSlider = sliders[1] ?? null
        if (hueSlider) {
            hueSlider.dispatchEvent(
                new CustomEvent('rokdock-change', { detail: { value: 0 }, bubbles: true, composed: true })
            )
        }
    })

    // Wait for the CSS var to return to the pre-test baseline (hue 0 = identity tint).
    await expect.poll(
        () => mainWin.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--rokdock-bg-base').trim()
        ),
        { timeout: 8_000 }
    ).toBe(bgAtHue0)

    expect(mainErrors).toEqual([])
    await closeSettings(mainWin)
})

test('terminal section renders without a connected device (data-section visible with Tab Label Format control)', async () => {
    // context.surfaces.terminal and context.surfaces.code are both true in the
    // dock shell even without a device, so both [data-section="code"] and
    // [data-section="terminal"] should always render inside the Appearance tab.
    // This test is entirely device-free and must always pass.
    await openSettings(mainWin)

    const appearanceTab = mainWin.getByRole('button', { name: 'Appearance', exact: true })
    await appearanceTab.waitFor({ state: 'visible', timeout: 5_000 })
    await appearanceTab.click()

    // Both section wrappers must be in the DOM and visible.
    const codeSection = mainWin.locator('[data-section="code"]')
    await expect(codeSection).toBeVisible({ timeout: 5_000 })

    const terminalSection = mainWin.locator('[data-section="terminal"]')
    await expect(terminalSection).toBeVisible({ timeout: 5_000 })

    // CollapsibleSettingsSection opens by default, so inner content is visible
    // without interaction. Verify representative labels in each section.
    // "Syntax Theme" is the label in the Syntax & Colors collapsible inside Code.
    // The collapsible header lives in Shadow DOM; the label element is in light DOM.
    const syntaxThemeLabel = mainWin.locator('[data-section="code"]').getByText('Syntax Theme', { exact: true })
    await expect(syntaxThemeLabel).toBeVisible({ timeout: 5_000 })

    // "Tab Label Format" is the only field in TerminalAppearanceSection.
    const tabLabelFormatLabel = mainWin.locator('[data-section="terminal"]').getByText('Tab Label Format', { exact: true })
    await expect(tabLabelFormatLabel).toBeVisible({ timeout: 5_000 })

    expect(mainErrors).toEqual([])
    await closeSettings(mainWin)
})

// The terminal gear deeplink (clicking the terminal toolbar gear opens Appearance
// on the Terminal section) needs a live terminal tab, so it is covered with a fake
// telnet server in tests/e2e/terminalDeeplink.spec.ts rather than skipped here.

test('theme mode is save-gated: Cancel reverts without persisting, Save persists', async () => {
    const persistedMode = () => mainWin.evaluate(() => window.rokdock.store.getPreferences().then((p: AppPreferences) => p.themeMode ?? 'dark'))
    const baseline = await persistedMode()

    // Cancel path: switch to Light (live preview), then Escape. The preview must
    // revert (no theme-light class) and the persisted mode must be unchanged.
    await openSettings(mainWin)
    await mainWin.getByRole('button', { name: 'Appearance', exact: true }).click()
    await mainWin.waitForSelector('rokdock-segmented', { timeout: 5_000 })
    expect(await clickSegmentedOption(mainWin, 'Light')).toBe(true)
    await expect.poll(() => mainWin.evaluate(() => document.documentElement.classList.contains('theme-light')), { timeout: 5_000 }).toBe(true)
    await mainWin.keyboard.press('Escape')
    await expect.poll(() => mainWin.evaluate(() => document.documentElement.classList.contains('theme-light')), { timeout: 5_000 }).toBe(false)
    expect(await persistedMode()).toBe(baseline)

    // Save path: switch to Light and Save. The persisted mode must now be 'light'.
    await openSettings(mainWin)
    await mainWin.getByRole('button', { name: 'Appearance', exact: true }).click()
    await mainWin.waitForSelector('rokdock-segmented', { timeout: 5_000 })
    expect(await clickSegmentedOption(mainWin, 'Light')).toBe(true)
    await mainWin.locator('.rokdock-dialog-actions .rokdock-btn-primary').click()
    await expect.poll(persistedMode, { timeout: 5_000 }).toBe('light')

    // Restore the baseline and Save so later tests start from a known state.
    await openSettings(mainWin)
    await mainWin.getByRole('button', { name: 'Appearance', exact: true }).click()
    await mainWin.waitForSelector('rokdock-segmented', { timeout: 5_000 })
    const baselineLabel = baseline === 'light' ? 'Light' : baseline === 'system' ? 'System' : 'Dark'
    expect(await clickSegmentedOption(mainWin, baselineLabel)).toBe(true)
    await mainWin.locator('.rokdock-dialog-actions .rokdock-btn-primary').click()
    await expect.poll(persistedMode, { timeout: 5_000 }).toBe(baseline)

    expect(mainErrors).toEqual([])
})

test('UI font size is save-gated: Cancel reverts the preview and persists nothing, Save persists', async () => {
    const persistedScale = () => mainWin.evaluate(() => window.rokdock.store.getPreferences().then((p: AppPreferences) => p.uiFontScale ?? 0))
    const fontBase = () => mainWin.evaluate(() => document.documentElement.style.getPropertyValue('--rokdock-font-base').trim())
    const baseline = await persistedScale()
    const baselineBase = `${14 + baseline}px`

    // Drive the "UI font size" slider by its label slot, mirroring the Hue lookup.
    const nudgeFontScale = (value: number) => mainWin.evaluate((v) => {
        const sliders = Array.from(document.querySelectorAll('rokdock-slider'))
        const target = sliders.find(s => s.querySelector('[slot="label"]')?.textContent?.trim() === 'UI font size')
        target?.dispatchEvent(new CustomEvent('rokdock-change', { detail: { value: v }, bubbles: true, composed: true }))
    }, value)

    // Cancel path: nudge to +4 (live preview shifts the base to 18px), then Cancel.
    // The preview must revert and the persisted offset must be unchanged.
    await openSettings(mainWin)
    await mainWin.getByRole('button', { name: 'Appearance', exact: true }).click()
    await mainWin.waitForSelector('rokdock-slider', { timeout: 5_000 })
    await nudgeFontScale(4)
    await expect.poll(fontBase, { timeout: 5_000 }).toBe('18px')
    await mainWin.locator('.rokdock-dialog-actions .rokdock-btn-ghost').click()
    await expect.poll(fontBase, { timeout: 5_000 }).toBe(baselineBase)
    expect(await persistedScale()).toBe(baseline)

    // Save path: nudge to +4 and Save. The persisted offset must now be 4.
    await openSettings(mainWin)
    await mainWin.getByRole('button', { name: 'Appearance', exact: true }).click()
    await mainWin.waitForSelector('rokdock-slider', { timeout: 5_000 })
    await nudgeFontScale(4)
    await mainWin.locator('.rokdock-dialog-actions .rokdock-btn-primary').click()
    await expect.poll(persistedScale, { timeout: 5_000 }).toBe(4)

    // Restore the baseline and Save so later tests start from a known state.
    await openSettings(mainWin)
    await mainWin.getByRole('button', { name: 'Appearance', exact: true }).click()
    await mainWin.waitForSelector('rokdock-slider', { timeout: 5_000 })
    await nudgeFontScale(baseline)
    await mainWin.locator('.rokdock-dialog-actions .rokdock-btn-primary').click()
    await expect.poll(persistedScale, { timeout: 5_000 }).toBe(baseline)

    expect(mainErrors).toEqual([])
})

test('switching theme mode swaps the syntax theme to its light/dark companion', async () => {
    await openSettings(mainWin)
    await mainWin.getByRole('button', { name: 'Appearance', exact: true }).click()
    await mainWin.waitForSelector('rokdock-segmented', { timeout: 5_000 })

    // Seed a known dark preset that has a light companion (GitHub Dark).
    await seedGithubDarkSyntax(mainWin)
    await expect.poll(() => syntaxThemeValue(mainWin), { timeout: 5_000 }).toBe('githubDark')

    // Switch to Light: the syntax theme follows to its light companion.
    expect(await clickSegmentedOption(mainWin, 'Light')).toBe(true)
    await expect.poll(() => syntaxThemeValue(mainWin), { timeout: 5_000 }).toBe('githubLight')

    // Switch back to Dark: it returns to the dark companion.
    expect(await clickSegmentedOption(mainWin, 'Dark')).toBe(true)
    await expect.poll(() => syntaxThemeValue(mainWin), { timeout: 5_000 }).toBe('githubDark')

    // Escape cancels the draft so persisted prefs are untouched for later tests.
    await closeSettings(mainWin)
    expect(mainErrors).toEqual([])
})

test('the menu-bar quick toggle also swaps the syntax theme to its companion (the direct-toggle path)', async () => {
    // Regression: the Settings segmented control swapped the syntax theme on a mode change, but the
    // menu-bar quick toggle (store.setThemeMode) did not, so a named dark theme stayed dark in light
    // mode. This drives the ACTUAL button the user hits, distinct from the Settings-control test above.

    // Seed GitHub Dark in Dark mode and Save so it persists to the live store (the toggle reads the store).
    await openSettings(mainWin)
    await mainWin.getByRole('button', { name: 'Appearance', exact: true }).click()
    await mainWin.waitForSelector('rokdock-segmented', { timeout: 5_000 })
    expect(await clickSegmentedOption(mainWin, 'Dark')).toBe(true)
    await seedGithubDarkSyntax(mainWin)
    await expect.poll(() => syntaxThemeValue(mainWin), { timeout: 5_000 }).toBe('githubDark')
    await mainWin.getByRole('button', { name: 'Save', exact: true }).click()
    await mainWin.locator('.rokdock-dialog-header .rokdock-title').waitFor({ state: 'hidden', timeout: 5_000 })
    await expect.poll(() => mainWin.evaluate(() => document.documentElement.classList.contains('theme-dark')), { timeout: 5_000 }).toBe(true)

    // The bug path: click the menu-bar quick toggle, not the Settings segmented control.
    await mainWin.getByRole('button', { name: 'Toggle light and dark mode' }).click()
    await expect.poll(() => mainWin.evaluate(() => document.documentElement.classList.contains('theme-light')), { timeout: 5_000 }).toBe(true)

    // Reopen Settings and confirm the syntax theme followed to its light companion.
    await openSettings(mainWin)
    await mainWin.getByRole('button', { name: 'Appearance', exact: true }).click()
    await mainWin.waitForSelector('rokdock-segmented', { timeout: 5_000 })
    await expect.poll(() => syntaxThemeValue(mainWin), { timeout: 5_000 }).toBe('githubLight')
    await closeSettings(mainWin)

    // Restore dark mode so later tests see the default.
    await mainWin.getByRole('button', { name: 'Toggle light and dark mode' }).click()
    await expect.poll(() => mainWin.evaluate(() => document.documentElement.classList.contains('theme-dark')), { timeout: 5_000 }).toBe(true)

    expect(mainErrors).toEqual([])
})

test('all appearance tests completed with zero main-process errors and no CSP violations', async () => {
    const alive = await mainWin.evaluate(() => typeof window !== 'undefined')
    expect(alive).toBe(true)
    expect(mainErrors).toEqual([])
    expect(cspViolations).toEqual([])
})
