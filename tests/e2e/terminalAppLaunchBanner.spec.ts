/**
 * E2E regression: the terminal bands its output by app-run "block" (a compile+run
 * cycle), alternating a background tint across every subsequent line until the next
 * block starts, so scrolling through a long session makes it obvious which output
 * belongs to which launch.
 *
 * A block starts at a Compiling or Running marker, except a Running marker that
 * immediately follows a Compiling marker for the SAME channel merges into that
 * marker's block instead of starting a new one (a build-then-launch cycle is one
 * block, not two). Anything else - a bare rerun with no recompile, a second cycle for
 * the same channel, a different channel - starts a fresh block.
 *
 * A fake telnet server emits two full compile+run cycles for 'Paramount Plus' (blocks
 * 1 and 2, alternating tint once per cycle) followed by a bare rerun with no preceding
 * compile for a different, "main"-entry channel (block 3, a fresh flip).
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import net from 'node:net'
import { launchRokDock } from './helpers'

const DEBUG_PORT = 8085
// Roku emits identical marker text on every run/compile of the same channel, so a marker
// line can only be told apart from another one by its position in the buffer, never by text.
const RUN_MARKER = "------ Running dev 'Paramount Plus' runuserinterface ------"
const MAIN_ENTRY_RUN_MARKER = "------ Running dev 'RoComponentBench' main ------"
const COMPILING_LINE = "------ Compiling dev 'Paramount Plus' ------"
// Observed live on a real sideload: the firmware compiles a shared library between the
// app's two Compiling markers, then re-enters the app, before the one Running marker.
const SIDELOAD_COMPILING_LINE = "------ Compiling dev 'Endless Podcasts' ------"
const SIDELOAD_RUNNING_LINE = "------ Running dev 'Endless Podcasts' runuserinterface ------"

let app: ElectronApplication
let mainWin: Page
let fakeServer: net.Server

test.beforeAll(async () => {
    const payload = [
        'run0 line a',
        'run0 line b',
        COMPILING_LINE,
        'compiling output',
        RUN_MARKER,
        'run1 line a',
        COMPILING_LINE,
        RUN_MARKER,
        'run2 line a',
        MAIN_ENTRY_RUN_MARKER,
        'run3 line a',
        SIDELOAD_COMPILING_LINE,
        'sub-compile output (Roku Analytics Library)',
        SIDELOAD_COMPILING_LINE,
        SIDELOAD_RUNNING_LINE,
        'run4 line a'
    ].join('\r\n') + '\r\n'
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

test('bands output by compile+run block, merging a matching compile/run pair into one block', async () => {
    await mainWin.evaluate(() => window.rokdock.discovery.addManual('127.0.0.1', 'Fake Roku'))
    const deviceRow = mainWin.getByText('Fake Roku', { exact: true })
    await deviceRow.waitFor({ state: 'visible', timeout: 8_000 })
    await deviceRow.click()
    const connectBtn = mainWin.getByText('BrightScript Debug', { exact: true })
    await connectBtn.waitFor({ state: 'visible', timeout: 5_000 })
    await connectBtn.click()

    await expect.poll(async () => mainWin.evaluate(() => document.body.textContent ?? ''), { timeout: 10_000 })
        .toContain('run4 line a')

    const rows = await mainWin.evaluate(() =>
        Array.from(document.querySelectorAll('[data-line]')).map((el) => ({
            text: el.textContent,
            runStart: el.getAttribute('data-app-run-start') === 'true',
            overlay: el.getAttribute('data-app-run-overlay') === 'true'
        })))

    const byText = (text: string) => rows.find((row) => row.text === text)
    const compilingRows = rows.filter((row) => row.text === COMPILING_LINE)
    const runningRows = rows.filter((row) => row.text === RUN_MARKER)
    expect(compilingRows).toHaveLength(2)
    expect(runningRows).toHaveLength(2)

    // Run 0 (before anything starts): untinted.
    expect(byText('run0 line a')?.overlay).toBe(false)
    expect(byText('run0 line b')?.overlay).toBe(false)

    // Block 1: the Compiling marker starts it and is tinted; the matching Running marker
    // for the SAME channel merges in (not its own block start) rather than flipping again.
    expect(compilingRows[0]!.runStart).toBe(true)
    expect(compilingRows[0]!.overlay).toBe(true)
    expect(byText('compiling output')?.overlay).toBe(true)
    expect(runningRows[0]!.runStart).toBe(false)
    expect(runningRows[0]!.overlay).toBe(true)
    expect(byText('run1 line a')?.overlay).toBe(true)

    // Block 2: a second compile+run cycle for the SAME channel flips the tint once per
    // cycle, not once per raw marker line.
    expect(compilingRows[1]!.runStart).toBe(true)
    expect(compilingRows[1]!.overlay).toBe(false)
    expect(runningRows[1]!.runStart).toBe(false)
    expect(runningRows[1]!.overlay).toBe(false)
    expect(byText('run2 line a')?.overlay).toBe(false)

    // Block 3: a bare rerun with no preceding compile (a different, "main"-entry channel,
    // task-based with no SceneGraph UI) still starts its own new block.
    const mainEntryMarkerRow = byText(MAIN_ENTRY_RUN_MARKER)
    expect(mainEntryMarkerRow?.runStart).toBe(true)
    expect(mainEntryMarkerRow?.overlay).toBe(true)
    expect(byText('run3 line a')?.overlay).toBe(true)

    // Block 4 (the real sideload case): two Compiling markers for the SAME channel,
    // with a library sub-compile between them, then one Running marker - all one
    // block. Only the first Compiling starts it; the tint flips once for the whole
    // thing, not once per marker.
    const sideloadCompilingRows = rows.filter((row) => row.text === SIDELOAD_COMPILING_LINE)
    expect(sideloadCompilingRows).toHaveLength(2)
    expect(sideloadCompilingRows[0]!.runStart).toBe(true)
    expect(sideloadCompilingRows[1]!.runStart).toBe(false)
    const sideloadOverlay = sideloadCompilingRows[0]!.overlay
    expect(sideloadCompilingRows[1]!.overlay).toBe(sideloadOverlay)
    expect(byText('sub-compile output (Roku Analytics Library)')?.overlay).toBe(sideloadOverlay)
    const sideloadRunningRow = byText(SIDELOAD_RUNNING_LINE)
    expect(sideloadRunningRow?.runStart).toBe(false)
    expect(sideloadRunningRow?.overlay).toBe(sideloadOverlay)
    expect(byText('run4 line a')?.overlay).toBe(sideloadOverlay)
    // A new channel always starts a new block, so this flips relative to block 3.
    expect(sideloadOverlay).toBe(!mainEntryMarkerRow?.overlay)
})
