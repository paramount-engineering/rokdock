/**
 * E2E: the "maintain aspect ratio" lock on the Output Size section.
 *
 * With the lock on (the default), editing width recomputes height from the source aspect
 * ratio and vice versa. With the lock off, the two dimensions move independently. This drives
 * both directions plus a negative control (lock off means no linking) end to end against a
 * 100x50 (2:1) source.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { launchRokDock, sendToolWindowCommand, openToolWindow } from './helpers'

let app: ElectronApplication
let mainWin: Page
let mainErrors: string[]

// A 2:1 rectangle: intrinsic 100 wide, 50 tall.
const WIDE_RECT =
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">' +
    '<rect width="100" height="50" fill="#3355ff"/></svg>'

test.beforeAll(async () => {
    const launched = await launchRokDock()
    app = launched.app
    mainWin = launched.mainWin
    mainErrors = launched.mainErrors
})

test.afterAll(async () => {
    await app.close()
})

test('the aspect-ratio lock links width and height to the source ratio, and releasing it unlinks them', async () => {
    const win = await openToolWindow(app, mainWin, () => window.rokdock.svgExporter.openEditor())

    await sendToolWindowCommand(app, 'SVG Converter', {
        type: 'loadSvg',
        svgText: WIDE_RECT,
        fileName: 'wideRect.svg',
        intrinsicWidth: 100,
        intrinsicHeight: 50
    })

    const dims = () => win.evaluate(() => ({
        w: (document.getElementById('inpW') as HTMLInputElement).value,
        h: (document.getElementById('inpH') as HTMLInputElement).value
    }))
    const setInput = (id: string, value: string) => win.evaluate(({ id, value }) => {
        const input = document.getElementById(id) as HTMLInputElement
        input.value = value
        input.dispatchEvent(new Event('input', { bubbles: true }))
    }, { id, value })

    // The lock starts on. Editing width drives height to width / 2.
    await expect.poll(() => win.evaluate(() =>
        (document.getElementById('togAspect') as HTMLElement).hasAttribute('checked'))).toBe(true)
    await setInput('inpW', '300')
    await expect.poll(dims).toEqual({ w: '300', h: '150' })

    // Editing height drives width to height * 2.
    await setInput('inpH', '80')
    await expect.poll(dims).toEqual({ w: '160', h: '80' })

    // Negative control: releasing the lock unlinks the two. Changing width leaves height alone.
    await win.evaluate(() => (document.getElementById('togAspect') as HTMLElement).click())
    await setInput('inpW', '400')
    await expect.poll(dims).toEqual({ w: '400', h: '80' })

    await win.close().catch(() => {})
    expect(mainErrors).toEqual([])
})

test('the lock is disabled for a source with no intrinsic dimensions', async () => {
    const win = await openToolWindow(app, mainWin, () => window.rokdock.svgExporter.openEditor())

    await sendToolWindowCommand(app, 'SVG Converter', {
        type: 'loadSvg',
        svgText: WIDE_RECT,
        fileName: 'dimensionless.svg',
        intrinsicWidth: 0,
        intrinsicHeight: 0
    })

    // With no source ratio to enforce, the toggle is disabled rather than a no-op control.
    await expect.poll(() => win.evaluate(() =>
        (document.getElementById('togAspect') as HTMLElement).hasAttribute('disabled'))).toBe(true)

    await win.close().catch(() => {})
    expect(mainErrors).toEqual([])
})
