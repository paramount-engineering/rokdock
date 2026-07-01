/**
 * Launch the built RokDock app under Playwright for documentation tooling.
 *
 * Centralizes the launch recipe shared by the doc-capture scripts. It strips
 * ELECTRON_RUN_AS_NODE (the sandbox sets it to 1, which makes Electron run as
 * plain Node and crash on the first electron API), resolves the electron binary
 * and the built entry point, waits for the React shell to actually mount, and
 * applies a consistent capture viewport.
 *
 * Usage: npm run build (so out/ is current), then run a capture script with
 *   env -u ELECTRON_RUN_AS_NODE node scripts/<script>.mjs
 */

import { _electron as electron } from 'playwright'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
import os from 'os'
import fs from 'fs'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Repo root (scripts/ lives one level down). */
export const root = path.join(__dirname, '..')

/**
 * Launch the built app and return { app, main } once the shell has mounted.
 *
 * @param {object} [opts]
 * @param {{width: number, height: number}|null} [opts.viewport] - capture viewport, or null to skip the resize.
 */
export async function launchBuiltApp({ viewport = { width: 1400, height: 900 } } = {}) {
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE

    // Run against a throwaway userData dir so this tooling never shares the cache or
    // electron-store of a real RokDock install (which causes "Unable to move the
    // cache: Access is denied" collisions and would also trip the single-instance lock).
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-tooling-'))

    const app = await electron.launch({
        executablePath: require('electron'),
        args: ['out/main/main.js', `--user-data-dir=${userDataDir}`, '--no-sandbox', '--disable-gpu'],
        env,
        cwd: root
    })

    const main = await app.firstWindow()
    await main.waitForLoadState('domcontentloaded')
    // Wait for the React shell to mount (the Devices header is always present)
    // rather than sleeping a fixed interval.
    await main.getByText('Devices', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })

    if (viewport) {
        await main.setViewportSize(viewport).catch(() => {})
        await main.waitForTimeout(500) // let the resize repaint before capture
    }

    return { app, main }
}
