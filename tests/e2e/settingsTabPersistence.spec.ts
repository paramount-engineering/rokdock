/**
 * E2E regression: changing the theme on the Appearance tab must not bounce the
 * Settings dialog back to the tab it was opened on.
 *
 * Bug: the dialog's seed-on-open effect was keyed on the store values it reads,
 * including terminalFallbackColor. Switching the theme auto-adjusts that fallback
 * color, which re-ran the effect and reset the active tab to settingsDefaultTab.
 * So opening Settings via a deeplink (e.g. the Deeplinks panel gear, which opens
 * on the Deeplinks tab), switching to Appearance, and changing the theme jumped
 * the user back to Deeplinks. The fix keys the seed effect only on the open
 * transition, so a mid-dialog store change no longer resets the tab.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { launchRokDock } from './helpers'

let app: ElectronApplication
let mainWin: Page
let mainErrors: string[]

test.beforeAll(async () => {
    const launched = await launchRokDock()
    app = launched.app
    mainWin = launched.mainWin
    mainErrors = launched.mainErrors
})

test.afterAll(async () => {
    await app.close()
})

/** Clicks a button inside the rokdock-segmented shadow root by its label. */
async function clickSegmentedOption(page: Page, label: string): Promise<boolean> {
    return page.evaluate((targetLabel: string) => {
        const seg = document.querySelector('rokdock-segmented')
        const buttons = seg?.shadowRoot?.querySelectorAll('button')
        for (const btn of buttons ?? []) {
            if (btn.textContent?.trim() === targetLabel) { btn.click(); return true }
        }
        return false
    }, label)
}

test('theme change on Appearance keeps the active tab (does not jump to the deeplink entry tab)', async () => {
    // Open Settings on the Deeplinks tab via its panel gear (a non-Appearance entry).
    const gear = mainWin.getByTitle('Configure deeplinks').first()
    await gear.waitFor({ state: 'visible', timeout: 10_000 })
    await gear.click()
    await mainWin.locator('.rokdock-dialog-header .rokdock-title').waitFor({ state: 'visible', timeout: 8_000 })

    // Switch to the Appearance tab; its content (the theme segmented control) mounts.
    await mainWin.getByRole('button', { name: 'Appearance', exact: true }).click()
    await mainWin.waitForSelector('rokdock-segmented', { timeout: 5_000 })

    // Change the theme. This mutates the store (terminalFallbackColor); before the
    // fix it re-ran the seed effect and reset the active tab to Deeplinks.
    expect(await clickSegmentedOption(mainWin, 'Light')).toBe(true)
    await expect.poll(
        () => mainWin.evaluate(() => document.documentElement.classList.contains('theme-light')),
        { timeout: 5_000 }
    ).toBe(true)

    // The Appearance content must still be shown (its segmented control is in the
    // DOM); the dialog must NOT have bounced back to Deeplinks (which would unmount
    // it and show the "+ Add Deeplink" control instead).
    expect(await mainWin.locator('rokdock-segmented').count()).toBe(1)
    expect(await mainWin.getByRole('button', { name: '+ Add Deeplink' }).count()).toBe(0)

    // Restore the theme and close so later runs start from dark.
    await clickSegmentedOption(mainWin, 'Dark')
    await expect.poll(
        () => mainWin.evaluate(() => document.documentElement.classList.contains('theme-dark')),
        { timeout: 5_000 }
    ).toBe(true)
    await mainWin.keyboard.press('Escape')

    expect(mainErrors).toEqual([])
})
