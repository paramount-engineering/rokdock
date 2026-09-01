/**
 * E2E regression: the terminal's live regex filter hides non-matching lines from the
 * virtualized view without discarding them from the buffer, and Select All / copy
 * while filtered only reach the filtered (visible) lines.
 *
 * A fake telnet server emits a mix of "keep N" and "drop N" lines, well past the
 * virtualization window. The test opens the filter via the same context-menu action
 * channel the real menu item drives, types a pattern that matches only "keep" lines,
 * and asserts the DOM only ever shows "keep" rows. Clearing the filter brings every
 * line back. A filtered Select All + native copy is asserted to contain only the
 * "keep" lines (negative control: the buffer holds far more than that).
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import net from 'node:net'
import { launchRokDock } from './helpers'

const DEBUG_PORT = 8085
const LINE_COUNT = 400
const KEEP_COUNT = LINE_COUNT / 2

let app: ElectronApplication
let mainWin: Page
let fakeServer: net.Server

/** The filter bar's status readout ("showing all", "<matched> / <total>", or an error). */
const filterStatusText = () => mainWin.evaluate(() =>
    document.querySelector('.terminal-filter-input')?.parentElement?.textContent ?? '')

/** The open terminal tab's id, which the context-menu action channel is addressed by. */
async function readTabId(): Promise<string> {
    const tabId = await mainWin.evaluate(() =>
        document.querySelector('[data-tab-id]')?.getAttribute('data-tab-id') ?? '')
    expect(tabId).not.toBe('')
    return tabId
}

/**
 * The fake server writes its payload once per connection, and the tests below each end by
 * emptying the buffer. Reconnecting opens a fresh socket, so the server re-sends the full
 * batch and there is real matchable content to filter before clearing it again.
 */
async function reconnect(tabId: string): Promise<void> {
    await app.evaluate(({ BrowserWindow }, id) => {
        const win = BrowserWindow.getAllWindows()[0]
        win.webContents.send('context-menu:action', id, 'reconnect')
    }, tabId)
}

/**
 * Waits for the filter status to show a real, non-zero match count. This reads the live
 * filter's own count, computed over the FULL buffer by the regex worker, not the virtualized
 * DOM (checking for a specific far-down line's text is a bad proxy: under heavier system load,
 * or if the viewport isn't scrolled to where that line would render, it never appears in the
 * DOM even once the data has fully arrived). The generous timeout absorbs the full e2e suite's
 * system load (100+ preceding specs slow down how fast a reconnect's fresh batch streams in).
 */
async function waitForNonZeroFilterMatch(): Promise<void> {
    await expect.poll(filterStatusText, { timeout: 20_000 }).toMatch(/^[1-9]\d* \/ \d+/)
}

/**
 * Focuses the terminal's own container (tabIndex=0, ancestor of the output viewport), the
 * element the shortcut listeners require as the keydown target. Clicking a plain child div
 * does not reliably move focus there, so this focuses it directly.
 */
async function focusTerminalContainer(): Promise<void> {
    await mainWin.evaluate(() => {
        const viewport = document.querySelector('.terminal-viewport-scroll')
        const container = viewport?.closest('[tabindex="0"]') as HTMLElement | null
        container?.focus()
    })
}

test.beforeAll(async () => {
    const lines: string[] = []
    for (let i = 0; i < LINE_COUNT; i++) {
        lines.push(i % 2 === 0 ? `keep ${i}` : `drop ${i}`)
    }
    const payload = lines.join('\r\n') + '\r\n'
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

test('filters the virtualized view to matching lines, then restores everything when cleared', async () => {
    await mainWin.evaluate(() => window.rokdock.discovery.addManual('127.0.0.1', 'Fake Roku'))
    const deviceRow = mainWin.getByText('Fake Roku', { exact: true })
    await deviceRow.waitFor({ state: 'visible', timeout: 8_000 })
    await deviceRow.click()
    const connectBtn = mainWin.getByText('BrightScript Debug', { exact: true })
    await connectBtn.waitFor({ state: 'visible', timeout: 5_000 })
    await connectBtn.click()

    await expect.poll(async () => mainWin.evaluate(() => document.body.textContent ?? ''), { timeout: 10_000 })
        .toContain(`keep ${LINE_COUNT - 2}`)

    const tabId = await readTabId()

    // Negative control: before any filter is applied, "drop" lines are on screen too.
    const preFilterLines = await mainWin.evaluate(() =>
        Array.from(document.querySelectorAll('[data-line-index]')).map((el) => el.textContent))
    expect(preFilterLines.some((text) => text?.startsWith('drop'))).toBe(true)

    // Open the filter bar the same way the real "Filter Output..." menu item does.
    await app.evaluate(({ BrowserWindow }, id) => {
        const win = BrowserWindow.getAllWindows()[0]
        win.webContents.send('context-menu:action', id, 'toggle-filter')
    }, tabId)

    const filterInput = mainWin.locator('.terminal-filter-input')
    await filterInput.waitFor({ state: 'visible', timeout: 5_000 })
    await filterInput.fill('^keep')

    // Debounce (120ms) + a worker round trip: the status readout flips from "showing all"
    // to the match count once the filter is actually applied.
    await expect.poll(filterStatusText, { timeout: 5_000 }).toContain(`${KEEP_COUNT} / `)

    const renderedLines = await mainWin.evaluate(() =>
        Array.from(document.querySelectorAll('[data-line-index]')).map((el) => el.textContent))
    expect(renderedLines.length).toBeGreaterThan(0)
    expect(renderedLines.every((text) => text?.startsWith('keep'))).toBe(true)

    // Select All + native copy while filtered reaches only the "keep" lines.
    await app.evaluate(({ BrowserWindow, clipboard }, id) => {
        clipboard.clear()
        const win = BrowserWindow.getAllWindows()[0]
        win.webContents.send('context-menu:action', id, 'select-all')
    }, tabId)
    await expect.poll(() => mainWin.evaluate(() => (window.getSelection()?.toString() ?? '').length), { timeout: 5_000 })
        .toBeGreaterThan(0)
    const copied = await app.evaluate(async ({ BrowserWindow, clipboard }) => {
        const win = BrowserWindow.getAllWindows()[0]
        win.webContents.copy()
        await new Promise((resolve) => setTimeout(resolve, 300))
        return clipboard.readText()
    })
    const copiedLines = copied.split('\n').filter(Boolean)
    expect(copiedLines).toHaveLength(KEEP_COUNT)
    expect(copiedLines.every((text) => text.startsWith('keep'))).toBe(true)

    // Clearing the filter reveals every buffered line again. Nothing was discarded.
    await filterInput.fill('')
    await expect.poll(async () => mainWin.evaluate(() => {
        const viewport = document.querySelector('.terminal-viewport-scroll') as HTMLElement | null
        if (viewport) viewport.scrollTop = viewport.scrollHeight
        return document.body.textContent ?? ''
    }), { timeout: 5_000 }).toContain(`drop ${LINE_COUNT - 1}`)
})

test('clearing the terminal while a filter is active does not crash the renderer', async () => {
    const tabId = await readTabId()
    await reconnect(tabId)

    const filterInput = mainWin.locator('.terminal-filter-input')
    await filterInput.fill('^keep')
    await waitForNonZeroFilterMatch()

    // The buffer is cleared while filteredLineIndices still points at the pre-clear buffer:
    // the render loop must not index the (now empty) buffer with those stale positions.
    await app.evaluate(({ BrowserWindow }, id) => {
        const win = BrowserWindow.getAllWindows()[0]
        win.webContents.send('context-menu:action', id, 'clear')
    }, tabId)

    // Give the crash (if any) a moment to reach the ErrorBoundary fallback, then confirm the
    // real terminal UI is still there instead of the "Something went wrong" fallback screen.
    await mainWin.waitForTimeout(500)
    await expect(mainWin.getByText('Something went wrong')).toHaveCount(0)
    await expect(mainWin.locator('.terminal-filter-input')).toBeVisible()
})

test('Alt+C (the real reported repro, not just the menu action) clears while filtered without crashing', async () => {
    const tabId = await readTabId()
    await reconnect(tabId)

    const filterInput = mainWin.locator('.terminal-filter-input')
    await filterInput.fill('^keep')
    await waitForNonZeroFilterMatch()

    await focusTerminalContainer()
    await mainWin.keyboard.press('Alt+C')

    await mainWin.waitForTimeout(500)
    await expect(mainWin.getByText('Something went wrong')).toHaveCount(0)
    await expect(mainWin.locator('[data-line]')).toHaveCount(0)
})

test('Ctrl+Shift+F opens the filter bar (not Find) and auto-focuses it, while Ctrl+F still opens Find', async () => {
    const filterInput = mainWin.locator('.terminal-filter-input')
    const searchInput = mainWin.locator('.terminal-search-input')

    // Start from a known state: neither bar open.
    if (await filterInput.count() > 0) {
        await filterInput.focus()
        await mainWin.keyboard.press('Escape')
    }
    if (await searchInput.count() > 0) {
        await searchInput.focus()
        await mainWin.keyboard.press('Escape')
    }
    await expect(filterInput).toHaveCount(0)
    await expect(searchInput).toHaveCount(0)

    await focusTerminalContainer()
    await mainWin.keyboard.press('Control+Shift+F')
    await expect(filterInput).toBeVisible()
    await expect(filterInput).toBeFocused()
    await expect(searchInput).toHaveCount(0)

    await filterInput.focus()
    await mainWin.keyboard.press('Escape')
    await expect(filterInput).toHaveCount(0)

    await focusTerminalContainer()
    await mainWin.keyboard.press('Control+f')
    await expect(searchInput).toBeVisible()
    await expect(filterInput).toHaveCount(0)
})

test('a pattern that actually applies is recorded in filter history, and ArrowUp recalls it', async () => {
    await reconnect(await readTabId())

    // Start from a known state: filter closed (also clears the input's own text, not history).
    const filterInput = mainWin.locator('.terminal-filter-input')
    if (await filterInput.count() > 0) {
        await filterInput.focus()
        await mainWin.keyboard.press('Escape')
    }
    await expect(filterInput).toHaveCount(0)

    await focusTerminalContainer()
    await mainWin.keyboard.press('Control+Shift+F')
    await expect(filterInput).toBeVisible()
    await filterInput.fill('^keep')
    await waitForNonZeroFilterMatch()

    // Closing the bar clears the input's own text but must not erase it from history.
    await mainWin.keyboard.press('Escape')
    await expect(filterInput).toHaveCount(0)

    await focusTerminalContainer()
    await mainWin.keyboard.press('Control+Shift+F')
    await expect(filterInput).toBeVisible()
    await expect(filterInput).toHaveValue('')

    const historyToggle = mainWin.locator('.terminal-filter-history-toggle')
    await expect(historyToggle).toBeEnabled()

    await filterInput.press('ArrowUp')
    await expect(filterInput).toHaveValue('^keep')

    // The dropdown lists the same recalled pattern.
    await historyToggle.click()
    await expect(mainWin.locator('.terminal-filter-history-flyout')).toContainText('^keep')
})
