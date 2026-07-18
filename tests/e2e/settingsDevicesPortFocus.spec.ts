/**
 * E2E regression: typing in a Settings > Devices port field must not lose focus
 * per keystroke.
 *
 * Bug: each port row's React key was built from the row's mutable values
 * (`${port.port}-${port.label}-${port.color}`). Typing changed a value, which
 * changed the key, so React unmounted the old row and mounted a new one after
 * every keystroke, dropping focus. Only the first character landed. The fix keys
 * the row by its stable list index (matching the deeplink-params list), so the
 * input stays mounted while typing.
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

test('typing in a Devices port field keeps focus and accepts every character', async () => {
    // Open Settings via the Deeplinks panel gear, then switch to the Devices tab.
    const gear = mainWin.getByTitle('Configure deeplinks').first()
    await gear.waitFor({ state: 'visible', timeout: 10_000 })
    await gear.click()
    await mainWin.locator('.rokdock-dialog-header .rokdock-title').waitFor({ state: 'visible', timeout: 8_000 })
    await mainWin.getByRole('button', { name: 'Devices', exact: true }).click()

    // Add a fresh (empty) port row and target its number field.
    await mainWin.getByRole('button', { name: '+ Add Port' }).click()
    const portInput = mainWin.getByPlaceholder('Port').last()
    await portInput.waitFor({ state: 'visible', timeout: 5_000 })

    // Type a multi-digit value one key at a time. With the value-derived key,
    // the first keystroke remounts the row and focus is lost, so only "8" lands.
    await portInput.click()
    await mainWin.keyboard.type('8060', { delay: 30 })

    // Both assertions fail under the bug: the value is truncated and the input
    // is no longer the focused element.
    await expect(mainWin.getByPlaceholder('Port').last()).toHaveValue('8060')
    await expect(mainWin.getByPlaceholder('Port').last()).toBeFocused()

    // Close without saving (discards the throwaway port row).
    await mainWin.keyboard.press('Escape')
    expect(mainErrors).toEqual([])
})
