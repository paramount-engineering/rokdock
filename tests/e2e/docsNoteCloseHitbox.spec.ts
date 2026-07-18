/**
 * E2E regression: the Developer Docs sticky-note close (X) button must be a real click target.
 *
 * The note textarea overlaps the top-right corner where the X sits. The X used to be a 14x17 button
 * at the same z-index as the textarea but earlier in the DOM, so the textarea stacked on top and
 * stole most of the clicks, including dead-center: clicking the visible X focused the textarea
 * instead of closing the note. The X is now a 24px target above the textarea.
 *
 * This clicks the geometric center of the X (a real pointer click, so it exercises hit-testing, not
 * a synthetic element dispatch) and asserts the note closes, and checks the target is a comfortable
 * size (a 14px button is still clickable by Playwright, so size needs its own assertion). Verified
 * as a negative control: against the old CSS the size assertion fails and the center click focuses
 * the textarea, leaving the note open.
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { launchRokDockWithArgsAndUserData, openToolWindow } from './helpers'

const PAGE_ONE = 'docs/developer-program/getting-started/page-one.md'

function seed(userData: string): void {
    const cacheDir = path.join(userData, 'docs-cache')
    const pagesDir = path.join(cacheDir, 'pages')
    fs.mkdirSync(pagesDir, { recursive: true })
    fs.writeFileSync(path.join(cacheDir, 'manifest.json'),
        JSON.stringify({ version: 1, ref: 'v2.0', builtAgainstSha: 'abc', updatedAt: new Date().toISOString() }), 'utf-8')
    const tree = { roots: [{ slug: 'developer-program', label: 'developer-program', path: 'docs/developer-program', kind: 'directory', children: [{ slug: 'getting-started', label: 'Getting Started', path: 'docs/developer-program/getting-started', kind: 'directory', children: [{ slug: 'page-one', label: 'Page One', path: PAGE_ONE, kind: 'page' }] }] }], slugIndex: {} }
    fs.writeFileSync(path.join(cacheDir, 'tree.json'), JSON.stringify(tree), 'utf-8')
    const encode = (p: string) => `${p.replace(/~/g, '~~').replace(/\//g, '~')}.json`
    fs.writeFileSync(path.join(pagesDir, encode(PAGE_ONE)),
        JSON.stringify({ path: PAGE_ONE, title: 'Page One', markdown: '# Page One\n\nContent.' }), 'utf-8')
}

test('the sticky-note close button is a real click target at its center', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-noteclose-'))
    seed(userData)
    const { app, mainWin } = await launchRokDockWithArgsAndUserData([], userData)
    try {
        const win = await openToolWindow(app, mainWin, () => window.rokdock.docs.open('dark'))
        await win.waitForFunction(() => !document.documentElement.classList.contains('rokdock-theme-pending'), undefined, { timeout: 8000 })

        const openNode = async (label: string): Promise<void> => {
            const node = win.getByText(label, { exact: true }).first()
            await node.waitFor({ state: 'visible', timeout: 5000 })
            await node.click()
            await win.waitForTimeout(200)
        }
        await openNode('developer-program'); await openNode('Getting Started'); await openNode('Page One')
        await win.waitForFunction(() => !!document.querySelector('.docs-prose'), undefined, { timeout: 6000 })
        await win.getByRole('button', { name: 'Notes' }).click()
        await win.waitForSelector('.docs-note', { timeout: 3000 })

        // A comfortable target (a 14px button is still clickable by Playwright, so assert the size),
        // plus its geometric center for the real pointer click below.
        const geom = await win.evaluate(() => {
            const rect = (document.querySelector('.docs-note-close') as HTMLElement).getBoundingClientRect()
            return { width: rect.width, height: rect.height, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 }
        })
        expect(geom.width).toBeGreaterThanOrEqual(22)
        expect(geom.height).toBeGreaterThanOrEqual(22)

        // A real pointer click at the X's center must close the note (not focus the textarea).
        await win.mouse.click(geom.cx, geom.cy)
        await expect(win.locator('.docs-note')).toHaveCount(0)

        await win.close().catch(() => {})
    } finally {
        await app.close()
        fs.rmSync(userData, { recursive: true, force: true })
    }
})
