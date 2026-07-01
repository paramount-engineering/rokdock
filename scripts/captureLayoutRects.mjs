/**
 * Read the on-screen rectangles of the main-shell panels (by section header
 * text) and write them to .docshots/rects.json. Used to place numbered callout
 * markers on the overview "anatomy" figure at exact coordinates. Fast: launches,
 * reads rects, closes (no screenshotting).
 *
 * Usage: env -u ELECTRON_RUN_AS_NODE node scripts/captureLayoutRects.mjs
 */

import fs from 'fs'
import path from 'path'
import { launchBuiltApp, root } from './launchBuiltApp.mjs'

const { app, main } = await launchBuiltApp()

const rects = await main.evaluate(() => {
    const out = { sections: {}, viewport: { w: window.innerWidth, h: window.innerHeight } }
    // The container of a section is the parent div that also holds the section body.
    document.querySelectorAll('.rokdock-section-header span').forEach((span) => {
        const label = (span.textContent || '').trim()
        const panel = span.closest('.rokdock-section-header')?.parentElement
        const el = panel ?? span
        const r = el.getBoundingClientRect()
        if (label) out.sections[label] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    })
    return out
})

fs.writeFileSync(path.join(root, '.docshots', 'rects.json'), JSON.stringify(rects, null, 2))
process.stdout.write(JSON.stringify(rects, null, 2) + '\n')
await app.close().catch(() => {})
