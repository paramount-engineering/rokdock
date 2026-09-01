/**
 * Pure helpers for the SVG Converter tool: color conversion, <style>-block CSS parsing,
 * and raw-markup fixups. Node-safe and DOM-free so they can be unit-tested in the vitest
 * node environment without a browser context. Browser-dependent helpers (normalizeColor,
 * extractColors, applyRecolor, and matching a parsed rule's selector against a real
 * element) live in svgConverter.ts because they require a canvas/DOMParser.
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

/**
 * Ensures the root <svg> tag declares the SVG namespace. Without it, an Image element
 * fails to decode the markup at all (a blank raster) even though the regex dimension
 * read and the DOMParser color read both tolerate the missing namespace, so import can
 * appear to succeed while render silently fails. A no-op if the root already declares
 * xmlns (any value), or if there is no <svg> tag to fix.
 */
export function ensureSvgNamespace(svgText: string): string {
    const rootTagMatch = /<svg\b[^>]*>/i.exec(svgText)
    if (!rootTagMatch) return svgText
    const rootTag = rootTagMatch[0]
    if (/\bxmlns\s*=/i.test(rootTag)) return svgText
    const withNamespace = rootTag.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"')
    return svgText.slice(0, rootTagMatch.index) + withNamespace + svgText.slice(rootTagMatch.index + rootTag.length)
}

export interface StyleRule {
    selector: string
    declarations: Record<string, string>
}

/**
 * Extract {selector, declarations} pairs from a <style> block's raw CSS text: flat rules
 * only, which covers the class/id color rules design tools (Illustrator, Inkscape, Figma
 * exports) actually emit for SVG icons. No brace-depth tracking, so a flat at-rule with no
 * braces of its own (e.g. `@font-face{...}`) is skipped by its leading `@`, but a rule
 * nested inside one (e.g. `@media (...){ .cls-1{fill:red} }`) still gets picked up on its
 * own, ignoring the at-rule's condition. Not a goal for this parser: a media query inside
 * an SVG <style> block is rare, and this only ever feeds the Colors panel / recolor, not a
 * real stylesheet cascade.
 */
export function parseStyleRules(cssText: string): StyleRule[] {
    const rules: StyleRule[] = []
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g
    let match: RegExpExecArray | null
    while ((match = ruleRe.exec(cssText)) !== null) {
        const selector = match[1].trim()
        if (!selector || selector.startsWith('@')) continue
        const declarations: Record<string, string> = {}
        for (const declaration of match[2].split(';')) {
            const colonIndex = declaration.indexOf(':')
            if (colonIndex === -1) continue
            const prop = declaration.slice(0, colonIndex).trim()
            const value = declaration.slice(colonIndex + 1).trim()
            if (prop) declarations[prop] = value
        }
        rules.push({ selector, declarations })
    }
    return rules
}
