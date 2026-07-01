// Generate PNG icons from SVG source using Electron offscreen rendering
// Run: npx electron scripts/generate-icons.js

const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')

const SIZES = [16, 32, 48, 64, 128, 256, 512]
const RENDER_SIZE = 512

app.whenReady().then(async () => {
    const iconsDir = path.join(__dirname, '..', 'resources', 'icons')
    const svgPath = path.join(iconsDir, 'icon.svg').replace(/\\/g, '/')

    const win = new BrowserWindow({
        width: RENDER_SIZE,
        height: RENDER_SIZE,
        show: false,
        frame: false,
        transparent: true,
        webPreferences: { offscreen: true }
    })

    const html = `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; }
  html, body { width: ${RENDER_SIZE}px; height: ${RENDER_SIZE}px; overflow: hidden; background: transparent; }
  img { width: ${RENDER_SIZE}px; height: ${RENDER_SIZE}px; display: block; }
</style></head><body>
<img src="file:///${svgPath}" />
</body></html>`

    const tmpFile = path.join(os.tmpdir(), 'rokdock-icon-render.html')
    fs.writeFileSync(tmpFile, html)

    await win.loadFile(tmpFile)
    await new Promise(resolve => setTimeout(resolve, 1500))

    const fullImage = await win.webContents.capturePage()
    const fullPng = fullImage.toPNG()
    console.log(`Captured ${RENDER_SIZE}px source (${fullPng.length} bytes)`)

    // Save full 512px
    fs.mkdirSync(iconsDir, { recursive: true })
    fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), fullPng)
    console.log('Generated icon-512.png')

    // Resize to all other sizes
    for (const size of SIZES) {
        if (size === RENDER_SIZE) continue
        const resized = fullImage.resize({ width: size, height: size, quality: 'best' })
        const png = resized.toPNG()
        fs.writeFileSync(path.join(iconsDir, `icon-${size}.png`), png)
        console.log(`Generated icon-${size}.png (${png.length} bytes)`)
    }

    // Copy 512px as main icon.png for macOS .icns generation
    fs.copyFileSync(
        path.join(iconsDir, 'icon-512.png'),
        path.join(iconsDir, 'icon.png')
    )
    console.log('Copied icon-512.png -> icon.png')

    // Build a Windows .ico from the generated PNG sizes
    const icoInputPaths = [16, 24, 32, 48, 64, 128, 256]
        .map(size => path.join(iconsDir, `icon-${size}.png`))
        .filter(fs.existsSync)
    if (icoInputPaths.length === 0) {
        throw new Error('No PNG icon sizes found for .ico generation.')
    }
    const { default: pngToIco } = await import('png-to-ico')
    const icoBuffer = await pngToIco(icoInputPaths)
    fs.writeFileSync(path.join(iconsDir, 'icon.ico'), icoBuffer)
    console.log('Generated icon.ico')

    // Compose per-tool launcher icons: base render plus a corner badge.
    const launchers = require('../src/shared/toolLaunchers.json')
    const toolIconsDir = path.join(__dirname, '..', 'build', 'tool-icons')
    fs.mkdirSync(toolIconsDir, { recursive: true })
    // Runtime per-tool window icons ship in resources (via the files: resources/** rule)
    // so createToolWindow can use them as the BrowserWindow icon on Windows and Linux.
    const resToolIconsDir = path.join(iconsDir, 'tools')
    fs.mkdirSync(resToolIconsDir, { recursive: true })
    const TOOL_ICO_SIZES = [16, 32, 48, 64, 128, 256]

    // Per-tool badge pill, drawn as inline SVG over the base icon. The label font is
    // auto-fit to the pill width and optically centered (see the measurement below).
    const BADGE_W = 248
    const BADGE_H = 156
    // Badge labels use the bundled proportional Inter (loaded via @font-face) so words
    // like "JSON" kern naturally. A monospace fallback gives every glyph equal advance,
    // which leaves an ugly gap after narrow letters like J.
    const interFontPath = path.join(__dirname, '..', 'resources', 'fonts', 'Inter-SemiBold.woff2').replace(/\\/g, '/')
    for (const tool of launchers) {
        const badgeText = tool.badge.replace(/&/g, '&amp;').replace(/</g, '&lt;')
        const badgeHtml = `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @font-face { font-family: 'Inter'; src: url('file:///${interFontPath}') format('woff2'); font-weight: 600; }
  html, body { width: ${RENDER_SIZE}px; height: ${RENDER_SIZE}px; overflow: hidden; background: transparent; position: relative; }
  .base { width: ${RENDER_SIZE}px; height: ${RENDER_SIZE}px; display: block; }
  .badge { position: absolute; right: 12px; bottom: 12px; }
</style></head><body>
  <img class="base" src="file:///${svgPath}" />
  <svg class="badge" width="${BADGE_W}" height="${BADGE_H}" viewBox="0 0 ${BADGE_W} ${BADGE_H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="6" y="6" width="${BADGE_W - 12}" height="${BADGE_H - 12}" rx="34" ry="34" fill="#1f6feb" stroke="#0d1117" stroke-width="10"/>
    <text id="badgeText" x="${BADGE_W / 2}" y="${BADGE_H / 2}" text-anchor="middle" font-family="'Inter', sans-serif" font-weight="600" font-size="92" fill="#ffffff">${badgeText}</text>
  </svg>
</body></html>`
        const badgeFile = path.join(os.tmpdir(), `rokdock-tool-${tool.key}.html`)
        fs.writeFileSync(badgeFile, badgeHtml)
        await win.loadFile(badgeFile)
        await new Promise(resolve => setTimeout(resolve, 800))
        // Fit the badge text to the pill width, then optically center it by its true
        // ink bounds. SVG getBBox returns the font metric box (content-independent), so
        // glyphs with no descender ride high. Canvas measureText gives the actual
        // per-glyph ink ascent/descent and the real text width for the auto-fit.
        await win.webContents.executeJavaScript(`(async () => {
            await document.fonts.load("600 92px 'Inter'")
            await document.fonts.ready
            const t = document.getElementById('badgeText')
            const ctx = document.createElement('canvas').getContext('2d')
            const MAX_TEXT_W = 192
            let size = 92
            ctx.font = "600 " + size + "px 'Inter', sans-serif"
            const w = ctx.measureText(t.textContent).width
            if (w > MAX_TEXT_W) { size = Math.floor(size * MAX_TEXT_W / w); t.setAttribute('font-size', size) }
            ctx.font = "600 " + size + "px 'Inter', sans-serif"
            const m = ctx.measureText(t.textContent)
            const dy = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2
            t.setAttribute('transform', 'translate(0,' + dy + ')')
        })()`)
        await new Promise(resolve => setTimeout(resolve, 60))
        const composed = await win.webContents.capturePage()

        // Per-tool PNGs at the hicolor sizes (consumed by the deb, the macOS .icns, and
        // the Windows .ico). Every consumer reads a sized name, so no unsized alias.
        for (const size of [16, 32, 48, 64, 128, 256, 512]) {
            const png = composed.resize({ width: size, height: size, quality: 'best' }).toPNG()
            fs.writeFileSync(path.join(toolIconsDir, `${tool.key}-${size}.png`), png)
        }
        // Runtime window icon shipped in resources (used by createToolWindow per tool).
        fs.copyFileSync(path.join(toolIconsDir, `${tool.key}-512.png`), path.join(resToolIconsDir, `${tool.key}.png`))

        // Windows .ico from the composed sizes (pngToIco was imported for the base icon).
        const icoInputs = TOOL_ICO_SIZES
            .map(s => path.join(toolIconsDir, `${tool.key}-${s}.png`))
            .filter(fs.existsSync)
        fs.writeFileSync(path.join(toolIconsDir, `${tool.key}.ico`), await pngToIco(icoInputs))
        fs.unlinkSync(badgeFile)
        console.log(`Composed tool icon: ${tool.key}`)
    }

    win.destroy()
    fs.unlinkSync(tmpFile)
    app.quit()
})
