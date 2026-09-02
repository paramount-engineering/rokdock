/**
 * E2E regression: hovering the terminal output must not snap a manually-scrolled
 * view back to the bottom.
 *
 * Moving the pointer into the output area enables JSON-hover detection (once per
 * tab) and kicks off a background scan that merges JSON-fallback metadata onto
 * every buffered line. That merge produces a new (but content-equivalent) line
 * array. The auto-scroll-to-bottom effect used to depend on that merged array
 * directly, so its completion (unrelated to any real new output) forced
 * scrollTop back to the max, destroying wherever the user had scrolled to (and
 * any selection anchored there). It now depends on the raw line buffer instead,
 * which only changes when output actually changes.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import net from 'node:net'
import { launchRokDock } from './helpers'

const DEBUG_PORT = 8085
const LINE_COUNT = 300
const LAST_LINE = `log line ${LINE_COUNT - 1}`

let app: ElectronApplication
let mainWin: Page
let fakeServer: net.Server

test.beforeAll(async () => {
    const payload = Array.from({ length: LINE_COUNT }, (_, i) => `log line ${i}`).join('\r\n') + '\r\n'
    fakeServer = net.createServer((socket) => {
        socket.on('error', () => undefined)
        socket.write(payload)
    })
    await new Promise<void>((resolve, reject) => {
        fakeServer.once('error', reject)
        fakeServer.listen(DEBUG_PORT, '127.0.0.1', () => resolve())
    })
    const launched = await launchRokDock()
    app = launched.app
    mainWin = launched.mainWin
})

test.afterAll(async () => {
    await app.close()
    await new Promise<void>((resolve) => fakeServer.close(() => resolve()))
})

test('scrolling away from the bottom then hovering the output does not snap back to the bottom', async () => {
    await mainWin.evaluate(() => window.rokdock.discovery.addManual('127.0.0.1', 'Fake Roku'))
    const deviceRow = mainWin.getByText('Fake Roku', { exact: true })
    await deviceRow.waitFor({ state: 'visible', timeout: 8_000 })
    await deviceRow.click()
    const connectBtn = mainWin.getByText('BrightScript Debug', { exact: true })
    await connectBtn.waitFor({ state: 'visible', timeout: 5_000 })
    await connectBtn.click()

    // Wait for the whole buffer, then scroll away from the bottom.
    await expect.poll(async () => mainWin.evaluate(() => {
        const viewport = document.querySelector('.terminal-viewport-scroll') as HTMLElement | null
        if (viewport) viewport.scrollTop = viewport.scrollHeight
        return document.body.textContent ?? ''
    }), { timeout: 20_000 }).toContain(LAST_LINE)

    await mainWin.evaluate(() => {
        const viewport = document.querySelector('.terminal-viewport-scroll') as HTMLElement
        viewport.scrollTop = 0
    })
    // The scroll-triggered virtualization re-render is deferred to a rAF; give it a
    // moment to settle before locating a row at the new scroll position.
    await expect.poll(() => mainWin.evaluate(() =>
        document.querySelector('[data-line-index="0"]') !== null), { timeout: 3_000 }).toBe(true)

    // Hover the output (enables JSON-hover detection and its background cache scan)
    // by locating a rendered row and moving the pointer onto it - the same real
    // interaction a user makes when clicking or dragging to select terminal text.
    const firstRow = mainWin.locator('[data-line-index]').first()
    const box = await firstRow.boundingBox()
    if (!box) throw new Error('no rendered row found')
    await mainWin.mouse.move(box.x + 5, box.y + box.height / 2)

    // Give the background JSON-fallback merge time to finish a full pass over the
    // buffer and (pre-fix) fire the stale auto-scroll dependency.
    await mainWin.waitForTimeout(1_500)

    const scrollTop = await mainWin.evaluate(() => (document.querySelector('.terminal-viewport-scroll') as HTMLElement).scrollTop)
    expect(scrollTop).toBe(0)
})
