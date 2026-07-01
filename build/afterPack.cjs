/**
 * electron-builder afterPack hook. On macOS only, builds a wrapper .app per tool
 * (each execs the installed RokDock with --tool <key>) into a shared "RokDock Tools"
 * folder at the project root, so dmg.contents (a static, per-arch-agnostic config)
 * can place it in the DMG for both x64 and arm64. The folder must sit outside
 * appOutDir because dmgbuild resolves dmg.contents[].path relative to the process
 * cwd (the project root), not appOutDir. Wrapper apps locate the installed
 * RokDock.app at runtime via mdfind, so they aren't tied to a specific appOutDir.
 *
 * Each wrapper app is its own executable extracted from a quarantined DMG, so
 * Gatekeeper requires it to be independently signed and notarized; the main
 * RokDock.app's signature and notarization do not cover it. When CSC_LINK is set
 * (CI release builds), this imports the Developer ID certificate into a throwaway
 * keychain, signs every wrapper app with hardened runtime, and notarizes them all
 * concurrently via notarytool. Skipped entirely for local/unsigned builds.
 *
 * Uses the native iconutil, codesign, ditto, and xcrun (present on the mac build host).
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync, execFile } = require('child_process')
const { promisify } = require('util')
const templates = require('../scripts/launcherTemplates.cjs')

const execFileAsync = promisify(execFile)
const root = path.join(__dirname, '..')
const ENTITLEMENTS_PATH = path.join(root, 'build', 'entitlements.mac.plist')

/** Imports the Developer ID certificate into a throwaway keychain and returns
 *  the signing identity name, or null when CSC_LINK is unset (unsigned build). */
function importSigningIdentity(keychainPath, keychainPassword) {
    const cscLink = process.env.CSC_LINK
    if (!cscLink) return null

    execFileSync('security', ['create-keychain', '-p', keychainPassword, keychainPath])
    execFileSync('security', ['set-keychain-settings', '-lut', '21600', keychainPath])
    execFileSync('security', ['unlock-keychain', '-p', keychainPassword, keychainPath])

    const existingKeychains = execFileSync('security', ['list-keychains', '-d', 'user'], { encoding: 'utf8' })
        .split('\n').map(line => line.trim().replace(/^"|"$/g, '')).filter(Boolean)
    execFileSync('security', ['list-keychains', '-d', 'user', '-s', keychainPath, ...existingKeychains])

    const p12Path = path.join(os.tmpdir(), `rokdock-tools-cert-${process.pid}.p12`)
    fs.writeFileSync(p12Path, Buffer.from(cscLink, 'base64'))
    try {
        execFileSync('security', [
            'import', p12Path, '-k', keychainPath, '-P', process.env.CSC_KEY_PASSWORD ?? '',
            '-T', '/usr/bin/codesign', '-T', '/usr/bin/security',
        ])
    } finally {
        fs.rmSync(p12Path, { force: true })
    }
    execFileSync('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', keychainPassword, keychainPath])

    const identities = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning', keychainPath], { encoding: 'utf8' })
    const match = identities.match(/"(Developer ID Application:[^"]+)"/)
    if (!match) throw new Error('No Developer ID Application identity found in the imported certificate')
    return match[1]
}

/** Codesigns a wrapper app with hardened runtime, then notarizes and staples it. */
async function signAndNotarize(appPath, identity, keychainPath) {
    execFileSync('codesign', [
        '--force', '--deep', '--options', 'runtime', '--timestamp',
        '--entitlements', ENTITLEMENTS_PATH,
        '--sign', identity, '--keychain', keychainPath,
        appPath,
    ])

    const zipPath = `${appPath}.zip`
    execFileSync('ditto', ['-c', '-k', '--keepParent', appPath, zipPath])
    try {
        await execFileAsync('xcrun', [
            'notarytool', 'submit', zipPath, '--wait',
            '--key', process.env.APPLE_API_KEY,
            '--key-id', process.env.APPLE_API_KEY_ID,
            '--issuer', process.env.APPLE_API_ISSUER,
        ])
    } finally {
        fs.rmSync(zipPath, { force: true })
    }
    execFileSync('xcrun', ['stapler', 'staple', appPath])
}

exports.default = async function afterPack(context) {
    if (context.electronPlatformName !== 'darwin') return
    const launchers = require('../src/shared/toolLaunchers.json')
    const toolIconsDir = path.join(root, 'build', 'tool-icons')
    const toolsDir = path.join(root, 'build', 'RokDock Tools')
    fs.mkdirSync(toolsDir, { recursive: true })

    const keychainPath = path.join(os.tmpdir(), `rokdock-tools-${process.pid}.keychain-db`)
    const keychainPassword = 'rokdock-tools-temp'
    const identity = importSigningIdentity(keychainPath, keychainPassword)
    const appPaths = []

    for (const l of launchers) {
        const appDir = path.join(toolsDir, `RokDock ${l.title}.app`)
        const macosDir = path.join(appDir, 'Contents', 'MacOS')
        const resDir = path.join(appDir, 'Contents', 'Resources')
        fs.mkdirSync(macosDir, { recursive: true })
        fs.mkdirSync(resDir, { recursive: true })

        fs.writeFileSync(path.join(appDir, 'Contents', 'Info.plist'), templates.macInfoPlist(l))
        const stub = path.join(macosDir, 'launch')
        fs.writeFileSync(stub, templates.macLaunchStub(l))
        fs.chmodSync(stub, 0o755)

        // Build <key>.icns from the composed PNGs via iconutil.
        const iconset = path.join(root, 'build', `${l.key}.iconset`)
        fs.rmSync(iconset, { recursive: true, force: true })
        fs.mkdirSync(iconset, { recursive: true })
        const map = [
            [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'], [32, 'icon_32x32.png'],
            [64, 'icon_32x32@2x.png'], [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
            [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'], [512, 'icon_512x512.png'],
        ]
        for (const [size, name] of map) {
            const src = path.join(toolIconsDir, `${l.key}-${size}.png`)
            if (fs.existsSync(src)) fs.copyFileSync(src, path.join(iconset, name))
        }
        execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(resDir, `${l.key}.icns`)])
        fs.rmSync(iconset, { recursive: true, force: true })
        console.log(`Built wrapper app: RokDock ${l.title}.app`)
        appPaths.push(appDir)
    }

    if (identity) {
        try {
            console.log(`Signing and notarizing ${appPaths.length} wrapper app(s)...`)
            await Promise.all(appPaths.map(appPath => signAndNotarize(appPath, identity, keychainPath)))
            console.log('Wrapper apps signed and notarized.')
        } finally {
            execFileSync('security', ['delete-keychain', keychainPath])
        }
    } else {
        console.log('CSC_LINK not set; wrapper apps left unsigned (local/unsigned build).')
    }
}
