/**
 * Main-process constants for tool window dimensions, timeouts, and feature flags.
 *
 * These values are used by IPC handlers when creating BrowserWindows (initial size,
 * minimum size) and by utility functions (auto-refresh intervals, screenshot naming).
 * Centralizing them here prevents magic numbers from being scattered across handler files.
 *
 * Window size constants follow the pattern: WIDTH/HEIGHT (default), MIN_WIDTH/MIN_HEIGHT.
 */

// Used as BrowserWindow backgroundColor before preload CSS vars are applied.
export const PREVIEW_BG_DARK = '#121427'

export const MONO_FONT_STACK = "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, Menlo, Monaco, 'Ubuntu Mono', ui-monospace, monospace"

export const AUTO_REFRESH_INTERVALS_SEC = [5, 15, 30, 45, 60, 90, 120] as const
export const QUERY_ACTIVE_APP_TIMEOUT_MS = 3500
export const ROKU_DEV_APP_ID = 'dev'
export const PREFS_PERSIST_DEBOUNCE_MS = 220
export const TOAST_DURATION_MS = 2400

export const SCREENSHOT_PREVIEW_WIDTH = 1100
/** Default height fits toolbar + two-row zoom/compare dock without crowding the image area. */
export const SCREENSHOT_PREVIEW_HEIGHT = 770
export const SCREENSHOT_PREVIEW_MIN_WIDTH = 700
export const SCREENSHOT_PREVIEW_MIN_HEIGHT = 460

export const JSON_EDITOR_WIDTH = 960
export const JSON_EDITOR_HEIGHT = 720
export const JSON_EDITOR_MIN_WIDTH = 640
export const JSON_EDITOR_MIN_HEIGHT = 440

export const NINEPATCH_EDITOR_WIDTH = 1200
export const NINEPATCH_EDITOR_HEIGHT = 850
export const NINEPATCH_EDITOR_MIN_WIDTH = 900
export const NINEPATCH_EDITOR_MIN_HEIGHT = 650

export const SVG_EXPORTER_WIDTH = 960
export const SVG_EXPORTER_HEIGHT = 700
export const SVG_EXPORTER_MIN_WIDTH = 600
export const SVG_EXPORTER_MIN_HEIGHT = 480

export const SCRIPT_EDITOR_WIDTH = 1100
export const SCRIPT_EDITOR_HEIGHT = 780
export const SCRIPT_EDITOR_MIN_WIDTH = 800
export const SCRIPT_EDITOR_MIN_HEIGHT = 560

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47] as const
export const JPEG_SIGNATURE = [0xff, 0xd8] as const

/** Local copies of comparison overlays (screenshot preview onion skin) live under userData / this subdir. */
export const ONION_OVERLAY_USERDATA_SUBDIR = 'onion-overlays'
