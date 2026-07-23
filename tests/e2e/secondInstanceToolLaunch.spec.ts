/**
 * E2E regression: a second `--tool=<key>` launch while RokDock is already running
 * must open the tool window in the running instance (single-instance argv
 * forwarding), not fall back to the dock. This reproduces the Windows per-tool
 * Start Menu shortcut (`RokDock.exe --tool=json`) fired while the dock is open.
 *
 * The attached `--tool=<key>` form is required: Electron reorders the argv it
 * forwards to the second-instance handler, so a space-separated `--tool json`
 * loses its value (covered at the unit level in launchRequest.test.ts). The
 * launchers emit the attached form for exactly this reason.
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
        // window is opening. Return empty so a poll retries rather than throwing.
        return []
    }
}

/**
 * Launches a second RokDock process against the given userData dir, so it loses the
 * single-instance lock and forwards its argv to the primary, then exits. Mirrors
 * what a per-tool launcher does when RokDock is already running.
 */
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

test('a second --tool=<key> launch opens the tool window in the running instance', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-2inst-'))
    const { app } = await launchRokDockWithArgsAndUserData([], dir)
    try {
        expect(await windowTitles(app)).toEqual(['RokDock'])
        spawnSecondInstance(dir, ['--tool=json'])
        await expect.poll(() => windowTitles(app), { timeout: 15_000 }).toContain('JSON Editor')
    } finally {
        await app.close()
    }
})

test('a bare second launch focuses the dock and opens no tool window (negative control)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-2inst-bare-'))
    const { app } = await launchRokDockWithArgsAndUserData([], dir)
    try {
        expect(await windowTitles(app)).toEqual(['RokDock'])
        spawnSecondInstance(dir, [])
        // Wait past when a tool window would appear (the positive case opens in ~1-2s),
        // then confirm the bare launch added no window and only surfaced the dock.
        await new Promise<void>((resolve) => setTimeout(resolve, 4_000))
        expect(await windowTitles(app)).toEqual(['RokDock'])
    } finally {
        await app.close()
    }
})
