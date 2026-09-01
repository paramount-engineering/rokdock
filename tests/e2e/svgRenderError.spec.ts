/**
 * E2E: renderSvg's failure path. A malformed/undecodable SVG must not silently leave the
 * spinner stuck and the previous render on screen while the toolbar shows the new filename.
 * It should clear the loading overlay, disable Export, and surface a toast.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { launchRokDock, sendToolWindowCommand, openToolWindow } from './helpers'

let app: ElectronApplication
let mainWin: Page

// Truncated markup (no closing tag): the browser's Image decode fails on this.
const MALFORMED_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"'

test.beforeAll(async () => {
    const launched = await launchRokDock()
    app = launched.app
    mainWin = launched.mainWin
})

test.afterAll(async () => {
    await app.close()
})

test('a malformed SVG clears the spinner, disables Export, and shows a toast instead of hanging', async () => {
    const win = await openToolWindow(app, mainWin, () => window.rokdock.svgExporter.openEditor())

    await sendToolWindowCommand(app, 'SVG Converter', {
        type: 'loadSvg',
        svgText: MALFORMED_SVG,
        fileName: 'broken.svg',
        intrinsicWidth: 0,
        intrinsicHeight: 0
    })

    await expect.poll(() => win.evaluate(() =>
        document.getElementById('toast')?.classList.contains('show'))).toBe(true)

    await expect.poll(() => win.evaluate(() =>
        document.getElementById('loadingOverlay')?.classList.contains('show'))).toBe(false)

    await expect.poll(() => win.evaluate(() =>
        (document.getElementById('exportBtn') as HTMLButtonElement).disabled)).toBe(true)

    await win.close().catch(() => {})
})
