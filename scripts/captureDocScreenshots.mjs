/**
 * Capture documentation screenshots of the device-independent UI surfaces.
 *
 * Drives the built Electron app with Playwright and writes raw PNGs (plus a
 * boxes.json of element bounding boxes for later annotation) to .docshots/.
 * Device-dependent states (live terminal, capture feed, real screenshot preview)
 * require a real Roku and are not captured here.
 *
 * Usage: npm run build (so out/ is current), then:
 *   env -u ELECTRON_RUN_AS_NODE node scripts/captureDocScreenshots.mjs
 */

import fs from 'fs'
import path from 'path'
import { launchBuiltApp, root } from './launchBuiltApp.mjs'
import { SAMPLE_DEEPLINKS } from './docCaptureFixtures.mjs'

const outDir = path.join(root, '.docshots')
fs.mkdirSync(outDir, { recursive: true })

const log = (s) => process.stdout.write(s + '\n')
const boxes = {}

const { app, main } = await launchBuiltApp()

// Seed sample deeplinks so the Deeplinks settings tab is populated (and matches the
// Deeplinks panel figure captured by captureDeviceDocScreenshots.mjs).
await main.evaluate((deeplinks) => window.rokdock.deeplinks.saveAll(deeplinks), SAMPLE_DEEPLINKS).catch(() => {})
await main.waitForTimeout(500)

async function shot(page, name) {
    await page.screenshot({ path: path.join(outDir, `${name}.png`) })
    log('captured ' + name)
}

/** Screenshot a single element (tight crop, no dimmed page background). */
async function shotEl(page, selector, name) {
    await page.locator(selector).first().screenshot({ path: path.join(outDir, `${name}.png`) })
    log('captured ' + name)
}

/** Record the bounding box of a locator (best-effort) for later annotation. */
async function recordBox(page, key, locator) {
    try {
        const b = await locator.boundingBox()
        if (b) boxes[key] = b
    } catch { /* element not present */ }
}

// 1. Main shell (dark) + bounding boxes of the major regions.
await shot(main, 'main-shell-dark')
await recordBox(main, 'devices', main.getByText('Devices', { exact: true }).locator('xpath=ancestor::*[1]'))
await recordBox(main, 'fileMenu', main.getByRole('button', { name: 'File' }))
await recordBox(main, 'themeToggle', main.getByRole('button', { name: /toggle light and dark mode/i }))

// 2. Add-device dialog (best-effort: click an add control in the device panel).
try {
    const addBtn = main.getByRole('button', { name: /add device|add a device/i }).first()
    await addBtn.click({ timeout: 4000 })
    await main.waitForTimeout(600)
    await shotEl(main, '.rokdock-dialog', 'add-device-dialog')
    await main.keyboard.press('Escape').catch(() => {})
    await main.waitForTimeout(300)
} catch (e) { log('add-device dialog: skipped (' + String(e).split('\n')[0] + ')') }

// 3. Settings dialog - capture each tab.
try {
    await main.getByRole('button', { name: 'File' }).click()
    await main.waitForTimeout(200)
    // /^Settings\.\.\./ (not /^Settings/) so this matches the "Settings..." menu
    // item and not the device-panel gear icon, whose label also starts "Settings".
    await main.getByRole('button', { name: /^Settings\.\.\./ }).click({ force: true })
    await main.locator('.rokdock-dialog-header .rokdock-title').waitFor({ state: 'visible', timeout: 8000 })
    await main.waitForTimeout(400)
    // Enumerate tab buttons by their visible labels and capture the dialog element.
    // The label is what the tab button shows; name is the output filename ("AI (Beta)"
    // is not a valid file basename, so it maps to settings-ai).
    const settingsTabs = [
        { label: 'Appearance', name: 'appearance' },
        { label: 'Devices', name: 'devices' },
        { label: 'Remote', name: 'remote' },
        { label: 'Deeplinks', name: 'deeplinks' },
        { label: 'Capture', name: 'capture' },
        { label: 'AI (Beta)', name: 'ai' },
        { label: 'Advanced', name: 'advanced' },
    ]
    for (const { label, name } of settingsTabs) {
        try {
            const tab = main.getByRole('button', { name: label, exact: true })
            await tab.click({ timeout: 3000 })
            await main.waitForTimeout(400)
            // The AI tab needs its add-provider form open to be a useful figure.
            if (name === 'ai') {
                await main.getByTestId('ai-show-add-form').click({ timeout: 2000 }).catch(() => {})
                await main.waitForTimeout(300)
            }
            await shotEl(main, '.rokdock-dialog', `settings-${name}`)
        } catch { log('settings tab skipped: ' + label) }
    }
    // Close the dialog.
    await main.locator('.rokdock-dialog-header button').first().click().catch(() => {})
    await main.waitForTimeout(300)
} catch (e) { log('settings: skipped (' + String(e).split('\n')[0] + ')') }

// 4. Tool windows (device-independent). Open via the preload bridge, capture.
// The opener runs in the page, so it calls window.rokdock directly; passing it
// as a function (not an eval'd string) keeps it syntax-checked at author time.
async function captureToolWindow(name, openFn, arg, settleMs = 1200) {
    const winPromise = app.waitForEvent('window', { timeout: 7500 }).catch(() => null)
    try {
        await main.evaluate(openFn, arg)
    } catch (e) {
        log(`tool window opener failed for ${name}: ${String(e).split('\n')[0]}`)
    }
    const win = await winPromise
    if (!win) { log('tool window did not open: ' + name); return }
    await win.waitForLoadState('domcontentloaded').catch(() => {})
    await win.waitForTimeout(settleMs) // let editor / fetched content render before capture
    await shot(win, name)
    // Leave it open (editors prompt a discard dialog on close); app.close() handles teardown.
}

const sampleJson = JSON.stringify({
    apps: [
        { id: '12', name: 'Netflix', type: 'appl', version: '7.12.0' },
        { id: '13', name: 'Prime Video', type: 'appl', version: '11.3.2025' }
    ],
    activeApp: { id: '12', name: 'Netflix' },
    device: { model: 'Roku Ultra', serial: 'YH00XXXXXXXX', softwareVersion: '13.0.0' }
}, null, 2)

await captureToolWindow('tool-json-editor', (json) => window.rokdock.json.addTab(json), sampleJson)
await captureToolWindow('tool-svg-converter', () => window.rokdock.svgExporter.openEditor('dark'))
await captureToolWindow('tool-ninepatch-editor', () => window.rokdock.ninepatch.openEditor('dark'))
await captureToolWindow('tool-script-editor', () => window.rokdock.scriptEditor.open({
    name: 'Launch and verify Netflix',
    steps: [
        { type: 'press', key: 'Home' },
        { type: 'delay', durationMs: 1500 },
        { type: 'launch', channelId: '12' },
        { type: 'delay', durationMs: 3000 },
        { type: 'screenshot' },
        { type: 'waitPlayerState', state: 'play', timeoutMs: 10000 }
    ],
    themeMode: 'dark'
}))

// 4b. Developer Docs window. Needs network to populate the tree, which can take
// longer than a fixed settle, so wait for the Browse tree, then open a leaf page
// so the reading pane renders real content. If offline the tree never loads and
// the capture is skipped (the doc still reads fine without the figure).
{
    const winPromise = app.waitForEvent('window', { timeout: 7500 }).catch(() => null)
    await main.evaluate(() => window.rokdock.docs.open('dark')).catch(() => {})
    const docsWin = await winPromise
    if (!docsWin) {
        log('developer docs window did not open')
    } else {
        await docsWin.waitForLoadState('domcontentloaded').catch(() => {})
        let treeLoaded = false
        try {
            await docsWin.locator('.docs-tree-row, .docs-nav-row').first().waitFor({ state: 'visible', timeout: 30000 })
            treeLoaded = true
        } catch { log('developer docs tree did not load within 30s (network restricted?)') }
        if (treeLoaded) {
            // Top-level categories are expand-only; expand FEATURES then open a leaf.
            try {
                await docsWin.getByText('FEATURES', { exact: true }).first().click({ timeout: 4000 })
                await docsWin.waitForTimeout(600)
                await docsWin.getByText('Roku platform overview', { exact: true }).first().click({ timeout: 4000 })
                await docsWin.locator('.docs-prose').first().waitFor({ state: 'visible', timeout: 15000 })
                await docsWin.waitForTimeout(1000)
            } catch (e) { log('developer docs leaf page not opened: ' + String(e).split('\n')[0]) }
            await shot(docsWin, 'tool-developer-docs')

            // Sub-states the docs feature adds: full-text search, the find bar over a
            // result, and the What's New feed (the last needs the GitHub compare API).
            const docsSearch = docsWin.locator('.docs-sidebar-search')
            try {
                await docsSearch.click()
                await docsSearch.fill('deeplink')
                await docsWin.locator('.docs-search-result').first().waitFor({ state: 'visible', timeout: 20000 })
                await docsWin.waitForTimeout(500)
                await shot(docsWin, 'docs-search')
                await docsWin.locator('.docs-search-result').first().click({ timeout: 4000 })
                await docsWin.locator('.docs-find-bar').waitFor({ state: 'visible', timeout: 15000 })
                await docsWin.waitForTimeout(700)
                await shot(docsWin, 'docs-find-bar')
            } catch (e) { log('docs search/find-bar skipped: ' + String(e).split('\n')[0]) }
            try {
                await docsSearch.fill('')
                await docsWin.locator('.docs-whatsnew-entry').click({ timeout: 4000 })
                await docsWin.locator('.docs-whatsnew-group, .docs-whatsnew-message:not(:has-text("Loading"))').first()
                    .waitFor({ state: 'visible', timeout: 30000 })
                await docsWin.waitForTimeout(800)
                await shot(docsWin, 'docs-whats-new')
            } catch (e) { log("docs what's-new skipped: " + String(e).split('\n')[0]) }
        }
    }
}

// 5. Light theme main shell (toggle, capture, toggle back).
try {
    const toggle = main.getByRole('button', { name: /toggle light and dark mode/i })
    await toggle.click({ timeout: 4000 })
    await main.waitForTimeout(700)
    await shot(main, 'main-shell-light')
    await toggle.click().catch(() => {})
    await main.waitForTimeout(400)
} catch (e) { log('theme toggle: skipped (' + String(e).split('\n')[0] + ')') }

fs.writeFileSync(path.join(outDir, 'boxes.json'), JSON.stringify(boxes, null, 2))
log('boxes.json written with keys: ' + Object.keys(boxes).join(', '))

// 6. AI Chat panel. The panel renders only when a provider is active, so activate
// the first available provider (a detected CLI in most environments) and reload so
// boot recomputes availability, then expand and capture the panel. Done last
// because it reloads the main window and changes the shell (the AI panel appears).
// Captures only the panel chrome; a real conversation needs a working provider.
try {
    const activated = await main.evaluate(async () => {
        await window.rokdock.ai.refreshCliDetection()
        const list = await window.rokdock.ai.listProfiles()
        if (!list.length) return null
        await window.rokdock.ai.setActive(list[0].id)
        return list[0].name
    })
    if (!activated) {
        log('AI panel skipped: no provider available to activate')
    } else {
        await main.reload()
        await main.waitForLoadState('domcontentloaded')
        await main.getByText('Devices', { exact: true }).first().waitFor({ state: 'visible', timeout: 20000 })
        await main.waitForTimeout(800)
        const panel = main.locator('[data-testid="ai-chat-panel"]')
        await panel.waitFor({ state: 'visible', timeout: 8000 })
        await main.getByText('AI Chat', { exact: false }).first().click({ timeout: 4000 }).catch(() => {})
        await main.waitForTimeout(600)
        await shotEl(main, '[data-testid="ai-chat-panel"]', 'ai-chat-panel')
    }
} catch (e) { log('AI panel skipped: ' + String(e).split('\n')[0]) }

log('CAPTURE DONE -> ' + outDir)
await app.close().catch(() => {})
