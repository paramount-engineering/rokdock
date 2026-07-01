/**
 * Eligibility rule for the terminal "Look up in Docs" action.
 *
 * A docs search is only useful for a short term: a full block of selected
 * output never yields meaningful results. A selection qualifies when it is one
 * to three whitespace-separated words. Both the context-menu item and the
 * hover magnifier use this rule so they agree on what is searchable.
 */
export const LOOKUP_MAX_WORDS = 3

/** True when the selected text is a short, search-worthy term (1 to 3 words). */
export function selectionQualifiesForLookup(text: string): boolean {
    const words = text.trim().split(/\s+/).filter(Boolean)
    return words.length >= 1 && words.length <= LOOKUP_MAX_WORDS
}

/**
 * The current window selection as a lookup term, or null when it is collapsed,
 * empty, or not a short (1 to 3 word) term. The single rule shared by the
 * context-menu action, the menu's enabled gate, and the hover magnifier so all
 * three agree on what is searchable.
 */
export function qualifyingLookupTerm(): string | null {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return null
    const text = selection.toString()
    return selectionQualifiesForLookup(text) ? text.trim() : null
}
