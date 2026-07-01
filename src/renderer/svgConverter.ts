import { bootBundledTheme } from '@shared/entryBootstrap'
import './appearanceModalTrigger'
import { createToast } from '@shared/toast'
import type { SvgConverterCommand } from '@shared/toolWindowCommands'
import './svgConverter.css'

// Apply theme vars and await fonts before the body is revealed.
// This runs concurrently with the synchronous setup below; the body remains
// hidden (via .rokdock-theme-pending on <html>) until bootBundledTheme resolves.
void bootBundledTheme()
import { faUpload, faDownload } from '@fortawesome/free-solid-svg-icons'
import { faSvg } from '@shared/icons'
import { toHex } from './svgConverterColor'

// --- State ---

let svgText: string | null = null            // current render source (recolored copy of the import)
let originalSvgText: string | null = null    // immutable imported source - recolor always derives from this
let colorMap: Record<string, string> = {}   // normalized original color -> override hex (#rrggbb)
let currentColorOverride: string | null = null  // override hex for currentColor, or null to leave as default
let svgUsesCurrentColor = false
let intrinsicWidth = 0
let intrinsicHeight = 0
let fsDitherOn = true
let colorCount = 64
let lightBgOn = false
let renderTimer: ReturnType<typeof setTimeout> | null = null
let quantizeTimer: ReturnType<typeof setTimeout> | null = null
let cleanDataUrl: string | null = null       // clean SVG render - always the quantization source
let quantizedDataUrl: string | null = null   // last quantized result - used directly for export
let zoom = 100

// --- Presets ---
// Preset scale factors relative to FHD (1080p) baseline
const PRESETS: Record<string, number> = {
    '4k':  2,
    fhd: 1,
    hd:  720 / 1080,
    sd:  480 / 1080
}

// --- DOM refs ---
const loadingOverlay  = document.getElementById('loadingOverlay') as HTMLElement
const viewport        = document.getElementById('previewViewport') as HTMLElement
const dropZone        = document.getElementById('dropZone') as HTMLElement
const canvas          = document.getElementById('previewCanvas') as HTMLCanvasElement
const ctx             = canvas.getContext('2d') as CanvasRenderingContext2D
const canvasContainer              = document.getElementById('canvasContainer') as HTMLElement
const zoomSizer       = document.getElementById('canvasZoomSizer') as HTMLElement
const zoomDockWrap    = document.getElementById('zoomDockWrap') as HTMLElement
const zoomDock        = document.getElementById('zoomDock') as HTMLElement
const importBtn       = document.getElementById('importBtn') as HTMLButtonElement
const exportBtn       = document.getElementById('exportBtn') as HTMLButtonElement
const panelExportBtn  = document.getElementById('panelExportBtn') as HTMLButtonElement
const toolbarFilename = document.getElementById('toolbarFilename') as HTMLElement
const previewFooter   = document.getElementById('previewFooter') as HTMLElement
const sourceInfo      = document.getElementById('sourceInfo') as HTMLElement
const sourceDims      = document.getElementById('sourceDims') as HTMLElement
const sizeSection     = document.getElementById('sizeSection') as HTMLElement
const optsSection     = document.getElementById('optsSection') as HTMLElement
const pillRow         = document.getElementById('pillRow') as HTMLElement
const inpW            = document.getElementById('inpW') as HTMLInputElement
const inpH            = document.getElementById('inpH') as HTMLInputElement
const togDither       = document.getElementById('togDither') as HTMLElement
const togLightBg      = document.getElementById('togLightBg') as HTMLElement
const colorPillRow    = document.getElementById('colorPillRow') as HTMLElement
const estSize         = document.getElementById('estSize') as HTMLElement
const colorCollapsible = document.getElementById('colorCollapsible') as HTMLElement
const colorList       = document.getElementById('colorList') as HTMLElement
const resetColorsBtn  = document.getElementById('resetColorsBtn') as HTMLButtonElement
const showToast = createToast(document.getElementById('toast') as HTMLDivElement)

// --- Inject icons ---
importBtn.innerHTML = faSvg(faUpload)
exportBtn.innerHTML = faSvg(faDownload)

const ctxImport = document.getElementById('ctxImport') as HTMLElement
const ctxExport = document.getElementById('ctxExport') as HTMLElement
ctxImport.insertAdjacentHTML('afterbegin', faSvg(faUpload))
ctxExport.insertAdjacentHTML('afterbegin', faSvg(faDownload))

// --- Rendering ---
function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = url
    })
}

async function renderSvg(): Promise<void> {
    if (!svgText) return
    const targetW = parseInt(inpW.value) || 1920
    const targetH = parseInt(inpH.value) || 1080
    const prevW = canvas.width

    const blob = new Blob([svgText], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    try {
        const img = await loadImage(url)
        URL.revokeObjectURL(url)

        const superCanvas = new OffscreenCanvas(targetW * 2, targetH * 2)
        superCanvas.getContext('2d')!.drawImage(img, 0, 0, targetW * 2, targetH * 2)

        canvas.width = targetW
        canvas.height = targetH
        ctx.drawImage(superCanvas, 0, 0, targetW, targetH)

        // Compensate zoom so the visual size stays the same after resolution change
        if (prevW && prevW !== targetW) {
            zoom = Math.max(10, Math.min(1000, zoom * (prevW / targetW)))
            if (Math.abs(zoom - 100) < 3) zoom = 100
        }

        cleanDataUrl = canvas.toDataURL('image/png')
        applyZoom()
        requestAnimationFrame(centerCanvas)
        scheduleQuantize()
    } catch {
        URL.revokeObjectURL(url)
    }
}

function scheduleRender(): void {
    if (renderTimer !== null) clearTimeout(renderTimer)
    renderTimer = setTimeout(renderSvg, 400)
}

// --- Quantize preview ---
let quantizeGen = 0

function scheduleQuantize(): void {
    if (quantizeTimer !== null) clearTimeout(quantizeTimer)
    quantizeTimer = setTimeout(quantizePreview, 300)
}

async function quantizePreview(): Promise<void> {
    if (!svgText || !cleanDataUrl) { estSize.textContent = ''; return }
    const gen = ++quantizeGen
    estSize.textContent = 'Processing...'
    loadingOverlay.classList.add('show')
    quantizedDataUrl = null
    setExportEnabled(false)

    const rawDataUrl = cleanDataUrl
    const result = await window.rokdock.svgExporter.quantize(rawDataUrl, colorCount, fsDitherOn)
    if (gen !== quantizeGen) return // stale result - a newer quantize is in flight
    loadingOverlay.classList.remove('show')
    if (!result.ok || !result.dataUrl) {
        estSize.textContent = ''
        setExportEnabled(false)
        return
    }

    // Draw quantized result into canvas so preview exactly matches export
    try {
        const img = await loadImage(result.dataUrl)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0)
    } catch { /* ignore draw errors */ }

    quantizedDataUrl = result.dataUrl
    const bytes = result.sizeBytes ?? 0
    estSize.textContent = bytes < 1024 ? bytes + ' B' : Math.round(bytes / 1024) + ' KB'
    setExportEnabled(true)
}

// --- Zoom ---
function applyZoom(): void {
    if (!canvas.width) return
    const zf = zoom / 100
    canvasContainer.style.transform = 'scale(' + zf + ')'
    zoomSizer.style.width = (canvas.width * zf) + 'px'
    zoomSizer.style.height = (canvas.height * zf) + 'px'
    zoomDock.setAttribute('value', String(Math.round(zoom)))
    updateCanvasMargin()
}

function updateCanvasMargin(): void {
    const margin = Math.max(200, viewport.clientWidth, viewport.clientHeight)
    const prev = parseInt(zoomSizer.style.margin) || 200
    if (margin === prev) return
    zoomSizer.style.margin = margin + 'px'
    const delta = margin - prev
    viewport.scrollLeft = Math.max(0, viewport.scrollLeft + delta)
    viewport.scrollTop = Math.max(0, viewport.scrollTop + delta)
}

// Re-fit canvas when window is resized
let resizeTimer: ReturnType<typeof setTimeout> | null = null
window.addEventListener('resize', () => {
    updateCanvasMargin()
    if (!svgText) return
    if (resizeTimer !== null) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => zoomFit(), 80)
})

function setZoom(value: number): void {
    const sw = viewport.scrollWidth - viewport.clientWidth
    const sh = viewport.scrollHeight - viewport.clientHeight
    const fx = sw > 0 ? (viewport.scrollLeft / sw) : 0.5
    const fy = sh > 0 ? (viewport.scrollTop / sh) : 0.5
    zoom = Math.max(10, Math.min(1000, value))
    if (Math.abs(zoom - 100) < 3) zoom = 100
    applyZoom()
    const sw2 = viewport.scrollWidth - viewport.clientWidth
    const sh2 = viewport.scrollHeight - viewport.clientHeight
    viewport.scrollLeft = fx * sw2
    viewport.scrollTop = fy * sh2
}

function centerCanvas(): void {
    const margin = parseFloat(zoomSizer.style.margin) || 200
    const zf = zoom / 100
    const cx = margin + (canvas.width / 2) * zf
    const cy = margin + (canvas.height / 2) * zf
    viewport.scrollLeft = Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth, cx - viewport.clientWidth / 2))
    viewport.scrollTop = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, cy - viewport.clientHeight / 2))
}

function zoomFit(): void {
    if (!canvas.width || !canvas.height) return
    const vr = viewport.getBoundingClientRect()
    const cw = canvas.width, ch = canvas.height
    setZoom(Math.max(10, Math.min(1000, Math.min((vr.width - 40) / cw, (vr.height - 40) / ch) * 100)))
    requestAnimationFrame(centerCanvas)
}

// Zoom dock events
zoomDock.addEventListener('rokdock-change', (e) => setZoom((e as CustomEvent<{ value: number }>).detail.value))
zoomDock.addEventListener('rokdock-actual', () => { setZoom(100); requestAnimationFrame(centerCanvas) })
zoomDock.addEventListener('rokdock-fit', zoomFit)

// Ctrl+scroll zoom
viewport.addEventListener('wheel', e => {
    if (!svgText) return
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))
}, { passive: false })

// --- Canvas drag (pan) ---
interface PanState { sx: number; sy: number; sl: number; st: number }
let panState: PanState | null = null
viewport.addEventListener('mousedown', e => {
    if (e.button !== 0 || !svgText) return
    if ((e.target as HTMLElement).closest('.zoom-dock-wrap') || (e.target as HTMLElement).closest('.drop-zone')) return
    panState = { sx: e.clientX, sy: e.clientY, sl: viewport.scrollLeft, st: viewport.scrollTop }
    viewport.classList.add('dragging')
    e.preventDefault()
})
document.addEventListener('mousemove', e => {
    if (!panState) return
    viewport.scrollLeft = panState.sl - (e.clientX - panState.sx)
    viewport.scrollTop = panState.st - (e.clientY - panState.sy)
})
document.addEventListener('mouseup', () => {
    if (panState) { panState = null; viewport.classList.remove('dragging') }
})

// --- Preset pills ---
function setPreset(name: string): void {
    pillRow.querySelectorAll('.pill').forEach(pill => (pill as HTMLElement).classList.toggle('active', (pill as HTMLButtonElement).dataset.preset === name))
    if (PRESETS[name] !== undefined && intrinsicWidth > 0 && intrinsicHeight > 0) {
        const scale = PRESETS[name]
        inpW.value = String(Math.round(intrinsicWidth * scale))
        inpH.value = String(Math.round(intrinsicHeight * scale))
    }
    scheduleRender()
}

pillRow.addEventListener('click', (e) => {
    const pill = (e.target as HTMLElement).closest('.pill') as HTMLButtonElement | null
    if (!pill || !svgText) return
    setPreset(pill.dataset.preset ?? '')
})

// --- W/H inputs ---
function onSizeInput(): void {
    pillRow.querySelectorAll('.pill').forEach(pill => (pill as HTMLElement).classList.toggle('active', (pill as HTMLButtonElement).dataset.preset === 'custom'))
    scheduleRender()
}
inpW.addEventListener('input', onSizeInput)
inpH.addEventListener('input', onSizeInput)

// --- Color count pills ---
function setColorPreset(count: number): void {
    colorCount = count
    colorPillRow.querySelectorAll('.pill').forEach(pill => (pill as HTMLElement).classList.toggle('active', parseInt((pill as HTMLButtonElement).dataset.colors ?? '0') === count))
    scheduleQuantize()
}
colorPillRow.querySelectorAll('.pill').forEach(pill => {
    pill.addEventListener('click', () => setColorPreset(parseInt((pill as HTMLButtonElement).dataset.colors ?? '0')))
})
setColorPreset(64)

// --- FS Dither toggle ---
togDither.addEventListener('rokdock-change', (e) => {
    fsDitherOn = (e as CustomEvent<{ checked: boolean }>).detail.checked
    scheduleQuantize()
})

// --- Light background toggle ---
togLightBg.addEventListener('rokdock-change', (e) => {
    lightBgOn = (e as CustomEvent<{ checked: boolean }>).detail.checked
    viewport.classList.toggle('light-bg', lightBgOn)
})

// --- Recolor ---
// Detect the distinct paint colors in the imported SVG and let the user override
// each one (plus currentColor) before rasterizing. The override is applied to a
// copy derived from originalSvgText, so it is non-destructive and re-editable.
const svgParser = new DOMParser()
const svgSerializer = new XMLSerializer()
const normCtx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D
// Paint properties to scan: [SVG attribute, CSSStyleDeclaration property, invalid-fallback].
// The fallback is the color the browser renders when the value is unparseable - the
// property's SVG initial value. fill and stop-color fall back to black.
// stroke falls back to 'none' (null here), so a malformed stroke renders nothing and is not offered.
const PAINT_PROPS: Array<[string, string, string | null]> = [['fill', 'fill', '#000000'], ['stroke', 'stroke', null], ['stop-color', 'stopColor', '#000000']]
const RESET_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>'

// Canonicalize a CSS/SVG paint value to '#rrggbb', 'rgba(...)', or 'currentColor'.
// Non-paint keywords (none, transparent, url(#...), var(...)) return null. An
// unparseable value (e.g. a malformed hex like #FFFFFFF that Figma can emit) returns
// invalidFallback: the browser renders such a value as the property's initial color,
// so we surface that rendered color as a swappable entry rather than dropping it.
function normalizeColor(value: string | null | undefined, invalidFallback: string | null = null): string | null {
    if (value == null) return null
    const trimmed = String(value).trim()
    if (!trimmed) return null
    const low = trimmed.toLowerCase()
    if (low === 'currentcolor') return 'currentColor'
    if (low === 'none' || low === 'transparent' || low === 'inherit'
        || low === 'context-fill' || low === 'context-stroke'
        || low.indexOf('url(') === 0 || low.indexOf('var(') === 0) return null
    // Two-sentinel trick: an invalid value leaves fillStyle at the prior value,
    // so reading back from two different sentinels yields two different results.
    normCtx.fillStyle = '#000000'; normCtx.fillStyle = trimmed; const fromBlack = normCtx.fillStyle
    normCtx.fillStyle = '#ffffff'; normCtx.fillStyle = trimmed; const fromWhite = normCtx.fillStyle
    if (fromBlack !== fromWhite) return invalidFallback
    return fromBlack
}

function hasOverrides(): boolean {
    return Object.keys(colorMap).length > 0 || !!currentColorOverride
}

// Scan all elements' paint attributes and inline styles for distinct colors.
function extractColors(svg: string): { colors: string[]; usesCurrent: boolean } {
    const doc = svgParser.parseFromString(svg, 'image/svg+xml')
    if (doc.getElementsByTagName('parsererror').length) return { colors: [], usesCurrent: false }
    const seen: Record<string, boolean> = {}, order: string[] = []
    let usesCurrent = false
    const els = doc.getElementsByTagName('*')
    for (let i = 0; i < els.length; i++) {
        const el = els[i]
        for (const [attr, prop, fallback] of PAINT_PROPS) {
            const style = (el as HTMLElement).style ? (el as HTMLElement).style as unknown as Record<string, string> : null
            const vals: (string | null)[] = [el.getAttribute(attr), style ? style[prop] : null]
            for (const raw of vals) {
                if (raw == null || raw === '') continue
                const normalized = normalizeColor(raw, fallback)
                if (!normalized) continue
                if (normalized === 'currentColor') { usesCurrent = true; continue }
                if (!seen[normalized]) { seen[normalized] = true; order.push(normalized) }
            }
        }
    }
    return { colors: order, usesCurrent }
}

// Build a recolored copy of the SVG from the override map. Returns the input
// unchanged when there are no overrides or the SVG cannot be parsed.
function applyRecolor(svg: string): string {
    if (!hasOverrides()) return svg
    const doc = svgParser.parseFromString(svg, 'image/svg+xml')
    if (doc.getElementsByTagName('parsererror').length) return svg
    const root = doc.documentElement
    // currentColor resolves against the inherited CSS color property.
    // Setting it on the root remaps every currentColor paint, including ones in <style> blocks.
    if (svgUsesCurrentColor && currentColorOverride) root.style.color = currentColorOverride
    const els = doc.getElementsByTagName('*')
    for (let i = 0; i < els.length; i++) {
        const el = els[i]
        for (const [attr, prop, fallback] of PAINT_PROPS) {
            const av = el.getAttribute(attr)
            if (av) {
                const normalized = normalizeColor(av, fallback)
                if (normalized && normalized !== 'currentColor' && colorMap[normalized]) el.setAttribute(attr, colorMap[normalized])
            }
            const elStyle = (el as HTMLElement).style ? (el as HTMLElement).style as unknown as Record<string, string> : null
            const sv = elStyle ? elStyle[prop] : null
            if (sv) {
                const normalized = normalizeColor(sv, fallback)
                if (normalized && normalized !== 'currentColor' && colorMap[normalized]) elStyle![prop] = colorMap[normalized]
            }
        }
    }
    return svgSerializer.serializeToString(doc)
}

function applyColorsAndRender(): void {
    svgText = applyRecolor(originalSvgText!)
    scheduleRender()
}

// Build one swatch row. isCurrent toggles the special currentColor entry.
function makeColorRow(key: string, isCurrent: boolean): HTMLDivElement {
    const row = document.createElement('div')
    row.className = 'color-row'
    // The swatch is a fixed "from" reference showing the original color.
    // The color input is the editable "to" target.
    const swatch = document.createElement('span')
    swatch.className = 'color-swatch'
    swatch.style.background = isCurrent ? '#000000' : key
    const input = document.createElement('input')
    input.type = 'color'
    input.className = 'color-input'
    const defaultHex = isCurrent ? (currentColorOverride || '#000000') : toHex(key)
    input.value = defaultHex
    const hex = document.createElement('span')
    hex.className = 'color-hex'
    hex.textContent = isCurrent ? 'currentColor' : key
    const reset = document.createElement('button')
    reset.className = 'color-reset'
    reset.title = 'Reset to original'
    reset.innerHTML = RESET_ICON

    input.addEventListener('input', () => {
        if (isCurrent) currentColorOverride = input.value
        else colorMap[key] = input.value
        hex.classList.add('overridden')
        applyColorsAndRender()
    })
    reset.addEventListener('click', () => {
        if (isCurrent) { currentColorOverride = null; input.value = '#000000' }
        else { delete colorMap[key]; input.value = toHex(key) }
        hex.classList.remove('overridden')
        applyColorsAndRender()
    })

    row.append(swatch, input, hex, reset)
    return row
}

function buildColorSection(): void {
    colorList.innerHTML = ''
    const { colors, usesCurrent } = extractColors(originalSvgText!)
    svgUsesCurrentColor = usesCurrent
    if (colors.length === 0 && !usesCurrent) {
        colorCollapsible.style.display = 'none'
        return
    }
    colorCollapsible.style.display = ''
    if (usesCurrent) colorList.appendChild(makeColorRow('currentColor', true))
    colors.forEach(color => colorList.appendChild(makeColorRow(color, false)))
}

resetColorsBtn.addEventListener('click', () => {
    colorMap = {}
    currentColorOverride = null
    buildColorSection()
    applyColorsAndRender()
})

// --- Import flow ---
interface SvgImportResult {
    ok: boolean
    svgText: string
    fileName: string
    intrinsicWidth: number
    intrinsicHeight: number
}

async function doImport(): Promise<void> {
    loadingOverlay.classList.add('show')
    const result = await window.rokdock.svgExporter.importSvg()
    if (!result || !result.ok) { loadingOverlay.classList.remove('show'); return }
    onSvgImported(result as SvgImportResult)
}

function onSvgImported(result: SvgImportResult): void {
    cleanDataUrl = null
    quantizedDataUrl = null
    originalSvgText = result.svgText
    colorMap = {}
    currentColorOverride = null
    svgUsesCurrentColor = false
    svgText = result.svgText
    buildColorSection()
    intrinsicWidth = result.intrinsicWidth || 0
    intrinsicHeight = result.intrinsicHeight || 0

    // Show loaded state
    viewport.classList.remove('empty')
    dropZone.style.display = 'none'
    zoomSizer.style.display = 'inline-block'
    zoomDockWrap.classList.remove('hidden')
    previewFooter.style.display = ''
    sizeSection.classList.remove('disabled')
    optsSection.classList.remove('disabled')
    setExportEnabled(true)

    // Update info
    toolbarFilename.style.display = ''
    toolbarFilename.textContent = result.fileName
    sourceInfo.textContent = result.fileName
    if (intrinsicWidth && intrinsicHeight) {
        sourceDims.textContent = 'source: ' + intrinsicWidth + ' x ' + intrinsicHeight
    } else {
        sourceDims.textContent = 'source: unknown dimensions'
    }

    setPreset('fhd')
    if (renderTimer !== null) clearTimeout(renderTimer)
    renderTimer = setTimeout(async () => {
        await renderSvg()
        requestAnimationFrame(zoomFit)
    }, 100)
}

// --- Export flow ---
async function doExport(): Promise<void> {
    if (!quantizedDataUrl) return
    const baseName = (toolbarFilename.textContent ?? '').replace(/\.svg$/i, '') + '.png'
    await window.rokdock.svgExporter.savePng(quantizedDataUrl, baseName)
}

// Main drives Import/Export through the typed tool-window command channel.
window.rokdock.toolWindow.onCommand((raw: unknown) => {
    const command = raw as SvgConverterCommand
    switch (command.type) {
        case 'import': void doImport(); break
        case 'export': void doExport(); break
        case 'loadSvg': onSvgImported({ ok: true, svgText: command.svgText, fileName: command.fileName, intrinsicWidth: command.intrinsicWidth, intrinsicHeight: command.intrinsicHeight }); break
        case 'toast': showToast(command.message); break
        default: command satisfies never
    }
})

// Standalone CLI launch: pull any SVG the main process loaded for us.
void (async () => {
    const initial = await window.rokdock.svgExporter.getInitialData()
    if (initial.data) {
        onSvgImported({ ok: true, ...initial.data })
    } else if (initial.error) {
        showToast(initial.error)
    }
})()

// --- Drop zone interactions ---
dropZone.addEventListener('click', doImport)
importBtn.addEventListener('click', doImport)
panelExportBtn.addEventListener('click', doExport)

// Drag and drop
let dragCount = 0
viewport.addEventListener('dragenter', (e) => {
    e.preventDefault()
    dragCount++
    if (dropZone.style.display !== 'none') dropZone.classList.add('drag-over')
})
viewport.addEventListener('dragleave', (e) => {
    e.preventDefault()
    dragCount--
    if (dragCount <= 0) { dragCount = 0; dropZone.classList.remove('drag-over') }
})
viewport.addEventListener('dragover', (e) => {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
})
viewport.addEventListener('drop', async (e) => {
    e.preventDefault()
    dragCount = 0
    dropZone.classList.remove('drag-over')
    const file = e.dataTransfer && e.dataTransfer.files[0]
    if (file && file.name && file.name.toLowerCase().endsWith('.svg')) {
        loadingOverlay.classList.add('show')
        const text = await file.text()
        const result = await window.rokdock.svgExporter.importSvgText(text, file.name)
        if (result && result.ok) onSvgImported(result as SvgImportResult)
        else loadingOverlay.classList.remove('show')
    } else if (file) {
        void doImport()
    }
})

// --- Context menu ---
const ctxMenu = document.getElementById('ctxMenu') as HTMLElement

function hideCtx(): void { ctxMenu.classList.remove('show') }
document.addEventListener('contextmenu', (e) => {
    if (viewport.contains(e.target as Node)) {
        e.preventDefault()
        ctxExport.classList.toggle('disabled', !quantizedDataUrl)
        ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - 180) + 'px'
        ctxMenu.style.top = Math.min(e.clientY, window.innerHeight - 80) + 'px'
        ctxMenu.classList.add('show')
    } else {
        hideCtx()
    }
})
document.addEventListener('mousedown', (e) => {
    if (!ctxMenu.contains(e.target as Node)) hideCtx()
})
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideCtx() })
ctxImport.addEventListener('click', () => { hideCtx(); void doImport() })
ctxExport.addEventListener('click', () => { hideCtx(); void doExport() })

// --- Toolbar export button ---
exportBtn.addEventListener('click', doExport)

function setExportEnabled(enabled: boolean): void {
    panelExportBtn.disabled = !enabled
    exportBtn.disabled = !enabled
}

