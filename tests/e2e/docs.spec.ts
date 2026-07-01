/**
 * E2E smoke tests: Developer Docs tool window.
 *
 * Network-deterministic by design: the docs window fetches its nav tree live
 * from api.github.com. The test sandbox may have no network access, so we
 * never assert that live doc content renders. Instead we assert:
 *
 *  1. The window opens and receives the correct title.
 *  2. The themed boot completes (rokdock-theme-pending removed).
 *  3. The sidebar chrome is present regardless of network state.
 *  4. The Browse section reaches a terminal (non-white-screen) state: either
 *     tree nodes rendered, or a loading/error/empty indicator is shown.
 *  5. Zero main-process fatal errors during the run.
 *  6. A --tool docs standalone launch opens a dock-less window titled
 *     "Developer Docs".
 *
 * Favorites persistence is verified without live content: a favorite is seeded
 * via window.rokdock.store.setPreferences before the window opens. The hook
 * reads prefs on mount, so the entry appears immediately in the Favorites
 * section without any network requirement.
 *
 * Offline cache tests (at the bottom of this file) use a pre-populated
 * docs-cache directory written to a temp userData dir before launch. The
 * main-process fetch is replaced via app.evaluate() so the tests are
 * deterministic regardless of network availability.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { launchRokDock, launchRokDockWithArgs, launchRokDockWithArgsAndUserData } from './helpers'

// ---------------------------------------------------------------------------
// Shared app handle (all inDock tests share one launch to save time)
// ---------------------------------------------------------------------------

let app: ElectronApplication
let mainWin: Page
let mainErrors: string[]
let cspViolations: string[]

test.beforeAll(async () => {
    const launched = await launchRokDock()
    app = launched.app
    mainWin = launched.mainWin
    mainErrors = launched.mainErrors
    cspViolations = launched.cspViolations
})

test.afterAll(async () => {
    await app.close()
})

// ---------------------------------------------------------------------------
// Helpers (mirrors toolWindows.spec.ts)
// ---------------------------------------------------------------------------

async function openToolWindow(opener: string): Promise<Page> {
    const before = app.windows().length

    await mainWin.evaluate((expr: string) => {
        return new Promise<void>((resolve, reject) => {
            try {
                // eslint-disable-next-line no-eval
                const p = eval(expr) as Promise<unknown>
                if (p && typeof p.then === 'function') {
                    p.then(() => resolve(), reject)
                } else {
                    resolve()
                }
            } catch (e) {
                reject(e)
            }
        })
    }, opener)

    const deadline = Date.now() + 8_000
    let win: Page | undefined
    while (Date.now() < deadline) {
        const wins = app.windows()
        if (wins.length > before) {
            win = wins[wins.length - 1]
            break
        }
        await new Promise<void>(r => setTimeout(r, 100))
    }

    if (!win) throw new Error(`Tool window did not appear within 8 s (opener: ${opener})`)

    await win.waitForLoadState('domcontentloaded')
    return win
}

async function closeToolWindow(win: Page): Promise<void> {
    const beforeCount = app.windows().length
    await win.close().catch(() => {})
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
        if (app.windows().length < beforeCount) break
        await new Promise<void>(r => setTimeout(r, 100))
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('Developer Docs: opens with correct title', async () => {
    const win = await openToolWindow(`window.rokdock.docs.open('dark')`)
    const title = await win.title()
    expect(title).toBe('Developer Docs')
    await closeToolWindow(win)
    expect(mainErrors).toEqual([])
})

test('Developer Docs: themed boot completes (rokdock-theme-pending removed)', async () => {
    const win = await openToolWindow(`window.rokdock.docs.open('dark')`)

    await win.waitForFunction(
        () => !document.documentElement.classList.contains('rokdock-theme-pending'),
        undefined,
        { timeout: 8_000 }
    )

    // Still alive, no crash during themed boot.
    expect(await win.title()).toBe('Developer Docs')
    await closeToolWindow(win)
    expect(mainErrors).toEqual([])
})

test('Developer Docs: sidebar chrome renders (search input + section headers)', async () => {
    const win = await openToolWindow(`window.rokdock.docs.open('dark')`)

    // Wait for themed boot so React has mounted.
    await win.waitForFunction(
        () => !document.documentElement.classList.contains('rokdock-theme-pending'),
        undefined,
        { timeout: 8_000 }
    )

    // Wait until the sidebar is visible. The sidebar appears once the tree load
    // settles (either renders the DocsSidebar or the error/loading fallback).
    // We wait for the search input which is always present when DocsSidebar renders.
    // A generous timeout covers slow or absent network (tree error surfaces quickly).
    await win.waitForFunction(
        () => !!document.querySelector('input[type="search"]'),
        undefined,
        { timeout: 15_000 }
    )

    // Search input: functional (full-text search is wired up).
    const searchInput = win.locator('input[type="search"]')
    await expect(searchInput).toBeEnabled()

    // Section headers by visible text inside .rokdock-section-header spans.
    // CollapsibleSection renders the title in a <span> inside .rokdock-section-header.
    const favoritesHeader = win.locator('.rokdock-section-header span', { hasText: 'Favorites' })
    await expect(favoritesHeader).toBeVisible()

    const browseHeader = win.locator('.rokdock-section-header span', { hasText: 'Browse' })
    await expect(browseHeader).toBeVisible()

    await closeToolWindow(win)
    expect(mainErrors).toEqual([])
})

test('Developer Docs: Browse section reaches terminal state without white-screening', async () => {
    const win = await openToolWindow(`window.rokdock.docs.open('dark')`)

    await win.waitForFunction(
        () => !document.documentElement.classList.contains('rokdock-theme-pending'),
        undefined,
        { timeout: 8_000 }
    )

    // Wait up to 20 s for the Browse section to settle. It is terminal when one of:
    //  - role="tree" exists (tree nodes rendered, meaning network was up)
    //  - An error or loading indicator is visible (network down or tree empty)
    //  - The empty-state "No favorites" text is visible inside Favorites
    //    (DocsSidebar mounted, which means tree loaded or errored out)
    //
    // The one state we reject is a true white-screen: #root is empty. We assert
    // that #root has some rendered content.
    const reached = await win.waitForFunction(
        () => {
            const root = document.getElementById('root')
            if (!root || root.children.length === 0) return false

            // Terminal: tree rendered
            if (document.querySelector('[role="tree"]')) return true

            // Terminal: tree fetch errored (DocsView renders an error banner)
            if (document.querySelector('.docs-layout')) {
                // DocsView mounted. If we have the sidebar (search input) or an
                // error message div inside the sidebar column, we are done.
                const searchInput = document.querySelector('input[type="search"]')
                const errorDiv = document.querySelector('.docs-layout-sidebar div')
                return !!(searchInput ?? errorDiv)
            }

            return false
        },
        undefined,
        { timeout: 20_000 }
    )

    expect(reached).toBeTruthy()

    await closeToolWindow(win)
    expect(mainErrors).toEqual([])
})

test('Developer Docs: seeded favorite appears in Favorites section', async () => {
    // Seed a favorite into the store BEFORE opening the docs window.
    // useDocsLibrary reads favoriteDocs in a useEffect on mount, so the entry
    // will be present immediately when DocsSidebar renders.
    await mainWin.evaluate(() =>
        window.rokdock.store.setPreferences({
            favoriteDocs: [{ path: 'docs/developer-program/getting-started/roku-dev-prog.md', title: 'Seeded Favorite' }]
        })
    )

    const win = await openToolWindow(`window.rokdock.docs.open('dark')`)

    await win.waitForFunction(
        () => !document.documentElement.classList.contains('rokdock-theme-pending'),
        undefined,
        { timeout: 8_000 }
    )

    // Wait for the sidebar chrome to appear (search input is the reliable signal).
    await win.waitForFunction(
        () => !!document.querySelector('input[type="search"]'),
        undefined,
        { timeout: 15_000 }
    )

    // The Favorites section should display the seeded entry.
    const seededEntry = win.locator('text=Seeded Favorite')
    await expect(seededEntry).toBeVisible({ timeout: 5_000 })

    await closeToolWindow(win)

    // Clean up the seeded favorite so it does not bleed into later tests.
    await mainWin.evaluate(() =>
        window.rokdock.store.setPreferences({ favoriteDocs: [] })
    )

    expect(mainErrors).toEqual([])
})

test('Developer Docs: favorite star button is hidden when no page is loaded', async () => {
    const win = await openToolWindow(`window.rokdock.docs.open('dark')`)

    await win.waitForFunction(
        () => !document.documentElement.classList.contains('rokdock-theme-pending'),
        undefined,
        { timeout: 8_000 }
    )

    // The favorite button lives in the window toolbar's right group, which only
    // renders its page controls once a page is open. With no page loaded the
    // favorite control is absent from the DOM.
    await expect(win.locator('button[aria-label$="favorites"]')).toHaveCount(0, { timeout: 5_000 })

    await closeToolWindow(win)
    expect(mainErrors).toEqual([])
})

test('Developer Docs: zero CSP violations on open', async () => {
    const win = await openToolWindow(`window.rokdock.docs.open('dark')`)

    await win.waitForFunction(
        () => !document.documentElement.classList.contains('rokdock-theme-pending'),
        undefined,
        { timeout: 8_000 }
    )

    await closeToolWindow(win)

    expect(cspViolations).toEqual([])
    expect(mainErrors).toEqual([])
})

// ---------------------------------------------------------------------------
// Standalone launch (--tool docs)
// ---------------------------------------------------------------------------

test('Developer Docs: --tool docs opens a dock-less window titled Developer Docs', async () => {
    const { app: standaloneApp, mainErrors: standaloneErrors } = await launchRokDockWithArgs(['--tool', 'docs'])
    try {
        const win = await standaloneApp.firstWindow()
        await win.waitForLoadState('domcontentloaded')

        expect(await win.title()).toBe('Developer Docs')

        // Dock-less: only one window.
        expect(standaloneApp.windows().length).toBe(1)

        // Themed boot completes.
        await win.waitForFunction(
            () => !document.documentElement.classList.contains('rokdock-theme-pending'),
            undefined,
            { timeout: 8_000 }
        )

        expect(standaloneErrors).toEqual([])
    } finally {
        await standaloneApp.close()
    }
})

// ---------------------------------------------------------------------------
// Offline cache tests
//
// Both tests pre-populate a docs-cache directory in a temp userData dir before
// the app launches. After launch they replace global.fetch in the main process
// (via app.evaluate) so all network requests fail deterministically. The cache
// layer then serves content from disk instead of the network.
//
// The docs-cache schema (from src/main/services/docsCache.ts):
//   userData/docs-cache/manifest.json  : version, ref, builtAgainstSha, updatedAt
//   userData/docs-cache/tree.json      : DocsTree (roots + slugIndex)
//   userData/docs-cache/pages/<name>   : one DocsPage per file
//   userData/docs-cache/whats-new-last.json : StoredWhatsNew (written by the app)
//
// A page filename is: repoPath.replace(/~/g, '~~').replace(/\//g, '~') + '.json'
// The manifest version must be 1 and ref must match DOCS_REF ('v2.0') for the
// cache to be considered valid.
//
// The stale-fallback test does NOT pre-write whats-new-last.json. Instead it serves
// a valid commits + compare success first so the real getWhatsNew -> writeLastWhatsNew
// path persists last-good, then swaps fetch to 403 to prove the stale fallback reads it.
// ---------------------------------------------------------------------------

/** Build a minimal valid docs-cache directory inside `userData`. */
function seedDocsCache(userData: string): { pagePath: string; pageTitle: string; pageText: string } {
    const cacheDir = path.join(userData, 'docs-cache')
    const pagesDir = path.join(cacheDir, 'pages')
    fs.mkdirSync(pagesDir, { recursive: true })

    const pagePath = 'docs/developer-program/getting-started/roku-dev-prog.md'
    const pageTitle = 'Roku Developer Program'
    const pageText = 'Welcome to the Roku developer program overview.'

    // manifest.json: version=1, ref='v2.0' (must match DOCS_REF in docsService.ts).
    const manifest = {
        version: 1,
        ref: 'v2.0',
        builtAgainstSha: 'abc123fakesha',
        updatedAt: new Date().toISOString(),
    }
    fs.writeFileSync(path.join(cacheDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8')

    // tree.json: minimal DocsTree with one page node so the service accepts it
    // and reports it as valid (isValidFor returns true).
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
                            {
                                slug: 'roku-dev-prog',
                                label: pageTitle,
                                path: pagePath,
                                kind: 'page',
                            },
                        ],
                    },
                ],
            },
        ],
        slugIndex: { 'roku-dev-prog': pagePath },
    }
    fs.writeFileSync(path.join(cacheDir, 'tree.json'), JSON.stringify(tree), 'utf-8')

    // Page JSON: matches the DocsPage interface (path, title, markdown).
    const page = { path: pagePath, title: pageTitle, markdown: pageText }
    // Page filename: slashes become '~', existing tildes become '~~'.
    const pageFileName = `${pagePath.replace(/~/g, '~~').replace(/\//g, '~')}.json`
    fs.writeFileSync(path.join(pagesDir, pageFileName), JSON.stringify(page), 'utf-8')

    // Note: whats-new-last.json is intentionally NOT seeded here. The stale-fallback
    // test exercises the real round-trip: a first successful getWhatsNew load writes
    // last-good via writeLastWhatsNew, then a 403 forces the stale fallback to read it.

    return { pagePath, pageTitle, pageText }
}

/**
 * Replace global.fetch in the Electron main process so every request to
 * api.github.com or raw.githubusercontent.com fails with a 403 response.
 * All other requests pass through. Run after app launch via app.evaluate().
 */
async function blockGitHubInMainProcess(app: ElectronApplication): Promise<void> {
    await app.evaluate(() => {
        const originalFetch = global.fetch
        ;(global as unknown as Record<string, unknown>).fetch = async (
            input: RequestInfo | URL,
            init?: RequestInit
        ): Promise<Response> => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
            if (url.includes('api.github.com') || url.includes('raw.githubusercontent.com')) {
                return new Response('Forbidden (blocked by test)', { status: 403, statusText: 'Forbidden' })
            }
            return originalFetch(input, init)
        }
    })
}

/**
 * Replace global.fetch in the Electron main process so the GitHub commits and
 * compare endpoints return a minimal-but-valid SUCCESS response. This lets a
 * first What's New load complete and persist last-good via the real
 * writeLastWhatsNew. The tree is read from the seeded disk cache, so no tree
 * fetch is needed. `changedPagePath` must be a page present in the seeded tree
 * so the compare entry survives the service's nav-label filter.
 */
async function serveGitHubWhatsNewSuccessInMainProcess(
    app: ElectronApplication,
    changedPagePath: string,
): Promise<void> {
    // app.evaluate passes the Electron module object as the first arg and the
    // caller-supplied value as the second, so the page path is the second param.
    await app.evaluate((_electron, changedPath: string) => {
        const originalFetch = global.fetch
        ;(global as unknown as Record<string, unknown>).fetch = async (
            input: RequestInfo | URL,
            init?: RequestInit
        ): Promise<Response> => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
            const json = (body: unknown): Response =>
                new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

            // commits?sha=...&per_page=1 -> the base/head commit list (needs one sha).
            if (url.includes('api.github.com') && url.includes('/commits')) {
                return json([{ sha: 'deadbeefcafe' }])
            }
            // compare/<base>...<head> -> the changed-file list (one openable docs page).
            if (url.includes('api.github.com') && url.includes('/compare/')) {
                return json({
                    files: [
                        {
                            filename: changedPath,
                            status: 'modified',
                            additions: 5,
                            deletions: 2,
                            patch: '@@ -1,1 +1,1 @@\n-old line\n+new line',
                        },
                    ],
                })
            }
            // Any other GitHub call (e.g. the tree API or raw CDN that prime() may
            // trigger) is blocked so the test never depends on live network. Returning
            // 403 keeps prime()'s revalidate best-effort path from rebuilding the tree
            // from real data, which would replace the seeded fixture mid-test.
            if (url.includes('api.github.com') || url.includes('raw.githubusercontent.com')) {
                return new Response('Forbidden (blocked by test)', { status: 403, statusText: 'Forbidden' })
            }
            return originalFetch(input, init)
        }
    }, changedPagePath)
}

test('reads a cached docs page with the network blocked', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-docs-offline-'))
    try {
        const { pagePath, pageTitle, pageText } = seedDocsCache(userData)

        const { app: isolatedApp, mainWin } = await launchRokDockWithArgsAndUserData([], userData)
        try {
            // Block GitHub in the main process before the docs window opens. The
            // DocsService reads the tree from the disk cache (manifest is valid),
            // so no network call is needed for the tree. Page reads also hit the
            // disk cache first.
            await blockGitHubInMainProcess(isolatedApp)

            // Open the docs window.
            const winPromise = isolatedApp.waitForEvent('window')
            await mainWin.evaluate(() => window.rokdock.docs.open('dark'))
            const docsWin = await winPromise
            await docsWin.waitForLoadState('domcontentloaded')

            // Wait for themed boot.
            await docsWin.waitForFunction(
                () => !document.documentElement.classList.contains('rokdock-theme-pending'),
                undefined,
                { timeout: 8_000 }
            )

            // Wait for the sidebar to mount (search input is the reliable signal).
            await docsWin.waitForFunction(
                () => !!document.querySelector('input[type="search"]'),
                undefined,
                { timeout: 20_000 }
            )

            // Read the pre-cached page through the IPC bridge (the same path the UI
            // uses). The service reads from the disk cache; the network is blocked.
            const result = await docsWin.evaluate(
                (p: string) => window.rokdock.docs.getPage(p),
                pagePath
            )

            // The page was served from the disk cache: title and markdown match.
            expect((result as { title?: string }).title).toBe(pageTitle)
            expect((result as { markdown?: string }).markdown).toBe(pageText)
        } finally {
            await isolatedApp.close()
        }
    } finally {
        try { fs.rmSync(userData, { recursive: true, force: true }) } catch { /* cleanup best-effort */ }
    }
})

test("What's New shows the last cached result when GitHub 403s", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-docs-stale-'))
    try {
        const { pagePath, pageTitle } = seedDocsCache(userData)

        const { app: isolatedApp, mainWin } = await launchRokDockWithArgsAndUserData([], userData)
        try {
            // Phase 1: serve a valid commits + compare success so the first What's New
            // load completes and persists last-good through the real writeLastWhatsNew.
            // The tree comes from the seeded disk cache, so no tree fetch is needed.
            await serveGitHubWhatsNewSuccessInMainProcess(isolatedApp, pagePath)

            // Open the docs window.
            const winPromise = isolatedApp.waitForEvent('window')
            await mainWin.evaluate(() => window.rokdock.docs.open('dark'))
            const docsWin = await winPromise
            await docsWin.waitForLoadState('domcontentloaded')

            await docsWin.waitForFunction(
                () => !document.documentElement.classList.contains('rokdock-theme-pending'),
                undefined,
                { timeout: 8_000 }
            )

            // Wait for sidebar to mount.
            await docsWin.waitForFunction(
                () => !!document.querySelector('input[type="search"]'),
                undefined,
                { timeout: 20_000 }
            )

            // Open the What's New view by clicking the sidebar button. This first load
            // succeeds (status 200) and the service writes whats-new-last.json.
            const whatsNewButton = docsWin.locator('button.docs-whatsnew-entry')
            await expect(whatsNewButton).toBeVisible({ timeout: 5_000 })
            await whatsNewButton.click()

            // The successful load renders the changed page (the success fixture's entry).
            const changedEntry = docsWin.locator('button.docs-whatsnew-link', { hasText: pageTitle })
            await expect(changedEntry).toBeVisible({ timeout: 15_000 })
            // No stale banner yet: this load was live and successful.
            await expect(
                docsWin.locator('.docs-whatsnew-message', { hasText: 'Showing the last cached changes' })
            ).toHaveCount(0)

            // Phase 2: swap fetch so commits/compare now 403.
            await blockGitHubInMainProcess(isolatedApp)

            // Switch the time window from the default (30 days) to 7 days. This changes
            // the since-date, so the service issues a FRESH fetch (the per-since memo
            // does not cover it) which now 403s and falls back to last-good.
            const sevenDays = docsWin.locator('button', { hasText: '7 days' })
            await expect(sevenDays).toBeVisible({ timeout: 5_000 })
            await sevenDays.click()

            // The service catches the 403, reads whats-new-last.json (written in phase 1),
            // and returns stale: true. The component renders the stale banner.
            const staleBanner = docsWin.locator('.docs-whatsnew-message', {
                hasText: 'Showing the last cached changes. Could not reach GitHub.',
            })
            await expect(staleBanner).toBeVisible({ timeout: 15_000 })

            // The cached entries (or the empty-state) still render alongside the banner.
            // Phase 1 persisted one entry, so the page link reappears from the stale result.
            await expect(
                docsWin.locator('button.docs-whatsnew-link', { hasText: pageTitle })
            ).toBeVisible({ timeout: 5_000 })
        } finally {
            await isolatedApp.close()
        }
    } finally {
        try { fs.rmSync(userData, { recursive: true, force: true }) } catch { /* cleanup best-effort */ }
    }
})
