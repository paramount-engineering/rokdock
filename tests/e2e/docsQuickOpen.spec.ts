/**
 * E2E: Ctrl+K quick-open command palette in the Developer Docs viewer.
 *
 * Seeds an offline docs cache with two pages, opens the docs window, triggers
 * the palette, navigates to a page by keyboard, and verifies Escape closes it.
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { launchRokDockWithArgsAndUserData } from './helpers'

const PAGE_ONE_PATH = 'docs/developer-program/getting-started/page-one.md'
const PAGE_TWO_PATH = 'docs/developer-program/getting-started/page-two.md'

function seedDocsCache(userData: string): void {
    const cacheDir = path.join(userData, 'docs-cache')
    const pagesDir = path.join(cacheDir, 'pages')
    fs.mkdirSync(pagesDir, { recursive: true })
    fs.writeFileSync(
        path.join(cacheDir, 'manifest.json'),
        JSON.stringify({ version: 1, ref: 'v2.0', builtAgainstSha: 'abc', updatedAt: new Date().toISOString() }),
        'utf-8',
    )
    const tree = {
        roots: [
            {
                slug: 'developer-program',
                label: 'developer-program',
                path: 'docs/developer-program',
                kind: 'directory',
                children: [
                    {
                        slug: 'getting-started',
                        label: 'Getting Started',
                        path: 'docs/developer-program/getting-started',
                        kind: 'directory',
                        children: [
                            { slug: 'page-one', label: 'Page One', path: PAGE_ONE_PATH, kind: 'page' },
                            { slug: 'page-two', label: 'Page Two', path: PAGE_TWO_PATH, kind: 'page' },
                        ],
                    },
                ],
            },
        ],
        slugIndex: {},
    }
    fs.writeFileSync(path.join(cacheDir, 'tree.json'), JSON.stringify(tree), 'utf-8')

    const writePage = (docPath: string, title: string, markdown: string): void => {
        const filename = `${docPath.replace(/~/g, '~~').replace(/\//g, '~')}.json`
        fs.writeFileSync(
            path.join(pagesDir, filename),
            JSON.stringify({ path: docPath, title, markdown }),
            'utf-8',
        )
    }
    writePage(PAGE_ONE_PATH, 'Page One', '# Page One\n\nContent for page one.')
    writePage(PAGE_TWO_PATH, 'Page Two', '# Page Two\n\nContent for page two.')
}

test('quick-open palette opens, navigates, and closes', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-quickopen-'))
    seedDocsCache(userData)
    const { app, mainWin } = await launchRokDockWithArgsAndUserData([], userData)
    try {
        const windowsBefore = app.windows().length
        await mainWin.evaluate(() => window.rokdock.docs.open('dark'))

        const deadline = Date.now() + 8000
        let docsWin
        while (Date.now() < deadline) {
            const all = app.windows()
            if (all.length > windowsBefore) { docsWin = all[all.length - 1]; break }
            await new Promise(r => setTimeout(r, 100))
        }
        if (!docsWin) throw new Error('docs window did not open')

        await docsWin.waitForLoadState('domcontentloaded')
        await docsWin.waitForFunction(
            () => !document.documentElement.classList.contains('rokdock-theme-pending'),
            undefined,
            { timeout: 8000 },
        )

        // Palette is not visible before the shortcut.
        await expect(docsWin.locator('.docs-quickopen')).not.toBeVisible()

        // Open the palette with Ctrl+K.
        await docsWin.keyboard.press('Control+k')
        await expect(docsWin.locator('.docs-quickopen')).toBeVisible({ timeout: 3000 })

        // The input should be focused.
        await expect(docsWin.locator('.docs-quickopen-input')).toBeFocused({ timeout: 2000 })

        // Type part of "Page Two" and press Enter to navigate.
        await docsWin.keyboard.type('Page Two')
        await docsWin.keyboard.press('Enter')

        await docsWin.waitForFunction(
            () => (document.querySelector('.docs-pane-title')?.textContent ?? '').includes('Page Two'),
            undefined,
            { timeout: 8000 },
        )

        // Palette closed after navigation.
        await expect(docsWin.locator('.docs-quickopen')).not.toBeVisible()

        // Reopen and close with Escape.
        await docsWin.keyboard.press('Control+k')
        await expect(docsWin.locator('.docs-quickopen')).toBeVisible({ timeout: 3000 })
        await docsWin.keyboard.press('Escape')
        await expect(docsWin.locator('.docs-quickopen')).not.toBeVisible({ timeout: 2000 })
    } finally {
        await app.close()
        fs.rmSync(userData, { recursive: true, force: true })
    }
})
