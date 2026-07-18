/**
 * Lightweight JSON structure utilities used by the terminal overlay system.
 *
 * These helpers operate on raw strings rather than parsed JSON objects so they
 * can work on partial/incomplete JSON fragments that appear in terminal output.
 */

/**
 * Given a position of an opening brace or bracket in a string, returns the
 * index of its matching closing counterpart, accounting for nested structures
 * and string literals. Returns -1 if no matching close is found.
 *
 * Used by the terminal tokenizer to detect JSON objects/arrays in log output
 * so they can be highlighted and made expandable by the renderer.
 */
export function findMatchingBracket(text: string, start: number): number {
    const open = text[start]
    const close = open === '{' ? '}' : open === '[' ? ']' : ''
    if (!close) return -1
    let depth = 0
    let inString = false
    let escape = false
    for (let i = start; i < text.length; i++) {
        const ch = text[i]
        if (escape) {
            escape = false
            continue
        }
        if (ch === '\\' && inString) {
            escape = true
            continue
        }
        if (ch === '"') {
            inString = !inString
            continue
        }
        if (inString) continue
        if (ch === open) depth += 1
        if (ch === close) {
            depth -= 1
            if (depth === 0) return i
        }
    }
    return -1
}

/**
 * From a list of {start, end} spans, keep only the outermost ones: any span entirely
 * contained within a wider span (or exactly equal to one already kept) is dropped.
 * Sorted by start ascending then end descending, then swept with a running max end, so
 * a span whose end does not exceed the running max is enclosed by an already-kept span.
 * O(n log n), and shared by the terminal tokenizer's JSON-candidate filter and the
 * renderer's JSON-overlay merge so the two cannot drift. Returns the input unchanged
 * (same reference) when there is nothing to merge.
 */
export function keepOutermostSpans<T extends { start: number; end: number }>(spans: T[]): T[] {
    if (spans.length <= 1) return spans
    const sorted = spans.slice().sort((first, second) => (first.start - second.start) || (second.end - first.end))
    const kept: T[] = []
    let maxEnd = -1
    for (const span of sorted) {
        if (span.end <= maxEnd) continue
        kept.push(span)
        maxEnd = span.end
    }
    return kept
}
