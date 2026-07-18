/**
 * E2E: caret-based tab-strip scrolling in the JSON editor.
 *
 * Drives the shared createTabStripScroller behavior through the JSON editor's
 * vanilla tab bar: with enough tabs to overflow, the carets appear, the left
 * caret starts disabled (strip at the start), clicking the right caret scrolls
 * the strip and enables the left caret, and the native scrollbar stays hidden.
 * The same helper backs the terminal tab bar (React), which needs a device to
 * exercise, so this covers the shared logic.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { launchRokDock, openToolWindow } from './helpers'

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

test('tab carets appear on overflow, scroll the strip, and hide the native scrollbar', async () => {
    const win = await openToolWindow(app, mainWin, () => window.rokdock.json.openEditor())
    expect(await win.title()).toBe('JSON Editor')

    // Add enough tabs to overflow the strip (via the real new-tab button).
    await win.evaluate(() => {
        const button = document.getElementById('btnAddTab') as HTMLButtonElement
        for (let i = 0; i < 30; i++) button.click()
    })

    const carets = () => win.evaluate(() => {
        const list = document.querySelector('.rokdock-tab-list') as HTMLElement
        const left = document.querySelector('.rokdock-tab-scroll-left') as HTMLButtonElement
        const right = document.querySelector('.rokdock-tab-scroll-right') as HTMLButtonElement
        return {
            hasCarets: !!left && !!right,
            leftHidden: left.hidden,
            rightHidden: right.hidden,
            leftDisabled: left.disabled,
            rightDisabled: right.disabled,
            scrollLeft: list.scrollLeft,
            // A visible horizontal scrollbar would shrink clientHeight below offsetHeight.
            scrollbarHidden: list.offsetHeight === list.clientHeight,
            scrollbarWidth: getComputedStyle(list).getPropertyValue('scrollbar-width')
        }
    })

    // Overflowing: both carets shown and the native scrollbar is hidden. (Adding tabs
    // scrolls the newest, active tab into view, so the strip starts at the end here.)
    const initial = await carets()
    expect(initial.hasCarets).toBe(true)
    expect(initial.leftHidden).toBe(false)
    expect(initial.rightHidden).toBe(false)
    expect(initial.scrollbarHidden).toBe(true)
    expect(initial.scrollbarWidth).toBe('none')

    // Drive the strip to the start: the left caret disables, the right caret enables.
    await win.evaluate(() => { (document.querySelector('.rokdock-tab-list') as HTMLElement).scrollLeft = 0 })
    await expect.poll(async () => (await carets()).leftDisabled, { timeout: 2_000 }).toBe(true)
    expect((await carets()).rightDisabled).toBe(false)

    // Click the right caret and wait for the smooth scroll to advance; left re-enables.
    await win.click('.rokdock-tab-scroll-right')
    await expect.poll(async () => (await carets()).scrollLeft, { timeout: 2_000 }).toBeGreaterThan(0)
    expect((await carets()).leftDisabled).toBe(false)

    await win.close().catch(() => {})
    expect(mainErrors).toEqual([])
})
