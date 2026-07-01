/**
 * Renderer-side color utilities.
 *
 * hexToRgb: parses a 3 or 6-digit hex color string into an {r, g, b} object.
 *   Returns null for invalid inputs, supporting both '#abc' and '#aabbcc' forms.
 *
 * Used primarily by DeviceCard's port-badge style builder and any component
 * that needs to derive transparent variants of theme hex values at runtime
 * (since CSS custom properties cannot be used inside rgba() calls without
 * custom property support, which is not universally available in the token
 * positions needed).
 */
/**
 * Parse a 3 or 6-digit hex color string into an `{r, g, b}` object.
 *
 * @param hex - A CSS hex color, e.g. `'#abc'` or `'#aabbcc'` (leading `#` required).
 * @returns The parsed channel values, or `null` if the input is not a valid hex color.
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const value = hex.trim()
    const match = value.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
    if (!match) return null
    const raw = match[1]
    const full = raw.length === 3 ? raw.split('').map((digit) => digit + digit).join('') : raw
    const num = Number.parseInt(full, 16)
    if (Number.isNaN(num)) return null
    return {
        r: (num >> 16) & 255,
        g: (num >> 8) & 255,
        b: num & 255
    }
}