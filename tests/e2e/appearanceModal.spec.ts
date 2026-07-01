/**
 * E2E: the in-window Appearance modal (Phase 2).
 *
 * Dock-less tool windows expose appearance settings through a toolbar gear
 * (<rokdock-settings-gear>) that dispatches 'rokdock-open-appearance'; the
 * per-window appearanceModalTrigger lazily mounts a React modal overlay INSIDE
 * the current window (not a separate OS window). This suite opens a tool window,
 * clicks its gear, and asserts the modal appears in-window with the universal
 * sections present and the dock-only Terminal section absent (terminal: false),
 * that no new OS window is spawned, that a second click does not stack a second
 * modal, and that closing leaves no main-process errors.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { launchRokDock } from './helpers'

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

/** Opens a tool window via an opener expression evaluated in the dock, then
 *  returns the newest window once it appears. */
async function openToolWindow(opener: string): Promise<Page> {
    const before = app.windows().length
    await mainWin.evaluate((expr: string) => {
        // eslint-disable-next-line no-eval
        return Promise.resolve(eval(expr))
    }, opener)
    const deadline = Date.now() + 8_000
    while (Date.now() < deadline) {
        const wins = app.windows()
        if (wins.length > before) {
            const win = wins[wins.length - 1]
            await win.waitForLoadState('domcontentloaded')
            return win
        }
        await new Promise<void>(r => setTimeout(r, 100))
    }
    throw new Error(`Tool window did not appear within 8 s (opener: ${opener})`)
}

/**
 * JSON editor: Code section and font-size live-update.
 *
 * Opens the JSON editor, clicks its gear, asserts the in-window modal shows the
 * Code section and NO Terminal section, drives the Font Size range input to a
 * clearly different value, clicks Save, and asserts the .cm-editor computed
 * font-size reflects the new value. A negative control captures the before value
 * and asserts it differs from the after value.
 *
 * The userData dir is a throwaway per launchRokDock call (see helpers.ts), so
 * there is no persistent state to restore after changing the font-size pref.
 */
test('JSON editor modal shows Code section (no Terminal) and font-size live-updates after Save', async () => {
    const jsonWin = await openToolWindow(`window.rokdock.json.openEditor()`)
    expect(await jsonWin.title()).toBe('JSON Editor')

    // Wait for the themed boot to complete so the CM6 editor has applied its theme
    // and the .cm-editor font-size reflects the initial pref.
    await jsonWin.waitForFunction(
        () => !document.documentElement.classList.contains('rokdock-theme-pending'),
        undefined,
        { timeout: 5_000 }
    )
    await jsonWin.waitForSelector('.cm-editor', { timeout: 5_000 })

    // Capture the editor font-size BEFORE opening the modal. The CM6 theme sets
    // fontSize on '&' (the .cm-editor root element).
    const fontSizeBefore = await jsonWin.evaluate(() => {
        const editor = document.querySelector('.cm-editor')
        if (!editor) return ''
        return getComputedStyle(editor).fontSize
    })
    expect(fontSizeBefore).not.toBe('')

    // Click the gear to open the in-window Appearance modal.
    const gear = jsonWin.locator('rokdock-settings-gear')
    await expect(gear).toHaveCount(1)
    await gear.click()
    await jsonWin.waitForSelector('.rokdock-overlay', { timeout: 8_000 })

    // The Code section must be present. Terminal must be absent (terminal: false).
    expect(await jsonWin.locator('[data-section="code"]').count()).toBe(1)
    expect(await jsonWin.locator('[data-section="terminal"]').count()).toBe(0)

    // Drive the Font Size slider inside the Code section. It is a themed
    // <rokdock-slider> (min=8 max=24) whose actual range input lives in the
    // element's shadow root. The component listens on that input's 'input' event,
    // syncs its number field, and emits 'rokdock-change', which the React wrapper
    // bridges to onChange. Reach into the shadow root, set the value, and dispatch
    // the input event the component is listening for.
    const targetFontSize = 22
    await jsonWin.evaluate((size: number) => {
        const codeSection = document.querySelector('[data-section="code"]')
        if (!codeSection) throw new Error('[data-section="code"] not found')
        // The Font Size slider is the first (and only) rokdock-slider in the Code
        // section (Font sub-section). Syntax & Colors has no sliders.
        const slider = codeSection.querySelector('rokdock-slider')
        if (!slider?.shadowRoot) throw new Error('Font Size rokdock-slider not found in code section')
        const rangeInput = slider.shadowRoot.querySelector('input[type="range"]') as HTMLInputElement | null
        if (!rangeInput) throw new Error('range input not found in rokdock-slider shadow root')
        rangeInput.value = String(size)
        rangeInput.dispatchEvent(new Event('input', { bubbles: true }))
    }, targetFontSize)

    // Click Save: persists the font size and applies the appearance draft, which
    // broadcasts 'appearance:applied' (relayed into the JSON editor window as
    // 'rokdock-appearance-applied'), triggering a CM6 theme reconfigure with the
    // new font size.
    await jsonWin.locator('.rokdock-btn-primary').click()
    await jsonWin.waitForSelector('.rokdock-overlay', { state: 'detached', timeout: 5_000 })

    // Poll until the .cm-editor font-size reflects the new value. broadcastCodeStyle
    // travels via IPC (main re-reads prefs, re-broadcasts) so it may not be instant.
    const expectedFontSize = `${targetFontSize}px`
    await expect.poll(
        () => jsonWin.evaluate(() => {
            const editor = document.querySelector('.cm-editor')
            if (!editor) return ''
            return getComputedStyle(editor).fontSize
        }),
        { timeout: 8_000 }
    ).toBe(expectedFontSize)

    // Negative control: the before value must differ from the after value.
    expect(fontSizeBefore).not.toBe(expectedFontSize)

    await jsonWin.close().catch(() => {})
    expect(mainErrors).toEqual([])
    expect(cspViolations).toEqual([])
})

test('gear opens an in-window Appearance modal (no new OS window) with Terminal gated off', async () => {
    const svg = await openToolWindow(`window.rokdock.svgExporter.openEditor('dark')`)
    expect(await svg.title()).toBe('SVG Converter')

    const gear = svg.locator('rokdock-settings-gear')
    await expect(gear).toHaveCount(1)

    const windowCountBefore = app.windows().length
    await gear.click()

    // The modal mounts in-window (lazy React chunk), so an overlay appears in the
    // SVG window itself and the OS window count does not change.
    await svg.waitForSelector('.rokdock-overlay', { timeout: 8_000 })
    await svg.waitForSelector('rokdock-segmented', { timeout: 5_000 })
    expect(app.windows().length).toBe(windowCountBefore)

    expect(await svg.locator('.rokdock-title').first().innerText()).toBe('Appearance')
    // The Terminal section is dock-only and must be gated off here (terminal: false).
    expect(await svg.locator('[data-section="terminal"]').count()).toBe(0)

    // The modal's full-screen overlay intercepts pointer events, so the gear cannot
    // be clicked again while it is open. Re-dispatch the open event directly to prove
    // the single-instance guard does not stack a second overlay.
    await svg.evaluate(() => document.dispatchEvent(new CustomEvent('rokdock-open-appearance')))
    await new Promise<void>(r => setTimeout(r, 300))
    expect(await svg.locator('.rokdock-overlay').count()).toBe(1)

    // Cancel closes the modal (overlay removed) without persisting.
    await svg.locator('.rokdock-btn-ghost').click()
    await svg.waitForSelector('.rokdock-overlay', { state: 'detached', timeout: 5_000 })

    await svg.close().catch(() => {})
    expect(mainErrors).toEqual([])
    expect(cspViolations).toEqual([])
})

/**
 * A JSON editor opened from the dock menu (NOT from a terminal) must honor the
 * persisted code-surface appearance on its first paint. Before the boot path read
 * the prefs, the menu opener passed no syntax theme or background, so the editor
 * showed default JSON colors on the default background regardless of the saved
 * settings. Here we persist a distinctive theme with its own background, open the
 * editor via the menu path, and assert the editor background is the theme's.
 */
test('menu-opened JSON editor honors the persisted syntax theme and background on boot', async () => {
    // Persist Atom One Dark (background #282c34) with use-theme-background on.
    await mainWin.evaluate(async () => {
        await window.rokdock.store.setPreferences({
            terminalSyntaxThemePreset: 'atomOneDark',
            terminalUseThemeBackground: true,
        })
    })

    // Open via the dock-menu path (no appearance args are passed by this opener).
    const jsonWin = await openToolWindow(`window.rokdock.json.openEditor()`)
    expect(await jsonWin.title()).toBe('JSON Editor')
    await jsonWin.waitForFunction(
        () => !document.documentElement.classList.contains('rokdock-theme-pending'),
        undefined,
        { timeout: 5_000 }
    )
    await jsonWin.waitForSelector('.cm-editor', { timeout: 5_000 })

    // The editor background must be Atom One Dark's #282c34 (rgb(40, 44, 52)), not
    // the default app background, proving the boot path read the persisted theme.
    await expect.poll(
        () => jsonWin.evaluate(() => {
            const editor = document.querySelector('.cm-editor')
            return editor ? getComputedStyle(editor).backgroundColor : ''
        }),
        { timeout: 5_000 }
    ).toBe('rgb(40, 44, 52)')

    await jsonWin.close().catch(() => {})
    expect(mainErrors).toEqual([])
    expect(cspViolations).toEqual([])
})
