/**
 * Capture the documentation screenshots that need a reachable Roku PRESENT (but
 * not a live debug stream or a dev-channel screenshot):
 *
 *   device-card-connected  - a discovered device card, expanded, with its actions
 *   remote-live            - the Remote panel with a device selected (enabled)
 *   deeplinks-live         - the Deeplinks panel populated, with a device selected
 *   script-editor-running  - a delay-only script mid-run (delay steps skip the
 *                            device ping, so the active step + execution log render)
 *
 * These are split from captureDocScreenshots.mjs because they require a real device
 * on the network. Run this only when a Roku is reachable. The remaining gated shots
 * (terminal debug output, the device screenshot preview + overlay, and the live HDMI
 * capture feed) need a dev-channel session, saved credentials, or capture hardware
 * and are not produced here.
 *
 * Device selection: set ROKDOCK_DOC_DEVICE_IP to target a specific device (it is
 * added explicitly if discovery misses it); otherwise the first reachable discovered
 * device is used. If no device is found, the script logs and exits without failing.
 *
 * Usage: npm run build, then:
 *   env -u ELECTRON_RUN_AS_NODE ROKDOCK_DOC_DEVICE_IP=192.168.1.50 node scripts/captureDeviceDocScreenshots.mjs
 */
import fs from 'fs'
import path from 'path'
import { launchBuiltApp, root } from './launchBuiltApp.mjs'
import { SAMPLE_DEEPLINKS } from './docCaptureFixtures.mjs'

const outDir = path.join(root, '.docshots')
fs.mkdirSync(outDir, { recursive: true })
const log = (s) => process.stdout.write(s + '\n')
const requestedIp = process.env.ROKDOCK_DOC_DEVICE_IP || null

const { app, main } = await launchBuiltApp()
await main.locator('#boot-splash').waitFor({ state: 'hidden', timeout: 25000 }).catch(() => {})

// Seed sample deeplinks so the Deeplinks panel is populated.
await main.evaluate((deeplinks) => window.rokdock.deeplinks.saveAll(deeplinks), SAMPLE_DEEPLINKS).catch(() => {})

// Resolve the target device: an explicitly requested IP (added if missing), else the
// first reachable discovered device.
if (requestedIp) {
    await main.evaluate((ip) => window.rokdock.discovery.addManual(ip), requestedIp).catch(() => {})
}
const target = await main.evaluate(async (ip) => {
    for (let i = 0; i < 30; i++) {
        const list = await window.rokdock.discovery.getDevices()
        const match = ip ? list.find(d => d.ip === ip) : list.find(d => d.reachable) || list[0]
        if (match && (match.reachable || i > 8)) return match
        await new Promise(r => setTimeout(r, 1000))
    }
    const list = await window.rokdock.discovery.getDevices()
    return ip ? list.find(d => d.ip === ip) : list[0]
}, requestedIp)

if (!target) {
    log('no reachable device found; skipping device-dependent doc screenshots')
    await app.close().catch(() => {})
    process.exit(0)
}
const deviceIp = target.ip
log(`using device ${target.name}@${deviceIp}${target.reachable ? ' (online)' : ' (offline)'}`)

// Reload so the seeded deeplinks render, then wait for the device to reappear.
await main.reload()
await main.waitForLoadState('domcontentloaded')
await main.locator('#boot-splash').waitFor({ state: 'hidden', timeout: 25000 }).catch(() => {})
await main.evaluate(async (ip) => {
    for (let i = 0; i < 30; i++) {
        const list = await window.rokdock.discovery.getDevices()
        if (list.some(d => d.ip === ip)) return
        await new Promise(r => setTimeout(r, 1000))
    }
}, deviceIp)
await main.waitForTimeout(800)

const cardLabel = target.name && target.name !== deviceIp ? target.name : deviceIp

// device-card-connected: expand the card, capture the device panel.
try {
    await main.getByText(cardLabel, { exact: false }).first().click({ timeout: 5000 })
    await main.waitForTimeout(500)
    const box = await main.evaluate(() => {
        const accent = [...document.querySelectorAll('span')].find(s => /active connection/.test(s.textContent || ''))
        const container = accent ? accent.closest('div')?.parentElement : null
        if (!container) return null
        const r = container.getBoundingClientRect()
        return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
    })
    if (box) {
        await main.screenshot({ path: path.join(outDir, 'device-card-connected.png'), clip: box })
        log('captured device-card-connected')
    } else { log('device panel container not found') }
} catch (e) { log('device-card: ' + String(e).split('\n')[0]) }

// terminal-live: connect to the BrightScript Debug port and capture the terminal
// column. The card is already expanded from the step above. Meaningful output
// (the syntax-highlighted debugger) requires an app actively running or paused on
// the device; an idle device connects but streams little.
try {
    await main.getByText('BrightScript Debug', { exact: true }).first().click({ timeout: 5000 })
    await main.waitForTimeout(9000)
    const clip = await main.evaluate(() => {
        const bar = document.querySelector('.rokdock-tab-bar')
        if (!bar) return null
        const r = bar.getBoundingClientRect()
        return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(window.innerHeight - r.y) }
    })
    if (clip && clip.width > 0) {
        await main.screenshot({ path: path.join(outDir, 'terminal-live.png'), clip })
        log('captured terminal-live')
    } else { log('terminal tab bar not found; skipping terminal-live') }
} catch (e) { log('terminal-live: ' + String(e).split('\n')[0]) }

// remote-live: select the device, capture the Remote section.
try {
    const deviceSelect = main.locator('select').filter({ has: main.locator('option', { hasText: 'Select device...' }) }).first()
    await deviceSelect.selectOption(deviceIp, { timeout: 5000 })
    await main.waitForTimeout(700)
    await main.locator('.rokdock-section-header').filter({ hasText: 'Remote' }).locator('xpath=..')
        .screenshot({ path: path.join(outDir, 'remote-live.png') })
    log('captured remote-live')
} catch (e) { log('remote-live: ' + String(e).split('\n')[0]) }

// deeplinks-live: capture the Deeplinks section (device still selected).
try {
    await main.locator('.rokdock-section-header').filter({ hasText: 'Deeplinks' }).locator('xpath=..')
        .screenshot({ path: path.join(outDir, 'deeplinks-live.png') })
    log('captured deeplinks-live')
} catch (e) { log('deeplinks-live: ' + String(e).split('\n')[0]) }

// script-editor-running: a delay-led script runs without a device ping, so the
// active-step highlight and execution log render with only a selected device.
try {
    const winPromise = app.waitForEvent('window', { timeout: 7500 }).catch(() => null)
    await main.evaluate((ip) => window.rokdock.scriptEditor.open({
        name: 'Smoke test loop',
        steps: [
            { type: 'press', key: 'Home' },
            { type: 'delay', durationMs: 8000 },
            { type: 'launch', channelId: 'dev' },
            { type: 'delay', durationMs: 8000 },
            { type: 'screenshot' },
        ],
        themeMode: 'dark',
        deviceIp: ip,
    }), deviceIp)
    const scriptWin = await winPromise
    if (scriptWin) {
        await scriptWin.waitForLoadState('domcontentloaded').catch(() => {})
        await scriptWin.waitForTimeout(1500)
        await scriptWin.locator('select').first().selectOption(deviceIp, { timeout: 3000 }).catch(() => {})
        await scriptWin.waitForTimeout(500)
        await scriptWin.getByRole('button', { name: /play|run/i }).first().click({ timeout: 3000 }).catch(async () => {
            await scriptWin.locator('[title*="Play" i], [title*="Run" i]').first().click({ timeout: 3000 }).catch(() => {})
        })
        await scriptWin.waitForTimeout(2500)
        await scriptWin.screenshot({ path: path.join(outDir, 'script-editor-running.png') })
        log('captured script-editor-running')
    } else { log('script editor did not open') }
} catch (e) { log('script-editor-running: ' + String(e).split('\n')[0]) }

log('DEVICE CAPTURE DONE -> ' + outDir)
await app.close().catch(() => {})
