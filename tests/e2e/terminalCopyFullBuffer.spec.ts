/**
 * E2E regression: copying from the virtualized terminal must include the whole
 * scrollback, not just the rows currently in the DOM.
 *
 * The output is virtualized (only a scroll window of rows is mounted), so a native
 * copy of a Select All used to capture just the visible rows and drop the rest of a
 * large log. A fake telnet server emits a few thousand lines; the test drives the
 * real Select All action and a native webContents.copy() (the same path Cmd/Ctrl+C
 * and the Edit menu take), then reads the OS clipboard and asserts every line is
 * present. Negative control: far fewer than the full count are ever in the DOM, so a
 * full-buffer clipboard cannot have come from the rendered rows.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import net from 'node:net'
import { launchRokDock } from './helpers'

const DEBUG_PORT = 8085
const LINE_COUNT = 2500
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

test('Select All + native copy includes the full scrollback, not just the virtualized rows', async () => {
    // Connect on the BrightScript Debug port (same flow as the docs-lookup spec).
    await mainWin.evaluate(() => window.rokdock.discovery.addManual('127.0.0.1', 'Fake Roku'))
    const deviceRow = mainWin.getByText('Fake Roku', { exact: true })
    await deviceRow.waitFor({ state: 'visible', timeout: 8_000 })
    await deviceRow.click()
    const connectBtn = mainWin.getByText('BrightScript Debug', { exact: true })
    await connectBtn.waitFor({ state: 'visible', timeout: 5_000 })
    await connectBtn.click()

    // Wait until the whole buffer has arrived: scroll to the bottom and confirm the last
    // emitted line is present in the DOM.
    await expect.poll(async () => mainWin.evaluate(() => {
        const viewport = document.querySelector('.terminal-viewport-scroll') as HTMLElement | null
        if (viewport) viewport.scrollTop = viewport.scrollHeight
        return document.body.textContent ?? ''
    }), { timeout: 20_000 }).toContain(LAST_LINE)

    // Negative control: virtualization is active, so only a fraction of the lines are in
    // the DOM at once. A full-buffer clipboard therefore cannot be a rendered-rows artifact.
    const renderedRows = await mainWin.evaluate(() => document.querySelectorAll('[data-line-index]').length)
    expect(renderedRows).toBeGreaterThan(0)
    expect(renderedRows).toBeLessThan(LINE_COUNT / 2)

    const tabId = await mainWin.evaluate(() =>
        document.querySelector('[data-tab-id]')?.getAttribute('data-tab-id') ?? '')
    expect(tabId).not.toBe('')

    // Drive the real Select All over the same IPC channel the context menu uses, then run a
    // native copy (the Cmd/Ctrl+C path). Our copy-event override rebuilds the full buffer.
    await app.evaluate(({ BrowserWindow, clipboard }, id) => {
        clipboard.clear()
        const win = BrowserWindow.getAllWindows()[0]
        win.webContents.send('context-menu:action', id, 'select-all')
    }, tabId)

    // Let the renderer apply the Select All (set the flag + DOM selection) before copying.
    await expect.poll(() => mainWin.evaluate(() =>
        (window.getSelection()?.toString() ?? '').length), { timeout: 5_000 }).toBeGreaterThan(0)

    const copied = await app.evaluate(async ({ BrowserWindow, clipboard }) => {
        const win = BrowserWindow.getAllWindows()[0]
        win.webContents.copy()
        await new Promise((resolve) => setTimeout(resolve, 300))
        return clipboard.readText()
    })

    const copiedLines = copied.split('\n')
    // Every emitted line is present, far more than were ever in the DOM.
    expect(copiedLines.length).toBeGreaterThanOrEqual(LINE_COUNT)
    expect(copied).toContain('log line 0')
    expect(copied).toContain(LAST_LINE)
})
