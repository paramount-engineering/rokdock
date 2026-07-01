/**
 * Pure geometry helpers for the Screenshot Preview window.
 *
 * Extracted from the renderer so the zoom-fit, zoom-snap, and pixel-measure math
 * (the rounding/clamping/branching that is easy to get subtly wrong) is unit
 * testable without a DOM. The renderer owns the DOM reads and passes plain
 * numbers in.
 */

/**
 * Compute the zoom percentage that fits an image inside the viewport.
 * Never upscales past 100%, never drops below minZoom.
 *
 * @param naturalWidth - Intrinsic image width in pixels.
 * @param naturalHeight - Intrinsic image height in pixels.
 * @param viewportWidth - Available viewport width in pixels.
 * @param viewportHeight - Available viewport height in pixels.
 * @param minZoom - Lower clamp for the result (percent).
 * @returns The fit zoom as an integer percentage, or null if inputs are degenerate.
 */
export function fitZoomPercent(
    naturalWidth: number,
    naturalHeight: number,
    viewportWidth: number,
    viewportHeight: number,
    minZoom: number
): number | null {
    if (naturalWidth <= 0 || naturalHeight <= 0) return null
    const vw = Math.max(1, viewportWidth)
    const vh = Math.max(1, viewportHeight)
    const raw = Math.floor(Math.min(vw / naturalWidth, vh / naturalHeight) * 100)
    return Math.max(minZoom, Math.min(100, raw))
}

/**
 * Clamp a zoom value to [minZoom, maxZoom] and snap to the snap percentage when
 * within the snap threshold (so 99-101% lands exactly on 100%).
 *
 * @param value - Desired zoom percent.
 * @param minZoom - Lower clamp.
 * @param maxZoom - Upper clamp.
 * @param snapPercent - The value to snap to (e.g. 100).
 * @param snapThreshold - Distance from snapPercent within which to snap.
 * @returns The clamped, snapped zoom percent.
 */
export function snapZoomPercent(
    value: number,
    minZoom: number,
    maxZoom: number,
    snapPercent: number,
    snapThreshold: number
): number {
    const clamped = Math.min(maxZoom, Math.max(minZoom, value))
    return Math.abs(clamped - snapPercent) <= snapThreshold ? snapPercent : clamped
}

/** A point in the screenshot's natural pixel space. */
export interface MeasurePoint {
    nx: number
    ny: number
}

/** The rounded pixel deltas between two measure points. */
export interface MeasureDelta {
    dx: number
    dy: number
    adx: number
    ady: number
    diag: number
}

/**
 * Compute the rounded horizontal, vertical, and diagonal pixel distances between
 * the measure start and end points.
 */
export function measureDelta(start: MeasurePoint, end: MeasurePoint): MeasureDelta {
    const dx = Math.round(end.nx - start.nx)
    const dy = Math.round(end.ny - start.ny)
    const adx = Math.abs(dx)
    const ady = Math.abs(dy)
    const diag = Math.round(Math.sqrt(dx * dx + dy * dy))
    return { dx, dy, adx, ady, diag }
}

/**
 * Build the measure-overlay label text from a delta. Pure axis distances read as
 * "(horizontal)"/"(vertical)"; a diagonal reports all three components.
 */
export function measureLabelText(delta: MeasureDelta): string {
    const { adx, ady, diag } = delta
    if (ady === 0 && adx === 0) return '0 px'
    if (ady === 0) return `${adx} px (horizontal)`
    if (adx === 0) return `${ady} px (vertical)`
    return `dx: ${adx} px\ndy: ${ady} px\nDiagonal: ${diag} px`
}

/**
 * Compute the tick offsets (as fractions of the line length) for the measure ruler.
 * Ticks are placed every `step` natural pixels, skipping the ends. Returns an empty
 * array when the line is too short to warrant ticks.
 *
 * @param lengthNatural - Line length in natural pixels.
 * @param displayLength - Line length in displayed (on-screen) pixels.
 * @param step - Spacing between ticks in natural pixels.
 */
export function measureTickFractions(lengthNatural: number, displayLength: number, step: number): number[] {
    const fractions: number[] = []
    if (lengthNatural <= step * 0.6 || displayLength <= 0.25) return fractions
    for (let offset = step; offset < lengthNatural - step * 0.35; offset += step) {
        fractions.push(offset / lengthNatural)
    }
    return fractions
}
