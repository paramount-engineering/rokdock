/**
 * Pure color helper for the SVG Converter tool.
 *
 * This module contains only node-safe, DOM-free color utilities so they can
 * be unit-tested in the vitest node environment without a browser context.
 * Browser-dependent helpers (normalizeColor, extractColors, applyRecolor)
 * live in svgConverter.ts because they require a canvas/DOMParser.
 */

/**
 * Converts a normalized CSS color string to a 6-digit '#rrggbb' hex value
 * suitable for use with an `<input type="color">` element.
 *
 * Alpha is always dropped: rgba() values produce the opaque rgb equivalent,
 * and 8-digit hex values are truncated to 6 digits. This mirrors the behavior
 * of the browser color picker, which cannot represent transparency.
 *
 * @param norm - A normalized color value: a '#rrggbb' or '#rrggbbaa' hex
 *               string, or an 'rgb(r, g, b)' / 'rgba(r, g, b, a)' string.
 * @returns A 6-digit '#rrggbb' hex string.
 */
export function toHex(norm: string): string {
    if (norm[0] === '#') return norm.length >= 7 ? norm.slice(0, 7) : norm
    const match = norm.match(/rgba?\(([^)]+)\)/)
    if (!match) return '#000000'
    const channels = match[1].split(',').map(x => parseFloat(x))
    const toByteHex = (value: number): string => ('0' + Math.max(0, Math.min(255, Math.round(value || 0))).toString(16)).slice(-2)
    return '#' + toByteHex(channels[0]) + toByteHex(channels[1]) + toByteHex(channels[2])
}
