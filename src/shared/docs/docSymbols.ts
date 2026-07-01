/**
 * Shared predicates for what counts as a linkable Roku documentation symbol.
 * Used by the docs symbol index (main, which titles the link targets) and the
 * chat answer linker (renderer, which decides which tokens in an answer link).
 */

/**
 * True for a high-confidence Roku code symbol: an ro/if-prefixed component or
 * interface name (roBitmap, ifDraw2D), or an interior-hump camel/Pascal
 * identifier (createObject, DrawRect, blendColor, SceneGraph). These are
 * distinctive enough to link wherever they appear, without needing a known docs
 * page, so the renderer links them on shape alone (a click runs a docs search).
 */
export function hasRokuSymbolShape(token: string): boolean {
    if (token.length < 3) return false
    if (/^(ro|if)[A-Z]/.test(token)) return true
    return /[a-z][A-Z]/.test(token)
}

/**
 * True for a documentation page title worth indexing as a linkable symbol: the
 * high-confidence shapes above, plus a single capitalized word (a component name
 * like Rectangle, Label, or Poster). A single-word doc title is a real component,
 * so linking it is safe; multi-word titles ("Getting Started") are not symbols.
 * Single capitalized words only link when they are an actual title (the renderer
 * gates them on the index), so prose words that are not documented never link.
 */
export function isLinkableTitle(title: string): boolean {
    if (title.length < 3 || /\s/.test(title)) return false
    if (hasRokuSymbolShape(title)) return true
    // A single capitalized word that contains a lowercase letter: a component name
    // (Rectangle, Poster). The lowercase requirement excludes all-caps acronyms
    // (RGB, HTTP, XML, URL) that would otherwise over-link as common prose words.
    return /^[A-Z][A-Za-z0-9]*[a-z]/.test(title)
}
