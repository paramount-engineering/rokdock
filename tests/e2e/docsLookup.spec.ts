/**
 * E2E: "Look up in Docs". The terminal context-menu lookup injects a search
 * term into the docs sidebar, both for a new window (boot-drain path) and an
 * already-open window (nudge-drain path).
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { launchRokDockWithArgsAndUserData } from './helpers'

const LOOKUP_PAGE = 'docs/developer-program/getting-started/lookup-page.md'

function seedLookupPage(userData: string): void {
    const cacheDir = path.join(userData, 'docs-cache')
    const pagesDir = path.join(cacheDir, 'pages')
    fs.mkdirSync(pagesDir, { recursive: true })
    fs.writeFileSync(
        path.join(cacheDir, 'manifest.json'),
        JSON.stringify({ version: 1, ref: 'v2.0', builtAgainstSha: 'abc', updatedAt: new Date().toISOString() }),
        'utf-8',
    )
    const tree = {
        roots: [{
            slug: 'developer-program', label: 'developer-program',
            path: 'docs/developer-program', kind: 'directory',
            children: [{
                slug: 'getting-started', label: 'Getting Started',
                path: 'docs/developer-program/getting-started', kind: 'directory',
                children: [{ slug: 'lookup-page', label: 'Lookup Page', path: LOOKUP_PAGE, kind: 'page' }],
            }],
        }],
        slugIndex: {},
    }
    fs.writeFileSync(path.join(cacheDir, 'tree.json'), JSON.stringify(tree), 'utf-8')
    const file = `${LOOKUP_PAGE.replace(/~/g, '~~').replace(/\//g, '~')}.json`
    fs.writeFileSync(
        path.join(pagesDir, file),
        JSON.stringify({ path: LOOKUP_PAGE, title: 'Lookup Page', markdown: '# Lookup Page\n\nThis page covers roSGNode basics and ifSGNodeField usage.' }),
        'utf-8',
    )
}

test('new-window path: lookUp injects term into sidebar search input', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-lookup-'))
    seedLookupPage(userData)
    const { app, mainWin } = await launchRokDockWithArgsAndUserData([], userData)
    try {
        const before = app.windows().length
        await mainWin.evaluate(() => window.rokdock.docs.lookUp('roSGNode'))
        const deadline = Date.now() + 8000
        let win: Awaited<ReturnType<typeof app.windows>>[number] | undefined
        while (Date.now() < deadline) {
            const w = app.windows()
            if (w.length > before) { win = w[w.length - 1]; break }
            await new Promise(r => setTimeout(r, 100))
        }
        if (!win) throw new Error('docs window did not open')
        await win.waitForLoadState('domcontentloaded')
        await win.waitForFunction(
            () => !document.documentElement.classList.contains('rokdock-theme-pending'),
            undefined, { timeout: 8000 },
        )
        const searchInput = win.locator('.docs-sidebar-search')
        await expect.poll(async () => await searchInput.inputValue(), { timeout: 8000 }).toBe('roSGNode')
    } finally {
        await app.close()
        fs.rmSync(userData, { recursive: true, force: true })
    }
})

test('already-open path: lookUp updates sidebar search input in existing window', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-lookup2-'))
    seedLookupPage(userData)
    const { app, mainWin } = await launchRokDockWithArgsAndUserData([], userData)
    try {
        // Open docs window first.
        const before = app.windows().length
        await mainWin.evaluate(() => window.rokdock.docs.open('dark'))
        const deadline = Date.now() + 8000
        let win: Awaited<ReturnType<typeof app.windows>>[number] | undefined
        while (Date.now() < deadline) {
            const w = app.windows()
            if (w.length > before) { win = w[w.length - 1]; break }
            await new Promise(r => setTimeout(r, 100))
        }
        if (!win) throw new Error('docs window did not open')
        await win.waitForLoadState('domcontentloaded')
        await win.waitForFunction(
            () => !document.documentElement.classList.contains('rokdock-theme-pending'),
            undefined, { timeout: 8000 },
        )
        // Now push a lookup to the already-open window.
        await mainWin.evaluate(() => window.rokdock.docs.lookUp('ifSGNodeField'))
        const searchInput = win.locator('.docs-sidebar-search')
        await expect.poll(async () => await searchInput.inputValue(), { timeout: 8000 }).toBe('ifSGNodeField')
    } finally {
        await app.close()
        fs.rmSync(userData, { recursive: true, force: true })
    }
})
