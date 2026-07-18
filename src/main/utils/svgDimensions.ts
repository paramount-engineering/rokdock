/**
 * Parse an SVG's intrinsic pixel dimensions from its markup. Prefers explicit pixel width/height on
 * the root <svg>, then falls back to the viewBox. Non-pixel width/height (percentages, em, and so
 * on) do not match, so an SVG sized "100%" correctly falls through to the viewBox. The viewBox is
 * "min-x min-y width height": min-x/min-y may be negative, and the four values may be separated by
 * whitespace or commas, so both are allowed. Returns { 0, 0 } when neither source is present.
 */
export function parseSvgDimensions(svgText: string): { width: number; height: number } {
    const widthMatch = svgText.match(/<svg[^>]*\bwidth=["'](\d+(?:\.\d+)?)(px)?["']/i)
    const heightMatch = svgText.match(/<svg[^>]*\bheight=["'](\d+(?:\.\d+)?)(px)?["']/i)
    if (widthMatch && heightMatch) {
        return { width: parseFloat(widthMatch[1]), height: parseFloat(heightMatch[1]) }
    }

    const vbMatch = svgText.match(/<svg[^>]*\bviewBox=["']\s*-?[\d.]+[\s,]+-?[\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i)
    if (vbMatch) {
        return { width: parseFloat(vbMatch[1]), height: parseFloat(vbMatch[2]) }
    }

    return { width: 0, height: 0 }
}
