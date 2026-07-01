/**
 * IPC contract for the Screenshot Preview tool window.
 *
 * Shared by the main process (handler), the preload bridge, and the bundled
 * renderer entry so the three sides cannot drift. The preview uses three flows:
 *  - a one-time initial-data pull on boot (replaces the old template injection),
 *  - typed action invokes from the renderer to main (replaces the old
 *    rokdock-preview:// will-navigate event bus),
 *  - typed messages pushed from main to the renderer (the screenshot-preview:message
 *    channel), plus a renderer-to-main state push so main's right-click menu can
 *    reflect the live UI without an executeJavaScript pull.
 *
 * All image payloads are `data:` URLs: the renderer loads under a tight CSP
 * (img-src 'self' data:) and never receives a file:// URL.
 */

/** A screenshot history entry as presented to the preview renderer. */
export interface ScreenshotHistoryEntryForPreview {
    /**
     * Absolute file path. Opaque to the renderer: it is passed back to fetch the
     * full image (main validates it against the known history before serving).
     */
    path: string
    label: string
    /** Small `data:` URL for the list thumbnail. */
    thumbnailDataUrl: string
}

/** An onion-overlay menu entry (built-in or recent file) for the preview renderer. */
export interface OnionOverlayMenuEntryForPreview {
    ref: string
    label: string
    /** Small `data:` URL for the list thumbnail (empty when unavailable). */
    thumbnailDataUrl: string
}

/** Initial data pulled by the preview renderer on boot (replaces template injection). */
export interface ScreenshotPreviewInitialData {
    title: string
    /** The first screenshot as a `data:` URL, or null to show the placeholder. */
    imageDataUrl: string | null
    zoomPercent: number
    autoRefreshEnabled: boolean
    autoRefreshIntervalSec: number
    /** The selectable auto-refresh intervals (seconds); main is the validation authority. */
    autoRefreshIntervalsSec: number[]
    onionOpacityPercent: number
    screenshotHistory: ScreenshotHistoryEntryForPreview[]
    onionBuiltinMenu: OnionOverlayMenuEntryForPreview[]
    onionOverlayHistory: OnionOverlayMenuEntryForPreview[]
    /** Trigger a refresh as soon as the window is ready (capture-screenshot entry point). */
    autoRefreshOnLoad: boolean
}

/** Live renderer state pushed to main so the right-click menu reflects the current UI. */
export interface ScreenshotPreviewState {
    autoRefreshEnabled: boolean
    autoRefreshIntervalSec: number
    overlayActive: boolean
    captureActive: boolean
}

/** Preview preferences persisted on change (debounced on the renderer side). */
export interface ScreenshotPreviewPrefs {
    zoomPercent: number
    autoRefreshEnabled: boolean
    autoRefreshIntervalSec: number
    onionOpacityPercent: number
}

/** Result of a validated image fetch by absolute path. */
export interface ScreenshotPreviewImageResult {
    ok: boolean
    /** Present when ok; the requested image as a `data:` URL. */
    dataUrl?: string
}

/** Messages pushed from main to the preview renderer over screenshot-preview:message. */
export type ScreenshotPreviewMessage =
    | { type: 'status'; text: string }
    | { type: 'trigger-refresh' }
    | { type: 'trigger-save' }
    | { type: 'trigger-save-with-overlay' }
    | { type: 'trigger-copy-with-overlay' }
    | { type: 'image-updated'; imageDataUrl: string }
    | { type: 'load-history-image'; imageDataUrl: string }
    | { type: 'set-auto-refresh'; enabled: boolean; intervalSec?: number }
    | { type: 'history-updated'; entries: ScreenshotHistoryEntryForPreview[] }
    | { type: 'onion-history-updated'; entries: OnionOverlayMenuEntryForPreview[] }
    | { type: 'set-onion'; dataUrl: string }
    | { type: 'clear-onion' }
    | { type: 'auto-refresh-disabled'; message: string }
