/**
 * E2E: the terminal selection toolbar's "Look up in Docs" and "Copy" buttons.
 *
 * A fake telnet server stands in for the Roku debug port and emits two lines:
 * a short term and a long line. Selecting the short term shows the floating
 * selection toolbar lookup button and clicking it opens the docs window. Selecting the long line
 * shows no lookup button (a full block is never a useful search term), but Copy still
 * appears and copies the selection regardless.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import net from 'node:net'
import { launchRokDock } from './helpers'

const DEBUG_PORT = 8085
const SHORT_LINE = 'roSGNode'
const LONG_LINE = 'this is a full line of terminal output with many words'

let app: ElectronApplication
let mainWin: Page
let fakeServer: net.Server

test.beforeAll(async () => {
    fakeServer = net.createServer((socket) => {
        socket.on('error', () => undefined)
        socket.write(`${SHORT_LINE}\r\n${LONG_LINE}\r\n`)
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

// Select an output line's full text and fire the mouseup the magnifier listens for.
async function selectLineAndRelease(lineText: string): Promise<void> {
    await mainWin.evaluate((text) => {
        const lines = Array.from(document.querySelectorAll<HTMLElement>('[data-line]'))
        const line = lines.find((el) => (el.textContent ?? '').includes(text))
        if (!line) throw new Error(`line not found: ${text}`)
        const range = document.createRange()
        range.selectNodeContents(line)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        const rect = line.getBoundingClientRect()
        line.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.right, clientY: rect.top }))
    }, lineText)
}

test('magnifier appears only for a short selection and opens docs', async () => {
    // Add a manual device and connect on the BrightScript Debug port.
    await mainWin.evaluate(() => window.rokdock.discovery.addManual('127.0.0.1', 'Fake Roku'))
    const deviceRow = mainWin.getByText('Fake Roku', { exact: true })
    await deviceRow.waitFor({ state: 'visible', timeout: 8_000 })
    await deviceRow.click()
    const connectBtn = mainWin.getByText('BrightScript Debug', { exact: true })
    await connectBtn.waitFor({ state: 'visible', timeout: 5_000 })
    await connectBtn.click()

    // Wait for the emitted output to render.
    await mainWin.getByText(SHORT_LINE, { exact: false }).first().waitFor({ state: 'visible', timeout: 8_000 })

    // A long, multi-word selection shows no lookup button.
    await selectLineAndRelease(LONG_LINE)
    await expect(mainWin.locator('[data-testid="seltoolbar-lookup"]')).toHaveCount(0)

    // A short (1 to 3 word) selection shows the lookup button.
    await selectLineAndRelease(SHORT_LINE)
    await expect(mainWin.locator('[data-testid="seltoolbar-lookup"]')).toBeVisible({ timeout: 2_000 })

    // Clicking it opens the docs window (lookUp fired).
    const before = app.windows().length
    await mainWin.locator('[data-testid="seltoolbar-lookup"]').click()
    await expect.poll(() => app.windows().length, { timeout: 8_000 }).toBeGreaterThan(before)
})

test('the Copy button on the selection toolbar copies the selected text', async () => {
    // The long line has no lookup/explain button, so Copy is the only action offered,
    // proving Copy does not depend on either of those being eligible.
    await selectLineAndRelease(LONG_LINE)
    await expect(mainWin.locator('[data-testid="seltoolbar-copy"]')).toBeVisible({ timeout: 2_000 })

    await app.evaluate(({ clipboard }) => clipboard.clear())
    await mainWin.locator('[data-testid="seltoolbar-copy"]').click()

    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 5_000 })
        .toContain(LONG_LINE)
})

test('the toolbar hides when the pointer leaves the selection and its own area, and reappears on hovering back', async () => {
    await selectLineAndRelease(LONG_LINE)
    const toolbar = mainWin.locator('[data-testid="seltoolbar-copy"]')
    await expect(toolbar).toBeVisible({ timeout: 2_000 })

    // Move well away from both the selection and the toolbar (the device panel, far left).
    await mainWin.mouse.move(20, 400)
    await expect(toolbar).toHaveCount(0)

    // Moving back over the SELECTED TEXT (the selection's own rect, tightly fit around
    // the rendered glyphs) brings it back without a new selection. This is deliberately
    // NOT the row element's full-width rect: a terminal row is wider than its text (it
    // includes trailing blank space), and hovering that blank space should not count.
    const point = await mainWin.evaluate(() => {
        const range = window.getSelection()!.getRangeAt(0)
        const box = range.getBoundingClientRect()
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    })
    await mainWin.mouse.move(point.x, point.y)
    await expect(toolbar).toBeVisible({ timeout: 2_000 })
})

test('a fast move from the selection straight onto the toolbar does not lose it, even skipping the gap between them', async () => {
    await selectLineAndRelease(LONG_LINE)
    const toolbarBtn = mainWin.locator('[data-testid="seltoolbar-copy"]')
    await expect(toolbarBtn).toBeVisible({ timeout: 2_000 })

    // A real drag/mouseup can leave the pointer just outside both rects for one sample
    // (fast movement does not sample every pixel of the gap between the selection and the
    // toolbar sitting just above it). Simulate that: jump to a point outside both rects,
    // then immediately (no wait, faster than the hide delay) land on the button itself.
    await mainWin.mouse.move(20, 400)
    const box = (await toolbarBtn.boundingBox())!
    await mainWin.mouse.move(box.x + box.width / 2, box.y + box.height / 2)

    // Never disappeared: the click lands on a still-mounted button.
    await expect(toolbarBtn).toBeVisible()
    await toolbarBtn.click()
})
