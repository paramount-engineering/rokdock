/**
 * Pure decision logic for what text a terminal "copy" should place on the clipboard.
 *
 * The terminal output is virtualized: only the rows in the current scroll window are in
 * the DOM. A browser-native copy (Cmd/Ctrl+C, the Edit menu's copy role, or a drag
 * selection) can only capture those mounted rows, so copying "select all" or a selection
 * taller than the window silently drops the rest of the scrollback. This helper
 * reconstructs the intended text from the full line buffer instead of the DOM selection.
 */

export interface TerminalCopySelection {
    /** True when the user invoked Select All, so the whole buffer should be copied. */
    selectAllActive: boolean
    /** The browser selection's text, accurate only for rows still in the DOM. */
    nativeText: string
    /** Buffer line index of the selection anchor, or null if it could not be resolved. */
    anchorLineIndex: number | null
    /** Buffer line index of the selection focus, or null if it could not be resolved. */
    focusLineIndex: number | null
}

/**
 * Resolves the clipboard text for a terminal copy, falling back from the possibly
 * truncated DOM selection to the full line buffer when virtualization dropped rows.
 *
 * @param selection - The current selection state.
 * @param bufferLines - Every line's text, in buffer order.
 * @returns The text to write to the clipboard.
 */
export function resolveTerminalCopyText(selection: TerminalCopySelection, bufferLines: string[]): string {
    if (selection.selectAllActive) return bufferLines.join('\n')

    const { nativeText, anchorLineIndex, focusLineIndex } = selection
    if (!nativeText) return nativeText
    if (anchorLineIndex == null || focusLineIndex == null) return nativeText

    const startIndex = Math.min(anchorLineIndex, focusLineIndex)
    const endIndex = Math.max(anchorLineIndex, focusLineIndex)
    // When the DOM selection already holds every line in the range, nothing was dropped and
    // the native text is authoritative (it also preserves partial-line start/end boundaries).
    // Otherwise virtualization unmounted rows mid-range, so rebuild the whole range from the
    // buffer. Boundary lines are then copied in full, which is acceptable for a large
    // multi-line selection (the case where the native copy was losing content).
    if (nativeText.split('\n').length >= endIndex - startIndex + 1) return nativeText
    return bufferLines.slice(startIndex, endIndex + 1).join('\n')
}
