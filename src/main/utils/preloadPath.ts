/**
 * Resolves the preload script path for BrowserWindow creation.
 *
 * The preload script must be explicitly excluded from ASAR packaging (asarUnpack)
 * so Electron can load it as a native file. The path rewrite handles this: it
 * replaces 'app.asar' with 'app.asar.unpacked' in the resolved path so packaged
 * builds find the unpacked copy correctly.
 *
 * All BrowserWindow constructors in IPC handlers should use this function rather
 * than constructing the path inline.
 */

import path from 'path'

/**
 * Returns the absolute path to the compiled preload script for use in BrowserWindow
 * construction. In packaged builds the path is rewritten from 'app.asar' to
 * 'app.asar.unpacked' so Electron can load the unpacked copy directly via the
 * file system rather than from inside the ASAR archive.
 *
 * @returns Absolute path to preload/preload.js, adjusted for packaged builds.
 */
export function getPreloadScriptPath(): string {
    return path.join(__dirname, '../preload/preload.js').replace('app.asar', 'app.asar.unpacked')
}
