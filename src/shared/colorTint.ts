/**
 * Pure color tinting in HSL space. No DOM, no dependencies, so the main
 * process, preload, and renderer can all import it. Used by toCSSVars to
 * retint a curated subset of theme tokens for the Appearance tab.
 */

/** An HSL adjustment. hue is degrees added (0 to 359). saturation is a
 *  multiplier (1 leaves saturation unchanged). brightness is a lightness
 *  offset in the range -1 to 1 (0 leaves lightness unchanged). */
export interface Tint {
    hue: number
    saturation: number
    brightness: number
}

export const IDENTITY_TINT: Tint = { hue: 0, saturation: 1, brightness: 0 }

/** True when the tint would not change any color, so callers can skip work. */
export function isIdentityTint(tint: Tint): boolean {
    return tint.hue === 0 && tint.saturation === 1 && tint.brightness === 0
}

interface Rgba { r: number; g: number; b: number; a: number }

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value))

/** Parse #rgb, #rrggbb, rgb(), and rgba(). Returns null for anything else
 *  (gradients, named colors, var() references), so applyTint can pass those
 *  through untouched. */
function parseColor(input: string): Rgba | null {
    const stripped = input.trim()
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(stripped)
    if (hex) {
        const h = hex[1]
        if (h.length === 3) {
            return {
                r: parseInt(h[0] + h[0], 16),
                g: parseInt(h[1] + h[1], 16),
                b: parseInt(h[2] + h[2], 16),
                a: 1,
            }
        }
        return {
            r: parseInt(h.slice(0, 2), 16),
            g: parseInt(h.slice(2, 4), 16),
            b: parseInt(h.slice(4, 6), 16),
            a: 1,
        }
    }
    const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(stripped)
    if (rgb) {
        return {
            r: clamp(Math.round(parseFloat(rgb[1])), 0, 255),
            g: clamp(Math.round(parseFloat(rgb[2])), 0, 255),
            b: clamp(Math.round(parseFloat(rgb[3])), 0, 255),
            a: rgb[4] === undefined ? 1 : clamp(parseFloat(rgb[4]), 0, 1),
        }
    }
    return null
}

function rgbToHsl({ r, g, b }: Rgba): { h: number; s: number; l: number } {
    const rn = r / 255, gn = g / 255, bn = b / 255
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
    const lightness = (max + min) / 2
    if (max === min) return { h: 0, s: 0, l: lightness }
    const delta = max - min
    const sat = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
    let h: number
    if (max === rn) h = (gn - bn) / delta + (gn < bn ? 6 : 0)
    else if (max === gn) h = (bn - rn) / delta + 2
    else h = (rn - gn) / delta + 4
    return { h: h * 60, s: sat, l: lightness }
}

function hslToRgb(h: number, sat: number, lightness: number): { r: number; g: number; b: number } {
    h = ((h % 360) + 360) % 360
    if (sat === 0) {
        const grayValue = Math.round(lightness * 255)
        return { r: grayValue, g: grayValue, b: grayValue }
    }
    const chroma = (1 - Math.abs(2 * lightness - 1)) * sat
    const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1))
    const colorOffset = lightness - chroma / 2
    let rp = 0, gp = 0, bp = 0
    if (h < 60) { rp = chroma; gp = x }
    else if (h < 120) { rp = x; gp = chroma }
    else if (h < 180) { gp = chroma; bp = x }
    else if (h < 240) { gp = x; bp = chroma }
    else if (h < 300) { rp = x; bp = chroma }
    else { rp = chroma; bp = x }
    return {
        r: Math.round((rp + colorOffset) * 255),
        g: Math.round((gp + colorOffset) * 255),
        b: Math.round((bp + colorOffset) * 255),
    }
}

/**
 * Parse a color and return its HSL (hue 0 to 360, saturation and lightness 0
 * to 1), or null if the value is not a parseable color (gradient strings,
 * named colors, var() references, non-color values like spacing or fonts).
 * Lets callers hue-gate which tokens to tint without a name list.
 */
export function colorHsl(color: string): { h: number; s: number; l: number } | null {
    const rgba = parseColor(color)
    if (!rgba) return null
    return rgbToHsl(rgba)
}

const toHex2 = (num: number): string => clamp(num, 0, 255).toString(16).padStart(2, '0')

/**
 * Apply an HSL tint to a single color string. Hex inputs return hex; rgba
 * inputs return rgba with alpha preserved. Unparseable inputs and the
 * identity tint return the original string unchanged.
 */
export function applyTint(color: string, tint: Tint): string {
    if (isIdentityTint(tint)) return color
    const rgba = parseColor(color)
    if (!rgba) return color
    const hsl = rgbToHsl(rgba)
    const h = hsl.h + tint.hue
    const sat = clamp(hsl.s * tint.saturation, 0, 1)
    const lightness = clamp(hsl.l + tint.brightness, 0, 1)
    const { r, g, b } = hslToRgb(h, sat, lightness)
    if (rgba.a < 1) return `rgba(${r}, ${g}, ${b}, ${rgba.a})`
    return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`
}
