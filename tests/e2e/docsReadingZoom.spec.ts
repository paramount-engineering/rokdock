/**
 * E2E: reading-pane text zoom (Ctrl+=/Ctrl+-/Ctrl+0) in the Developer Docs
 * viewer. Scales only the prose (`--docs-reading-scale`), persists to
 * AppPreferences.docsReadingScale, and is bound in the renderer (the View menu
 * intentionally has no webFrame zoom roles).
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { launchRokDockWithArgsAndUserData } from './helpers'

function seedPage(userData: string): string {
    const cacheDir = path.join(userData, 'docs-cache')
    const pagesDir = path.join(cacheDir, 'pages')
    fs.mkdirSync(pagesDir, { recursive: true })
    const pagePath = 'docs/developer-program/getting-started/roku-dev-prog.md'
    fs.writeFileSync(path.join(cacheDir, 'manifest.json'), JSON.stringify({ version: 1, ref: 'v2.0', builtAgainstSha: 'abc', updatedAt: new Date().toISOString() }), 'utf-8')
    const tree = { roots: [{ slug: 'developer-program', label: 'developer-program', path: 'docs/developer-program', kind: 'directory', children: [{ slug: 'getting-started', label: 'Getting Started', path: 'docs/developer-program/getting-started', kind: 'directory', children: [{ slug: 'roku-dev-prog', label: 'Roku Developer Program', path: pagePath, kind: 'page' }] }] }], slugIndex: { 'roku-dev-prog': pagePath } }
    fs.writeFileSync(path.join(cacheDir, 'tree.json'), JSON.stringify(tree), 'utf-8')
    const page = { path: pagePath, title: 'Roku Developer Program', markdown: '# Roku Developer Program\n\nBody text for the reading pane.' }
    const pageFileName = `${pagePath.replace(/~/g, '~~').replace(/\//g, '~')}.json`
    fs.writeFileSync(path.join(pagesDir, pageFileName), JSON.stringify(page), 'utf-8')
    return 'Roku Developer Program'
}

const readScaleVar = (el: Element): string =>
    (el as HTMLElement).style.getPropertyValue('--docs-reading-scale')

test('reading-pane text zoom: Ctrl+=/-/0 scale the prose and persist', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-readzoom-'))
    const pageTitle = seedPage(userData)
    const { app, mainWin } = await launchRokDockWithArgsAndUserData([], userData)
    try {
        const before = app.windows().length
        await mainWin.evaluate(() => window.rokdock.docs.open('dark'))
        const deadline = Date.now() + 8000
        let win
        while (Date.now() < deadline) { const w = app.windows(); if (w.length > before) { win = w[w.length - 1]; break } await new Promise(r => setTimeout(r, 100)) }
        if (!win) throw new Error('docs window did not open')
        await win.waitForLoadState('domcontentloaded')
        await win.waitForFunction(() => !document.documentElement.classList.contains('rokdock-theme-pending'), undefined, { timeout: 8000 })

        const click = async (label: string) => {
            const loc = win!.getByText(label, { exact: true }).first()
            await loc.waitFor({ state: 'visible', timeout: 5000 })
            await loc.click()
            await win!.waitForTimeout(250)
        }
        await click('developer-program')
        await click('Getting Started')
        await click(pageTitle)
        await win.waitForFunction(() => !!document.querySelector('.docs-prose'), undefined, { timeout: 6000 })

        const pane = win.locator('.docs-layout-reading')

        // Two increases: 1 -> 1.1 -> 1.2.
        await win.keyboard.press('Control+Equal')
        await win.keyboard.press('Control+Equal')
        await expect.poll(() => pane.evaluate(readScaleVar)).toBe('1.2')
        expect(await win.evaluate(() => window.rokdock.store.getPreferences().then(p => p.docsReadingScale))).toBeCloseTo(1.2)

        // One decrease: 1.2 -> 1.1.
        await win.keyboard.press('Control+Minus')
        await expect.poll(() => pane.evaluate(readScaleVar)).toBe('1.1')

        // Reset: 1.1 -> 1.
        await win.keyboard.press('Control+0')
        await expect.poll(() => pane.evaluate(readScaleVar)).toBe('1')
        expect(await win.evaluate(() => window.rokdock.store.getPreferences().then(p => p.docsReadingScale))).toBeCloseTo(1)
    } finally {
        await app.close()
        fs.rmSync(userData, { recursive: true, force: true })
    }
})
