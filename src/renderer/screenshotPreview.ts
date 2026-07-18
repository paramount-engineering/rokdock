/**
 * Screenshot Preview tool window - bundled Vite renderer entry.
 *
 * Shows the latest Roku screenshot with zoom, pan, pixel measure, onion-skin
 * overlay comparison, auto-refresh, and a live capture-device feed. Replaces the
 * former runtime-injected HTML template.
 *
 * Boot pulls initial state via screenshot-preview:get-initial-data. All file-based
 * images (screenshots, overlays) arrive as `data:` URLs from main, since this page
 * runs under a tight CSP (img-src 'self' data:). Renderer actions invoke typed
 * channels on window.rokdock.screenshotPreview; main pushes updates back via
 * onMessage. The renderer also pushes its live UI state so main's right-click menu
 * stays accurate without an executeJavaScript pull.
 */

import { bootBundledTheme } from '@shared/entryBootstrap'
import './appearanceModalTrigger'
import { createToast } from '@shared/toast'
import './screenshotPreview.css'
import {
    faRotateRight,
    faFloppyDisk,
    faFileExport,
    faCopy,
    faClone,
    faRulerCombined,
    faLayerGroup,
    faVideo,
    faCamera,
    faChevronDown,
    faChevronRight,
    faXmark
} from '@fortawesome/free-solid-svg-icons'
import { faSvg } from '@shared/icons'
import { escapeHtml } from '@shared/htmlEscape'
import {
    fitZoomPercent,
    snapZoomPercent,
    measureDelta,
    measureLabelText,
    measureTickFractions,
    type MeasurePoint
} from './screenshotPreviewGeometry'
import { videoFrameToPngDataUrl } from './utils/videoFrame'
import type {
    OnionOverlayMenuEntryForPreview,
    ScreenshotHistoryEntryForPreview,
    ScreenshotPreviewMessage,
    ScreenshotPreviewState
} from '@shared/screenshotPreviewProtocol'
import type { AppPreferences } from '@shared/types'

void bootBundledTheme()

// -- Constants -------------------------------------------------------------------

/** Debounce before persisting preview preferences after a zoom/opacity change. */
const PREFS_PERSIST_DEBOUNCE_MS = 220
const MIN_ZOOM = 10
const MAX_ZOOM = 300
const ZOOM_SNAP_PERCENT = 100
const ZOOM_SNAP_THRESHOLD = 2
/** Tick spacing for the pixel-measure ruler, in image (natural) pixels. */
const MEASURE_TICK_STEP = 20

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

// -- DOM references ------------------------------------------------------------

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const refreshBtn = byId<HTMLButtonElement>('refreshBtn')
const autoRefreshBtn = byId<HTMLButtonElement>('autoRefreshBtn')
const autoRefreshInterval = byId<HTMLSelectElement>('autoRefreshInterval')
const saveBtn = byId<HTMLButtonElement>('saveBtn')
const saveWithOverlayBtn = byId<HTMLButtonElement>('saveWithOverlayBtn')
const copyBtn = byId<HTMLButtonElement>('copyBtn')
const copyWithOverlayBtn = byId<HTMLButtonElement>('copyWithOverlayBtn')
const measureBtn = byId<HTMLButtonElement>('measureBtn')
const onionLoadToolbarBtn = byId<HTMLButtonElement>('onionLoadToolbarBtn')
const captureToggleBtn = byId<HTMLButtonElement>('captureToggleBtn')
const captureIconStore = byId<HTMLSpanElement>('captureIconStore')
const historyBtn = byId<HTMLButtonElement>('historyBtn')
const historyPanel = byId<HTMLDivElement>('historyPanel')
const viewport = byId<HTMLDivElement>('viewport')
const screenshotPlaceholder = byId<HTMLDivElement>('screenshotPlaceholder')
const shot = byId<HTMLImageElement>('shot')
const captureVideo = byId<HTMLVideoElement>('captureVideo')
const onionSkin = byId<HTMLImageElement>('onionSkin')
const measureSvg = document.getElementById('measureSvg') as unknown as SVGSVGElement
const measureLabel = byId<HTMLDivElement>('measureLabel')
const zoomDock = byId<HTMLElement>('zoomDock')
const zoomDockWrap = byId<HTMLDivElement>('zoomDockWrap')
const countdown = byId<HTMLDivElement>('countdown')
const toast = byId<HTMLDivElement>('toast')
const onionOpacity = byId<HTMLInputElement>('onionOpacity')
const onionOpacityLabel = byId<HTMLDivElement>('onionOpacityLabel')
const onionClearBtn = byId<HTMLButtonElement>('onionClearBtn')
const onionPresetsBtn = byId<HTMLButtonElement>('onionPresetsBtn')
const onionPresetsPanel = byId<HTMLDivElement>('onionPresetsPanel')
const onionHistoryFlyout = byId<HTMLDivElement>('onionHistoryFlyout')

// -- Icons -----------------------------------------------------------------------

refreshBtn.innerHTML = faSvg(faRotateRight)
saveBtn.innerHTML = faSvg(faFloppyDisk)
saveWithOverlayBtn.innerHTML = faSvg(faFileExport)
copyBtn.innerHTML = faSvg(faCopy)
copyWithOverlayBtn.innerHTML = faSvg(faClone)
measureBtn.innerHTML = faSvg(faRulerCombined)
onionLoadToolbarBtn.innerHTML = faSvg(faLayerGroup)
captureToggleBtn.innerHTML = faSvg(faVideo)
captureIconStore.innerHTML = faSvg(faCamera)
byId<HTMLSpanElement>('onionPresetsChevron').innerHTML = faSvg(faChevronDown)
const chevronRightSvg = faSvg(faChevronRight)
onionClearBtn.innerHTML = faSvg(faXmark)

// -- State ---------------------------------------------------------------------

let prefsTimer: ReturnType<typeof setTimeout> | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let countdownTimer: ReturnType<typeof setInterval> | null = null
let autoRefreshEnabled = false
let isRefreshing = false
let countdownRemaining = 0
let zoomPercent = 100
let lastFitPercent = 100
let preserveZoomOnNextLoad = false
let naturalWidth = 0
let naturalHeight = 0
let dragging = false
let dragStartX = 0
let dragStartY = 0
let dragScrollLeft = 0
let dragScrollTop = 0
let overlayMouseInside = false
let lastMouseX = 0
let lastMouseY = 0
let hasMousePosition = false
let onionOpacityPercent = 50
let onionOverlayLoaded = false
let measureMode = false
let measuring = false
let measureStart: MeasurePoint | null = null
let measureEnd: MeasurePoint | null = null
let measureDragEndpoint: 'start' | 'end' | null = null
let screenshotHistoryEntries: ScreenshotHistoryEntryForPreview[] = []
let onionOverlayHistoryEntries: OnionOverlayMenuEntryForPreview[] = []
let onionBuiltinMenu: OnionOverlayMenuEntryForPreview[] = []
const allowedIntervals = new Set<string>()

// Capture-mode state.
let captureActive = false
let captureStream: MediaStream | null = null
let captureNaturalWidth = 0
let captureNaturalHeight = 0
let pendingCapturedSrc: string | null = null
const refreshIconDefault = refreshBtn.innerHTML
const refreshIconCapture = captureIconStore.innerHTML

const preview = window.rokdock.screenshotPreview

const measureLineColor = (): string =>
    getComputedStyle(document.documentElement).getPropertyValue('--rokdock-measure-line').trim() || '#00ff88'
const measureShadowColor = (): string =>
    getComputedStyle(document.documentElement).getPropertyValue('--rokdock-measure-shadow').trim() || 'rgba(0,0,0,0.5)'

// -- State push (keeps main's right-click menu accurate) -------------------------

function pushState(): void {
    const state: ScreenshotPreviewState = {
        autoRefreshEnabled,
        autoRefreshIntervalSec: Number(autoRefreshInterval.value) || 30,
        overlayActive: onionOverlayLoaded,
        captureActive
    }
    preview.pushState(state)
}

// -- Toast -----------------------------------------------------------------------

const showToast = createToast(toast)

function showPlaceholder(visible: boolean): void {
    screenshotPlaceholder.classList.toggle('hidden', !visible)
}

// -- History panel -------------------------------------------------------------

function renderHistoryPanel(): void {
    historyPanel.innerHTML = ''
    screenshotHistoryEntries.forEach((entry) => {
        const button = document.createElement('button')
        button.className = 'history-item'
        button.type = 'button'
        button.setAttribute('role', 'menuitem')
        const thumb = document.createElement('img')
        thumb.className = 'thumb'
        thumb.src = entry.thumbnailDataUrl
        thumb.alt = ''
        const label = document.createElement('span')
        label.className = 'label'
        label.textContent = entry.label
        button.appendChild(thumb)
        button.appendChild(label)
        button.addEventListener('click', () => { void showHistoryEntry(entry) })
        historyPanel.appendChild(button)
    })
    historyBtn.style.display = screenshotHistoryEntries.length ? '' : 'none'
}

async function showHistoryEntry(entry: ScreenshotHistoryEntryForPreview): Promise<void> {
    const result = await preview.showHistoryImage(entry.path)
    if (!result.ok || !result.dataUrl) {
        showToast('That screenshot is no longer available.')
        return
    }
    clearMeasureForNewShot()
    preserveZoomOnNextLoad = true
    shot.classList.remove('is-sized')
    shot.src = result.dataUrl
    closeHistoryPanel()
}

function closeHistoryPanel(): void {
    historyPanel.classList.remove('open')
    historyBtn.setAttribute('aria-expanded', 'false')
}

// -- Onion overlay presets -------------------------------------------------------

let flyoutCloseTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFlyoutClose(): void {
    flyoutCloseTimer = setTimeout(() => {
        onionHistoryFlyout.classList.remove('open')
        flyoutCloseTimer = null
    }, 150)
}

function cancelFlyoutClose(): void {
    if (flyoutCloseTimer) {
        clearTimeout(flyoutCloseTimer)
        flyoutCloseTimer = null
    }
}

function closeOnionPresetsPanel(): void {
    onionPresetsPanel.classList.remove('open')
    onionPresetsBtn.setAttribute('aria-expanded', 'false')
    cancelFlyoutClose()
    onionHistoryFlyout.classList.remove('open')
}

interface FlyoutItem {
    thumb: string
    label: string
    action: () => void
}

function openOverlayFlyout(items: FlyoutItem[], triggerEl: HTMLElement): void {
    onionHistoryFlyout.innerHTML = ''
    if (!items.length) {
        const empty = document.createElement('div')
        empty.className = 'onion-preset-empty'
        empty.textContent = 'No items available'
        onionHistoryFlyout.appendChild(empty)
    } else {
        items.forEach((item) => {
            const button = document.createElement('button')
            button.type = 'button'
            button.className = 'onion-preset-item'
            button.setAttribute('role', 'menuitem')
            button.title = item.label
            if (item.thumb) {
                const thumb = document.createElement('img')
                thumb.className = 'onion-preset-thumb'
                thumb.alt = ''
                thumb.loading = 'lazy'
                thumb.decoding = 'async'
                thumb.src = item.thumb
                button.appendChild(thumb)
            } else {
                const placeholder = document.createElement('span')
                placeholder.className = 'onion-preset-thumb-ph'
                placeholder.setAttribute('aria-hidden', 'true')
                button.appendChild(placeholder)
            }
            const labelElement = document.createElement('span')
            labelElement.className = 'onion-preset-label'
            labelElement.textContent = item.label
            button.appendChild(labelElement)
            button.addEventListener('click', item.action)
            onionHistoryFlyout.appendChild(button)
        })
    }
    const rect = triggerEl.getBoundingClientRect()
    const spaceRight = window.innerWidth - rect.right
    if (spaceRight >= 220) {
        onionHistoryFlyout.style.left = `${rect.right}px`
        onionHistoryFlyout.style.right = ''
        onionHistoryFlyout.style.maxWidth = `${Math.max(160, spaceRight)}px`
    } else {
        onionHistoryFlyout.style.left = ''
        onionHistoryFlyout.style.right = `${window.innerWidth - rect.left}px`
        onionHistoryFlyout.style.maxWidth = ''
    }
    const spaceBelow = window.innerHeight - rect.bottom
    if (spaceBelow >= rect.top) {
        onionHistoryFlyout.style.top = `${rect.top}px`
        onionHistoryFlyout.style.bottom = 'auto'
    } else {
        onionHistoryFlyout.style.top = 'auto'
        onionHistoryFlyout.style.bottom = `${window.innerHeight - rect.bottom}px`
    }
    onionHistoryFlyout.classList.add('open')
}

function appendFlyoutTrigger(panel: HTMLElement, label: string, getItems: () => FlyoutItem[]): void {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'onion-flyout-trigger'
    button.setAttribute('role', 'menuitem')
    button.setAttribute('aria-haspopup', 'true')
    const labelElement = document.createElement('span')
    labelElement.className = 'onion-preset-label'
    labelElement.textContent = label
    button.appendChild(labelElement)
    const chevron = document.createElement('span')
    chevron.className = 'flyout-chevron'
    chevron.innerHTML = chevronRightSvg
    button.appendChild(chevron)
    button.addEventListener('mouseenter', () => { cancelFlyoutClose(); openOverlayFlyout(getItems(), button) })
    button.addEventListener('mouseleave', () => scheduleFlyoutClose())
    panel.appendChild(button)
}

function renderOnionPresetsPanel(): void {
    onionPresetsPanel.innerHTML = ''
    onionHistoryFlyout.classList.remove('open')
    const loadBtn = document.createElement('button')
    loadBtn.type = 'button'
    loadBtn.className = 'onion-flyout-trigger'
    loadBtn.setAttribute('role', 'menuitem')
    const loadLabel = document.createElement('span')
    loadLabel.className = 'onion-preset-label'
    loadLabel.textContent = 'Load image...'
    loadBtn.appendChild(loadLabel)
    loadBtn.addEventListener('click', () => { closeOnionPresetsPanel(); void preview.pickOverlay() })
    onionPresetsPanel.appendChild(loadBtn)
    appendFlyoutTrigger(onionPresetsPanel, 'Built-in', () =>
        onionBuiltinMenu.map((entry) => ({
            thumb: entry.thumbnailDataUrl,
            label: entry.label,
            action: () => { closeOnionPresetsPanel(); void preview.applyOverlay(entry.ref) }
        }))
    )
    appendFlyoutTrigger(onionPresetsPanel, 'Recent', () =>
        onionOverlayHistoryEntries.map((entry) => ({
            thumb: entry.thumbnailDataUrl,
            label: entry.label,
            action: () => { closeOnionPresetsPanel(); void preview.applyOverlay(entry.ref) }
        }))
    )
    appendFlyoutTrigger(onionPresetsPanel, 'Screenshot History', () =>
        screenshotHistoryEntries.map((entry) => ({
            thumb: entry.thumbnailDataUrl,
            label: entry.label,
            action: () => { closeOnionPresetsPanel(); void applyHistoryAsOverlay(entry) }
        }))
    )
}

async function applyHistoryAsOverlay(entry: ScreenshotHistoryEntryForPreview): Promise<void> {
    const result = await preview.getImage(entry.path)
    if (result.ok && result.dataUrl) {
        applyOnionSrc(result.dataUrl)
    } else {
        showToast('That screenshot is no longer available.')
    }
}

// -- Onion overlay apply / clear -------------------------------------------------

function syncOnionUi(): void {
    onionSkin.style.opacity = String(onionOpacityPercent / 100)
    const op = Math.round(onionOpacityPercent)
    onionOpacity.value = String(op)
    onionOpacity.style.setProperty('--onion-pct', `${op}%`)
    onionOpacityLabel.textContent = `${op}%`
    onionOpacity.disabled = !onionOverlayLoaded
    onionClearBtn.style.display = (onionOverlayLoaded || !!onionSkin.getAttribute('src')) ? 'inline-flex' : 'none'
    onionSkin.classList.toggle('is-on', onionOverlayLoaded)
    saveWithOverlayBtn.disabled = !onionOverlayLoaded
    saveWithOverlayBtn.title = onionOverlayLoaded
        ? 'Save screenshot with comparison overlay baked in'
        : 'Load a comparison overlay first'
    copyWithOverlayBtn.disabled = !onionOverlayLoaded
    copyWithOverlayBtn.title = onionOverlayLoaded
        ? 'Copy screenshot with comparison overlay baked in - Ctrl+Shift+C'
        : 'Load a comparison overlay first (then Ctrl+Shift+C)'
}

function applyOnionSrc(src: string): void {
    if (!src) return
    onionOverlayLoaded = false
    syncOnionUi()
    const finishOnion = (): void => {
        onionOverlayLoaded = true
        syncOnionLayoutToShot()
        syncOnionUi()
        updateOverlayDim()
        pushState()
    }
    onionSkin.onload = finishOnion
    onionSkin.onerror = (): void => {
        onionOverlayLoaded = false
        onionSkin.removeAttribute('src')
        onionSkin.style.width = ''
        onionSkin.style.height = ''
        syncOnionUi()
        pushState()
        showToast('Comparison overlay failed to load.')
    }
    onionSkin.src = src
    if (onionSkin.complete && onionSkin.naturalWidth > 0) finishOnion()
}

function clearOnionOverlay(): void {
    onionOverlayLoaded = false
    onionSkin.removeAttribute('src')
    onionSkin.style.width = ''
    onionSkin.style.height = ''
    syncOnionUi()
    updateOverlayDim()
    pushState()
}

// -- Preference persistence ------------------------------------------------------

function persistPreviewPrefs(immediate: boolean): void {
    const write = (): void => {
        preview.savePrefs({
            zoomPercent: Math.round(zoomPercent),
            autoRefreshEnabled,
            autoRefreshIntervalSec: allowedIntervals.has(String(autoRefreshInterval.value))
                ? Number(autoRefreshInterval.value)
                : 30,
            onionOpacityPercent: Math.round(onionOpacityPercent)
        })
    }
    if (immediate) {
        if (prefsTimer) { clearTimeout(prefsTimer); prefsTimer = null }
        write()
        return
    }
    if (prefsTimer) clearTimeout(prefsTimer)
    prefsTimer = setTimeout(() => { prefsTimer = null; write() }, PREFS_PERSIST_DEBOUNCE_MS)
}

// -- Composite export (screenshot + overlay) -------------------------------------

async function exportCompositeDataUrl(): Promise<string | null> {
    if (!shot.complete || !shot.naturalWidth) {
        showToast('Screenshot not ready.')
        return null
    }
    const w = shot.naturalWidth
    const h = shot.naturalHeight
    if (w < 1 || h < 1) {
        showToast('Invalid screenshot size.')
        return null
    }
    try { if (shot.decode) await shot.decode() } catch { /* best-effort decode */ }
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) {
        showToast('Canvas unavailable.')
        return null
    }
    ctx.drawImage(shot, 0, 0, w, h)
    const overlayOn = !!(
        onionSkin.classList.contains('is-on') &&
        onionSkin.getAttribute('src') &&
        onionSkin.complete &&
        onionSkin.naturalWidth > 0
    )
    if (overlayOn) {
        try { if (onionSkin.decode) await onionSkin.decode() } catch { /* best-effort decode */ }
        const parsed = parseFloat(onionSkin.style.opacity || '1')
        const alpha = Number.isFinite(parsed) ? clamp(parsed, 0, 1) : 1
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.drawImage(onionSkin, 0, 0, w, h)
        ctx.restore()
    }
    return canvas.toDataURL('image/png')
}

async function saveWithOverlay(): Promise<void> {
    const dataUrl = await exportCompositeDataUrl()
    if (dataUrl) await preview.saveImage(dataUrl)
}

async function copyWithOverlay(): Promise<void> {
    const dataUrl = await exportCompositeDataUrl()
    if (dataUrl) await preview.copyImage(dataUrl)
}

// -- Auto-refresh + countdown ----------------------------------------------------

function updateCountdown(): void {
    countdown.className = 'countdown'
    countdown.textContent = autoRefreshEnabled
        ? `Next refresh: ${Math.max(0, countdownRemaining)}s`
        : 'Auto-refresh off'
}

function pauseCountdown(message: string): void {
    countdown.className = 'countdown paused'
    countdown.textContent = message || 'Auto-refresh paused'
}

function clearRefreshTimers(): void {
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
}

function scheduleNextAutoRefresh(): void {
    clearRefreshTimers()
    if (!autoRefreshEnabled) {
        updateCountdown()
        return
    }
    const seconds = Number(autoRefreshInterval.value) || 30
    countdownRemaining = seconds
    updateCountdown()
    countdownTimer = setInterval(() => { countdownRemaining -= 1; updateCountdown() }, 1000)
    refreshTimer = setTimeout(() => { void preview.refresh(true) }, seconds * 1000)
}

function setAutoRefreshVisual(): void {
    autoRefreshBtn.classList.toggle('on', autoRefreshEnabled)
    autoRefreshInterval.disabled = !autoRefreshEnabled
}

function setRefreshVisual(refreshing: boolean): void {
    isRefreshing = refreshing
    if (isRefreshing) {
        refreshBtn.classList.add('loading')
        refreshBtn.setAttribute('aria-busy', 'true')
        refreshBtn.setAttribute('disabled', 'true')
    } else {
        refreshBtn.classList.remove('loading')
        refreshBtn.removeAttribute('aria-busy')
        refreshBtn.removeAttribute('disabled')
    }
}

// -- Zoom + pan ------------------------------------------------------------------

const intersects = (rectA: DOMRect, rectB: DOMRect): boolean =>
    rectA.left < rectB.right && rectA.right > rectB.left && rectA.top < rectB.bottom && rectA.bottom > rectB.top
const pointInRect = (x: number, y: number, rect: DOMRect): boolean =>
    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom

const canPan = (): boolean => {
    const element = captureActive ? captureVideo : shot
    return element.clientWidth > viewport.clientWidth || element.clientHeight > viewport.clientHeight
}

function updateOverlayDim(): void {
    const shotRect = shot.getBoundingClientRect()
    const countdownRect = countdown.getBoundingClientRect()
    const dockRect = zoomDockWrap.getBoundingClientRect()
    const hasImage = shotRect.width > 0 && shotRect.height > 0
    const overlapsImage = hasImage && (intersects(dockRect, shotRect) || intersects(countdownRect, shotRect))
    const shouldDim = overlapsImage && !overlayMouseInside && !onionPresetsPanel.classList.contains('open')
    zoomDockWrap.classList.toggle('dimmed', shouldDim)
    countdown.classList.toggle('dimmed', shouldDim)
}

function updateOverlayHoverState(x: number, y: number): void {
    const dockRect = zoomDockWrap.getBoundingClientRect()
    const countdownRect = countdown.getBoundingClientRect()
    overlayMouseInside = pointInRect(x, y, dockRect) || pointInRect(x, y, countdownRect)
    updateOverlayDim()
}

function updatePanCursor(mouseX?: number, mouseY?: number): void {
    if (measureMode) { viewport.style.cursor = 'crosshair'; return }
    if (measureStart && measureEnd && mouseX !== undefined && mouseY !== undefined) {
        const point = clientToNaturalOnShot(mouseX, mouseY)
        if (point && hitMeasureEndpoint(point)) { viewport.style.cursor = 'grab'; return }
    }
    const panEnabled = canPan()
    viewport.style.cursor = dragging ? 'grabbing' : (panEnabled ? 'grab' : 'default')
}

function syncOnionLayoutToShot(): void {
    if (!naturalWidth || !naturalHeight) return
    const ratio = zoomPercent / 100
    onionSkin.style.width = `${Math.round(naturalWidth * ratio)}px`
    onionSkin.style.height = `${Math.round(naturalHeight * ratio)}px`
}

function applyCaptureZoom(): void {
    if (!captureNaturalWidth || !captureNaturalHeight) return
    const ratio = zoomPercent / 100
    captureVideo.style.width = `${Math.round(captureNaturalWidth * ratio)}px`
    captureVideo.style.height = `${Math.round(captureNaturalHeight * ratio)}px`
}

function applyZoom(): void {
    if (!naturalWidth || !naturalHeight) return
    const sizeEl = captureActive ? captureVideo : shot
    const prevWidth = sizeEl.clientWidth || naturalWidth
    const prevHeight = sizeEl.clientHeight || naturalHeight
    const sw0 = viewport.scrollWidth
    const cw0 = viewport.clientWidth
    const sh0 = viewport.scrollHeight
    const ch0 = viewport.clientHeight
    const overflowByScrollX = sw0 > cw0 + 0.5
    const overflowByScrollY = sh0 > ch0 + 0.5
    const centerRatioX = overflowByScrollX && prevWidth > 0
        ? clamp((viewport.scrollLeft + viewport.clientWidth / 2) / prevWidth, 0, 1) : 0.5
    const centerRatioY = overflowByScrollY && prevHeight > 0
        ? clamp((viewport.scrollTop + viewport.clientHeight / 2) / prevHeight, 0, 1) : 0.5
    const ratio = zoomPercent / 100
    const wPx = Math.round(naturalWidth * ratio)
    const hPx = Math.round(naturalHeight * ratio)
    shot.style.width = `${wPx}px`
    shot.style.height = `${hPx}px`
    if (captureActive) applyCaptureZoom()
    syncOnionLayoutToShot()
    zoomDock.setAttribute('value', String(Math.round(zoomPercent)))
    updatePanCursor()
    void viewport.offsetHeight
    const nextWidth = sizeEl.clientWidth || wPx
    const nextHeight = sizeEl.clientHeight || hPx
    const sw1 = viewport.scrollWidth
    const cw1 = viewport.clientWidth
    const sh1 = viewport.scrollHeight
    const ch1 = viewport.clientHeight
    const maxScrollX = Math.max(0, sw1 - cw1)
    const maxScrollY = Math.max(0, sh1 - ch1)
    viewport.scrollLeft = clamp(nextWidth * centerRatioX - cw1 / 2, 0, maxScrollX)
    viewport.scrollTop = clamp(nextHeight * centerRatioY - ch1 / 2, 0, maxScrollY)
    updateOverlayDim()
    redrawMeasureOverlay()
}

function setZoomPercent(value: number): void {
    zoomPercent = snapZoomPercent(value, MIN_ZOOM, MAX_ZOOM, ZOOM_SNAP_PERCENT, ZOOM_SNAP_THRESHOLD)
    applyZoom()
}

function fitToViewport(): void {
    const fit = fitZoomPercent(naturalWidth, naturalHeight, viewport.clientWidth, viewport.clientHeight, MIN_ZOOM)
    if (fit === null) return
    lastFitPercent = fit
    setZoomPercent(fit)
}

// -- Measure overlay -------------------------------------------------------------

function clientToNaturalOnShot(clientX: number, clientY: number): MeasurePoint | null {
    if (!naturalWidth || !naturalHeight) return null
    const element = captureActive ? captureVideo : shot
    const rect = element.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return null
    return {
        nx: clamp((clientX - rect.left) * (naturalWidth / rect.width), 0, naturalWidth),
        ny: clamp((clientY - rect.top) * (naturalHeight / rect.height), 0, naturalHeight)
    }
}

function redrawMeasureOverlay(): void {
    if (!measureStart || !measureEnd) {
        measureSvg.innerHTML = ''
        measureLabel.style.display = 'none'
        measureLabel.textContent = ''
        return
    }
    const element = captureActive ? captureVideo : shot
    const w = element.clientWidth
    const h = element.clientHeight
    if (w < 1 || h < 1) return
    measureSvg.setAttribute('width', String(w))
    measureSvg.setAttribute('height', String(h))
    measureSvg.setAttribute('viewBox', `0 0 ${w} ${h}`)
    const x1 = (measureStart.nx / naturalWidth) * w
    const y1 = (measureStart.ny / naturalHeight) * h
    const x2 = (measureEnd.nx / naturalWidth) * w
    const y2 = (measureEnd.ny / naturalHeight) * h
    const text = measureLabelText(measureDelta(measureStart, measureEnd))
    const dxd = x2 - x1
    const dyd = y2 - y1
    const displayLength = Math.sqrt(dxd * dxd + dyd * dyd)
    const lengthNatural = Math.sqrt(
        (measureEnd.nx - measureStart.nx) ** 2 + (measureEnd.ny - measureStart.ny) ** 2
    )
    let ticks = ''
    const tickFractions = measureTickFractions(lengthNatural, displayLength, MEASURE_TICK_STEP)
    if (tickFractions.length && displayLength > 0) {
        const halfLen = 2
        const px = -(dyd / displayLength) * halfLen
        const py = (dxd / displayLength) * halfLen
        for (const fraction of tickFractions) {
            const cx = x1 + dxd * fraction
            const cy = y1 + dyd * fraction
            ticks += `<line x1="${escapeHtml(cx - px)}" y1="${escapeHtml(cy - py)}" x2="${escapeHtml(cx + px)}" y2="${escapeHtml(cy + py)}" stroke="${escapeHtml(measureLineColor())}" stroke-width="1" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`
        }
    }
    const lineColor = measureLineColor()
    const shadowColor = measureShadowColor()
    const mainLine =
        `<line x1="${escapeHtml(x1)}" y1="${escapeHtml(y1)}" x2="${escapeHtml(x2)}" y2="${escapeHtml(y2)}" stroke="${escapeHtml(shadowColor)}" stroke-width="4" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` +
        `<line x1="${escapeHtml(x1)}" y1="${escapeHtml(y1)}" x2="${escapeHtml(x2)}" y2="${escapeHtml(y2)}" stroke="${escapeHtml(lineColor)}" stroke-width="1.5" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`
    measureSvg.innerHTML =
        mainLine + ticks +
        `<circle cx="${escapeHtml(x1)}" cy="${escapeHtml(y1)}" r="3" fill="${escapeHtml(lineColor)}"/>` +
        `<circle cx="${escapeHtml(x2)}" cy="${escapeHtml(y2)}" r="3" fill="${escapeHtml(lineColor)}"/>`
    measureLabel.textContent = text
    measureLabel.style.display = 'block'
    measureLabel.style.left = `${(x1 + x2) / 2}px`
    measureLabel.style.top = `${(y1 + y2) / 2}px`
}

function clearMeasureForNewShot(): void {
    measuring = false
    measureStart = null
    measureEnd = null
    redrawMeasureOverlay()
}

function exitMeasureModeUi(): void {
    measureMode = false
    measureBtn.classList.remove('on')
    measureBtn.setAttribute('aria-pressed', 'false')
    viewport.classList.remove('measure-on')
    updatePanCursor()
}

function hitMeasureEndpoint(point: MeasurePoint | null): 'start' | 'end' | null {
    if (!measureStart || !measureEnd || !point) return null
    const threshold = 8
    const element = captureActive ? captureVideo : shot
    const rect = element.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return null
    const sx = (measureStart.nx / naturalWidth) * rect.width
    const sy = (measureStart.ny / naturalHeight) * rect.height
    const ex = (measureEnd.nx / naturalWidth) * rect.width
    const ey = (measureEnd.ny / naturalHeight) * rect.height
    const px = (point.nx / naturalWidth) * rect.width
    const py = (point.ny / naturalHeight) * rect.height
    if (Math.sqrt((px - sx) ** 2 + (py - sy) ** 2) < threshold) return 'start'
    if (Math.sqrt((px - ex) ** 2 + (py - ey) ** 2) < threshold) return 'end'
    return null
}

// -- Shot load / error ---------------------------------------------------------

function revealShotAfterLayout(): void {
    requestAnimationFrame(() => { shot.classList.add('is-sized') })
}

function onShotLoad(): void {
    clearMeasureForNewShot()
    naturalWidth = shot.naturalWidth || 0
    naturalHeight = shot.naturalHeight || 0
    if (naturalWidth && naturalHeight) showPlaceholder(false)
    if (!naturalWidth || !naturalHeight) {
        revealShotAfterLayout()
        updateOverlayDim()
        return
    }
    const didFit = !preserveZoomOnNextLoad
    if (preserveZoomOnNextLoad) {
        preserveZoomOnNextLoad = false
        applyZoom()
    } else {
        fitToViewport()
    }
    revealShotAfterLayout()
    if (hasMousePosition) updateOverlayHoverState(lastMouseX, lastMouseY)
    else updateOverlayDim()
    if (didFit) {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (naturalWidth && naturalHeight) fitToViewport()
                updateOverlayDim()
            })
        })
        setTimeout(() => {
            if (naturalWidth && naturalHeight) fitToViewport()
            updateOverlayDim()
        }, 80)
    }
}

shot.addEventListener('load', onShotLoad)
shot.addEventListener('error', () => {
    clearMeasureForNewShot()
    shot.classList.add('is-sized')
    shot.style.width = ''
    shot.style.height = ''
    showToast('Preview image failed to render.')
    updateOverlayDim()
})

// -- Toolbar / panel events ------------------------------------------------------

historyBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    const open = historyPanel.classList.toggle('open')
    historyBtn.setAttribute('aria-expanded', open ? 'true' : 'false')
})
onionPresetsBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    const open = onionPresetsPanel.classList.toggle('open')
    onionPresetsBtn.setAttribute('aria-expanded', open ? 'true' : 'false')
})
document.addEventListener('click', () => {
    if (historyPanel.classList.contains('open')) closeHistoryPanel()
    if (onionPresetsPanel.classList.contains('open')) closeOnionPresetsPanel()
})
historyPanel.addEventListener('click', (e) => e.stopPropagation())
onionPresetsPanel.addEventListener('click', (e) => e.stopPropagation())
onionHistoryFlyout.addEventListener('click', (e) => e.stopPropagation())
onionHistoryFlyout.addEventListener('mouseenter', cancelFlyoutClose)
onionHistoryFlyout.addEventListener('mouseleave', scheduleFlyoutClose)

saveBtn.addEventListener('click', () => { void preview.save() })
saveWithOverlayBtn.addEventListener('click', () => { void saveWithOverlay() })
copyBtn.addEventListener('click', () => { void preview.copy() })
copyWithOverlayBtn.addEventListener('click', () => { void copyWithOverlay() })
measureBtn.addEventListener('click', () => {
    measureMode = !measureMode
    if (measureMode) {
        measureBtn.classList.add('on')
        measureBtn.setAttribute('aria-pressed', 'true')
        viewport.classList.add('measure-on')
        updatePanCursor()
    } else {
        exitMeasureModeUi()
        clearMeasureForNewShot()
    }
})
refreshBtn.addEventListener('click', () => {
    if (captureActive) { void captureFrameToShot(); return }
    if (isRefreshing) return
    setRefreshVisual(true)
    showToast('Refreshing screenshot...')
    void preview.refresh(false)
})
autoRefreshBtn.addEventListener('click', () => {
    autoRefreshEnabled = !autoRefreshEnabled
    setAutoRefreshVisual()
    scheduleNextAutoRefresh()
    persistPreviewPrefs(false)
    pushState()
})
autoRefreshInterval.addEventListener('change', () => {
    if (autoRefreshEnabled) scheduleNextAutoRefresh()
    persistPreviewPrefs(false)
    pushState()
})
zoomDock.addEventListener('rokdock-actual', () => { setZoomPercent(100); persistPreviewPrefs(false) })
zoomDock.addEventListener('rokdock-fit', () => { fitToViewport(); persistPreviewPrefs(false) })
zoomDock.addEventListener('rokdock-change', (e) => {
    setZoomPercent((e as CustomEvent<{ value: number }>).detail.value)
    persistPreviewPrefs(false)
})
onionLoadToolbarBtn.addEventListener('click', () => { void preview.pickOverlay() })
onionClearBtn.addEventListener('click', () => clearOnionOverlay())
onionOpacity.addEventListener('input', () => {
    onionOpacityPercent = clamp(Number(onionOpacity.value) || 0, 0, 100)
    syncOnionUi()
    persistPreviewPrefs(false)
})

// -- Copy hotkeys + Escape -------------------------------------------------------

function isCopyHotkeyTarget(target: EventTarget | null): boolean {
    if (!target || target === document.body) return false
    const tag = (target as HTMLElement).tagName
    if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'OPTION') return true
    return !!(target as HTMLElement).isContentEditable
}

window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || (e.key !== 'c' && e.key !== 'C')) return
    if (isCopyHotkeyTarget(e.target)) return
    e.preventDefault()
    if (e.shiftKey) {
        if (!copyWithOverlayBtn.disabled) void copyWithOverlay()
        else showToast('Load a comparison overlay first to copy screenshot + overlay (Ctrl+Shift+C).')
    } else {
        void preview.copy()
    }
}, true)

window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    if (isCopyHotkeyTarget(e.target)) return
    if (measuring || measureStart || measureEnd) { clearMeasureForNewShot(); e.preventDefault(); return }
    if (measureMode) { exitMeasureModeUi(); e.preventDefault() }
}, true)

// -- Pan + measure drag ----------------------------------------------------------

viewport.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return
    if (measureMode) {
        const point = clientToNaturalOnShot(event.clientX, event.clientY)
        if (!point) return
        measuring = true
        measureStart = { nx: point.nx, ny: point.ny }
        measureEnd = { nx: point.nx, ny: point.ny }
        redrawMeasureOverlay()
        event.preventDefault()
        return
    }
    if (measureStart && measureEnd) {
        const point = clientToNaturalOnShot(event.clientX, event.clientY)
        const hit = hitMeasureEndpoint(point)
        if (hit) {
            measureDragEndpoint = hit
            measuring = true
            event.preventDefault()
            return
        }
        clearMeasureForNewShot()
        return
    }
    if (!canPan()) return
    dragging = true
    dragStartX = event.clientX
    dragStartY = event.clientY
    dragScrollLeft = viewport.scrollLeft
    dragScrollTop = viewport.scrollTop
    updatePanCursor()
    event.preventDefault()
})

window.addEventListener('mousemove', (event) => {
    if (measuring) {
        const point = clientToNaturalOnShot(event.clientX, event.clientY)
        if (!point) return
        let nx = point.nx
        let ny = point.ny
        if (measureDragEndpoint) {
            const anchor = measureDragEndpoint === 'start' ? measureEnd! : measureStart!
            if (event.shiftKey) {
                if (Math.abs(nx - anchor.nx) >= Math.abs(ny - anchor.ny)) ny = anchor.ny
                else nx = anchor.nx
            }
            if (measureDragEndpoint === 'start') measureStart = { nx, ny }
            else measureEnd = { nx, ny }
        } else {
            if (event.shiftKey) {
                if (Math.abs(nx - measureStart!.nx) >= Math.abs(ny - measureStart!.ny)) ny = measureStart!.ny
                else nx = measureStart!.nx
            }
            measureEnd = { nx, ny }
        }
        redrawMeasureOverlay()
        return
    }
    if (!dragging) return
    viewport.scrollLeft = dragScrollLeft - (event.clientX - dragStartX)
    viewport.scrollTop = dragScrollTop - (event.clientY - dragStartY)
})

window.addEventListener('mouseup', () => {
    if (measuring) {
        measuring = false
        const wasDrag = !!measureDragEndpoint
        measureDragEndpoint = null
        if (!wasDrag && measureStart && measureEnd &&
            measureStart.nx === measureEnd.nx && measureStart.ny === measureEnd.ny) {
            measureStart = null
            measureEnd = null
        }
        if (!wasDrag) exitMeasureModeUi()
        redrawMeasureOverlay()
        return
    }
    if (!dragging) return
    dragging = false
    updatePanCursor()
})

viewport.addEventListener('wheel', (event) => {
    if (!event.ctrlKey) return
    event.preventDefault()
    setZoomPercent(zoomPercent * (event.deltaY < 0 ? 1.1 : 1 / 1.1))
}, { passive: false })

window.addEventListener('resize', () => {
    if (Math.abs(zoomPercent - lastFitPercent) < 1.5) fitToViewport()
    updateOverlayDim()
})
viewport.addEventListener('scroll', () => updateOverlayDim(), { passive: true })
window.addEventListener('mousemove', (event) => {
    hasMousePosition = true
    lastMouseX = event.clientX
    lastMouseY = event.clientY
    updateOverlayHoverState(lastMouseX, lastMouseY)
    if (!measuring && !dragging) updatePanCursor(lastMouseX, lastMouseY)
})
window.addEventListener('mouseleave', () => { overlayMouseInside = false; updateOverlayDim() })

// -- Capture-device feed ---------------------------------------------------------

function updateCaptureToggleBtn(): void {
    captureToggleBtn.classList.toggle('on', captureActive)
    captureToggleBtn.title = captureActive ? 'Switch back to screenshot mode' : 'Switch to capture device feed'
}

async function captureFrameToShot(): Promise<void> {
    const dataUrl = videoFrameToPngDataUrl(captureVideo)
    if (!dataUrl) {
        showToast('No video frame available')
        return
    }
    try {
        const result = await window.rokdock.capture.saveFrame(dataUrl)
        if (!result.ok) { showToast('Failed to save frame'); return }
        showToast('Screenshot captured')
        const entries = await preview.getHistory()
        screenshotHistoryEntries = entries
        renderHistoryPanel()
        const newest = entries[0]
        if (newest) {
            const shown = await preview.showHistoryImage(newest.path)
            if (shown.ok && shown.dataUrl) pendingCapturedSrc = shown.dataUrl
        }
    } catch {
        showToast('Failed to save frame')
    }
}

// Answer roBot's HDMI screenshot-fallback frame grabs with the capture feed's current frame when
// this window is in capture mode (or '' otherwise), so the fallback works from the preview window.
window.rokdock.capture.onGrabFrame((requestId: string) => {
    window.rokdock.capture.frameGrabbed(requestId, captureActive ? videoFrameToPngDataUrl(captureVideo) : '')
})

function showCaptureUi(): void {
    document.body.classList.add('capture-active')
    showPlaceholder(false)
    refreshBtn.innerHTML = refreshIconCapture
    refreshBtn.title = 'Capture screenshot from video'
    refreshBtn.disabled = false
    autoRefreshBtn.style.display = 'none'
    autoRefreshInterval.style.display = 'none'
    if (autoRefreshEnabled) {
        clearRefreshTimers()
        pauseCountdown('Capture mode active')
    }
}

function hideCaptureUi(): void {
    document.body.classList.remove('capture-active')
    captureVideo.style.width = ''
    captureVideo.style.height = ''
    if (!shot.getAttribute('src')) showPlaceholder(true)
    refreshBtn.innerHTML = refreshIconDefault
    refreshBtn.title = 'Refresh screenshot'
    refreshBtn.disabled = false
    autoRefreshBtn.style.display = ''
    autoRefreshInterval.style.display = ''
    setAutoRefreshVisual()
    if (autoRefreshEnabled) scheduleNextAutoRefresh()
}

captureVideo.addEventListener('loadedmetadata', () => {
    captureNaturalWidth = captureVideo.videoWidth || 0
    captureNaturalHeight = captureVideo.videoHeight || 0
    if (!captureActive || !captureNaturalWidth || !captureNaturalHeight) return
    window.rokdock.store.getPreferences().then((preferences: AppPreferences) => {
        const aspect = preferences.captureAspectRatio || 'auto'
        if (aspect === '16:9') {
            captureNaturalWidth = Math.max(captureNaturalWidth, Math.round(captureNaturalHeight * (16 / 9)))
            captureNaturalHeight = Math.round(captureNaturalWidth / (16 / 9))
        } else if (aspect === '4:3') {
            captureNaturalWidth = Math.max(captureNaturalWidth, Math.round(captureNaturalHeight * (4 / 3)))
            captureNaturalHeight = Math.round(captureNaturalWidth / (4 / 3))
        }
        captureVideo.style.objectFit = 'fill'
        naturalWidth = captureNaturalWidth
        naturalHeight = captureNaturalHeight
        viewport.style.overflow = 'hidden'
        fitToViewport()
        applyCaptureZoom()
        requestAnimationFrame(() => { viewport.style.overflow = '' })
    }).catch(() => {
        naturalWidth = captureNaturalWidth
        naturalHeight = captureNaturalHeight
        fitToViewport()
        applyCaptureZoom()
    })
})

async function startCapture(): Promise<void> {
    try {
        const result = await window.rokdock.capture.getDeviceId()
        if (!result.ok || !result.deviceId) {
            showToast('No capture device configured. Set one in Settings.')
            return
        }
        const mutedResult = await window.rokdock.capture.getMuted()
        const isMuted = mutedResult.ok ? mutedResult.muted : true
        captureStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { ideal: result.deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: true
        })
        captureVideo.srcObject = captureStream
        captureVideo.muted = !!isMuted
        captureActive = true
        showCaptureUi()
        updateCaptureToggleBtn()
        pushState()
        const videoTrack = captureStream.getVideoTracks()[0]
        if (videoTrack) {
            const settings = videoTrack.getSettings()
            if (settings.width && settings.height) showToast(`Capture: ${settings.width}x${settings.height}`)
        }
    } catch (err) {
        showToast(`Failed to start capture: ${err instanceof Error ? err.message : String(err)}`)
    }
}

function stopCapture(): void {
    if (captureStream) {
        captureStream.getTracks().forEach((track) => track.stop())
        captureStream = null
    }
    captureVideo.srcObject = null
    captureVideo.style.objectFit = ''
    captureActive = false
    captureNaturalWidth = 0
    captureNaturalHeight = 0
    naturalWidth = shot.naturalWidth || 0
    naturalHeight = shot.naturalHeight || 0
    hideCaptureUi()
    updateCaptureToggleBtn()
    pushState()
    if (pendingCapturedSrc) {
        const src = pendingCapturedSrc
        pendingCapturedSrc = null
        shot.classList.remove('is-sized')
        shot.src = src
    } else if (naturalWidth && naturalHeight) {
        applyZoom()
    }
}

captureToggleBtn.addEventListener('click', () => {
    if (captureActive) stopCapture()
    else void startCapture()
})

async function initCaptureToggle(): Promise<void> {
    try {
        const result = await window.rokdock.capture.getDeviceId()
        captureToggleBtn.disabled = !(result.ok && result.deviceId)
    } catch {
        captureToggleBtn.disabled = true
    }
}

// -- Incoming messages from main -----------------------------------------------

preview.onMessage((message: ScreenshotPreviewMessage) => {
    if (!message) return
    switch (message.type) {
        case 'status':
            setRefreshVisual(false)
            showToast(message.text)
            break
        case 'trigger-refresh':
            if (!isRefreshing) {
                setRefreshVisual(true)
                showToast('Refreshing screenshot...')
                void preview.refresh(false)
            }
            break
        case 'load-history-image':
            clearMeasureForNewShot()
            preserveZoomOnNextLoad = true
            shot.classList.remove('is-sized')
            shot.src = message.imageDataUrl
            break
        case 'trigger-save':
            void preview.save()
            break
        case 'trigger-save-with-overlay':
            void saveWithOverlay()
            break
        case 'trigger-copy-with-overlay':
            void copyWithOverlay()
            break
        case 'set-auto-refresh':
            autoRefreshEnabled = message.enabled
            if (message.enabled && typeof message.intervalSec === 'number' && allowedIntervals.has(String(message.intervalSec))) {
                autoRefreshInterval.value = String(message.intervalSec)
            }
            setAutoRefreshVisual()
            scheduleNextAutoRefresh()
            persistPreviewPrefs(false)
            pushState()
            break
        case 'image-updated':
            setRefreshVisual(false)
            clearMeasureForNewShot()
            preserveZoomOnNextLoad = true
            shot.classList.remove('is-sized')
            shot.src = message.imageDataUrl
            if (autoRefreshEnabled) scheduleNextAutoRefresh()
            break
        case 'history-updated':
            screenshotHistoryEntries = message.entries
            renderHistoryPanel()
            break
        case 'onion-history-updated':
            onionOverlayHistoryEntries = message.entries
            renderOnionPresetsPanel()
            break
        case 'set-onion':
            applyOnionSrc(message.dataUrl)
            break
        case 'clear-onion':
            clearOnionOverlay()
            break
        case 'auto-refresh-disabled':
            setRefreshVisual(false)
            autoRefreshEnabled = false
            setAutoRefreshVisual()
            clearRefreshTimers()
            pauseCountdown(message.message || 'Auto-refresh paused (dev app not running)')
            persistPreviewPrefs(false)
            pushState()
            break
    }
})

// -- Boot ------------------------------------------------------------------------

async function init(): Promise<void> {
    const data = await preview.getInitialData()
    document.title = data.title

    zoomPercent = data.zoomPercent
    autoRefreshEnabled = data.autoRefreshEnabled
    onionOpacityPercent = data.onionOpacityPercent
    screenshotHistoryEntries = data.screenshotHistory
    onionBuiltinMenu = data.onionBuiltinMenu
    onionOverlayHistoryEntries = data.onionOverlayHistory

    // Build the auto-refresh interval dropdown from the allowed intervals.
    autoRefreshInterval.innerHTML = ''
    for (const sec of data.autoRefreshIntervalsSec) {
        allowedIntervals.add(String(sec))
        const option = document.createElement('option')
        option.value = String(sec)
        option.textContent = `${sec}s`
        autoRefreshInterval.appendChild(option)
    }
    const initialInterval = String(data.autoRefreshIntervalSec)
    autoRefreshInterval.value = allowedIntervals.has(initialInterval) ? initialInterval : '30'

    setAutoRefreshVisual()
    updateCountdown()
    updateOverlayDim()
    renderHistoryPanel()
    renderOnionPresetsPanel()
    syncOnionUi()

    if (data.imageDataUrl) {
        shot.src = data.imageDataUrl
        if (shot.complete && shot.naturalWidth) onShotLoad()
    } else {
        showPlaceholder(true)
    }

    void initCaptureToggle()
    pushState()

    if (data.autoRefreshOnLoad) {
        setRefreshVisual(true)
        showToast('Refreshing screenshot...')
        void preview.refresh(false)
    }
}

void init()
