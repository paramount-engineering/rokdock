/**
 * Development dependency check for the main process startup.
 *
 * Detects missing npm packages early and shows a clear error dialog so developers
 * know to run 'npm install' rather than seeing cryptic module-not-found errors.
 * No-ops in packaged builds since all required packages are bundled by Vite/electron-builder.
 */

import fs from 'fs'
import path from 'path'
import { app, dialog } from 'electron'

/**
 * Reads `dependencies` from `package.json` and checks that each package
 * exists in `node_modules`. If any are missing, shows a native dialog
 * listing them and suggesting `npm install`.
 *
 * Only runs in dev mode - packaged builds bundle their dependencies.
 */
export function checkDevDependencies(): void {
    if (app.isPackaged) return

    const projectRoot = path.join(__dirname, '../..')
    const pkgPath = path.join(projectRoot, 'package.json')

    let pkg: { dependencies?: Record<string, string> }
    try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    } catch {
        return
    }

    const deps = Object.keys(pkg.dependencies ?? {})
    if (deps.length === 0) return

    const nodeModules = path.join(projectRoot, 'node_modules')
    if (!fs.existsSync(nodeModules)) {
        // Entire node_modules missing - all deps are missing
        return reportMissing(deps)
    }

    const topLevel = new Set(fs.readdirSync(nodeModules))
    const missing = deps.filter((name) => {
        if (!name.startsWith('@')) return !topLevel.has(name)
        // Scoped package: check node_modules/@scope/pkg directly
        return !fs.existsSync(path.join(nodeModules, name))
    })

    if (missing.length > 0) reportMissing(missing)
}

/**
 * Logs the missing package names to stderr and shows a native Electron error dialog
 * instructing the developer to run 'npm install'.
 *
 * @param missing - Array of package names that were not found in node_modules.
 */
function reportMissing(missing: string[]): void {
    const list = missing.map((pkg) => `  - ${pkg}`).join('\n')
    console.error(
        `[RokDock] Missing ${missing.length} dependenc${missing.length === 1 ? 'y' : 'ies'} - run "npm install":\n${list}`
    )
    dialog.showErrorBox(
        'Missing Dependencies',
        `The following packages are missing from node_modules:\n\n${list}\n\nRun "npm install" to fix this.`
    )
}
