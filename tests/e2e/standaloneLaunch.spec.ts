/**
 * E2E: standalone CLI tool launch (RokDock --tool <name> [path]).
 *
 * Verifies the dock-less launch path: only the requested tool window opens (no
 * dock), and a file passed on the CLI is loaded into the tool. The native file
 * dialog is bypassed (a path is supplied), exactly the substrate file
 * associations will reuse. Second-instance argv routing and the macOS open-file event are not headlessly
 * drivable, so they are manual-verification items.
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { launchRokDockWithArgs } from './helpers'

function tmpFile(name: string, content: string | Buffer): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-launch-'))
    const p = path.join(dir, name)
    fs.writeFileSync(p, content)
    return p
}

const ONE_PX_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

test('JSON: --tool json <file> opens only the editor with the file loaded', async () => {
    const file = tmpFile('demo.json', '{"hello":"world"}')
    const { app } = await launchRokDockWithArgs(['--tool', 'json', file])
    try {
        const win = await app.firstWindow()
        await win.waitForLoadState('domcontentloaded')
        expect(await win.title()).toBe('JSON Editor')
        expect(app.windows().length).toBe(1)
        // The standalone opener passes the basename as the tab title. The tab label
        // is reliable DOM (CodeMirror 6 virtualizes the document text, so the tiny
        // JSON body is not a dependable innerText signal).
        await win.waitForFunction(
            () => Array.from(document.querySelectorAll('.rokdock-tab-label'))
                .some(el => (el.textContent ?? '').includes('demo.json')),
            undefined, { timeout: 5_000 }
        )
    } finally {
        await app.close()
    }
})

test('9-Patch: --tool ninepatch <png> opens only the editor with the asset loaded', async () => {
    const png = tmpFile('demo.png', Buffer.from(ONE_PX_PNG_B64, 'base64'))
    const { app } = await launchRokDockWithArgs(['--tool', 'ninepatch', png])
    try {
        const win = await app.firstWindow()
        await win.waitForLoadState('domcontentloaded')
        expect(await win.title()).toBe('9-Patch Editor')
        expect(app.windows().length).toBe(1)
        await win.waitForFunction(
            () => (document.getElementById('export1080Btn') as HTMLButtonElement | null)?.disabled === false,
            undefined, { timeout: 5_000 }
        )
    } finally {
        await app.close()
    }
})

test('SVG: --tool svg <file> opens only the converter with the SVG loaded', async () => {
    const svg = tmpFile('demo.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')
    const { app } = await launchRokDockWithArgs(['--tool', 'svg', svg])
    try {
        const win = await app.firstWindow()
        await win.waitForLoadState('domcontentloaded')
        expect(await win.title()).toBe('SVG Converter')
        expect(app.windows().length).toBe(1)
        // onSvgImported writes the filename into the toolbar element. Target it
        // directly rather than relying on innerText layout.
        await win.waitForFunction(
            () => (document.getElementById('toolbarFilename')?.textContent ?? '').includes('demo.svg'),
            undefined, { timeout: 5_000 }
        )
    } finally {
        await app.close()
    }
})

test('script: --tool script <file> opens only the script editor', async () => {
    // library.load is a plain JSON.parse with no schema validation, so any valid
    // ScriptFile JSON loads. The window title is `Script Editor - <name>`.
    const scriptFile = tmpFile('demo.json', JSON.stringify({ version: 1, name: 'demo', raspMode: true, steps: [] }))
    const { app } = await launchRokDockWithArgs(['--tool', 'script', scriptFile])
    try {
        const win = await app.firstWindow()
        await win.waitForLoadState('domcontentloaded')
        // The title carries the loaded script's name, so this also proves the file
        // loaded (not just that the window opened).
        expect(await win.title()).toContain('Script Editor - demo')
        expect(app.windows().length).toBe(1)
    } finally {
        await app.close()
    }
})

test('bad path: --tool json <missing> opens the editor empty, no crash', async () => {
    const { app, mainErrors } = await launchRokDockWithArgs(['--tool', 'json', '/no/such/file.json'])
    try {
        const win = await app.firstWindow()
        await win.waitForLoadState('domcontentloaded')
        expect(await win.title()).toBe('JSON Editor')
        expect(app.windows().length).toBe(1)
        // The failure is surfaced to the user, not silently swallowed: the error
        // toast shows with the file name.
        await win.waitForFunction(
            () => {
                const t = document.getElementById('toast')
                return !!t && t.classList.contains('show') && t.textContent!.includes("Couldn't open")
            },
            undefined, { timeout: 5_000 }
        )
        // A read failure is handled, not a crash: no fatal main-process errors.
        expect(mainErrors).toEqual([])
    } finally {
        await app.close()
    }
})

test('assoc: bare .json path opens the JSON editor', async () => {
    const file = tmpFile('assoc.json', '{"hello":"world"}')
    const { app } = await launchRokDockWithArgs([file])
    try {
        const win = await app.firstWindow()
        await win.waitForLoadState('domcontentloaded')
        expect(await win.title()).toBe('JSON Editor')
        expect(app.windows().length).toBe(1)
        await win.waitForFunction(
            () => Array.from(document.querySelectorAll('.rokdock-tab-label'))
                .some(el => (el.textContent ?? '').includes('assoc.json')),
            undefined, { timeout: 5_000 }
        )
    } finally {
        await app.close()
    }
})

test('assoc: bare .svg path opens the SVG converter', async () => {
    const svg = tmpFile('assoc.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')
    const { app } = await launchRokDockWithArgs([svg])
    try {
        const win = await app.firstWindow()
        await win.waitForLoadState('domcontentloaded')
        expect(await win.title()).toBe('SVG Converter')
        expect(app.windows().length).toBe(1)
        await win.waitForFunction(
            () => (document.getElementById('toolbarFilename')?.textContent ?? '').includes('assoc.svg'),
            undefined, { timeout: 5_000 }
        )
    } finally {
        await app.close()
    }
})

test('assoc: bare .rscript path opens the script editor with the script loaded', async () => {
    const file = tmpFile('demo.rscript', JSON.stringify({ version: 1, name: 'demo', raspMode: true, steps: [] }))
    const { app } = await launchRokDockWithArgs([file])
    try {
        const win = await app.firstWindow()
        await win.waitForLoadState('domcontentloaded')
        expect(await win.title()).toContain('Script Editor - demo')
        expect(app.windows().length).toBe(1)
    } finally {
        await app.close()
    }
})

test('assoc: bare .rasp path opens the script editor via the RASP importer', async () => {
    const rasp = tmpFile('rasp-demo.rasp', 'steps:\n  - press: Home\n')
    const { app } = await launchRokDockWithArgs([rasp])
    try {
        const win = await app.firstWindow()
        await win.waitForLoadState('domcontentloaded')
        expect(await win.title()).toContain('Script Editor - rasp-demo')
        expect(app.windows().length).toBe(1)
    } finally {
        await app.close()
    }
})

test('assoc: a lossy .rasp open surfaces the importer warnings in the log', async () => {
    // A requirements block is preserved as metadata but warned about by importRasp.
    // Opening the file should carry that warning to the editor and write it to the log,
    // the same notice the in-app RASP import shows.
    const rasp = tmpFile('warns.rasp', 'requirements:\n  min_version: 1\nsteps:\n  - press: Home\n')
    const { app } = await launchRokDockWithArgs([rasp])
    try {
        const win = await app.firstWindow()
        await win.waitForLoadState('domcontentloaded')
        await win.waitForFunction(
            () => Array.from(document.querySelectorAll('#log-entries .log-m'))
                .some(el => (el.textContent ?? '').includes('requirements block is stored as metadata')),
            undefined, { timeout: 5_000 }
        )
    } finally {
        await app.close()
    }
})
