/**
 * E2E: the terminal gear deeplinks into the Appearance tab's Terminal section.
 *
 * The dock's terminal toolbar has a gear (title "Terminal settings") that opens
 * Settings on the Appearance tab scrolled to the Terminal section. That gear only
 * renders when a terminal tab exists, so this drives a real connection: a manual
 * device is added, a fake telnet server stands in for the Roku debug port, and the
 * device card's "BrightScript Debug" (8085) connect button opens a terminal tab.
 * Clicking the gear must then open Settings on Appearance with the Terminal section
 * (data-section="terminal") visible.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import net from 'node:net'
import { launchRokDock } from './helpers'

// The default BrightScript Debug port the device card connects to (see shared/ports.ts).
const DEBUG_PORT = 8085

let app: ElectronApplication
let mainWin: Page
let mainErrors: string[]
let fakeServer: net.Server

test.beforeAll(async () => {
    // Stand in for the Roku debug port: accept the connection and absorb any bytes
    // so the socket stays open and a terminal tab is established.
    fakeServer = net.createServer((socket) => {
        socket.on('data', () => undefined)
        socket.on('error', () => undefined)
    })
    await new Promise<void>((resolve, reject) => {
        fakeServer.once('error', reject)
        fakeServer.listen(DEBUG_PORT, '127.0.0.1', () => resolve())
    })

    const launched = await launchRokDock()
    app = launched.app
    mainWin = launched.mainWin
    mainErrors = launched.mainErrors
})

test.afterAll(async () => {
    await app.close()
    await new Promise<void>((resolve) => fakeServer.close(() => resolve()))
})

test('terminal gear opens Appearance on the Terminal section', async () => {
    // Add a manual device pointing at the fake debug port.
    await mainWin.evaluate(() => window.rokdock.discovery.addManual('127.0.0.1', 'Fake Roku'))

    // Expand its card in the always-rendered Devices panel.
    const deviceRow = mainWin.getByText('Fake Roku', { exact: true })
    await deviceRow.waitFor({ state: 'visible', timeout: 8_000 })
    await deviceRow.click()

    // Connect on the BrightScript Debug port; the fake server accepts, so a terminal
    // tab is created and the terminal toolbar (with the gear) renders.
    const connectBtn = mainWin.getByText('BrightScript Debug', { exact: true })
    await connectBtn.waitFor({ state: 'visible', timeout: 5_000 })
    await connectBtn.click()

    const gear = mainWin.getByTitle('Terminal settings')
    await gear.waitFor({ state: 'visible', timeout: 8_000 })
    await gear.click()

    // Settings opens on Appearance with the Terminal section visible (the deeplink).
    await expect(mainWin.locator('.rokdock-dialog-header .rokdock-title')).toBeVisible({ timeout: 8_000 })
    await expect(mainWin.getByRole('button', { name: 'Appearance', exact: true })).toBeVisible()
    await expect(mainWin.locator('[data-section="terminal"]')).toBeVisible({ timeout: 5_000 })

    await mainWin.keyboard.press('Escape')
    expect(mainErrors).toEqual([])
})
