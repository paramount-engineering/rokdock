/**
 * E2E regression (issue #17 follow-up): closing the main RokDock dock must not
 * take down tool windows launched independently via `--tool`. Those windows
 * register in the 'standalone' scope and are independent of the dock session.
 *
 * The dock still closes its own dependents (tool windows opened from within the
 * dock, in the 'inDock' scope). This spec asserts both halves so the cascade is
 * scoped, not disabled: a standalone JSON window survives the dock closing while
 * an inDock SVG window closes with it.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { spawn } from 'child_process'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { launchRokDockWithArgsAndUserData } from './helpers'

const electronExe: string = require(
    path.join(__dirname, '..', '..', 'node_modules', 'electron')
) as string
const projectRoot = path.join(__dirname, '..', '..')

async function windowTitles(app: ElectronApplication): Promise<string[]> {
    try {
        return await app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().map(w => w.getTitle()))
    } catch {
        // The main-process evaluate context can be transiently torn down while a
        // window is opening or closing. Return empty so a poll retries.
        return []
    }
}

/** Spawns a second RokDock process that forwards its argv to the primary, then exits. */
function spawnSecondInstance(userDataDir: string, extraArgs: string[]): void {
    const env = Object.fromEntries(
        Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)
    )
    delete env.ELECTRON_RUN_AS_NODE
    env.ROKDOCK_E2E = '1'
    const child = spawn(
        electronExe,
        ['out/main/main.js', `--user-data-dir=${userDataDir}`, '--no-sandbox', '--disable-gpu', ...extraArgs],
        { cwd: projectRoot, env, stdio: 'ignore' }
    )
    child.unref()
}

test('closing the dock spares standalone tool windows but closes inDock ones', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-dockclose-'))
    const { app, mainWin } = await launchRokDockWithArgsAndUserData([], dir)
    try {
        expect(await windowTitles(app)).toEqual(['RokDock'])

        // Open a dependent (inDock) tool window from within the dock.
        await mainWin.evaluate(() => window.rokdock.svgExporter.openEditor('dark'))
        await expect.poll(() => windowTitles(app), { timeout: 15_000 }).toContain('SVG Converter')

        // Launch an independent (standalone) tool window via a forwarded --tool argv.
        spawnSecondInstance(dir, ['--tool=json'])
        await expect.poll(() => windowTitles(app), { timeout: 15_000 }).toContain('JSON Editor')

        // Close the dock through the main process so the BrowserWindow 'close' event
        // fires, matching the real red-button / Cmd-W path. (Playwright's page.close()
        // tears down the webContents without emitting 'close', so it would bypass the
        // cascade handler entirely.)
        await app.evaluate(({ BrowserWindow }) => {
            const dock = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'RokDock')
            dock?.close()
        })

        // The standalone JSON window survives; the inDock SVG window and the dock are gone.
        await expect.poll(() => windowTitles(app), { timeout: 15_000 }).toEqual(['JSON Editor'])

        // The app is still running because a window remains open (window-all-closed
        // never fired). A negative control: had the cascade closed the standalone
        // window too, the app would have quit and this evaluate would throw.
        expect(await app.evaluate(({ app: electronApp }) => electronApp.isReady())).toBe(true)
    } finally {
        await app.close()
    }
})
