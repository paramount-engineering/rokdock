/**
 * Writes the per-platform launcher artifacts from the manifest: the NSIS include,
 * the Linux .desktop files, and the AppImage install/uninstall scripts. Icons are
 * produced by generate-icons.js into build/tool-icons/ first. Run in predist.
 */
const fs = require('fs')
const path = require('path')
const templates = require('./launcherTemplates.cjs')

const launchers = require('../src/shared/toolLaunchers.json')
const root = path.join(__dirname, '..')
const buildDir = path.join(root, 'build')
const linuxDir = path.join(buildDir, 'linux')
const toolIconsDir = path.join(buildDir, 'tool-icons')

fs.mkdirSync(buildDir, { recursive: true })
fs.mkdirSync(linuxDir, { recursive: true })

// Windows NSIS include.
fs.writeFileSync(path.join(buildDir, 'tool-shortcuts.nsh'), templates.nsisInclude(launchers))

// Linux .desktop files (system install via the deb uses the "rokdock" binary).
for (const l of launchers) {
    fs.writeFileSync(
        path.join(linuxDir, `rokdock-${l.key}.desktop`),
        templates.desktopEntry(l, 'rokdock')
    )
}

// Stage Linux hicolor icons named rokdock-<key>.png per size for the deb.
// NOTE: the extraFiles "to: ../share/..." path in electron-builder.json must be confirmed
// with "dpkg -c dist/*.deb" on Linux; the exact ".." depth depends on electron-builder's
// app install root (/opt/RokDock/) and must land files under /usr/share/applications and
// /usr/share/icons/hicolor. Adjust the ".." depth in extraFiles if the paths are wrong.
const iconRoot = path.join(linuxDir, 'icons', 'hicolor')
for (const size of [16, 32, 48, 64, 128, 256, 512]) {
    const dir = path.join(iconRoot, `${size}x${size}`, 'apps')
    fs.mkdirSync(dir, { recursive: true })
    for (const l of launchers) {
        const src = path.join(toolIconsDir, `${l.key}-${size}.png`)
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, `rokdock-${l.key}.png`))
    }
}

// AppImage self-contained install/uninstall scripts (icons embedded as base64).
const iconsByKey = {}
for (const l of launchers) {
    const png = path.join(toolIconsDir, `${l.key}-256.png`)
    iconsByKey[l.key] = fs.existsSync(png) ? fs.readFileSync(png).toString('base64') : ''
}
fs.writeFileSync(path.join(linuxDir, 'install-tool-shortcuts.sh'), templates.appImageInstallScript(launchers, iconsByKey))
fs.writeFileSync(path.join(linuxDir, 'uninstall-tool-shortcuts.sh'), templates.appImageUninstallScript(launchers))
fs.chmodSync(path.join(linuxDir, 'install-tool-shortcuts.sh'), 0o755)
fs.chmodSync(path.join(linuxDir, 'uninstall-tool-shortcuts.sh'), 0o755)

console.log('Generated launcher artifacts in build/.')
