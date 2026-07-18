/**
 * E2E: per-page personal notes in the Developer Docs viewer. Typing a note,
 * navigating away, and returning shows the note automatically and the text
 * persists to AppPreferences.docsNotesByPath.
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { launchRokDockWithArgsAndUserData } from './helpers'
import type { AppPreferences } from '@shared/types'

const PAGE_ONE = 'docs/developer-program/getting-started/page-one.md'
const PAGE_TWO = 'docs/developer-program/getting-started/page-two.md'

function seedTwoPages(userData: string): void {
    const cacheDir = path.join(userData, 'docs-cache')
    const pagesDir = path.join(cacheDir, 'pages')
    fs.mkdirSync(pagesDir, { recursive: true })
    fs.writeFileSync(
        path.join(cacheDir, 'manifest.json'),
        JSON.stringify({
            version: 1,
            ref: 'v2.0',
            builtAgainstSha: 'abc',
            updatedAt: new Date().toISOString(),
        }),
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
                            { slug: 'page-one', label: 'Page One', path: PAGE_ONE, kind: 'page' },
                            { slug: 'page-two', label: 'Page Two', path: PAGE_TWO, kind: 'page' },
                        ],
                    },
                ],
            },
        ],
        slugIndex: {},
    }
    fs.writeFileSync(path.join(cacheDir, 'tree.json'), JSON.stringify(tree), 'utf-8')
    const encode = (p: string) => `${p.replace(/~/g, '~~').replace(/\//g, '~')}.json`
    fs.writeFileSync(
        path.join(pagesDir, encode(PAGE_ONE)),
        JSON.stringify({ path: PAGE_ONE, title: 'Page One', markdown: '# Page One\n\nContent for page one.' }),
        'utf-8',
    )
    fs.writeFileSync(
        path.join(pagesDir, encode(PAGE_TWO)),
        JSON.stringify({ path: PAGE_TWO, title: 'Page Two', markdown: '# Page Two\n\nContent for page two.' }),
        'utf-8',
    )
}

test('notes open, persist, and auto-show on return', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-notes-'))
    seedTwoPages(userData)
    const { app, mainWin } = await launchRokDockWithArgsAndUserData([], userData)
    try {
        const before = app.windows().length
        await mainWin.evaluate(() => window.rokdock.docs.open('dark'))
        const deadline = Date.now() + 8000
        let win: Awaited<ReturnType<typeof app.windows>>[number] | undefined
        while (Date.now() < deadline) {
            const windows = app.windows()
            if (windows.length > before) {
                win = windows[windows.length - 1]
                break
            }
            await new Promise(r => setTimeout(r, 100))
        }
        if (!win) throw new Error('docs window did not open')
        await win.waitForLoadState('domcontentloaded')
        await win.waitForFunction(
            () => !document.documentElement.classList.contains('rokdock-theme-pending'),
            undefined,
            { timeout: 8000 },
        )

        const openTreeNode = async (label: string) => {
            const loc = win!.getByText(label, { exact: true }).first()
            await loc.waitFor({ state: 'visible', timeout: 5000 })
            await loc.click()
            await win!.waitForTimeout(200)
        }

        await openTreeNode('developer-program')
        await openTreeNode('Getting Started')
        await openTreeNode('Page One')
        await win.waitForFunction(() => !!document.querySelector('.docs-prose'), undefined, { timeout: 6000 })

        // Open the notes panel via the toolbar button.
        const notesButton = win.getByRole('button', { name: 'Notes' })
        await notesButton.waitFor({ state: 'visible', timeout: 5000 })
        await notesButton.click()
        await win.waitForSelector('.docs-note', { timeout: 3000 })

        // Type a note.
        const noteText = 'Remember to check the sideloading docs!'
        const textarea = win.locator('.docs-note-text')
        await textarea.fill(noteText)

        // Wait for debounce to fire (400ms + buffer).
        await win.waitForTimeout(600)

        // Navigate to Page Two, then back to Page One.
        await openTreeNode('Page Two')
        await win.waitForFunction(
            () => (document.querySelector('.docs-pane-title')?.textContent ?? '').includes('Page Two'),
            undefined,
            { timeout: 6000 },
        )
        await openTreeNode('Page One')
        await win.waitForFunction(
            () => (document.querySelector('.docs-pane-title')?.textContent ?? '').includes('Page One'),
            undefined,
            { timeout: 6000 },
        )

        // The note panel should auto-open because the page now has a note.
        await win.waitForSelector('.docs-note', { timeout: 3000 })

        // The textarea should contain the text we typed.
        const savedText = await win.locator('.docs-note-text').inputValue()
        expect(savedText).toBe(noteText)

        // The pref should be persisted.
        const persistedNote = await win.evaluate(
            (p) => window.rokdock.store.getPreferences().then((prefs: AppPreferences) => prefs.docsNotesByPath?.[p]),
            PAGE_ONE,
        )
        expect(persistedNote).toBe(noteText)

        // The page now carries a sticky-note marker in the browse tree.
        await expect(win.locator('.docs-nav-note')).toHaveCount(1)
    } finally {
        await app.close()
        fs.rmSync(userData, { recursive: true, force: true })
    }
})
