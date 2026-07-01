/**
 * Production CSP assertion: the shipped renderer HTML must NOT grant inline
 * scripts. The Vite build plugin (tightenCspPlugin) strips 'unsafe-inline' from
 * script-src at build time. This spec is the deterministic regression net for
 * that. It reads the built out/renderer/*.html directly (no Electron launch), so
 * it depends on a prior `npm run build` (npm run test:e2e builds first).
 *
 * style-src 'unsafe-inline' is intentionally retained (inline FOUC + boot-splash
 * styles). This spec asserts it survives so a future over-broad tightening is caught.
 */
import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const RENDERER_OUT = path.join(__dirname, '..', '..', 'out', 'renderer')

// All seven renderer entries that carry a CSP meta tag.
const ENTRIES = [
    'index.html',
    'jsonEditor.html',
    'ninepatchEditor.html',
    'svgConverter.html',
    'scriptEditor.html',
    'capturePreview.html',
    'screenshotPreview.html'
]

/**
 * Pulls the CSP policy string out of a built HTML file. Matches the
 * Content-Security-Policy <meta> tag regardless of attribute order or wrapping
 * whitespace, then extracts its content="..." value.
 */
function extractCsp(html: string): string | null {
    const meta = html.match(/<meta[^>]*Content-Security-Policy[^>]*>/i)
    if (!meta) return null
    const content = meta[0].match(/content="([^"]*)"/i)
    return content ? content[1] : null
}

for (const entry of ENTRIES) {
    test(`prod CSP for ${entry}: script-src is 'self' with no 'unsafe-inline'`, () => {
        const html = fs.readFileSync(path.join(RENDERER_OUT, entry), 'utf-8')
        const csp = extractCsp(html)
        expect(csp, `${entry} should have a Content-Security-Policy meta tag`).not.toBeNull()
        // script-src is tightened: 'self' present, the inline grant gone.
        expect(csp).toContain("script-src 'self'")
        expect(csp).not.toContain("script-src 'self' 'unsafe-inline'")
        // style-src is deliberately left untouched.
        expect(csp).toContain("style-src 'self' 'unsafe-inline'")
    })
}

test('prod CSP preserves the per-window media-src directives', () => {
    const capture = extractCsp(fs.readFileSync(path.join(RENDERER_OUT, 'capturePreview.html'), 'utf-8')) ?? ''
    expect(capture).toContain("media-src 'self' blob:")
    const screenshot = extractCsp(fs.readFileSync(path.join(RENDERER_OUT, 'screenshotPreview.html'), 'utf-8')) ?? ''
    expect(screenshot).toContain("media-src 'self' mediastream:")
})
