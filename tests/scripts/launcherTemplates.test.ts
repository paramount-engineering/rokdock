import { describe, it, expect } from 'vitest'
import * as templates from '../../scripts/launcherTemplates.cjs'

const LAUNCHERS = [
    { key: 'json', title: 'JSON Editor', badge: '{ }' },
    { key: 'svg', title: 'SVG Converter', badge: 'SVG' },
]

describe('nsisInclude', () => {
    const nsh = templates.nsisInclude(LAUNCHERS)

    it('defines the customInstall and customUnInstall macros', () => {
        expect(nsh).toContain('!macro customInstall')
        expect(nsh).toContain('!macro customUnInstall')
        expect(nsh).toContain('!macroend')
    })

    it('creates one shortcut per launcher with its --tool arg and icon', () => {
        expect(nsh).toContain('"$SMPROGRAMS\\RokDock\\JSON Editor.lnk"')
        expect(nsh).toContain('"--tool json"')
        expect(nsh).toContain('"$INSTDIR\\resources\\icons\\tools\\json.ico"')
        expect(nsh).toContain('"--tool svg"')
    })

    it('deletes each shortcut on uninstall and removes the folder', () => {
        expect(nsh).toContain('Delete "$SMPROGRAMS\\RokDock\\JSON Editor.lnk"')
        expect(nsh).toContain('RMDir "$SMPROGRAMS\\RokDock"')
    })
})

describe('desktopEntry', () => {
    it('emits a valid entry with the --tool exec and icon name', () => {
        const entry = templates.desktopEntry(LAUNCHERS[0], 'rokdock')
        expect(entry).toContain('[Desktop Entry]')
        expect(entry).toContain('Name=RokDock JSON Editor')
        expect(entry).toContain('Exec=rokdock --tool json %U')
        expect(entry).toContain('Icon=rokdock-json')
        expect(entry).toContain('Categories=Development;')
        expect(entry).toContain('Type=Application')
    })
})

describe('macInfoPlist', () => {
    it('carries the per-tool bundle id, name, and icon', () => {
        const plist = templates.macInfoPlist(LAUNCHERS[0])
        expect(plist).toContain('<key>CFBundleIdentifier</key>')
        expect(plist).toContain('<string>com.rokdock.tool.json</string>')
        expect(plist).toContain('<string>RokDock JSON Editor</string>')
        expect(plist).toContain('<key>CFBundleExecutable</key>')
        expect(plist).toContain('<string>launch</string>')
        expect(plist).toContain('<string>json</string>')
    })
})

describe('macLaunchStub', () => {
    it('resolves RokDock by bundle id and execs it with the --tool arg', () => {
        const stub = templates.macLaunchStub(LAUNCHERS[0])
        expect(stub).toContain('#!/bin/sh')
        expect(stub).toContain("kMDItemCFBundleIdentifier == 'com.rokdock.app'")
        expect(stub).toContain('/Applications/RokDock.app')
        expect(stub).toContain('--tool json')
    })
})

describe('install/uninstall scripts', () => {
    it('install script writes one desktop file per tool and decodes its icon', () => {
        const icons = { json: 'AAAA', svg: 'BBBB' }
        const script = templates.appImageInstallScript(LAUNCHERS, icons)
        expect(script).toContain('#!/bin/sh')
        expect(script).toContain('--tool json')
        expect(script).toContain('rokdock-json.desktop')
        expect(script).toContain('AAAA')
        // Must use printf %b so the embedded \n escapes become real newlines in the .desktop file.
        expect(script).toContain("printf '%b")
    })

    it('uninstall script removes each desktop file and icon', () => {
        const script = templates.appImageUninstallScript(LAUNCHERS)
        expect(script).toContain('rokdock-json.desktop')
        expect(script).toContain('rokdock-svg.desktop')
    })
})
