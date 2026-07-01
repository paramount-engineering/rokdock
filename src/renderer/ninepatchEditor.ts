import { bootBundledTheme } from '@shared/entryBootstrap'
import './appearanceModalTrigger'
import { isLightTheme } from '@shared/themeBoot'
import type { NinePatchCommand } from '@shared/toolWindowCommands'
import { createToast } from '@shared/toast'
import './ninepatchEditor.css'

// Apply theme vars and await fonts before the body is revealed.
// This runs concurrently with the synchronous setup below; the body remains
// hidden (via .rokdock-theme-pending on <html>) until bootBundledTheme resolves.
void bootBundledTheme()

import {
    faPlus,
    faUpload,
    faRotateLeft,
    faRotateRight,
    faBolt,
    faEye,
    faDownload,
    faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { faSvg } from '@shared/icons'
import {
    S720,
    hexToRgba,
    bseg,
    outPos,
    detectRuns,
    scaleZones720,
    scalePad720,
} from './ninepatchGeometry'
import type { Zone, Segment } from './ninepatchGeometry'

// Types

/** All editable state for the 9-patch editor, serialized for undo/redo. */
interface EditorState {
    mode: 'shape' | 'imported'
    shape: 'rectangle' | 'ellipse'
    width: number
    height: number
    cornerRadius: number
    fillEnabled: boolean
    fillColor: string
    fillOpacity: number
    borderEnabled: boolean
    borderWidth: number
    borderColor: string
    borderOpacity: number
    shadowEnabled: boolean
    shadowColor: string
    shadowOpacity: number
    shadowX: number
    shadowY: number
    shadowBlur: number
    outerPadding: number
    stretchX: Zone[]
    stretchY: Zone[]
    paddingX: Zone | null
    paddingY: Zone | null
    importedDataUrl: string | null
    importedFileName: string | null
    parsedStretchX: Zone[] | null
    parsedStretchY: Zone[] | null
    parsedPaddingX: Zone | null
    parsedPaddingY: Zone | null
    zoom: number
}

/** Identifies one end of one zone handle for drag/hover tracking. */
interface HandleTarget {
    axis: 'x' | 'y'
    type: 's' | 'p'
    index: number
    edge: 's' | 'e'
}

/** Field-wise equality for two handle targets (cheaper than serializing on every mousemove). */
function sameHandle(first: HandleTarget | null, second: HandleTarget | null): boolean {
    return first === second || (!!first && !!second && first.axis === second.axis && first.type === second.type && first.index === second.index && first.edge === second.edge)
}

/** Interface for the zoom dock custom element's extra methods. */
interface ZoomDockElement extends HTMLElement {
    updateExtraVisibility(): void
}

// Icon HTML strings
// Used as innerHTML for dynamically-built zone add/delete buttons.
const svgPlus = faSvg(faPlus)
const svgX = faSvg(faXmark)

// Constants
const ZOOM_STEPS = [10, 25, 50, 75, 100, 150, 200, 300, 400, 500, 600, 800, 1000]
const ZONE_MARGIN = 10 // px outside shape for zone handles
const ZONE_COLORS = [
    { fill: 'rgba(76,175,80,.06)', handle: 'rgba(76,175,80,1)', glow: 'rgba(76,175,80,.16)' },
    { fill: 'rgba(0,188,212,.06)', handle: 'rgba(0,188,212,1)', glow: 'rgba(0,188,212,.16)' },
    { fill: 'rgba(255,152,0,.06)', handle: 'rgba(255,152,0,1)', glow: 'rgba(255,152,0,.16)' },
    { fill: 'rgba(233,30,99,.06)', handle: 'rgba(233,30,99,1)', glow: 'rgba(233,30,99,.16)' },
]
const PAD_COLOR = { fill: 'rgba(33,150,243,.06)', handle: 'rgba(33,150,243,.9)', glow: 'rgba(33,150,243,.16)' }

const RANGE_INPUT_PAIRS: Array<[string, string]> = [
    ['shapeWidthRange', 'shapeWidth'],
    ['shapeHeightRange', 'shapeHeight'],
    ['cornerRadiusRange', 'cornerRadius'],
    ['fillOpacityRange', 'fillOpacity'],
    ['borderWidthRange', 'borderWidth'],
    ['borderOpacityRange', 'borderOpacity'],
    ['shadowOpacityRange', 'shadowOpacity'],
    ['shadowXRange', 'shadowX'],
    ['shadowYRange', 'shadowY'],
    ['shadowBlurRange', 'shadowBlur'],
    ['outerPaddingRange', 'outerPadding'],
]

// State

// Fresh default shape-mode state. This is a factory, not a shared constant, so
// the zone arrays (stretchX/stretchY) are new on every use. A shared object
// would alias those arrays across the live state and every doNew() reset.
function defaultShapeState(): Omit<EditorState, 'zoom'> {
    return {
        mode: 'shape', shape: 'rectangle', width: 120, height: 60, cornerRadius: 12,
        fillEnabled: true, fillColor: '#FFFFFF', fillOpacity: 100,
        borderEnabled: false, borderWidth: 2, borderColor: '#000000', borderOpacity: 100,
        shadowEnabled: false, shadowColor: '#000000', shadowOpacity: 50, shadowX: 0, shadowY: 4, shadowBlur: 8,
        outerPadding: 0, stretchX: [], stretchY: [], paddingX: null, paddingY: null,
        importedDataUrl: null, importedFileName: null,
        parsedStretchX: null, parsedStretchY: null, parsedPaddingX: null, parsedPaddingY: null,
    }
}

// zoom is intentionally not part of defaultShapeState: doNew() preserves the
// current zoom level (matching the original editor behavior).
const state: EditorState = { ...defaultShapeState(), zoom: 100 }

const undoStack: EditorState[] = []
const redoStack: EditorState[] = []

let hasAsset = false

// DOM refs

const canvas          = document.getElementById('editorCanvas') as HTMLCanvasElement
const ctx             = canvas.getContext('2d') as CanvasRenderingContext2D
const borderCanvas    = document.getElementById('borderCanvas') as HTMLCanvasElement
const borderCtx            = borderCanvas.getContext('2d') as CanvasRenderingContext2D
const zoneOverlay         = document.getElementById('zoneOverlay') as HTMLCanvasElement
const zoneCtx            = zoneOverlay.getContext('2d') as CanvasRenderingContext2D
const canvasContainer              = document.getElementById('canvasContainer') as HTMLElement
const zoomSizer       = document.getElementById('canvasZoomSizer') as HTMLElement
const emptyState         = document.getElementById('emptyState') as HTMLElement
const emptyStateIcon  = document.getElementById('emptyStateIcon') as HTMLElement
const undoBtn         = document.getElementById('undoBtn') as HTMLButtonElement
const redoBtn         = document.getElementById('redoBtn') as HTMLButtonElement
const export1080Btn   = document.getElementById('export1080Btn') as HTMLButtonElement
const export720Btn    = document.getElementById('export720Btn') as HTMLButtonElement
const viewport              = document.getElementById('editorViewport') as HTMLElement
const loadingOverlay  = document.getElementById('loadingOverlay') as HTMLElement
const newBtn          = document.getElementById('newBtn') as HTMLButtonElement
const importBtn       = document.getElementById('importBtn') as HTMLButtonElement
const toolbarFilename = document.getElementById('toolbarFilename') as HTMLElement
const zoomDock        = document.getElementById('zoomDock') as ZoomDockElement
const zoomDockWrap    = document.getElementById('zoomDockWrap') as HTMLElement
const guidesBtn       = document.getElementById('guidesBtn') as HTMLButtonElement
const pixelRow        = document.getElementById('pixelRow') as HTMLElement
const pixelHighlight  = document.getElementById('pixelHighlight') as HTMLElement
const autoDetectBtn   = document.getElementById('autoDetectBtn') as HTMLButtonElement
const pvBgToggle      = document.getElementById('pvBgToggle') as HTMLButtonElement
const pvBgLabel       = document.getElementById('pvBgLabel') as HTMLElement
const pvPosterToggle  = document.getElementById('pvPosterToggle') as HTMLButtonElement
const pixelText       = document.getElementById('pixelText') as HTMLElement
const pixelSwatch     = document.getElementById('pixelSwatch') as HTMLElement

const showToast = createToast(document.getElementById('toast') as HTMLDivElement)

// Inject icons

newBtn.innerHTML = faSvg(faPlus)
importBtn.innerHTML = faSvg(faUpload)
undoBtn.innerHTML = faSvg(faRotateLeft)
redoBtn.innerHTML = faSvg(faRotateRight)
guidesBtn.innerHTML = faSvg(faEye)
export1080Btn.innerHTML = faSvg(faDownload)
export720Btn.innerHTML = faSvg(faDownload)
emptyStateIcon.innerHTML = faSvg(faUpload)
autoDetectBtn.innerHTML = faSvg(faBolt) + ' Auto'

// Range sync

function syncPct(element: HTMLInputElement): void {
    const mn = parseFloat(element.min) || 0
    const mx = parseFloat(element.max) || 100
    const value = parseFloat(element.value) || 0
    element.style.setProperty('--range-pct', ((value - mn) / (mx - mn)) * 100 + '%')
}

RANGE_INPUT_PAIRS.forEach(([rId, iId]) => {
    const range = document.getElementById(rId) as HTMLInputElement | null
    const inp = document.getElementById(iId) as HTMLInputElement | null
    if (!range || !inp) return
    range.addEventListener('input', () => { inp.value = range.value; syncPct(range); onInputChange() })
    inp.addEventListener('input', () => { range.value = inp.value; syncPct(range); onInputChange() })
    function wheelAdj(e: WheelEvent): void {
        e.preventDefault()
        e.stopPropagation()
        const step = e.shiftKey ? 10 : 1
        const cur = Number(inp!.value) || 0
        const mn = Number(inp!.min)
        const mx = Number(inp!.max)
        const nv = Math.max(mn, Math.min(mx, cur + (e.deltaY < 0 ? step : -step)))
        inp!.value = String(nv)
        range!.value = String(nv)
        syncPct(range!)
        onInputChange()
    }
    range.addEventListener('wheel', wheelAdj, { passive: false })
    inp.addEventListener('wheel', wheelAdj, { passive: false })
    syncPct(range)
})

// Toggles

function setupToggle(id: string, key: 'fillEnabled' | 'borderEnabled' | 'shadowEnabled'): void {
    const button = document.getElementById(id) as HTMLButtonElement
    button.addEventListener('click', e => {
        e.stopPropagation()
        pushUndo()
        state[key] = !state[key]
        button.classList.toggle('on', state[key])
        if (state[key]) {
            const col = button.closest('rokdock-collapsible')
            if (col && !col.hasAttribute('open')) col.setAttribute('open', '')
        }
        renderAll()
    })
}

setupToggle('fillToggle', 'fillEnabled')
setupToggle('borderToggle', 'borderEnabled')
setupToggle('shadowToggle', 'shadowEnabled')

// 720p dimension labels

// Input + 720p-label element pairs, resolved once. update720 runs on every
// onInputChange, so caching avoids re-querying these stable elements each time.
const fields720 = ['shapeWidth', 'shapeHeight', 'cornerRadius', 'borderWidth', 'outerPadding', 'shadowX', 'shadowY', 'shadowBlur']
    .map(id => ({ inp: document.getElementById(id) as HTMLInputElement | null, lbl: document.getElementById(id + '720') }))

function update720(): void {
    for (const { inp, lbl } of fields720) {
        if (inp && lbl) lbl.textContent = '(' + String(Math.round(Number(inp.value) * S720)) + ' @720p)'
    }
}

// Shape rendering

function renderShape(): void {
    const current = state
    const se = current.shadowEnabled
        ? Math.max(current.shadowBlur * 2 + Math.abs(current.shadowX), current.shadowBlur * 2 + Math.abs(current.shadowY)) + 4
        : 0
    const pad = current.outerPadding + se
    const tw = current.width + pad * 2
    const th = current.height + pad * 2
    canvas.width = tw
    canvas.height = th
    ctx.clearRect(0, 0, tw, th)
    const x = pad, y = pad, w = current.width, h = current.height
    const bw = current.borderEnabled ? current.borderWidth : 0

    function drawPath(context: CanvasRenderingContext2D): void {
        if (current.shape === 'ellipse') {
            context.beginPath()
            context.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
        } else {
            context.beginPath()
            context.roundRect(x, y, w, h, Math.min(current.cornerRadius, w / 2, h / 2))
        }
    }

    if (current.shadowEnabled) {
        const oc = document.createElement('canvas')
        oc.width = tw
        oc.height = th
        const octx = oc.getContext('2d') as CanvasRenderingContext2D
        octx.shadowOffsetX = current.shadowX
        octx.shadowOffsetY = current.shadowY
        octx.shadowBlur = current.shadowBlur
        octx.shadowColor = hexToRgba(current.shadowColor, current.shadowOpacity)
        octx.fillStyle = 'rgba(0,0,0,1)'
        drawPath(octx)
        octx.fill()
        octx.shadowColor = 'transparent'
        octx.shadowBlur = 0
        octx.shadowOffsetX = 0
        octx.shadowOffsetY = 0
        octx.globalCompositeOperation = 'destination-out'
        octx.fillStyle = 'rgba(0,0,0,1)'
        drawPath(octx)
        octx.fill()
        ctx.drawImage(oc, 0, 0)
    }

    if (current.fillEnabled) {
        ctx.save()
        ctx.fillStyle = hexToRgba(current.fillColor, current.fillOpacity)
        drawPath(ctx)
        ctx.fill()
        ctx.restore()
    }

    if (bw > 0) {
        ctx.save()
        drawPath(ctx)
        ctx.clip()
        ctx.strokeStyle = hexToRgba(current.borderColor, current.borderOpacity)
        ctx.lineWidth = bw * 2
        drawPath(ctx)
        ctx.stroke()
        ctx.restore()
    }

    if (!current.stretchX.length && !current.stretchY.length) {
        const mx = Math.max(Math.ceil(tw * 0.25), 2)
        const my = Math.max(Math.ceil(th * 0.25), 2)
        current.stretchX = [{ start: mx, end: tw - mx }]
        current.stretchY = [{ start: my, end: th - my }]
        current.paddingX = { start: pad, end: tw - pad }
        current.paddingY = { start: pad, end: th - pad }
    }

    zoomSizer.style.display = 'inline-block'
    canvasContainer.style.display = 'inline-block'
    emptyState.style.display = 'none'
    hasAsset = true
    export1080Btn.disabled = false
    export720Btn.disabled = false
}

// Border pixel canvas (9-patch encoding)

function renderBorderPixels(): void {
    const w = canvas.width, h = canvas.height
    borderCanvas.width = w + 2
    borderCanvas.height = h + 2
    borderCanvas.style.position = 'absolute'
    borderCanvas.style.left = '-1px'
    borderCanvas.style.top = '-1px'
    borderCanvas.style.width = (w + 2) + 'px'
    borderCanvas.style.height = (h + 2) + 'px'
    borderCtx.clearRect(0, 0, w + 2, h + 2)
    borderCtx.fillStyle = '#000000'
    ;(state.stretchX || []).forEach(zone => { borderCtx.fillRect(zone.start + 1, 0, zone.end - zone.start, 1) })
    ;(state.stretchY || []).forEach(zone => { borderCtx.fillRect(0, zone.start + 1, 1, zone.end - zone.start) })
    if (state.paddingX) borderCtx.fillRect(state.paddingX.start + 1, h + 1, state.paddingX.end - state.paddingX.start, 1)
    if (state.paddingY) borderCtx.fillRect(w + 1, state.paddingY.start + 1, 1, state.paddingY.end - state.paddingY.start)
}

// Zone overlay

let dragTarget: HandleTarget | null = null
let hoveredHandle: HandleTarget | null = null

function isHover(axis: string, type: string, index: number, edge: string): boolean {
    return !!(hoveredHandle && hoveredHandle.axis === axis && hoveredHandle.type === type && hoveredHandle.index === index && hoveredHandle.edge === edge)
}

function isDrag(axis: string, type: string, index: number, edge: string): boolean {
    return !!(dragTarget && dragTarget.axis === axis && dragTarget.type === type && dragTarget.index === index && dragTarget.edge === edge)
}

function renderZoneOverlay(): void {
    const w = canvas.width, h = canvas.height
    const dpr = window.devicePixelRatio || 1
    const zf = state.zoom / 100
    const scale = dpr * zf
    const margin = ZONE_MARGIN
    const cssW = w + 2 + margin * 2, cssH = h + 2 + margin * 2
    zoneOverlay.width = Math.round(cssW * scale)
    zoneOverlay.height = Math.round(cssH * scale)
    zoneOverlay.style.width = cssW + 'px'
    zoneOverlay.style.height = cssH + 'px'
    zoneOverlay.style.left = (-1 - margin) + 'px'
    zoneOverlay.style.top = (-1 - margin) + 'px'
    const overlayCtx = zoneCtx
    overlayCtx.setTransform(scale, 0, 0, scale, 0, 0)
    overlayCtx.clearRect(0, 0, cssW, cssH)
    const ox = margin + 1, oy = margin + 1
    const current = state
    const lw = Math.max(0.5, 1 / zf)
    const dash = [Math.max(3, 5 / zf), Math.max(2, 3 / zf)]
    const hr = 4 / zf

    function drawHandle(hx: number, hy: number, zc: { handle: string; glow: string }, hov: boolean, drag: boolean): void {
        const radius = hr
        if (hov || drag) {
            overlayCtx.beginPath()
            overlayCtx.arc(hx, hy, radius + 3 / zf, 0, Math.PI * 2)
            overlayCtx.fillStyle = zc.glow
            overlayCtx.fill()
        }
        overlayCtx.beginPath()
        overlayCtx.arc(hx, hy, radius, 0, Math.PI * 2)
        overlayCtx.fillStyle = (hov || drag) ? zc.handle : 'rgba(14,14,26,0.85)'
        overlayCtx.fill()
        overlayCtx.lineWidth = Math.max(0.5, 1.2 / zf)
        overlayCtx.strokeStyle = zc.handle
        overlayCtx.stroke()
        if (!hov && !drag) {
            overlayCtx.beginPath()
            overlayCtx.arc(hx, hy, radius * 0.38, 0, Math.PI * 2)
            overlayCtx.fillStyle = zc.handle
            overlayCtx.fill()
        }
    }

    function drawGuide(x1: number, y1: number, x2: number, y2: number, zc: { handle: string; glow: string }): void {
        overlayCtx.setLineDash([])
        overlayCtx.strokeStyle = zc.glow
        overlayCtx.lineWidth = Math.max(0.5, 1.5 / zf)
        overlayCtx.beginPath()
        overlayCtx.moveTo(x1, y1)
        overlayCtx.lineTo(x2, y2)
        overlayCtx.stroke()
        overlayCtx.strokeStyle = zc.handle
        overlayCtx.lineWidth = lw
        overlayCtx.setLineDash(dash)
        overlayCtx.beginPath()
        overlayCtx.moveTo(x1, y1)
        overlayCtx.lineTo(x2, y2)
        overlayCtx.stroke()
        overlayCtx.setLineDash([])
    }

    current.stretchX.forEach((zone, i) => {
        const zc = ZONE_COLORS[i % ZONE_COLORS.length]
        ;([{ gx: zone.start, e: 's' }, { gx: zone.end, e: 'e' }] as Array<{ gx: number; e: string }>).forEach(({ gx, e }) => {
            drawGuide(ox + gx, oy, ox + gx, oy + h, zc)
            drawHandle(ox + gx, margin / 2, zc, isHover('x', 's', i, e), isDrag('x', 's', i, e))
        })
    })

    current.stretchY.forEach((zone, i) => {
        const zc = ZONE_COLORS[i % ZONE_COLORS.length]
        ;([{ gy: zone.start, e: 's' }, { gy: zone.end, e: 'e' }] as Array<{ gy: number; e: string }>).forEach(({ gy, e }) => {
            drawGuide(ox, oy + gy, ox + w, oy + gy, zc)
            drawHandle(margin / 2, oy + gy, zc, isHover('y', 's', i, e), isDrag('y', 's', i, e))
        })
    })

    if (current.paddingX) {
        ;([{ gx: current.paddingX.start, e: 's' }, { gx: current.paddingX.end, e: 'e' }] as Array<{ gx: number; e: string }>).forEach(({ gx, e }) => {
            drawGuide(ox + gx, oy, ox + gx, oy + h, PAD_COLOR)
            drawHandle(ox + gx, oy + h + 1 + margin / 2, PAD_COLOR, isHover('x', 'p', 0, e), isDrag('x', 'p', 0, e))
        })
    }

    if (current.paddingY) {
        ;([{ gy: current.paddingY.start, e: 's' }, { gy: current.paddingY.end, e: 'e' }] as Array<{ gy: number; e: string }>).forEach(({ gy, e }) => {
            drawGuide(ox, oy + gy, ox + w, oy + gy, PAD_COLOR)
            drawHandle(ox + w + 1 + margin / 2, oy + gy, PAD_COLOR, isHover('y', 'p', 0, e), isDrag('y', 'p', 0, e))
        })
    }

    overlayCtx.setTransform(1, 0, 0, 1, 0, 0)
}

// Zone handle dragging

function findHandle(mx: number, my: number): HandleTarget | null {
    const current = state, w = canvas.width, h = canvas.height, margin = ZONE_MARGIN, ox = margin + 1, oy = margin + 1
    const hh = 10 / (state.zoom / 100)
    const handleYTop = margin / 2, handleXLeft = margin / 2
    const handleYBottom = oy + h + 1 + margin / 2, handleXRight = ox + w + 1 + margin / 2
    for (let i = 0; i < current.stretchX.length; i++) {
        const zone = current.stretchX[i]
        if (Math.hypot(mx - (ox + zone.start), my - handleYTop) < hh) return { axis: 'x', type: 's', index: i, edge: 's' }
        if (Math.hypot(mx - (ox + zone.end), my - handleYTop) < hh) return { axis: 'x', type: 's', index: i, edge: 'e' }
    }
    for (let i = 0; i < current.stretchY.length; i++) {
        const zone = current.stretchY[i]
        if (Math.hypot(mx - handleXLeft, my - (oy + zone.start)) < hh) return { axis: 'y', type: 's', index: i, edge: 's' }
        if (Math.hypot(mx - handleXLeft, my - (oy + zone.end)) < hh) return { axis: 'y', type: 's', index: i, edge: 'e' }
    }
    if (current.paddingX) {
        if (Math.hypot(mx - (ox + current.paddingX.start), my - handleYBottom) < hh) return { axis: 'x', type: 'p', index: 0, edge: 's' }
        if (Math.hypot(mx - (ox + current.paddingX.end), my - handleYBottom) < hh) return { axis: 'x', type: 'p', index: 0, edge: 'e' }
    }
    if (current.paddingY) {
        if (Math.hypot(mx - handleXRight, my - (oy + current.paddingY.start)) < hh) return { axis: 'y', type: 'p', index: 0, edge: 's' }
        if (Math.hypot(mx - handleXRight, my - (oy + current.paddingY.end)) < hh) return { axis: 'y', type: 'p', index: 0, edge: 'e' }
    }
    return null
}

function ovlCoords(e: MouseEvent): { x: number; y: number } {
    const rect = zoneOverlay.getBoundingClientRect()
    const zoom = state.zoom / 100
    return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom }
}

zoneOverlay.addEventListener('mousedown', e => {
    if (e.button !== 0) return
    const { x, y } = ovlCoords(e)
    const h = findHandle(x, y)
    if (h) {
        pushUndo()
        dragTarget = h
        e.preventDefault()
        e.stopPropagation()
    }
})

document.addEventListener('mousemove', e => {
    if (!dragTarget) return
    const { x, y } = ovlCoords(e)
    const current = state, w = canvas.width, h = canvas.height, margin = ZONE_MARGIN, ox = margin + 1, oy = margin + 1
    const val = dragTarget.axis === 'x'
        ? Math.max(0, Math.min(w, Math.round(x - ox)))
        : Math.max(0, Math.min(h, Math.round(y - oy)))
    if (dragTarget.type === 's') {
        const zones = dragTarget.axis === 'x' ? current.stretchX : current.stretchY
        const zone = zones[dragTarget.index]
        if (dragTarget.edge === 's') zone.start = Math.min(val, zone.end - 1)
        else zone.end = Math.max(val, zone.start + 1)
    } else {
        const pad = dragTarget.axis === 'x' ? current.paddingX : current.paddingY
        if (pad) {
            if (dragTarget.edge === 's') pad.start = Math.min(val, pad.end - 1)
            else pad.end = Math.max(val, pad.start + 1)
        }
    }
    renderBorderPixels()
    renderZoneOverlay()
    rebuildZones()
    renderPreviews()
})

document.addEventListener('mouseup', () => {
    if (dragTarget) { dragTarget = null; renderZoneOverlay() }
})

zoneOverlay.addEventListener('mousemove', e => {
    if (dragTarget) return
    const { x, y } = ovlCoords(e)
    const h = findHandle(x, y)
    zoneOverlay.style.cursor = h ? (h.axis === 'x' ? 'ew-resize' : 'ns-resize') : 'default'
    const prev = hoveredHandle
    hoveredHandle = h
    if (!sameHandle(prev, h)) renderZoneOverlay()
})

// Canvas pan

interface PanState { sx: number; sy: number; sl: number; st: number }
let panState: PanState | null = null

viewport.addEventListener('mousedown', e => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('.zoom-dock')) return
    if (panState) return
    if (dragTarget) return
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

// Pixel inspector

let pixelRowVisible = false

function setPixelRowVisible(vis: boolean): void {
    if (vis === pixelRowVisible) return
    pixelRowVisible = vis
    pixelRow.style.display = vis ? 'flex' : 'none'
    zoomDock.updateExtraVisibility()
}

zoneOverlay.addEventListener('mousemove', e => {
    if (dragTarget) return
    const { x, y } = ovlCoords(e)
    const margin = ZONE_MARGIN, ox = margin + 1, oy = margin + 1
    const cx = Math.round(x - ox), cy = Math.round(y - oy)
    if (cx < 0 || cy < 0 || cx >= canvas.width || cy >= canvas.height) {
        setPixelRowVisible(false)
        pixelHighlight.style.display = 'none'
        return
    }
    const px = ctx.getImageData(cx, cy, 1, 1).data
    pixelText.textContent = cx + ', ' + cy + '   R:' + px[0] + ' G:' + px[1] + ' B:' + px[2] + ' A:' + px[3]
    pixelSwatch.style.background = 'rgba(' + px[0] + ',' + px[1] + ',' + px[2] + ',' + (px[3] / 255) + ')'
    setPixelRowVisible(true)
    pixelHighlight.style.display = 'block'
    pixelHighlight.style.left = cx + 'px'
    pixelHighlight.style.top = cy + 'px'
    pixelHighlight.style.width = '1px'
    pixelHighlight.style.height = '1px'
    const ring = 1 / (state.zoom / 100)
    pixelHighlight.style.boxShadow = '0 0 0 ' + ring + 'px rgba(0,0,0,.7),0 0 0 ' + (ring * 2) + 'px rgba(255,255,255,.9)'
})

zoneOverlay.addEventListener('mouseleave', () => {
    setPixelRowVisible(false)
    pixelHighlight.style.display = 'none'
    if (hoveredHandle) { hoveredHandle = null; renderZoneOverlay() }
})

// Zoom dock

function applyZoom(): void {
    const zf = state.zoom / 100
    canvasContainer.style.transform = 'scale(' + zf + ')'
    const zm = ZONE_MARGIN
    const uw = canvas.width + 2 + zm * 2, uh = canvas.height + 2 + zm * 2
    zoomSizer.style.width = (uw * zf) + 'px'
    zoomSizer.style.height = (uh * zf) + 'px'
    zoomDock.setAttribute('value', String(Math.round(state.zoom)))
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

window.addEventListener('resize', updateCanvasMargin)

function setZoom(value: number): void {
    const sw = viewport.scrollWidth - viewport.clientWidth
    const sh = viewport.scrollHeight - viewport.clientHeight
    const fx = sw > 0 ? (viewport.scrollLeft / sw) : 0.5
    const fy = sh > 0 ? (viewport.scrollTop / sh) : 0.5
    state.zoom = Math.max(10, Math.min(1000, value))
    if (Math.abs(state.zoom - 100) < 3) state.zoom = 100
    applyZoom()
    renderZoneOverlay()
    const sw2 = viewport.scrollWidth - viewport.clientWidth
    const sh2 = viewport.scrollHeight - viewport.clientHeight
    viewport.scrollLeft = fx * sw2
    viewport.scrollTop = fy * sh2
}

zoomDock.addEventListener('rokdock-change', e => setZoom((e as CustomEvent<{ value: number }>).detail.value))
zoomDock.addEventListener('rokdock-actual', () => { setZoom(100); requestAnimationFrame(centerCanvas) })
zoomDock.addEventListener('rokdock-fit', () => {
    const vr = viewport.getBoundingClientRect()
    const cw = canvas.width + 2 + ZONE_MARGIN * 2, ch = canvas.height + 2 + ZONE_MARGIN * 2
    if (cw <= 0 || ch <= 0) return
    setZoom(Math.max(10, Math.min(1000, Math.min((vr.width - 80) / cw, (vr.height - 80) / ch) * 100)))
    requestAnimationFrame(centerCanvas)
})

viewport.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    setZoom(state.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))
}, { passive: false })

// Zone UI in left panel

function rebuildZones(): void {
    const body = document.getElementById('zonesBody') as HTMLElement
    body.innerHTML = ''
    addZoneSub(body, 'Stretch X', 'x', state.stretchX, canvas.width, true)
    addZoneSub(body, 'Stretch Y', 'y', state.stretchY, canvas.height, true)
    addPadSub(body, 'Padding X', 'x', state.paddingX, canvas.width)
    addPadSub(body, 'Padding Y', 'y', state.paddingY, canvas.height)
}

function addZoneSub(parent: HTMLElement, title: string, axis: 'x' | 'y', zones: Zone[], max: number, canAdd: boolean): void {
    const div = document.createElement('div')
    div.className = 'zone-sub'
    const hdr = document.createElement('div')
    hdr.className = 'zone-sub-hdr'
    hdr.textContent = title + ' '
    if (canAdd) {
        const button = document.createElement('button')
        button.className = 'add-btn'
        button.innerHTML = svgPlus
        button.title = 'Add zone'
        button.addEventListener('click', () => {
            pushUndo()
            const mid = Math.round(max / 2)
            zones.push({ start: Math.max(1, mid - 10), end: Math.min(max - 1, mid + 10) })
            renderAll()
        })
        hdr.appendChild(button)
    }
    div.appendChild(hdr)
    zones.forEach((zone, i) => {
        const entry = document.createElement('div')
        entry.className = 'zone-entry'
        const ehdr = document.createElement('div')
        ehdr.className = 'zone-entry-hdr'
        ehdr.innerHTML = '<span>Zone ' + (i + 1) + '</span><button class="del-btn" title="Remove">' + svgX + '</button>'
        entry.appendChild(ehdr)
        ;(ehdr.querySelector('.del-btn') as HTMLButtonElement).addEventListener('click', () => {
            pushUndo()
            zones.splice(i, 1)
            renderAll()
        })
        const r1 = document.createElement('div')
        r1.className = 'zr'
        r1.innerHTML = '<span class="zlbl">Start</span><input class="np-range" type="range" min="0" max="' + max + '" value="' + zone.start + '"><input class="inp" type="number" min="0" max="' + max + '" value="' + zone.start + '">'
        entry.appendChild(r1)
        const r2 = document.createElement('div')
        r2.className = 'zr'
        r2.innerHTML = '<span class="zlbl">End</span><input class="np-range" type="range" min="0" max="' + max + '" value="' + zone.end + '"><input class="inp" type="number" min="0" max="' + max + '" value="' + zone.end + '">'
        entry.appendChild(r2)
        const label720 = document.createElement('div')
        label720.className = 'zone-720'
        label720.textContent = '(' + String(Math.round(zone.start * S720)) + ' - ' + String(Math.round(zone.end * S720)) + ' @720p)'
        entry.appendChild(label720)
        div.appendChild(entry)

        const rr = entry.querySelectorAll('.np-range') as NodeListOf<HTMLInputElement>
        const ii = entry.querySelectorAll('.inp') as NodeListOf<HTMLInputElement>
        rr.forEach(range => syncPct(range))

        function zLive(sv: number | null, ev: number | null): void {
            const zones2 = axis === 'x' ? state.stretchX : state.stretchY
            const z2 = zones2[i]
            if (sv != null) { z2.start = Math.min(sv, z2.end - 1); rr[0].value = String(z2.start); ii[0].value = String(z2.start); syncPct(rr[0]) }
            if (ev != null) { z2.end = Math.max(ev, z2.start + 1); rr[1].value = String(z2.end); ii[1].value = String(z2.end); syncPct(rr[1]) }
            label720.textContent = '(' + String(Math.round(z2.start * S720)) + ' - ' + String(Math.round(z2.end * S720)) + ' @720p)'
            renderBorderPixels()
            renderZoneOverlay()
            renderPreviews()
        }

        rr[0].addEventListener('mousedown', () => pushUndo())
        rr[1].addEventListener('mousedown', () => pushUndo())
        rr[0].addEventListener('input', () => { zLive(Number(rr[0].value), null) })
        rr[1].addEventListener('input', () => { zLive(null, Number(rr[1].value)) })
        rr[0].addEventListener('change', () => rebuildZones())
        rr[1].addEventListener('change', () => rebuildZones())
        ii[0].addEventListener('input', () => { rr[0].value = ii[0].value; syncPct(rr[0]); applyZoneChange(axis, i, Number(ii[0].value), null) })
        ii[1].addEventListener('input', () => { rr[1].value = ii[1].value; syncPct(rr[1]); applyZoneChange(axis, i, null, Number(ii[1].value)) })

        ;[0, 1].forEach(ri => {
            function wh(e: WheelEvent): void {
                e.preventDefault()
                e.stopPropagation()
                const step = e.shiftKey ? 10 : 1
                const cur = Number(ii[ri].value) || 0
                const nv = Math.max(0, Math.min(max, cur + (e.deltaY < 0 ? step : -step)))
                ii[ri].value = String(nv)
                rr[ri].value = String(nv)
                syncPct(rr[ri])
                applyZoneChange(axis, i, ri === 0 ? nv : null, ri === 1 ? nv : null)
            }
            rr[ri].addEventListener('wheel', wh, { passive: false })
            ii[ri].addEventListener('wheel', wh, { passive: false })
        })
    })
    parent.appendChild(div)
}

function addPadSub(parent: HTMLElement, title: string, axis: 'x' | 'y', pad: Zone | null, max: number): void {
    if (!pad) return
    const div = document.createElement('div')
    div.className = 'zone-sub'
    const hdr = document.createElement('div')
    hdr.className = 'zone-sub-hdr'
    hdr.textContent = title
    div.appendChild(hdr)
    const entry = document.createElement('div')
    entry.className = 'zone-entry'
    const r1 = document.createElement('div')
    r1.className = 'zr'
    r1.innerHTML = '<span class="zlbl">Start</span><input class="np-range" type="range" min="0" max="' + max + '" value="' + pad.start + '"><input class="inp" type="number" min="0" max="' + max + '" value="' + pad.start + '">'
    entry.appendChild(r1)
    const r2 = document.createElement('div')
    r2.className = 'zr'
    r2.innerHTML = '<span class="zlbl">End</span><input class="np-range" type="range" min="0" max="' + max + '" value="' + pad.end + '"><input class="inp" type="number" min="0" max="' + max + '" value="' + pad.end + '">'
    entry.appendChild(r2)
    const label720 = document.createElement('div')
    label720.className = 'zone-720'
    label720.textContent = '(' + String(Math.round(pad.start * S720)) + ' - ' + String(Math.round(pad.end * S720)) + ' @720p)'
    entry.appendChild(label720)
    div.appendChild(entry)

    const rr = entry.querySelectorAll('.np-range') as NodeListOf<HTMLInputElement>
    const ii = entry.querySelectorAll('.inp') as NodeListOf<HTMLInputElement>
    rr.forEach(range => syncPct(range))

    function pLive(edge: 's' | 'e', val: number): void {
        const pad2 = axis === 'x' ? state.paddingX : state.paddingY
        if (!pad2) return
        if (edge === 's') { pad2.start = Math.min(val, pad2.end - 1); rr[0].value = String(pad2.start); ii[0].value = String(pad2.start); syncPct(rr[0]) }
        else { pad2.end = Math.max(val, pad2.start + 1); rr[1].value = String(pad2.end); ii[1].value = String(pad2.end); syncPct(rr[1]) }
        label720.textContent = '(' + String(Math.round(pad2.start * S720)) + ' - ' + String(Math.round(pad2.end * S720)) + ' @720p)'
        renderBorderPixels()
        renderZoneOverlay()
        renderPreviews()
    }

    rr[0].addEventListener('mousedown', () => pushUndo())
    rr[1].addEventListener('mousedown', () => pushUndo())
    rr[0].addEventListener('input', () => { pLive('s', Number(rr[0].value)) })
    rr[1].addEventListener('input', () => { pLive('e', Number(rr[1].value)) })
    rr[0].addEventListener('change', () => rebuildZones())
    rr[1].addEventListener('change', () => rebuildZones())
    ii[0].addEventListener('input', () => { rr[0].value = ii[0].value; syncPct(rr[0]); applyPadChange(axis, 's', Number(ii[0].value)) })
    ii[1].addEventListener('input', () => { rr[1].value = ii[1].value; syncPct(rr[1]); applyPadChange(axis, 'e', Number(ii[1].value)) })

    ;[0, 1].forEach(ri => {
        function wh(e: WheelEvent): void {
            e.preventDefault()
            e.stopPropagation()
            const step = e.shiftKey ? 10 : 1
            const cur = Number(ii[ri].value) || 0
            const nv = Math.max(0, Math.min(max, cur + (e.deltaY < 0 ? step : -step)))
            ii[ri].value = String(nv)
            rr[ri].value = String(nv)
            syncPct(rr[ri])
            applyPadChange(axis, ri === 0 ? 's' : 'e', nv)
        }
        rr[ri].addEventListener('wheel', wh, { passive: false })
        ii[ri].addEventListener('wheel', wh, { passive: false })
    })
    parent.appendChild(div)
}

function applyZoneChange(axis: 'x' | 'y', idx: number, sv: number | null, ev: number | null): void {
    pushUndo()
    const zones = axis === 'x' ? state.stretchX : state.stretchY
    const zone = zones[idx]
    if (sv != null) zone.start = Math.min(sv, zone.end - 1)
    if (ev != null) zone.end = Math.max(ev, zone.start + 1)
    renderBorderPixels()
    renderZoneOverlay()
    rebuildZones()
    renderPreviews()
}

function applyPadChange(axis: 'x' | 'y', edge: 's' | 'e', val: number): void {
    pushUndo()
    const pad = axis === 'x' ? state.paddingX : state.paddingY
    if (!pad) return
    if (edge === 's') pad.start = Math.min(val, pad.end - 1)
    else pad.end = Math.max(val, pad.start + 1)
    renderBorderPixels()
    renderZoneOverlay()
    rebuildZones()
    renderPreviews()
}

// Auto-detect zones

function autoDetectZones(): void {
    pushUndo()
    const se = state.mode === 'shape' && state.shadowEnabled
        ? Math.max(state.shadowBlur * 2 + Math.abs(state.shadowX), state.shadowBlur * 2 + Math.abs(state.shadowY)) + 4
        : 0
    const pad = Math.round((state.mode === 'shape' ? state.outerPadding : 0) + se)

    if (state.mode === 'shape' && state.shape !== 'ellipse') {
        const width = state.width, height = state.height
        const radius = Math.min(state.cornerRadius, width / 2, height / 2)
        const sxL = state.shadowEnabled ? Math.max(0, state.shadowX) : 0
        const sxR = state.shadowEnabled ? Math.max(0, -state.shadowX) : 0
        const syT = state.shadowEnabled ? Math.max(0, state.shadowY) : 0
        const syB = state.shadowEnabled ? Math.max(0, -state.shadowY) : 0
        if (width > 2 * radius) {
            state.stretchX = [{ start: Math.round(pad + radius + sxL), end: Math.round(pad + width - radius - sxR) }]
        } else {
            const cx = pad + width / 2
            state.stretchX = [{ start: Math.round(cx - width * 0.15), end: Math.round(cx + width * 0.15) }]
        }
        if (height > 2 * radius) {
            state.stretchY = [{ start: Math.round(pad + radius + syT), end: Math.round(pad + height - radius - syB) }]
        } else {
            const cy = pad + height / 2
            state.stretchY = [{ start: Math.round(cy - height * 0.15), end: Math.round(cy + height * 0.15) }]
        }
        const bHalf = state.borderEnabled ? state.borderWidth / 2 : 0
        const iX = width <= 2 * radius ? bHalf : Math.max(radius, bHalf)
        const iY = height <= 2 * radius ? bHalf : Math.max(radius, bHalf)
        state.paddingX = { start: Math.round(pad + iX), end: Math.round(pad + width - iX) }
        state.paddingY = { start: Math.round(pad + iY), end: Math.round(pad + height - iY) }
    } else {
        const w = canvas.width, h = canvas.height
        const imgData = ctx.getImageData(0, 0, w, h).data
        function al(x: number, y: number): number { return imgData[(y * w + x) * 4 + 3] }

        let x0: number, x1: number, y0: number, y1: number
        if (state.mode === 'shape') {
            x0 = pad; x1 = pad + state.width - 1; y0 = pad; y1 = pad + state.height - 1
        } else {
            x0 = w; x1 = -1; y0 = h; y1 = -1
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                if (al(x, y) > 0) {
                    if (x < x0) x0 = x
                    if (x > x1) x1 = x
                    if (y < y0) y0 = y
                    if (y > y1) y1 = y
                }
            }
            if (x1 < x0) return
        }
        const bw = x1 - x0 + 1, bh = y1 - y0 + 1

        let Mx = 0
        for (let x = x0; x <= x1; x++) Mx = Math.max(Mx, al(x, y0), al(x, y1))
        let zX: Zone | null = null
        if (Mx > 0) {
            let zs = -1, ze = -1
            for (let x = x0; x <= x1; x++) {
                if (al(x, y0) === Mx || al(x, y1) === Mx) { if (zs < 0) zs = x; ze = x + 1 }
            }
            if (zs >= 0) zX = { start: zs, end: ze }
        }

        let My = 0
        for (let y = y0; y <= y1; y++) My = Math.max(My, al(x0, y), al(x1, y))
        let zY: Zone | null = null
        if (My > 0) {
            let zs = -1, ze = -1
            for (let y = y0; y <= y1; y++) {
                if (al(x0, y) === My || al(x1, y) === My) { if (zs < 0) zs = y; ze = y + 1 }
            }
            if (zs >= 0) zY = { start: zs, end: ze }
        }

        if (!zX) { const cx = (x0 + x1) / 2, hw = bw * 0.15; zX = { start: Math.round(cx - hw), end: Math.round(cx + hw) } }
        if (!zY) { const cy = (y0 + y1) / 2, hh = bh * 0.15; zY = { start: Math.round(cy - hh), end: Math.round(cy + hh) } }

        state.stretchX = [{ start: zX.start, end: zX.end }]
        state.stretchY = [{ start: zY.start, end: zY.end }]

        if (state.mode === 'shape') {
            const width = state.width, height = state.height
            state.paddingX = { start: pad, end: pad + width }
            state.paddingY = { start: pad, end: pad + height }
        } else {
            state.paddingX = { start: x0, end: x1 + 1 }
            state.paddingY = { start: y0, end: y1 + 1 }
        }
    }

    renderBorderPixels()
    renderZoneOverlay()
    rebuildZones()
    renderPreviews()
}

autoDetectBtn.addEventListener('click', e => { e.stopPropagation(); autoDetectZones() })

// Preview background and poster

let pvLightBg = isLightTheme()
let pvUserToggled = false
let pvShowPoster = true

// The preview cards are static in the markup; resolve them once.
const pvCards = Array.from(document.querySelectorAll('.pv-card'))

function applyPvBg(): void {
    pvBgToggle.classList.toggle('on', pvLightBg)
    pvBgLabel.textContent = pvLightBg ? 'Light' : 'Dark'
    pvCards.forEach(card => {
        card.classList.toggle('light', pvLightBg)
        card.classList.toggle('dark', !pvLightBg)
    })
    viewport.classList.toggle('light', pvLightBg)
    viewport.classList.toggle('dark', !pvLightBg)
}

applyPvBg()

// Sync the preview background default to the theme once theme classes arrive.
const _themeObs = new MutationObserver(() => {
    if (!pvUserToggled) { pvLightBg = isLightTheme(); applyPvBg(); renderPreviews() }
    _themeObs.disconnect()
})
_themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

pvBgToggle.addEventListener('click', () => {
    pvUserToggled = true
    pvLightBg = !pvLightBg
    applyPvBg()
    renderPreviews()
})

pvPosterToggle.addEventListener('click', () => {
    pvShowPoster = !pvShowPoster
    pvPosterToggle.classList.toggle('on', pvShowPoster)
    renderPreviews()
})

// Preview rendering

function draw9(dc: CanvasRenderingContext2D, sc: HTMLCanvasElement, zones: { stretchX: Zone[]; stretchY: Zone[] }, tw: number, th: number): { fw: number; fh: number } {
    if (!zones.stretchX.length || !zones.stretchY.length) {
        dc.drawImage(sc, 0, 0, tw, th)
        return { fw: sc.width, fh: sc.height }
    }
    const cs = bseg(zones.stretchX, sc.width)
    const rs = bseg(zones.stretchY, sc.height)
    const sw = cs.filter((seg: Segment) => seg.stretchable).reduce((sum: number, seg: Segment) => sum + seg.length, 0)
    const fw = cs.filter((seg: Segment) => !seg.stretchable).reduce((sum: number, seg: Segment) => sum + seg.length, 0)
    const sh = rs.filter((seg: Segment) => seg.stretchable).reduce((sum: number, seg: Segment) => sum + seg.length, 0)
    const fh = rs.filter((seg: Segment) => !seg.stretchable).reduce((sum: number, seg: Segment) => sum + seg.length, 0)
    const ew = Math.max(0, tw - fw)
    const eh = Math.max(0, th - fh)
    let dy = 0
    for (const row of rs) {
        const dh = row.stretchable ? (sh > 0 ? Math.round(row.length / sh * eh) : 0) : row.length
        let dx = 0
        for (const col of cs) {
            const dw = col.stretchable ? (sw > 0 ? Math.round(col.length / sw * ew) : 0) : col.length
            if (dw > 0 && dh > 0) dc.drawImage(sc, col.position, row.position, col.length, row.length, dx, dy, dw, dh)
            dx += dw
        }
        dy += dh
    }
    return { fw, fh }
}

function drawMoviePoster(context: CanvasRenderingContext2D, w: number, h: number): void {
    const lg = w > 120
    const bg = context.createLinearGradient(0, 0, 0, h)
    bg.addColorStop(0, '#020c14'); bg.addColorStop(0.5, '#030810'); bg.addColorStop(1, '#080205')
    context.fillStyle = bg; context.fillRect(0, 0, w, h)
    const neb1 = context.createRadialGradient(w * 0.14, h * 0.44, 0, w * 0.14, h * 0.44, w * 0.68)
    neb1.addColorStop(0, 'rgba(230,90,15,0.48)'); neb1.addColorStop(0.35, 'rgba(190,55,10,0.24)'); neb1.addColorStop(1, 'rgba(110,20,5,0)')
    context.fillStyle = neb1; context.fillRect(0, 0, w, h)
    const neb2 = context.createRadialGradient(w * 0.84, h * 0.12, 0, w * 0.84, h * 0.12, w * 0.5)
    neb2.addColorStop(0, 'rgba(0,200,185,0.42)'); neb2.addColorStop(0.4, 'rgba(0,150,140,0.2)'); neb2.addColorStop(1, 'rgba(0,90,85,0)')
    context.fillStyle = neb2; context.fillRect(0, 0, w, h)
    const stars: Array<[number, number, number, string]> = [[0.08,0.06,1,'255,255,255'],[0.22,0.1,0.9,'255,238,190'],[0.41,0.04,1,'255,255,255'],[0.58,0.09,0.9,'190,240,255'],[0.72,0.06,0.8,'255,255,255'],[0.88,0.14,1,'255,238,190'],[0.95,0.05,0.85,'190,240,255'],[0.33,0.2,0.72,'255,255,255'],[0.63,0.17,0.9,'255,238,190'],[0.82,0.22,0.78,'255,255,255'],[0.14,0.28,0.7,'190,240,255'],[0.48,0.25,0.82,'255,255,255'],[0.76,0.31,0.68,'255,238,190'],[0.92,0.27,0.95,'255,255,255'],[0.05,0.38,0.62,'190,240,255'],[0.27,0.35,0.76,'255,255,255']]
    for (const [sx, sy, op, col] of stars) { context.fillStyle = 'rgba(' + col + ',' + String(op) + ')'; context.beginPath(); context.arc(sx * w, sy * h, lg ? 1 : 0.7, 0, Math.PI * 2); context.fill() }
    const pr = h * 0.19, px = w * 0.72, py = h * 0.28
    const plt = context.createRadialGradient(px - pr * 0.35, py - pr * 0.35, 0, px, py, pr)
    plt.addColorStop(0, 'rgba(255,215,100,1)'); plt.addColorStop(0.28, 'rgba(245,140,35,0.95)'); plt.addColorStop(0.58, 'rgba(200,65,15,0.78)'); plt.addColorStop(0.82, 'rgba(140,25,8,0.4)'); plt.addColorStop(1, 'rgba(80,8,3,0)')
    context.fillStyle = plt; context.beginPath(); context.arc(px, py, pr, 0, Math.PI * 2); context.fill()
    const patm = context.createRadialGradient(px, py, pr * 0.72, px, py, pr * 1.25)
    patm.addColorStop(0, 'rgba(0,190,170,0)'); patm.addColorStop(0.45, 'rgba(0,210,185,0.22)'); patm.addColorStop(1, 'rgba(0,180,160,0)')
    context.fillStyle = patm; context.beginPath(); context.arc(px, py, pr * 1.25, 0, Math.PI * 2); context.fill()
    context.save(); context.beginPath(); context.arc(px, py, pr, 0, Math.PI * 2); context.strokeStyle = 'rgba(255,225,140,0.55)'; context.lineWidth = lg ? 1.5 : 1; context.stroke(); context.restore()
    const haze = context.createLinearGradient(0, h * 0.64, 0, h)
    haze.addColorStop(0, 'rgba(190,55,8,0)'); haze.addColorStop(0.22, 'rgba(230,80,10,0.32)'); haze.addColorStop(0.55, 'rgba(170,40,5,0.22)'); haze.addColorStop(1, 'rgba(80,12,3,0.12)')
    context.fillStyle = haze; context.fillRect(0, h * 0.64, w, h * 0.36)
    const fy = h * 0.93, fs = h * (lg ? 0.27 : 0.25), fx = w * 0.24
    context.fillStyle = '#000'
    context.beginPath(); context.arc(fx, fy - fs * 0.72, fs * 0.11, 0, Math.PI * 2); context.fill()
    context.fillRect(fx - fs * 0.1, fy - fs * 0.62, fs * 0.2, fs * 0.48)
    context.fillRect(fx - fs * 0.1, fy - fs * 0.14, fs * 0.08, fs * 0.22)
    context.fillRect(fx + fs * 0.02, fy - fs * 0.14, fs * 0.08, fs * 0.22)
    context.fillRect(fx + fs * 0.1, fy - fs * 0.56, fs * 0.07, fs * 0.3)
    const tfs = lg ? 10 : 7
    context.save(); context.shadowColor = 'rgba(255,150,20,0.95)'; context.shadowBlur = lg ? 9 : 6
    context.fillStyle = '#ffe588'; context.font = '700 ' + String(tfs) + 'px -apple-system,BlinkMacSystemFont,sans-serif'
    context.textAlign = 'center'; context.textBaseline = 'alphabetic'; context.fillText('DARK ORBIT', w * 0.62, h * 0.46); context.restore()
    context.fillStyle = 'rgba(80,220,205,0.85)'; context.font = '400 ' + String(lg ? 5.5 : 4) + 'px -apple-system,sans-serif'
    context.textAlign = 'center'; context.textBaseline = 'alphabetic'; context.fillText('A STORY BEYOND THE STARS', w * 0.62, h * 0.56)
    context.fillStyle = 'rgba(210,145,55,0.7)'; context.font = '400 ' + String(lg ? 5 : 3.5) + 'px -apple-system,sans-serif'
    context.fillText('2157', w * 0.62, h * 0.63)
    const bww = lg ? 18 : 14, bh2 = lg ? 8 : 6, bx = w * 0.05, by = h * 0.055
    context.fillStyle = 'rgba(255,210,100,0.1)'; context.strokeStyle = 'rgba(255,210,100,0.55)'; context.lineWidth = 0.6
    context.fillRect(bx, by, bww, bh2); context.strokeRect(bx, by, bww, bh2)
    context.fillStyle = 'rgba(255,218,120,0.96)'; context.font = '700 ' + String(lg ? 5 : 4) + 'px -apple-system,sans-serif'
    context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText('TV-14', bx + bww / 2, by + bh2 / 2)
}

interface DrawPvState {
    stretchX: Zone[]
    stretchY: Zone[]
    paddingX: Zone | null
    paddingY: Zone | null
}

function drawPv(id: string, tw: number, th: number, isBtn: boolean, is720: boolean): void {
    const pc = document.getElementById(id) as HTMLCanvasElement
    const context = pc.getContext('2d') as CanvasRenderingContext2D
    pc.width = tw; pc.height = th
    context.clearRect(0, 0, tw, th)
    let src: HTMLCanvasElement = canvas
    let srcState: DrawPvState = {
        stretchX: state.stretchX, stretchY: state.stretchY,
        paddingX: state.paddingX, paddingY: state.paddingY,
    }
    if (is720) {
        const scaled = make720Source()
        src = scaled.src
        srcState = scaled.zones
    }
    if (!isBtn && pvShowPoster) {
        let cx = 0, cy = 0, cw = tw, ch = th
        if (srcState.paddingX && srcState.paddingY && srcState.stretchX.length && srcState.stretchY.length) {
            const csX = bseg(srcState.stretchX, src.width)
            const csY = bseg(srcState.stretchY, src.height)
            cx = outPos(srcState.paddingX.start, csX, tw)
            cy = outPos(srcState.paddingY.start, csY, th)
            cw = outPos(srcState.paddingX.end, csX, tw) - cx
            ch = outPos(srcState.paddingY.end, csY, th) - cy
        }
        if (cw > 0 && ch > 0) {
            context.save(); context.beginPath(); context.rect(cx, cy, cw, ch); context.clip()
            context.translate(cx, cy); drawMoviePoster(context, cw, ch); context.restore()
        }
    }
    const { fw, fh } = draw9(context, src, srcState, tw, th)
    let warnEl = pc.nextElementSibling as HTMLElement | null
    if (!warnEl || !warnEl.classList.contains('pv-size-warn')) {
        warnEl = document.createElement('div')
        warnEl.className = 'pv-size-warn'
        warnEl.innerHTML = '<svg viewBox="0 0 16 16"><path d="M8 2L1 14h14L8 2z"/><line x1="8" y1="7" x2="8" y2="10"/><circle cx="8" cy="12.5" r=".5" fill="#e03535" stroke="none"/></svg><span></span>'
        pc.parentNode!.insertBefore(warnEl, pc.nextSibling)
    }
    if (srcState.stretchX.length && srcState.stretchY.length) {
        const tooSmall = tw < fw || th < fh
        warnEl.classList.toggle('visible', tooSmall)
        if (tooSmall) {
            warnEl.querySelector('span')!.textContent = 'Min size: ' + fw + '\xd7' + fh + 'px'
            context.save(); context.fillStyle = 'rgba(220,40,40,0.15)'; context.fillRect(0, 0, tw, th)
            context.strokeStyle = 'rgba(220,40,40,0.6)'; context.lineWidth = 1; context.strokeRect(0.5, 0.5, tw - 1, th - 1); context.restore()
        }
    } else {
        warnEl.classList.remove('visible')
    }
    if (isBtn) {
        let cx = 0, cy = 0, cw = tw, ch = th
        if (srcState.paddingX && srcState.paddingY && srcState.stretchX.length && srcState.stretchY.length) {
            const csX = bseg(srcState.stretchX, src.width)
            const csY = bseg(srcState.stretchY, src.height)
            cx = outPos(srcState.paddingX.start, csX, tw)
            cy = outPos(srcState.paddingY.start, csY, th)
            cw = outPos(srcState.paddingX.end, csX, tw) - cx
            ch = outPos(srcState.paddingY.end, csY, th) - cy
        }
        const sx = Math.max(0, Math.floor(cx + cw / 2 - 4))
        const sy = Math.max(0, Math.floor(cy + ch / 2 - 4))
        const sw = Math.min(8, tw - sx), sh = Math.min(8, th - sy)
        const sd = context.getImageData(sx, sy, sw, sh).data
        let rSum = 0, gSum = 0, bSum = 0, aSum = 0
        for (let i = 0; i < sd.length; i += 4) {
            const alpha = sd[i + 3]
            if (alpha > 0) { rSum += sd[i] * alpha; gSum += sd[i + 1] * alpha; bSum += sd[i + 2] * alpha; aSum += alpha }
        }
        let txtColor = isLightTheme() ? '#1a1a2e' : '#f4f6ff'
        if (aSum > 0) {
            const red = rSum / aSum, green = gSum / aSum, blue = bSum / aSum
            const lum = 0.299 * red + 0.587 * green + 0.114 * blue
            txtColor = lum > 140 ? '#1a1a2e' : '#f4f6ff'
        }
        const fs = th > 40 ? 14 : 10
        context.font = '600 ' + String(fs) + 'px -apple-system,BlinkMacSystemFont,sans-serif'
        const label = 'Not a Real Button'
        let txt = label
        if (cw > 0 && context.measureText(txt).width > cw) {
            while (txt.length > 0 && context.measureText(txt + '...').width > cw) txt = txt.slice(0, -1)
            txt += '...'
        }
        const metrics = context.measureText(txt)
        const textY = cy + ch / 2 + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2
        context.fillStyle = txtColor; context.textAlign = 'center'; context.textBaseline = 'alphabetic'
        context.save()
        if (cw > 0 && ch > 0) { context.beginPath(); context.rect(cx, cy, cw, ch); context.clip() }
        context.fillText(txt, cx + cw / 2, textY)
        context.restore()
    }
}

function renderPreviews(): void {
    drawPv('pvBtn1080', 189, 45, true, false)
    drawPv('pvFrame1080', 147, 221, false, false)
    drawPv('pvBtn720', Math.round(189 * S720), Math.round(45 * S720), true, true)
    drawPv('pvFrame720', Math.round(147 * S720), Math.round(221 * S720), false, true)
}

// Undo/Redo

function pushUndo(): void {
    undoStack.push(JSON.parse(JSON.stringify(state)) as EditorState)
    redoStack.length = 0
    if (undoStack.length > 100) undoStack.shift()
    updateUndoButtons()
}

function doUndo(): void {
    if (!undoStack.length) return
    redoStack.push(JSON.parse(JSON.stringify(state)) as EditorState)
    Object.assign(state, undoStack.pop())
    syncInputs()
    renderAll()
    updateUndoButtons()
}

function doRedo(): void {
    if (!redoStack.length) return
    undoStack.push(JSON.parse(JSON.stringify(state)) as EditorState)
    Object.assign(state, redoStack.pop())
    syncInputs()
    renderAll()
    updateUndoButtons()
}

function updateUndoButtons(): void {
    undoBtn.disabled = !undoStack.length
    redoBtn.disabled = !redoStack.length
}

// Filename helpers

function updateFilenameDisplay(): void {
    const fn = state.importedFileName
    if (fn) { toolbarFilename.textContent = fn; toolbarFilename.style.display = 'block' }
    else { toolbarFilename.style.display = 'none' }
}

function exportBaseName(): string {
    const fn = state.importedFileName
    if (!fn) return state.shape || 'asset'
    let baseName = fn
    if (baseName.endsWith('.9.png')) baseName = baseName.slice(0, -6)
    else { const di = baseName.lastIndexOf('.'); if (di > 0) baseName = baseName.slice(0, di) }
    baseName = baseName.replace(/_fhd$/, '').replace(/_hd$/, '')
    return baseName || 'asset'
}

// State reset (doNew)

function doNew(): void {
    Object.assign(state, defaultShapeState())
    undoStack.length = 0
    redoStack.length = 0
    updateUndoButtons()
    updateFilenameDisplay()
    syncInputs()
    renderAll()
    requestAnimationFrame(centerCanvas)
}

// Import flow

function doImport(): void {
    const api = window.rokdock
    if (!api || !api.ninepatch) return
    loadingOverlay.classList.add('show')
    void api.ninepatch.importImage().then((result: { ok?: boolean } | null | undefined) => {
        if (!result || !result.ok) loadingOverlay.classList.remove('show')
        // On success, main sends an importData command with the loaded image
    })
}

// 9-patch border parser

function parseNP(context: CanvasRenderingContext2D, w: number, h: number): void {
    const data = context.getImageData(0, 0, w, h).data
    function ib(x: number, y: number): boolean {
        const i = (y * w + x) * 4
        return data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 255
    }
    state.stretchX = detectRuns(1, w - 1, x => ib(x, 0)).map(run => ({ start: run.start - 1, end: run.end - 1 }))
    state.stretchY = detectRuns(1, h - 1, y => ib(0, y)).map(run => ({ start: run.start - 1, end: run.end - 1 }))
    const px = detectRuns(1, w - 1, x => ib(x, h - 1))
    state.paddingX = px.length ? { start: px[0].start - 1, end: px[px.length - 1].end - 1 } : null
    const py = detectRuns(1, h - 1, y => ib(w - 1, y))
    state.paddingY = py.length ? { start: py[0].start - 1, end: py[py.length - 1].end - 1 } : null
}

/** Applies an image the main process loaded and delivered over the importData command. */
function applyImportedImage(data: Extract<NinePatchCommand, { type: 'importData' }>): void {
    pushUndo()
    state.mode = 'imported'
    state.importedDataUrl = data.dataUrl
    state.importedFileName = data.fileName
    const img = new Image()
    img.onload = () => {
        let w = img.naturalWidth, h = img.naturalHeight
        if (data.isNinePatch && w > 2 && h > 2) {
            canvas.width = w; canvas.height = h
            ctx.drawImage(img, 0, 0)
            parseNP(ctx, w, h)
            state.parsedStretchX = state.stretchX.map(zone => ({ ...zone }))
            state.parsedStretchY = state.stretchY.map(zone => ({ ...zone }))
            state.parsedPaddingX = state.paddingX ? { ...state.paddingX } : null
            state.parsedPaddingY = state.paddingY ? { ...state.paddingY } : null
            const inner = ctx.getImageData(1, 1, w - 2, h - 2)
            w -= 2; h -= 2
            canvas.width = w; canvas.height = h
            ctx.putImageData(inner, 0, 0)
        } else {
            canvas.width = w; canvas.height = h
            ctx.drawImage(img, 0, 0)
            state.stretchX = []; state.stretchY = []
            state.paddingX = null; state.paddingY = null
            state.parsedStretchX = null; state.parsedStretchY = null
            state.parsedPaddingX = null; state.parsedPaddingY = null
        }
        state.width = w; state.height = h
        zoomSizer.style.display = 'inline-block'
        canvasContainer.style.display = 'inline-block'
        emptyState.style.display = 'none'
        hasAsset = true
        export1080Btn.disabled = false
        export720Btn.disabled = false
        renderBorderPixels()
        renderZoneOverlay()
        rebuildZones()
        renderPreviews()
        applyZoom()
        updateFilenameDisplay()
        loadingOverlay.classList.remove('show')
        requestAnimationFrame(() => {
            zoomDock.dispatchEvent(new CustomEvent('rokdock-fit', { bubbles: true }))
        })
    }
    img.onerror = () => { loadingOverlay.classList.remove('show') }
    img.src = data.dataUrl
}

// Export

function build9PatchDataUrl(src: HTMLCanvasElement, zones: { stretchX: Zone[]; stretchY: Zone[]; paddingX: Zone | null; paddingY: Zone | null }): string {
    const w = src.width, h = src.height
    const nc = document.createElement('canvas')
    nc.width = w + 2; nc.height = h + 2
    const context = nc.getContext('2d') as CanvasRenderingContext2D
    context.clearRect(0, 0, w + 2, h + 2)
    context.drawImage(src, 1, 1)
    context.fillStyle = 'rgba(0,0,0,1)'
    ;(zones.stretchX || []).forEach(zone => { context.fillRect(zone.start + 1, 0, zone.end - zone.start, 1) })
    ;(zones.stretchY || []).forEach(zone => { context.fillRect(0, zone.start + 1, 1, zone.end - zone.start) })
    if (zones.paddingX) context.fillRect(zones.paddingX.start + 1, h + 1, zones.paddingX.end - zones.paddingX.start, 1)
    if (zones.paddingY) context.fillRect(w + 1, zones.paddingY.start + 1, 1, zones.paddingY.end - zones.paddingY.start)
    return nc.toDataURL('image/png')
}

// Build a 720p-scaled copy of the editor canvas and the matching 720p-scaled
// zones. Shared by the 720p preview and both export paths.
function make720Source(): { src: HTMLCanvasElement; zones: DrawPvState } {
    const sc = document.createElement('canvas')
    sc.width = Math.round(canvas.width * S720); sc.height = Math.round(canvas.height * S720)
    ;(sc.getContext('2d') as CanvasRenderingContext2D).drawImage(canvas, 0, 0, sc.width, sc.height)
    return {
        src: sc,
        zones: {
            stretchX: scaleZones720(state.stretchX),
            stretchY: scaleZones720(state.stretchY),
            paddingX: scalePad720(state.paddingX),
            paddingY: scalePad720(state.paddingY),
        },
    }
}

function exportSingle(is720: boolean): void {
    if (!hasAsset) return
    let src: HTMLCanvasElement = canvas
    let zones: DrawPvState = { stretchX: state.stretchX, stretchY: state.stretchY, paddingX: state.paddingX, paddingY: state.paddingY }
    if (is720) {
        const scaled = make720Source()
        src = scaled.src
        zones = scaled.zones
    }
    const du = build9PatchDataUrl(src, zones)
    const base = exportBaseName()
    const api = window.rokdock
    if (api && api.ninepatch) {
        void api.ninepatch.exportSingle(du, is720 ? base + '_hd.9.png' : base + '_fhd.9.png')
    }
}

function triggerExport(): void {
    if (!hasAsset) return
    const base = exportBaseName()
    const zones = { stretchX: state.stretchX, stretchY: state.stretchY, paddingX: state.paddingX, paddingY: state.paddingY }
    const du1080 = build9PatchDataUrl(canvas, zones)
    const scaled = make720Source()
    const du720 = build9PatchDataUrl(scaled.src, scaled.zones)
    const api = window.rokdock
    if (api && api.ninepatch) void api.ninepatch.exportImage(du1080, du720, zones, base)
}

// Center canvas

function centerCanvas(): void {
    const margin = parseFloat(zoomSizer.style.margin) || 200
    const zm = ZONE_MARGIN
    const zf = state.zoom / 100
    const uw = canvas.width + 2 + zm * 2, uh = canvas.height + 2 + zm * 2
    const ox = uw / 2 - (zm + 1), oy = uh / 2 - (zm + 1)
    const cx = margin + ox * zf, cy = margin + oy * zf
    viewport.scrollLeft = Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth, cx - viewport.clientWidth / 2))
    viewport.scrollTop = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, cy - viewport.clientHeight / 2))
}

// Guides toggle

let guidesVisible = true

guidesBtn.addEventListener('click', () => {
    guidesVisible = !guidesVisible
    guidesBtn.classList.toggle('dock-dim', !guidesVisible)
    guidesBtn.title = guidesVisible ? 'Hide guides' : 'Show guides'
    zoneOverlay.style.display = guidesVisible ? '' : 'none'
    if (guidesVisible) renderZoneOverlay()
})

// Sync state from inputs

function numVal(id: string, fallback: number): number {
    const value = Number((document.getElementById(id) as HTMLInputElement).value)
    return isNaN(value) ? fallback : value
}

function clamp01(id: string, fallback: number): number {
    return Math.max(0, Math.min(100, numVal(id, fallback)))
}

function syncState(): void {
    state.shape = (document.getElementById('shapeType') as HTMLSelectElement).value as 'rectangle' | 'ellipse'
    state.width = Math.max(4, numVal('shapeWidth', 120))
    state.height = Math.max(4, numVal('shapeHeight', 60))
    state.cornerRadius = Math.max(0, numVal('cornerRadius', 0))
    state.fillColor = (document.getElementById('fillColor') as HTMLInputElement).value
    state.fillOpacity = clamp01('fillOpacity', 100)
    state.borderColor = (document.getElementById('borderColor') as HTMLInputElement).value
    state.borderWidth = Math.max(0, numVal('borderWidth', 0))
    state.borderOpacity = clamp01('borderOpacity', 100)
    state.shadowColor = (document.getElementById('shadowColor') as HTMLInputElement).value
    state.shadowOpacity = clamp01('shadowOpacity', 50)
    state.shadowX = numVal('shadowX', 0)
    state.shadowY = numVal('shadowY', 0)
    state.shadowBlur = Math.max(0, numVal('shadowBlur', 0))
    state.outerPadding = Math.max(0, numVal('outerPadding', 0))
}

function syncInputs(): void {
    ;(document.getElementById('shapeType') as HTMLSelectElement).value = state.shape
    const fields: Record<string, unknown> = {
        shapeWidth: state.width, shapeHeight: state.height, cornerRadius: state.cornerRadius,
        fillColor: state.fillColor, fillOpacity: state.fillOpacity,
        borderColor: state.borderColor, borderWidth: state.borderWidth, borderOpacity: state.borderOpacity,
        shadowColor: state.shadowColor, shadowOpacity: state.shadowOpacity,
        shadowX: state.shadowX, shadowY: state.shadowY, shadowBlur: state.shadowBlur,
        outerPadding: state.outerPadding,
    }
    for (const [id, val] of Object.entries(fields)) {
        const element = document.getElementById(id) as HTMLInputElement | null
        if (element) element.value = String(val)
    }
    RANGE_INPUT_PAIRS.forEach(([rId, iId]) => {
        const range = document.getElementById(rId) as HTMLInputElement | null
        const inp = document.getElementById(iId) as HTMLInputElement | null
        if (range && inp) { range.value = inp.value; syncPct(range) }
    })
    ;(document.getElementById('fillToggle') as HTMLButtonElement).classList.toggle('on', state.fillEnabled)
    ;(document.getElementById('borderToggle') as HTMLButtonElement).classList.toggle('on', state.borderEnabled)
    ;(document.getElementById('shadowToggle') as HTMLButtonElement).classList.toggle('on', state.shadowEnabled)
    ;(document.getElementById('cornerRadiusField') as HTMLElement).style.display = state.shape === 'ellipse' ? 'none' : 'grid'
    update720()
}

function onInputChange(): void {
    pushUndo()
    syncState()
    renderAll()
}

function renderAll(): void {
    if (state.mode === 'shape') renderShape()
    renderBorderPixels()
    renderZoneOverlay()
    rebuildZones()
    renderPreviews()
    update720()
    applyZoom()
}

// Wire inputs

;['shapeType', 'fillColor', 'borderColor', 'shadowColor'].forEach(id => {
    const element = document.getElementById(id)
    if (element) element.addEventListener('input', onInputChange)
})

// onInputChange runs syncState + renderAll but NOT syncInputs, so the
// corner-radius field visibility (which syncInputs owns) is not updated on a
// shape-type change through that path. This dedicated listener keeps it in sync.
;(document.getElementById('shapeType') as HTMLSelectElement).addEventListener('change', () => {
    ;(document.getElementById('cornerRadiusField') as HTMLElement).style.display =
        (document.getElementById('shapeType') as HTMLSelectElement).value === 'ellipse' ? 'none' : 'grid'
})

// Button handlers

newBtn.addEventListener('click', doNew)
importBtn.addEventListener('click', doImport)
export1080Btn.addEventListener('click', () => exportSingle(false))
export720Btn.addEventListener('click', () => exportSingle(true))
undoBtn.addEventListener('click', doUndo)
redoBtn.addEventListener('click', doRedo)

// Keyboard shortcuts

document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); doUndo() }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); doRedo() }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); doNew() }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); doImport() }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); triggerExport() }
})

// Main drives the File/Edit menu actions through the typed tool-window command channel.
window.rokdock.toolWindow.onCommand((raw: unknown) => {
    const command = raw as NinePatchCommand
    switch (command.type) {
        case 'new': doNew(); break
        case 'import': doImport(); break // asks main to open the file dialog
        case 'importData': applyImportedImage(command); break // main delivered the loaded image
        case 'export': triggerExport(); break
        case 'undo': doUndo(); break
        case 'redo': doRedo(); break
        case 'toast': showToast(command.message); break
        default: command satisfies never
    }
})

// Boot

syncInputs()
renderAll()
requestAnimationFrame(() => {
    zoomDock.dispatchEvent(new CustomEvent('rokdock-fit', { bubbles: true }))
})

// Standalone CLI launch: pull any file the main process loaded for us.
void (async () => {
    const initial = await window.rokdock.ninepatch.getInitialData()
    if (initial.data) {
        applyImportedImage({ type: 'importData', ...initial.data })
    } else if (initial.error) {
        showToast(initial.error)
    }
})()
