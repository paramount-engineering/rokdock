/**
 * E2E: per-page reading-position memory in the Developer Docs viewer. Scrolling
 * a page, leaving, and returning within the session restores the scroll offset.
 * The position is in-memory only (navigation history), not persisted to disk.
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { launchRokDockWithArgsAndUserData } from './helpers'

const PAGE_ONE = 'docs/developer-program/getting-started/page-one.md'
const PAGE_TWO = 'docs/developer-program/getting-started/page-two.md'

function seedTwoPages(userData: string): void {
    const cacheDir = path.join(userData, 'docs-cache')
    const pagesDir = path.join(cacheDir, 'pages')
    fs.mkdirSync(pagesDir, { recursive: true })
    fs.writeFileSync(path.join(cacheDir, 'manifest.json'), JSON.stringify({ version: 1, ref: 'v2.0', builtAgainstSha: 'abc', updatedAt: new Date().toISOString() }), 'utf-8')
    const tree = { roots: [{ slug: 'developer-program', label: 'developer-program', path: 'docs/developer-program', kind: 'directory', children: [{ slug: 'getting-started', label: 'Getting Started', path: 'docs/developer-program/getting-started', kind: 'directory', children: [
        { slug: 'page-one', label: 'Page One', path: PAGE_ONE, kind: 'page' },
        { slug: 'page-two', label: 'Page Two', path: PAGE_TWO, kind: 'page' },
    ] }] }], slugIndex: {} }
    fs.writeFileSync(path.join(cacheDir, 'tree.json'), JSON.stringify(tree), 'utf-8')
    // A tall page so there is room to scroll.
    const tall = '# Page One\n\n' + Array.from({ length: 60 }, (_, i) => `## Section ${i}\n\nParagraph body for section ${i}.`).join('\n\n')
    const write = (p: string, title: string, md: string) => {
        const file = `${p.replace(/~/g, '~~').replace(/\//g, '~')}.json`
        fs.writeFileSync(path.join(pagesDir, file), JSON.stringify({ path: p, title, markdown: md }), 'utf-8')
    }
    write(PAGE_ONE, 'Page One', tall)
    write(PAGE_TWO, 'Page Two', '# Page Two\n\nShort body.')
}

test('reading position is remembered within the session, not persisted', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-readpos-'))
    seedTwoPages(userData)
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

        const open = async (label: string) => {
            const loc = win!.getByText(label, { exact: true }).first()
            await loc.waitFor({ state: 'visible', timeout: 5000 })
            await loc.click()
            await win!.waitForTimeout(250)
        }
        await open('developer-program')
        await open('Getting Started')
        await open('Page One')
        await win.waitForFunction(() => !!document.querySelector('.docs-prose'), undefined, { timeout: 6000 })

        const body = win.locator('.docs-pane-body')
        // Scroll down and let the debounced in-memory save fire.
        await body.evaluate(el => { el.scrollTop = 320 })
        await win.waitForTimeout(300)

        // Leave to Page Two, then come back to Page One.
        await open('Page Two')
        await win.waitForFunction(() => (document.querySelector('.docs-pane-title')?.textContent || '').includes('Page Two'), undefined, { timeout: 6000 })
        await open('Page One')
        await win.waitForFunction(() => (document.querySelector('.docs-pane-title')?.textContent || '').includes('Page One'), undefined, { timeout: 6000 })

        // The offset is restored within the session (allow a small tolerance).
        await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(280)

        // It is in-memory only: nothing is written to the persisted preferences.
        const persisted = await win.evaluate(() =>
            window.rokdock.store.getPreferences().then(prefs => (prefs as Record<string, unknown>).docsScrollByPath))
        expect(persisted).toBeUndefined()
    } finally {
        await app.close()
        fs.rmSync(userData, { recursive: true, force: true })
    }
})
