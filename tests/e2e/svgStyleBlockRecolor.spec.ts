/**
 * E2E: recoloring a color declared in a <style> block rule (not an attribute or inline
 * style). This is the default export mode for Illustrator, Inkscape, and many Figma
 * plugins: `<style>.cls-1{fill:#ff3355}</style>` plus `<rect class="cls-1"/>`. Before this
 * fix, extractColors only read the fill/stroke/stop-color attribute and inline style per
 * element, so such an SVG showed an empty Colors panel and could not be recolored at all.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { launchRokDock, sendToolWindowCommand, openToolWindow } from './helpers'

let app: ElectronApplication
let mainWin: Page
let mainErrors: string[]

const STYLE_BLOCK_RECT =
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">' +
    '<style>.cls-1{fill:#ff3355}</style>' +
    '<rect class="cls-1" width="100" height="100"/></svg>'

test.beforeAll(async () => {
    const launched = await launchRokDock()
    app = launched.app
    mainWin = launched.mainWin
    mainErrors = launched.mainErrors
})

test.afterAll(async () => {
    await app.close()
})

test('a color declared in a <style> block rule is surfaced as a swatch and recolors the preview', async () => {
    const win = await openToolWindow(app, mainWin, () => window.rokdock.svgExporter.openEditor())

    await sendToolWindowCommand(app, 'SVG Converter', {
        type: 'loadSvg',
        svgText: STYLE_BLOCK_RECT,
        fileName: 'styleBlockRect.svg',
        intrinsicWidth: 100,
        intrinsicHeight: 100
    })

    const swatches = () => win.evaluate(() =>
        Array.from(document.querySelectorAll('.color-hex')).map((el) => el.textContent))
    await expect.poll(swatches, { timeout: 10_000 }).toEqual(['#ff3355'])

    // Recolor to green via the color input.
    await win.evaluate(() => {
        const input = document.querySelector('.color-input') as HTMLInputElement
        input.value = '#00ff00'
        input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const centerPixel = () => win.evaluate(() => {
        const canvas = document.getElementById('previewCanvas') as HTMLCanvasElement
        const data = canvas.getContext('2d')!.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data
        return { r: data[0], g: data[1], b: data[2], a: data[3] }
    })
    await expect.poll(async () => (await centerPixel()).g, { timeout: 10_000 }).toBeGreaterThan(120)
    const pixel = await centerPixel()
    expect(pixel.r).toBeLessThan(90)
    expect(pixel.b).toBeLessThan(90)
    expect(pixel.a).toBeGreaterThan(0)

    await win.close().catch(() => {})
    expect(mainErrors).toEqual([])
})
