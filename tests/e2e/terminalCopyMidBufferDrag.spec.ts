/**
 * E2E regression: dragging a selection from a middle line down to the bottom of a long
 * buffer must copy from the actual start line, not wherever the browser's native
 * Selection anchor ends up after auto-scrolling.
 *
 * Dragging near the bottom edge of the virtualized viewport triggers the browser's own
 * auto-scroll, which (via React unmounting the row the drag started on) can cause
 * Chromium to silently re-anchor the Selection to a different, still-valid row rather
 * than leaving selection.anchorNode null. That re-anchored value is not null, so a
 * null-only fallback to the mousedown-captured line index never engages, and the copy
 * silently starts from the wrong line. Reported by a user via a screen recording:
 * "start the selection from a line in the middle, and got to the bottom, the start line
 * changes." Fixed by preferring the mousedown/mouseup-captured line indices over the
 * live (and provably unreliable under this exact interaction) DOM read.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import net from 'node:net'
import { launchRokDock } from './helpers'

const DEBUG_PORT = 8085
const LINE_COUNT = 300
const START_LINE = 150
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

test('dragging from a middle line to the bottom copies from the real start line, not a re-anchored one', async () => {
    await mainWin.evaluate(() => window.rokdock.discovery.addManual('127.0.0.1', 'Fake Roku'))
    const deviceRow = mainWin.getByText('Fake Roku', { exact: true })
    await deviceRow.waitFor({ state: 'visible', timeout: 8_000 })
    await deviceRow.click()
    const connectBtn = mainWin.getByText('BrightScript Debug', { exact: true })
    await connectBtn.waitFor({ state: 'visible', timeout: 5_000 })
    await connectBtn.click()

    await expect.poll(async () => mainWin.evaluate(() => {
        const viewport = document.querySelector('.terminal-viewport-scroll') as HTMLElement | null
        if (viewport) viewport.scrollTop = viewport.scrollHeight
        return document.body.textContent ?? ''
    }), { timeout: 20_000 }).toContain(LAST_LINE)

    // Position the start line near the top of the viewport.
    await mainWin.evaluate((line) => {
        const viewport = document.querySelector('.terminal-viewport-scroll') as HTMLElement
        viewport.scrollTop = line * 18 // VIRTUAL_LINE_HEIGHT
    }, START_LINE)
    await expect.poll(() => mainWin.evaluate((line) =>
        document.querySelector(`[data-line-index="${line}"]`) !== null, START_LINE), { timeout: 3_000 }).toBe(true)

    const startBox = await mainWin.locator(`[data-line-index="${START_LINE}"]`).boundingBox()
    if (!startBox) throw new Error(`line ${START_LINE} not found`)

    // Drag from the middle line toward the bottom edge repeatedly, which triggers the
    // browser's native auto-scroll and unmounts the start row along the way, then finish
    // the drag by releasing on a real rendered row at the very end of the buffer (matching
    // where a real mouse-up lands, on visible text, not the exact viewport edge pixel).
    await mainWin.mouse.move(startBox.x + 5, startBox.y + startBox.height / 2)
    await mainWin.mouse.down()
    const viewportBox = await mainWin.locator('.terminal-viewport-scroll').boundingBox()
    if (!viewportBox) throw new Error('viewport not found')
    for (let i = 0; i < 15; i++) {
        await mainWin.mouse.move(startBox.x + 5, viewportBox.y + viewportBox.height - 5, { steps: 2 })
        await mainWin.waitForTimeout(150)
    }
    const lastRow = mainWin.locator('[data-line-index]').last()
    const lastRowBox = await lastRow.boundingBox()
    if (lastRowBox) await mainWin.mouse.move(lastRowBox.x + 5, lastRowBox.y + lastRowBox.height / 2, { steps: 2 })
    await mainWin.mouse.up()

    const copied = await mainWin.evaluate(async () => {
        return new Promise<string>((resolve) => {
            const handler = (e: ClipboardEvent) => {
                document.removeEventListener('copy', handler)
                resolve(e.clipboardData?.getData('text/plain') ?? '')
            }
            document.addEventListener('copy', handler)
            document.execCommand('copy')
        })
    })

    expect(copied).toContain(`log line ${START_LINE}`)
    expect(copied).toContain(LAST_LINE)
    // The bug produced a copy anchored dozens of lines away from the real start; a
    // correct copy should be close to the true span (150..299), not wildly short/long.
    const copiedLineCount = copied.split('\n').length
    expect(copiedLineCount).toBeGreaterThanOrEqual(LINE_COUNT - START_LINE - 5)
    expect(copiedLineCount).toBeLessThanOrEqual(LINE_COUNT - START_LINE + 5)
})
