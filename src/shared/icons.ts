/**
 * FontAwesome icon serialization helper.
 *
 * Pure utility with no renderer or Node.js dependencies; safe to import from
 * both the main process and bundled renderer entries.
 */

import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'

/**
 * Converts a FontAwesome IconDefinition to a self-contained inline SVG string.
 * Destructures the icon tuple (width, height, ligatures, unicode, pathData) and
 * joins multi-path data arrays into a single 'd' attribute value.
 *
 * @param icon - FontAwesome icon definition from an icon package (e.g. @fortawesome/free-solid-svg-icons).
 * @returns Inline SVG string with fill="currentColor", ready to embed in HTML templates.
 */
export function faSvg(icon: IconDefinition): string {
    const [width, height, , , pathData] = icon.icon
    const pathStr = Array.isArray(pathData) ? pathData.join(' ') : pathData
    return `<svg viewBox="0 0 ${width} ${height}" fill="currentColor"><path d="${pathStr}"></path></svg>`
}
