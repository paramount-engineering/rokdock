/**
 * E2E regression: the 9-patch shape fill must not bleed into or past the border at a rounded corner.
 *
 * The border used to be drawn as an inner stroke, whose anti-aliased inner edge sat over the fill,
 * so the fill bled through the border at the corner (worst at the arc shoulders, where the arc
 * meets the straight edges). An earlier fix that only scanned the 45-degree diagonal missed this,
 * because the shoulders bleed while the diagonal looks fine. The border is now a solid concentric
 * ring, so it is a uniform width all the way around the corner.
 *
 * This sweeps rays from the corner's arc center outward across the whole quarter arc (shoulders
 * included) and asserts, at every angle, that walking inward from outside crosses a border band of
 * roughly the configured width before reaching the fill, and that no fill color appears outside it.
 *
 * Verified as a real negative control: against the old inner-stroke border the shoulder rays fail
 * (the black band collapses to a sliver as the fill bleeds across it); against the ring it passes.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { launchRokDock, openToolWindow } from './helpers'

let app: ElectronApplication
let mainWin: Page

const RADIUS = 40
const BORDER = 8

test.beforeAll(async () => {
    const launched = await launchRokDock()
    app = launched.app
    mainWin = launched.mainWin
})

test.afterAll(async () => { await app.close() })

test('9-patch: the border is a uniform ring at a rounded corner, with no fill bleed', async () => {
    const win = await openToolWindow(app, mainWin, () => window.rokdock.ninepatch.openEditor('dark'))

    // Red fill, black border, large rounded corner (outer padding 0 so the shape sits at the origin).
    await win.evaluate((cfg) => {
        const set = (id: string, value: string): void => {
            const input = document.getElementById(id) as HTMLInputElement
            input.value = value
            input.dispatchEvent(new Event('input', { bubbles: true }))
        }
        set('shapeWidth', '200'); set('shapeHeight', '200')
        set('cornerRadius', String(cfg.radius)); set('borderWidth', String(cfg.border))
        set('fillColor', '#ff0000'); set('borderColor', '#000000')
        const borderToggle = document.getElementById('borderToggle') as HTMLButtonElement
        if (!borderToggle.classList.contains('on')) borderToggle.click()
    }, { radius: RADIUS, border: BORDER })

    // Sweep rays from the top-left corner's arc center (radius, radius) across the full quarter arc.
    // Each ray walks inward; the sequence must be background -> border -> fill, with the border band
    // at least ~60% of the configured width (a bled corner collapses that band to a sliver).
    const sweep = (radius: number, border: number): Promise<{ angle: number; blackRun: number; reddishBeforeBlack: boolean }[]> =>
        win.evaluate((cfg) => {
            const canvas = document.getElementById('editorCanvas') as HTMLCanvasElement
            const ctx = canvas.getContext('2d')!
            const span = cfg.radius + 8
            const pixels = ctx.getImageData(0, 0, span, span).data
            const at = (px: number, py: number): [number, number, number, number] => {
                if (px < 0 || py < 0 || px >= span || py >= span) return [0, 0, 0, 0]
                const offset = (py * span + px) * 4
                return [pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]]
            }
            const results: { angle: number; blackRun: number; reddishBeforeBlack: boolean }[] = []
            for (let deg = 0; deg <= 90; deg += 10) {
                const rad = (deg * Math.PI) / 180
                const dx = -Math.cos(rad), dy = -Math.sin(rad) // up-left quadrant, canvas y grows down
                let blackRun = 0
                let sawBlack = false
                let reddishBeforeBlack = false
                // Walk inward from just outside the outer edge to just inside the inner edge.
                for (let dist = cfg.radius + 4; dist >= cfg.radius - cfg.border - 4; dist -= 1) {
                    const px = Math.round(cfg.radius + dx * dist)
                    const py = Math.round(cfg.radius + dy * dist)
                    const [r, g, b, a] = at(px, py)
                    const reddish = a > 30 && r > g + 30 && r > b + 30
                    const solidBlack = a > 120 && r < 90 && g < 90 && b < 90
                    if (solidBlack) { sawBlack = true; blackRun++ }
                    if (reddish && !sawBlack) reddishBeforeBlack = true
                }
                results.push({ angle: deg, blackRun, reddishBeforeBlack })
            }
            return results
        }, { radius, border })

    // Poll until the render is up (the straight-edge ray at 0 degrees shows a full border band).
    await expect.poll(async () => (await sweep(RADIUS, BORDER))[0].blackRun, { timeout: 10_000 }).toBeGreaterThan(0)
    const rays = await sweep(RADIUS, BORDER)

    for (const ray of rays) {
        expect(ray.reddishBeforeBlack, `fill bleeds outside the border at ${ray.angle} deg`).toBe(false)
        expect(ray.blackRun, `border band too thin at ${ray.angle} deg (fill bled into it)`).toBeGreaterThanOrEqual(BORDER * 0.6)
    }

    await win.close().catch(() => {})
})
