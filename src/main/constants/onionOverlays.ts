/**
 * Built-in comparison overlays for the screenshot preview (onion skin).
 * SVG assets live under `resources/`; refs are stored as `rokdock-builtin:<id>`.
 */
import fs from 'fs'
import path from 'path'

const ROKDOCK_BUILTIN_PREFIX = 'rokdock-builtin:'

/** Stable ids for built-ins (used in `rokdock-builtin:<id>` refs). */
const BUILTIN_OVERLAY_TV_SAFE = 'tv-safe-zones'
const BUILTIN_OVERLAY_TV_SAFE_720P = 'tv-safe-zones-720p'
const BUILTIN_OVERLAY_RULE_OF_THIRDS = 'rule-of-thirds'
const BUILTIN_OVERLAY_RULE_OF_THIRDS_720P = 'rule-of-thirds-720p'
const BUILTIN_OVERLAY_ASPECT_RATIO = 'aspect-ratio'
const BUILTIN_OVERLAY_ASPECT_RATIO_720P = 'aspect-ratio-720p'
const BUILTIN_OVERLAY_COLUMN_GRID = 'column-grid'
const BUILTIN_OVERLAY_COLUMN_GRID_720P = 'column-grid-720p'
const BUILTIN_OVERLAY_COLUMN_GRID_4COL = 'column-grid-4col'
const BUILTIN_OVERLAY_COLUMN_GRID_4COL_720P = 'column-grid-4col-720p'

export type BuiltinOverlayDimensions = { width: number; height: number }

const BUILTIN_OVERLAY_ROWS: ReadonlyArray<{ id: string; file: string; label: string }> = [
    { id: BUILTIN_OVERLAY_TV_SAFE, file: 'tv-safe-zones-overlay.svg', label: 'TV safe zones (1080p)' },
    { id: BUILTIN_OVERLAY_TV_SAFE_720P, file: 'tv-safe-zones-overlay-720p.svg', label: 'TV safe zones (720p)' },
    { id: BUILTIN_OVERLAY_RULE_OF_THIRDS, file: 'rule-of-thirds-overlay.svg', label: 'Rule of thirds (1080p)' },
    { id: BUILTIN_OVERLAY_RULE_OF_THIRDS_720P, file: 'rule-of-thirds-overlay-720p.svg', label: 'Rule of thirds (720p)' },
    { id: BUILTIN_OVERLAY_ASPECT_RATIO, file: 'aspect-ratio-overlay.svg', label: 'Aspect ratio (1080p)' },
    { id: BUILTIN_OVERLAY_ASPECT_RATIO_720P, file: 'aspect-ratio-overlay-720p.svg', label: 'Aspect ratio (720p)' },
    { id: BUILTIN_OVERLAY_COLUMN_GRID, file: 'column-grid-overlay.svg', label: 'Column grid (1080p)' },
    { id: BUILTIN_OVERLAY_COLUMN_GRID_720P, file: 'column-grid-overlay-720p.svg', label: 'Column grid (720p)' },
    { id: BUILTIN_OVERLAY_COLUMN_GRID_4COL, file: 'column-grid-4col-overlay.svg', label: '4-column grid (1080p)' },
    { id: BUILTIN_OVERLAY_COLUMN_GRID_4COL_720P, file: 'column-grid-4col-overlay-720p.svg', label: '4-column grid (720p)' }
]

const BUILTIN_ID_TO_FILE = new Map(BUILTIN_OVERLAY_ROWS.map((row) => [row.id, row.file]))
const BUILTIN_ID_TO_LABEL = new Map(BUILTIN_OVERLAY_ROWS.map((row) => [row.id, row.label]))

function resourcesDir(): string {
    return path.join(__dirname, '../../resources/overlays')
}

function svgFileToDataUrl(absPath: string): string | null {
    try {
        const raw = fs.readFileSync(absPath, 'utf8')
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(raw)}`
    } catch {
        return null
    }
}

export function isBuiltinOverlayRef(ref: string): boolean {
    return typeof ref === 'string' && ref.startsWith(ROKDOCK_BUILTIN_PREFIX)
}

/**
 * Resolve a built-in overlay to a `data:` URL from packaged `resources/overlays/*.svg`.
 * `dimensions` is accepted for API compatibility with the preview shell but ignored - each asset is fixed to 1080p or 720p.
 */
export function builtinOverlayDataUrl(
    ref: string,
    _dimensions?: BuiltinOverlayDimensions | null
): string | null {
    void _dimensions
    if (!isBuiltinOverlayRef(ref)) return null
    const id = ref.slice(ROKDOCK_BUILTIN_PREFIX.length)
    const file = BUILTIN_ID_TO_FILE.get(id)
    if (!file) return null
    const abs = path.join(resourcesDir(), file)
    return svgFileToDataUrl(abs)
}

export function labelForBuiltinId(id: string): string {
    return BUILTIN_ID_TO_LABEL.get(id) ?? id
}

export const BUILTIN_OVERLAY_MENU: ReadonlyArray<{ ref: string; label: string }> = BUILTIN_OVERLAY_ROWS.map(
    (row) => ({
        ref: `${ROKDOCK_BUILTIN_PREFIX}${row.id}`,
        label: row.label
    })
)
