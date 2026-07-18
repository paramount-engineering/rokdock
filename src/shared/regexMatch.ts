/**
 * Pure regex matching helpers for terminal search and line filtering.
 *
 * These run inside a Web Worker (see the renderer's regexMatch worker) so a
 * catastrophic-backtracking user pattern hangs the worker (which the caller
 * terminates on a timeout) instead of freezing the renderer main thread. The
 * functions are dependency-free and DOM-free so they are unit-tested directly and
 * safe to import from the worker, the renderer, or the main process.
 *
 * Each function compiles the pattern itself and reports an invalid pattern via a
 * discriminated result rather than throwing, so the worker can relay a clean
 * "invalid" status without a try/catch at the message boundary.
 */

/** A single match span within one line of the input. */
export interface RegexLineMatch {
    lineIndex: number
    start: number
    end: number
}

/** Result of a search-match run: matches on success, or an invalid-pattern signal. */
export type SearchMatchResult =
    | { status: 'ok'; matches: RegexLineMatch[] }
    | { status: 'invalid' }

/** Result of a line-filter run: the indices of matching lines, or an invalid-pattern signal. */
export type LineFilterResult =
    | { status: 'ok'; keptIndices: number[] }
    | { status: 'invalid' }

/**
 * Finds every non-empty match of the pattern across the given lines.
 *
 * @param source - The regex source (already escaped / whole-word-wrapped by the caller).
 * @param flags - The regex flags. Must include 'g' so exec advances through each line.
 * @param lines - The line texts to search.
 * @returns The match spans, or { status: 'invalid' } when the pattern does not compile.
 */
export function findSearchMatches(source: string, flags: string, lines: string[]): SearchMatchResult {
    let pattern: RegExp
    try {
        pattern = new RegExp(source, flags)
    } catch {
        return { status: 'invalid' }
    }
    const matches: RegexLineMatch[] = []
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const haystack = lines[lineIndex]
        if (!haystack) continue
        pattern.lastIndex = 0
        while (true) {
            const found = pattern.exec(haystack)
            if (!found) break
            const token = found[0]
            if (token.length === 0) {
                pattern.lastIndex += 1
                continue
            }
            matches.push({ lineIndex, start: found.index, end: found.index + token.length })
            // A non-global pattern never advances lastIndex, so guard against an infinite loop.
            if (!pattern.global) break
        }
    }
    return { status: 'ok', matches }
}

/**
 * Returns the indices of lines that match the pattern (a null/empty pattern is the
 * caller's concern: this is only invoked for a non-empty filter).
 *
 * @param source - The regex source.
 * @param flags - The regex flags (the filter compiles flagless today, so '' is typical).
 * @param lines - The line texts to filter.
 * @returns The kept line indices, or { status: 'invalid' } when the pattern does not compile.
 */
export function filterMatchingLineIndices(source: string, flags: string, lines: string[]): LineFilterResult {
    let pattern: RegExp
    try {
        pattern = new RegExp(source, flags)
    } catch {
        return { status: 'invalid' }
    }
    const keptIndices: number[] = []
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        pattern.lastIndex = 0
        if (pattern.test(lines[lineIndex])) keptIndices.push(lineIndex)
    }
    return { status: 'ok', keptIndices }
}
