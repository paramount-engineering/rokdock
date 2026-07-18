/**
 * E2E: recoloring a gradient whose stops declare no stop-color.
 *
 * A gradient exported without stop-color (common from design tools) renders as the
 * SVG default (black) but declares no literal color. extractColors now surfaces that
 * implicit default as a swappable swatch, and applyRecolor injects stop-color onto the
 * bare stops when it is overridden. This drives that end to end: load such an SVG,
 * confirm the black swatch appears, recolor it to blue, and check the preview pixel.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { launchRokDock, sendToolWindowCommand, openToolWindow } from './helpers'

let app: ElectronApplication
let mainWin: Page
let mainErrors: string[]

// A rect painted by a vertical gradient whose stops omit stop-color (implicit black).
const BARE_STOP_GRADIENT =
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100" fill="none">' +
    '<rect width="100" height="100" fill="url(#g)"/>' +
    '<defs><linearGradient id="g" x1="50" y1="0" x2="50" y2="100" gradientUnits="userSpaceOnUse">' +
    '<stop/><stop offset="1" stop-opacity="0.01"/></linearGradient></defs></svg>'

test.beforeAll(async () => {
    const launched = await launchRokDock()
    app = launched.app
    mainWin = launched.mainWin
    mainErrors = launched.mainErrors
})

test.afterAll(async () => {
    await app.close()
})

test('a gradient with bare stops exposes an implicit-black swatch that recolors the preview', async () => {
    const win = await openToolWindow(app, mainWin, () => window.rokdock.svgExporter.openEditor())

    await sendToolWindowCommand(app, 'SVG Converter', {
        type: 'loadSvg',
        svgText: BARE_STOP_GRADIENT,
        fileName: 'bareGradient.svg',
        intrinsicWidth: 100,
        intrinsicHeight: 100
    })

    // The implicit black default is surfaced as exactly one swappable swatch.
    const swatches = () => win.evaluate(() =>
        Array.from(document.querySelectorAll('.color-hex')).map((el) => el.textContent))
    await expect.poll(swatches, { timeout: 10_000 }).toEqual(['#000000'])

    // Recolor black to blue via the color input.
    await win.evaluate(() => {
        const input = document.querySelector('.color-input') as HTMLInputElement
        input.value = '#0000ff'
        input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    // The top of the preview (gradient start) becomes blue rather than black.
    const topPixel = () => win.evaluate(() => {
        const canvas = document.getElementById('previewCanvas') as HTMLCanvasElement
        const data = canvas.getContext('2d')!.getImageData(Math.floor(canvas.width / 2), 4, 1, 1).data
        return { r: data[0], g: data[1], b: data[2], a: data[3] }
    })
    await expect.poll(async () => (await topPixel()).b, { timeout: 10_000 }).toBeGreaterThan(120)
    const pixel = await topPixel()
    expect(pixel.r).toBeLessThan(90)
    expect(pixel.g).toBeLessThan(90)
    expect(pixel.a).toBeGreaterThan(0)

    await win.close().catch(() => {})
    expect(mainErrors).toEqual([])
})
