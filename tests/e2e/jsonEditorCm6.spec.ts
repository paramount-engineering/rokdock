/**
 * E2E verification for the JSON editor's ACE -> CodeMirror 6 migration.
 *
 * Boots the real app, opens the JSON editor, and exercises the migrated feature
 * set against the running CM6 editor: mount, syntax highlighting, lint markers on
 * bad JSON, folding (foldAll/unfoldAll toolbar buttons), the search panel,
 * format/minify, sort-at-cursor, dirty tracking, the status bar, the live
 * theme-change wiring, and the typed IPC command channel the main process drives.
 *
 * Negative control: the first assertion requires `.cm-editor` to exist. The old
 * ACE build rendered `.ace_editor` and never `.cm-editor`, so this whole spec
 * fails against a stale (pre-migration) build, which guards against a no-op run.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { launchRokDock, sendToolWindowCommand } from './helpers'

let app: ElectronApplication
let mainWin: Page
let mainErrors: string[]
let editor: Page

/** Returns the editor document text by joining the rendered CM line elements. */
async function docText(win: Page): Promise<string> {
    return win.evaluate(() =>
        Array.from(document.querySelectorAll('.cm-content .cm-line'))
            .map(l => l.textContent ?? '')
            .join('\n')
    )
}

// Drives the JSON editor through the real menu IPC path (shared helper).
async function sendCommand(command: unknown): Promise<void> {
    await sendToolWindowCommand(app, 'JSON Editor', command)
}

/** Replaces the editor content by opening a fresh tab holding the given string. */
async function openTabWith(win: Page, content: string): Promise<void> {
    const before = await win.locator('.rokdock-tab').count()
    await sendCommand({ type: 'addTab', content })
    await expect.poll(() => win.locator('.rokdock-tab').count()).toBe(before + 1)
}

test.beforeAll(async () => {
    const launched = await launchRokDock()
    app = launched.app
    mainWin = launched.mainWin
    mainErrors = launched.mainErrors

    // Open the JSON editor and wait for the themed boot to complete.
    const before = app.windows().length
    await mainWin.evaluate(() => window.rokdock.json.openEditor())
    const deadline = Date.now() + 8_000
    while (Date.now() < deadline) {
        if (app.windows().length > before) break
        await new Promise<void>(r => setTimeout(r, 100))
    }
    editor = app.windows()[app.windows().length - 1]
    await editor.waitForLoadState('domcontentloaded')
    await editor.waitForFunction(
        () => !document.documentElement.classList.contains('rokdock-theme-pending'),
        undefined,
        { timeout: 5_000 }
    )
})

test.afterAll(async () => {
    await app.close()
})

test('mounts a CodeMirror view (negative control vs ACE)', async () => {
    // Negative control: ACE rendered .ace_editor, never .cm-editor.
    await expect(editor.locator('.cm-editor')).toHaveCount(1)
    await expect(editor.locator('.cm-content')).toHaveCount(1)
})

test('highlights JSON tokens', async () => {
    await openTabWith(editor, '{\n  "key": "value",\n  "num": 42,\n  "flag": true,\n  "empty": null\n}')
    // CM6 wraps highlighted tokens in styled spans inside the lines.
    await expect.poll(() => editor.locator('.cm-content .cm-line span').count()).toBeGreaterThan(0)
    // Durable visual artifact for eyeballing the syntax palette and chrome.
    await editor.screenshot({ path: 'tests/e2e/screenshots/json-editor-cm6-dark.png' })
})

test('marks invalid JSON with a lint gutter marker', async () => {
    await openTabWith(editor, '{ "a": , }')
    // jsonParseLinter runs on the main thread (no worker) after a short debounce.
    await expect(editor.locator('.cm-lint-marker-error').first()).toBeVisible({ timeout: 6_000 })

    // The lint gutter renders in the leftmost column, before the line numbers.
    const lintBeforeNumbers = await editor.evaluate(() => {
        const gutters = Array.from(document.querySelectorAll('.cm-gutters > .cm-gutter'))
        const lintIdx = gutters.findIndex(g => g.classList.contains('cm-gutter-lint'))
        const numIdx = gutters.findIndex(g => g.classList.contains('cm-lineNumbers'))
        return lintIdx >= 0 && numIdx >= 0 && lintIdx < numIdx
    })
    expect(lintBeforeNumbers).toBe(true)
    await editor.screenshot({ path: 'tests/e2e/screenshots/json-editor-cm6-lint.png' })
})

test('folds and unfolds via the toolbar buttons', async () => {
    await openTabWith(editor, '{\n  "outer": {\n    "inner": 1,\n    "more": 2\n  }\n}')
    // Fold-gutter markers render (CSS-triangle markerDOM, no PNGs).
    await expect.poll(() => editor.locator('.cm-rokdock-fold').count()).toBeGreaterThan(0)

    await editor.locator('#btnCollapseAll').click()
    await expect.poll(() => editor.locator('.cm-foldPlaceholder').count()).toBeGreaterThan(0)

    await editor.locator('#btnExpandAll').click()
    await expect.poll(() => editor.locator('.cm-foldPlaceholder').count()).toBe(0)
})

test('opens the search panel via the command channel', async () => {
    await sendCommand({ type: 'find' })
    await expect(editor.locator('.cm-panel.cm-search')).toBeVisible({ timeout: 3_000 })
    // Close it so it does not interfere with later steps.
    await editor.keyboard.press('Escape')
})

test('formats and minifies the active document', async () => {
    await openTabWith(editor, '{"a":1,"b":2}')
    expect((await docText(editor)).split('\n').length).toBe(1)

    await editor.locator('#btnFormat').click()
    await expect.poll(() => editor.locator('.cm-content .cm-line').count()).toBeGreaterThan(1)

    await editor.locator('#btnMinify').click()
    await expect.poll(() => editor.locator('.cm-content .cm-line').count()).toBe(1)
    expect(await docText(editor)).toBe('{"a":1,"b":2}')
})

test('JSONL: expands records on Format and collapses them on Minify', async () => {
    await openTabWith(editor, '{"a":1}\n{"b":2}')
    // Recognized as JSONL (no parse error) with a record count in the status bar.
    await expect(editor.locator('#statusParse')).toHaveText('JSONL: 2 records', { timeout: 6_000 })
    await expect(editor.locator('.cm-lint-marker-error')).toHaveCount(0)

    await editor.locator('#btnFormat').click()
    // Each record pretty-prints across lines: two single-line records become six lines.
    await expect.poll(() => editor.locator('.cm-content .cm-line').count()).toBe(6)
    await expect(editor.locator('#statusParse')).toHaveText('JSONL: 2 records', { timeout: 6_000 })

    await editor.locator('#btnMinify').click()
    await expect.poll(() => editor.locator('.cm-content .cm-line').count()).toBe(2)
    expect(await docText(editor)).toBe('{"a":1}\n{"b":2}')
})

test('sorts keys at the cursor (offset-native path)', async () => {
    await openTabWith(editor, '{ "b": 1, "a": 2 }')
    await sendCommand({ type: 'sortAtCursor' })
    await expect.poll(async () => {
        const text = await docText(editor)
        return text.indexOf('"a"') >= 0 && text.indexOf('"a"') < text.indexOf('"b"')
    }).toBe(true)
})

test('warns when format merges duplicate keys', async () => {
    await openTabWith(editor, '{"a":1,"a":2}')
    await editor.locator('#btnFormat').click()
    await expect(editor.locator('#toast')).toHaveText(/[Dd]uplicate keys/, { timeout: 3_000 })
    // The duplicate is gone (last value wins) and the doc is formatted.
    const text = await docText(editor)
    expect(text).toContain('"a": 2')
    expect(text).not.toContain('"a": 1')
})

test('shows a child count on a collapsed range', async () => {
    const nested = JSON.stringify(
        {
            $schema: 'https://docs.renovatebot.com/renovate-schema.json',
            extends: ['config:recommended'],
            packageRules: [
                { description: 'Keep Vite on v7', matchPackageNames: ['vite'], allowedVersions: '<8' },
                { description: 'Keep plugin-react on v5', matchPackageNames: ['@vitejs/plugin-react'] },
            ],
        },
        null,
        2
    )
    await openTabWith(editor, nested)
    // Unfolded: multiple foldable lines show the (smaller) fold chevrons.
    await editor.screenshot({ path: 'tests/e2e/screenshots/json-editor-cm6-gutter.png' })

    await editor.locator('#btnCollapseAll').click()
    // The top-level object has three keys, so its placeholder reports 3.
    await expect(editor.locator('.cm-foldPlaceholder').first()).toHaveText(/3/, { timeout: 3_000 })
    await editor.screenshot({ path: 'tests/e2e/screenshots/json-editor-cm6-folded.png' })
})

test('collapsed and expanded fold markers are the same size', async () => {
    const nested = JSON.stringify(
        { a: { x: 1, y: 2 }, b: { x: 3, y: 4 }, c: { x: 5, y: 6 } },
        null,
        2
    )
    await openTabWith(editor, nested)
    const measure = (selector: string) =>
        editor.evaluate((sel: string) => {
            const el = document.querySelector(sel)
            if (!el) return null
            const r = el.getBoundingClientRect()
            return [Math.round(r.width), Math.round(r.height)]
        }, selector)

    // Expanded caret size.
    const openDims = await measure('.cm-rokdock-fold svg')
    expect(openDims).not.toBeNull()

    // Collapse, then the collapsed caret is the same glyph rotated, so it carries
    // the same dimensions (a rotated square has the same bounding box).
    await editor.locator('#btnCollapseAll').click()
    await expect(editor.locator('.cm-rokdock-fold-closed')).not.toHaveCount(0, { timeout: 3_000 })
    const closedDims = await measure('.cm-rokdock-fold-closed svg')
    expect(closedDims).toEqual(openDims)
})

test('tracks dirty state and updates the status bar on edit', async () => {
    const countBefore = await editor.locator('.rokdock-tab').count()
    await openTabWith(editor, '{}')
    await expect.poll(() => editor.locator('.rokdock-tab').count()).toBe(countBefore + 1)

    // Type into the editor to dirty the active tab.
    await editor.locator('.cm-content').click()
    await editor.keyboard.press('End')
    await editor.keyboard.type(' ')
    await expect(editor.locator('.rokdock-tab.active.dirty')).toHaveCount(1)

    // Status bar reflects position and a non-zero byte size.
    await expect(editor.locator('#statusPos')).toHaveText(/Ln \d+, Col \d+/)
    await expect(editor.locator('#statusSize')).not.toHaveText('0 B')
})

test('live theme-change wiring reconfigures all tabs without error', async () => {
    // The real switch is driven by main broadcasting theme:css-vars-updated; here
    // we verify the renderer listener + compartment reconfigure path runs and the
    // editor keeps rendering (colors still applied). A pixel-level palette flip is
    // a manual/in-app check since headless cannot set the real :root vars.
    // Two tabs are open so the background-tab reconfigure loop is exercised, then
    // we switch to the other tab to confirm it restored cleanly.
    await openTabWith(editor, '{"second":true}')
    const ok = await editor.evaluate(() => {
        try {
            document.documentElement.classList.add('theme-light')
            window.dispatchEvent(new CustomEvent('rokdock-theme-changed', { detail: {} }))
            document.documentElement.classList.remove('theme-light')
            window.dispatchEvent(new CustomEvent('rokdock-theme-changed', { detail: {} }))
            return true
        } catch {
            return false
        }
    })
    expect(ok).toBe(true)
    // Switch to the first tab (a background tab during the theme change) and
    // confirm it still renders.
    await editor.locator('.rokdock-tab').first().click()
    await expect(editor.locator('.cm-editor')).toHaveCount(1)
})

test('status bar reports a parse error and jump-to-error moves the cursor there', async () => {
    await openTabWith(editor, '{ "a": }')
    const parse = editor.locator('#statusParse')
    await expect(parse).toHaveText(/Error Ln \d+, Col \d+/, { timeout: 6_000 })
    const parseText = (await parse.textContent()) ?? ''
    await parse.click()
    // jump-to-error places the cursor at the error, so the position segment matches.
    await expect(editor.locator('#statusPos')).toHaveText(parseText.replace('Error ', ''))
})

test('status bar shows JSON for valid content', async () => {
    await openTabWith(editor, '{ "a": 1 }')
    await expect(editor.locator('#statusParse')).toHaveText('JSON', { timeout: 6_000 })
})

test('an empty document is not flagged as a parse error', async () => {
    // First make the editor show an error, then open an empty tab and confirm the
    // error clears (a blank buffer is the placeholder state, not a parse failure).
    await openTabWith(editor, '{ "a": }')
    await expect(editor.locator('#statusParse')).toHaveText(/Error/, { timeout: 6_000 })
    await openTabWith(editor, '')
    await expect(editor.locator('#statusParse')).toHaveText('JSON', { timeout: 6_000 })
    await expect(editor.locator('.cm-lint-marker-error')).toHaveCount(0, { timeout: 6_000 })
    await editor.screenshot({ path: 'tests/e2e/screenshots/json-editor-cm6-empty.png' })
})

test('sort-at-cursor handles a closing brace inside a string value', async () => {
    // The } inside "x}y" would break the pre-fix bracket scan and report the
    // object unsortable. With the string-aware scan the keys sort correctly.
    await openTabWith(editor, '{ "b": "x}y", "a": 1 }')
    await sendCommand({ type: 'sortAtCursor' })
    await expect.poll(async () => {
        const text = await docText(editor)
        return text.indexOf('"a"') >= 0 && text.indexOf('"a"') < text.indexOf('"b"')
    }).toBe(true)
})

test('unescape nested JSON opens the decoded payload in a new tab', async () => {
    const before = await editor.locator('.rokdock-tab').count()
    // The whole document is one escaped JSON string literal, so select all and unescape.
    await openTabWith(editor, JSON.stringify('{"a":1}'))
    await sendCommand({ type: 'selectAll' })
    await sendCommand({ type: 'unescapeNested' })
    // +1 for the openTabWith tab, +1 for the new unescaped tab.
    await expect.poll(() => editor.locator('.rokdock-tab').count()).toBe(before + 2)
    await expect.poll(() => docText(editor)).toContain('"a": 1')
})

test('closes cleanly with no main-process errors', async () => {
    const beforeCount = app.windows().length
    await editor.close().catch(() => {})
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
        if (app.windows().length < beforeCount) break
        await new Promise<void>(r => setTimeout(r, 100))
    }
    expect(mainErrors).toEqual([])
})
