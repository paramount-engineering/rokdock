/**
 * Pure 9-patch geometry helpers for the 9-Patch Editor tool.
 *
 * This module contains only node-safe, DOM-free math so it can be unit-tested
 * in the vitest node environment without a browser context. Canvas-dependent
 * functions (renderShape, renderBorderPixels, parseNP, build9PatchDataUrl,
 * draw9, drawMoviePoster, overlay and preview drawing) live in
 * ninepatchEditor.ts because they require a browser canvas.
 */

/** Scale factor for converting 1080p coordinates to 720p. */
export const S720 = 2 / 3

/**
 * A stretch or padding zone, defined by start (inclusive) and end (exclusive)
 * pixel coordinates along one axis of the canvas.
 */
export interface Zone {
    start: number
    end: number
}

/**
 * A segment produced by bseg: a contiguous run of pixels along one axis.
 * `position` is the starting pixel, `length` is the length, and `stretchable`
 * is true for stretchable segments and false for fixed (corner/edge) segments.
 */
export interface Segment {
    position: number
    length: number
    stretchable: boolean
}

/**
 * Rounds a 1080p pixel coordinate to its 720p equivalent.
 *
 * @param value - A 1080p coordinate or length in pixels.
 * @returns The coordinate rounded to the nearest 720p pixel.
 */
export function to720(value: number): number {
    return Math.round(value * S720)
}

/**
 * Converts a 6-digit hex color string and an integer opacity (0-100) into an
 * rgba() CSS color string, as used by canvas fillStyle/strokeStyle.
 *
 * @param hex - A '#rrggbb' hex color string.
 * @param op - Opacity as an integer from 0 (transparent) to 100 (opaque).
 * @returns An 'rgba(r,g,b,a)' string with alpha derived from op/100.
 */
export function hexToRgba(hex: string, op: number): string {
    const red = parseInt(hex.slice(1, 3), 16)
    const green = parseInt(hex.slice(3, 5), 16)
    const blue = parseInt(hex.slice(5, 7), 16)
    return 'rgba(' + red + ',' + green + ',' + blue + ',' + (op / 100) + ')'
}

/**
 * Builds a segment list describing the 9-patch tile layout along one axis.
 *
 * Zones are treated as stretchable regions; the gaps between (and outside) them
 * are fixed. Zones are sorted by start coordinate before processing.
 *
 * @param zones - Array of stretch zones for this axis.
 * @param total - Total pixel count along the axis (canvas.width or canvas.height).
 * @returns Ordered array of Segment records covering every pixel from 0 to total.
 */
export function bseg(zones: Zone[], total: number): Segment[] {
    const sorted = [...zones].sort((first, second) => first.start - second.start)
    const segs: Segment[] = []
    let pos = 0
    for (const zone of sorted) {
        if (zone.start > pos) segs.push({ position: pos, length: zone.start - pos, stretchable: false })
        segs.push({ position: zone.start, length: zone.end - zone.start, stretchable: true })
        pos = zone.end
    }
    if (pos < total) segs.push({ position: pos, length: total - pos, stretchable: false })
    return segs
}

/**
 * Maps a source canvas pixel coordinate to its output coordinate in a
 * 9-patch-stretched image, using the same segment layout that draw9 uses.
 *
 * @param srcP - Source pixel position along the axis.
 * @param segs - Segment list from bseg for this axis.
 * @param tOut - Total output size along the axis.
 * @returns The output pixel position corresponding to srcP.
 */
export function outPos(srcP: number, segs: Segment[], tOut: number): number {
    const stretchWidth = segs.filter(seg => seg.stretchable).reduce((sum, seg) => sum + seg.length, 0)
    const fixedWidth = segs.filter(seg => !seg.stretchable).reduce((sum, seg) => sum + seg.length, 0)
    const extraWidth = Math.max(0, tOut - fixedWidth)
    let outStart = 0
    for (const seg of segs) {
        const chunkWidth = seg.stretchable ? (stretchWidth > 0 ? Math.round(seg.length / stretchWidth * extraWidth) : 0) : seg.length
        if (srcP >= seg.position && srcP <= seg.position + seg.length) {
            return outStart + Math.round((srcP - seg.position) / seg.length * chunkWidth)
        }
        outStart += chunkWidth
    }
    return outStart
}

/**
 * Finds contiguous runs of indices [from, to) where test(i) returns true.
 *
 * Used by parseNP to decode the black border pixels of an existing .9.png file
 * into stretch and padding zone arrays.
 *
 * @param from - Inclusive start index.
 * @param to - Exclusive end index.
 * @param test - Predicate returning true for indices that belong to a run.
 * @returns Array of { start, end } run objects (end is exclusive).
 */
export function detectRuns(
    from: number,
    to: number,
    test: (i: number) => boolean
): Array<{ start: number; end: number }> {
    const runs: Array<{ start: number; end: number }> = []
    let inRun = false
    let runStart = 0
    for (let i = from; i < to; i++) {
        if (test(i)) {
            if (!inRun) { inRun = true; runStart = i }
        } else {
            if (inRun) { runs.push({ start: runStart, end: i }); inRun = false }
        }
    }
    if (inRun) runs.push({ start: runStart, end: to })
    return runs
}

/**
 * Scales a zone array from 1080p to 720p coordinates.
 *
 * @param zones - Source zone array in 1080p pixel space.
 * @returns New array with start/end values rounded to 720p.
 */
export function scaleZones720(zones: Zone[]): Zone[] {
    return zones.map(zone => ({ start: Math.round(zone.start * S720), end: Math.round(zone.end * S720) }))
}

/**
 * Scales a nullable padding zone from 1080p to 720p coordinates.
 *
 * @param pad - Source padding zone or null.
 * @returns Scaled padding zone or null.
 */
export function scalePad720(pad: Zone | null): Zone | null {
    if (!pad) return null
    return { start: Math.round(pad.start * S720), end: Math.round(pad.end * S720) }
}
