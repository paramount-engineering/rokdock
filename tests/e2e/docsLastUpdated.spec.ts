/**
 * E2E: "last updated" date indicator in the Developer Docs page header.
 * Verifies that the .docs-pane-updated element appears and shows a formatted
 * date after a page loads, when the commits API returns a date.
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { launchRokDockWithArgsAndUserData } from './helpers'

const PAGE_PATH = 'docs/developer-program/getting-started/overview.md'

function seedPage(userData: string): void {
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
            slug: 'developer-program',
            label: 'developer-program',
            path: 'docs/developer-program',
            kind: 'directory',
            children: [{
                slug: 'getting-started',
                label: 'Getting Started',
                path: 'docs/developer-program/getting-started',
                kind: 'directory',
                children: [
                    { slug: 'overview', label: 'Overview', path: PAGE_PATH, kind: 'page' },
                ],
            }],
        }],
        slugIndex: {},
    }
    fs.writeFileSync(path.join(cacheDir, 'tree.json'), JSON.stringify(tree), 'utf-8')
    const pageFile = PAGE_PATH.replace(/~/g, '~~').replace(/\//g, '~') + '.json'
    fs.writeFileSync(
        path.join(pagesDir, pageFile),
        JSON.stringify({ path: PAGE_PATH, title: 'Overview', markdown: '# Overview\n\nGetting started content.' }),
        'utf-8',
    )
}

test('last-updated date appears in the page header after the commits API responds', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-lastupdated-'))
    seedPage(userData)
    const { app, mainWin } = await launchRokDockWithArgsAndUserData([], userData)
    try {
        // Install a fetch override in the main process BEFORE the docs window opens.
        // The override intercepts commits API calls and returns a fixed date.
        await app.evaluate(() => {
            const realFetch = globalThis.fetch.bind(globalThis)
            globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
                const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
                if (url.includes('api.github.com') && url.includes('/commits?path=')) {
                    const body = JSON.stringify([{ commit: { committer: { date: '2026-05-01T12:00:00Z' } } }])
                    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } })
                }
                return realFetch(input, init)
            }
        })

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
            undefined,
            { timeout: 8000 },
        )

        const open = async (label: string): Promise<void> => {
            const loc = win!.getByText(label, { exact: true }).first()
            await loc.waitFor({ state: 'visible', timeout: 5000 })
            await loc.click()
            await win!.waitForTimeout(250)
        }
        await open('developer-program')
        await open('Getting Started')
        await open('Overview')

        await win.waitForFunction(
            () => (document.querySelector('.docs-pane-title')?.textContent ?? '').includes('Overview'),
            undefined,
            { timeout: 6000 },
        )

        const updatedEl = win.locator('.docs-pane-updated')
        await expect(updatedEl).toBeVisible({ timeout: 6000 })

        const text = await updatedEl.textContent()
        expect(text).toContain('Updated')
        expect(text).toContain('2026')
        expect(text).toContain('May')
    } finally {
        await app.close()
        fs.rmSync(userData, { recursive: true, force: true })
    }
})
