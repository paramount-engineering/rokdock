/**
 * Pure mapping logic for the terminal's live line filter.
 *
 * The filter never discards anything from the line buffer: it only decides
 * which buffer indices are currently displayed. The matching itself runs in
 * the regex Web Worker (see regexMatchClient), the same one used for search
 * and the save/stream filters, so a catastrophic-backtracking pattern cannot
 * freeze the renderer. This module only maps the worker's result (or its
 * absence) onto what the virtualized view and copy/select-all should show.
 * `null` always means "no filter active, show everything" and is kept
 * distinct from an empty array ("a filter is active and nothing matches").
 */

/** Maps a position in the displayed (possibly filtered) list back to its real buffer index. */
export function resolveBufferLineIndex(filteredLineIndices: number[] | null, position: number): number {
    return filteredLineIndices ? filteredLineIndices[position]! : position
}

/** The line texts a copy/select-all should consider: the filtered subset, or everything when unfiltered. */
export function linesForCopy(lineTexts: string[], filteredLineIndices: number[] | null): string[] {
    return filteredLineIndices ? filteredLineIndices.map((i) => lineTexts[i]!) : lineTexts
}

/** Maps a real buffer index to its position within the filtered list, or null if it isn't displayed. */
export function toFilteredPosition(filteredLineIndices: number[] | null, bufferIndex: number | null): number | null {
    if (bufferIndex == null) return null
    if (!filteredLineIndices) return bufferIndex
    const position = filteredLineIndices.indexOf(bufferIndex)
    return position === -1 ? null : position
}
