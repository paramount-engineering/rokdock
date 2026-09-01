/**
 * E2E: an SVG missing the xmlns declaration on its root tag. Some browsers fail to
 * decode such markup as an Image (a blank raster) even though the regex dimension read
 * and DOMParser color read both tolerate it, so import appeared to succeed while
 * render silently failed. renderSvg now injects the namespace before building the
 * render blob, so the file renders correctly instead.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { launchRokDock, sendToolWindowCommand, openToolWindow } from './helpers'

let app: ElectronApplication
let mainWin: Page

// Deliberately no xmlns attribute.
const NO_NAMESPACE_SVG = '<svg width="50" height="50"><rect width="50" height="50" fill="#00ff00"/></svg>'

test.beforeAll(async () => {
    const launched = await launchRokDock()
    app = launched.app
    mainWin = launched.mainWin
})

test.afterAll(async () => {
    await app.close()
})

test('an SVG with no xmlns declaration still renders and exports', async () => {
    const win = await openToolWindow(app, mainWin, () => window.rokdock.svgExporter.openEditor())

    await sendToolWindowCommand(app, 'SVG Converter', {
        type: 'loadSvg',
        svgText: NO_NAMESPACE_SVG,
        fileName: 'noNamespace.svg',
        intrinsicWidth: 50,
        intrinsicHeight: 50
    })

    // exportBtn is enabled immediately on import, well before the render (scheduled
    // ~100ms later) even starts, so it cannot signal "the render finished". estSize's
    // text starts empty, flips to "Processing..." mid-render, then becomes a real byte
    // count only once the full render+encode pipeline completes - wait on that instead.
    await expect.poll(() => win.evaluate(() =>
        document.getElementById('estSize')?.textContent), { timeout: 10_000 })
        .not.toMatch(/^(|Processing\.\.\.)$/)

    await expect.poll(() => win.evaluate(() =>
        document.getElementById('toast')?.classList.contains('show'))).toBe(false)

    const centerPixel = () => win.evaluate(() => {
        const canvas = document.getElementById('previewCanvas') as HTMLCanvasElement
        const data = canvas.getContext('2d')!.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data
        return { r: data[0], g: data[1], b: data[2], a: data[3] }
    })
    const pixel = await centerPixel()
    expect(pixel.g).toBeGreaterThan(120)
    expect(pixel.r).toBeLessThan(90)
    expect(pixel.b).toBeLessThan(90)
    expect(pixel.a).toBeGreaterThan(0)

    await win.close().catch(() => {})
})
