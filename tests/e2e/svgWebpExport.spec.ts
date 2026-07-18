/**
 * E2E: WebP export in the SVG Converter.
 *
 * Loads a gradient SVG, switches the export format to WebP, and verifies the
 * lossy WebP path: the quality control appears, the export button relabels, an
 * export size is produced, and the browser actually encodes WebP (real RIFF/WEBP
 * bytes from the preview canvas). Export itself ends in a native save dialog, so
 * this covers everything up to that OS boundary.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { launchRokDock, sendToolWindowCommand, openToolWindow } from './helpers'

let app: ElectronApplication
let mainWin: Page
let mainErrors: string[]

const GRADIENT_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">' +
    '<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs>' +
    '<rect width="100" height="100" fill="url(#g)"/></svg>'

test.beforeAll(async () => {
    const launched = await launchRokDock()
    app = launched.app
    mainWin = launched.mainWin
    mainErrors = launched.mainErrors
})

test.afterAll(async () => {
    await app.close()
})

test('WebP export: switches format, shows quality, and encodes real WebP bytes', async () => {
    const win = await openToolWindow(app, mainWin, () => window.rokdock.svgExporter.openEditor())
    expect(await win.title()).toBe('SVG Converter')

    // Load an SVG through the tool-window command channel (no file dialog).
    await sendToolWindowCommand(app, 'SVG Converter', {
        type: 'loadSvg',
        svgText: GRADIENT_SVG,
        fileName: 'gradient.svg',
        intrinsicWidth: 100,
        intrinsicHeight: 100
    })

    const sizeText = () => win.evaluate(() => document.getElementById('estSize')?.textContent ?? '')
    // The default PNG preview finishes and reports a size.
    await expect.poll(sizeText, { timeout: 10_000 }).toMatch(/\d+\s*(B|KB)/)

    // Switch to WebP.
    await win.click('.pill[data-format="webp"]')

    const ui = await win.evaluate(() => ({
        webpOptionsShown: (document.getElementById('webpOptions') as HTMLElement).style.display !== 'none',
        pngOptionsHidden: (document.getElementById('pngOptions') as HTMLElement).style.display === 'none',
        buttonLabel: (document.getElementById('exportBtnLabel') as HTMLElement).textContent
    }))
    expect(ui.webpOptionsShown).toBe(true)
    expect(ui.pngOptionsHidden).toBe(true)
    expect(ui.buttonLabel).toBe('Export WebP...')

    // After the debounce the WebP encode runs; wait past it, then confirm a size is
    // reported (the pattern excludes the transient "Processing..." state).
    await new Promise<void>((resolve) => setTimeout(resolve, 500))
    await expect.poll(sizeText, { timeout: 10_000 }).toMatch(/\d+\s*(B|KB)/)

    // The browser produces genuine WebP bytes (RIFF....WEBP) from the preview canvas.
    const webp = await win.evaluate(() => {
        const canvas = document.getElementById('previewCanvas') as HTMLCanvasElement
        const url = canvas.toDataURL('image/webp', 0.8)
        const binary = atob(url.split(',')[1])
        return { isWebp: url.startsWith('data:image/webp'), riff: binary.slice(0, 4), webp: binary.slice(8, 12) }
    })
    expect(webp.isWebp).toBe(true)
    expect(webp.riff).toBe('RIFF')
    expect(webp.webp).toBe('WEBP')

    await win.close().catch(() => {})
    expect(mainErrors).toEqual([])
})
