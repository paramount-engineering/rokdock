/**
 * E2E: standalone JSON editor session persistence.
 *
 * Verifies that the standalone editor restores unsaved work across a restart
 * (recovery cache), and that the in-dock editor does NOT inherit that session.
 * Two launches share one userData dir so persisted state survives the restart.
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { launchRokDockWithArgsAndUserData } from './helpers'

test('standalone: untitled unsaved work survives a restart', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-sess-e2e-'))
    try {
        // First launch: type into the untitled tab, wait past the debounce, close.
        {
            const { app } = await launchRokDockWithArgsAndUserData(['--tool', 'json'], userData)
            const win = await app.firstWindow()
            await win.waitForLoadState('domcontentloaded')
            await win.locator('.cm-content').click()
            // Use a plain string literal (no braces) to avoid CodeMirror auto-close-bracket
            // interference. The marker is a valid JSON string and is unambiguous enough
            // to confirm restore fidelity.
            await win.keyboard.type('"rokdock-persist-marker"')
            // Wait past the ~1s edit debounce so the snapshot is written.
            await win.waitForTimeout(1500)
            await app.close()
        }
        // Second launch (same userData): the unsaved untitled content is restored.
        {
            const { app } = await launchRokDockWithArgsAndUserData(['--tool', 'json'], userData)
            const win = await app.firstWindow()
            await win.waitForLoadState('domcontentloaded')
            await win.waitForFunction(
                () => (document.querySelector('.cm-content')?.textContent ?? '').includes('rokdock-persist-marker'),
                undefined, { timeout: 5_000 }
            )
            await app.close()
        }
    } finally {
        // On Windows, Chromium may still hold file handles briefly after app.close().
        // A cleanup failure here is not a product bug, so swallow it rather than
        // reporting a spurious test failure.
        try { fs.rmSync(userData, { recursive: true, force: true }) } catch { /* cleanup best-effort */ }
    }
})

test('in-dock JSON editor does not restore the standalone session', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-sess-e2e-'))
    try {
        // Seed a standalone session with unsaved content.
        {
            const { app } = await launchRokDockWithArgsAndUserData(['--tool', 'json'], userData)
            const win = await app.firstWindow()
            await win.waitForLoadState('domcontentloaded')
            await win.locator('.cm-content').click()
            await win.keyboard.type('"rokdock-standalone-only"')
            await win.waitForTimeout(1500)
            await app.close()
        }
        // Bare launch (dock), open the JSON editor in-dock. It must NOT show the standalone content.
        {
            const { app, mainWin } = await launchRokDockWithArgsAndUserData([], userData)
            await mainWin.waitForLoadState('domcontentloaded')
            // Register the window-event listener before triggering the IPC call so
            // the new window is not missed if it is created before waitForEvent resolves.
            const editorPromise = app.waitForEvent('window')
            // Open the in-dock JSON editor via the real preload bridge method.
            await mainWin.evaluate(() =>
                (window as unknown as { rokdock: { json: { openEditor: () => Promise<unknown> } } })
                    .rokdock.json.openEditor()
            )
            const editor = await editorPromise
            await editor.waitForLoadState('domcontentloaded')
            await editor.waitForFunction(
                () => document.querySelector('.cm-content') !== null,
                undefined, { timeout: 5_000 }
            )
            // Give any erroneous restore a moment to populate before asserting absence.
            await editor.waitForTimeout(500)
            const text = await editor.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '')
            expect(text).not.toContain('rokdock-standalone-only')
            await app.close()
        }
    } finally {
        try { fs.rmSync(userData, { recursive: true, force: true }) } catch { /* cleanup best-effort */ }
    }
})
