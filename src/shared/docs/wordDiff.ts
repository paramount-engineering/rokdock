/**
 * Word-level diff between two single lines, for the What's New Source view. A
 * modification (a removed line paired with an added line) is far more readable
 * when only the words that actually changed are emphasized, rather than striking
 * the whole old line and re-printing the whole new one.
 *
 * Both sides are tokenized into words and the whitespace between them, a longest
 * common subsequence of those tokens is found, and any token not on that common
 * subsequence is marked `changed`. Lines are short, so the O(n*m) table is cheap.
 */

export interface WordDiffSegment {
    text: string
    /** True when this token differs between the two sides (added or removed). */
    changed: boolean
}

export interface WordDiff {
    before: WordDiffSegment[]
    after: WordDiffSegment[]
}

/** Split into alternating word / whitespace tokens, preserving every character. */
function tokenize(line: string): string[] {
    return line.match(/\s+|\S+/g) ?? []
}

/** Indices into `beforeTokens` and `afterTokens` that are part of a longest common subsequence. */
function commonSubsequence(beforeTokens: string[], afterTokens: string[]): { aKeep: boolean[]; bKeep: boolean[] } {
    const numBefore = beforeTokens.length
    const numAfter = afterTokens.length
    // table[i][j] = LCS length of beforeTokens[i:] and afterTokens[j:].
    const table: number[][] = Array.from({ length: numBefore + 1 }, () => new Array<number>(numAfter + 1).fill(0))
    for (let i = numBefore - 1; i >= 0; i--) {
        for (let j = numAfter - 1; j >= 0; j--) {
            table[i][j] = beforeTokens[i] === afterTokens[j]
                ? table[i + 1][j + 1] + 1
                : Math.max(table[i + 1][j], table[i][j + 1])
        }
    }

    const aKeep = new Array<boolean>(numBefore).fill(false)
    const bKeep = new Array<boolean>(numAfter).fill(false)
    let i = 0
    let j = 0
    while (i < numBefore && j < numAfter) {
        if (beforeTokens[i] === afterTokens[j]) {
            aKeep[i] = true
            bKeep[j] = true
            i++
            j++
        } else if (table[i + 1][j] >= table[i][j + 1]) {
            i++
        } else {
            j++
        }
    }
    return { aKeep, bKeep }
}

/** Collapse a token list into segments, merging adjacent tokens of the same kind. */
function toSegments(tokens: string[], keep: boolean[]): WordDiffSegment[] {
    const segments: WordDiffSegment[] = []
    for (let i = 0; i < tokens.length; i++) {
        const changed = !keep[i]
        const last = segments[segments.length - 1]
        if (last && last.changed === changed) last.text += tokens[i]
        else segments.push({ text: tokens[i], changed })
    }
    return segments
}

/** Diff two lines at word granularity. */
export function wordDiff(before: string, after: string): WordDiff {
    // Fast path: identical lines (the common case when a multi-line del/add run has
    // only one truly-changed line) skip tokenizing and the O(n*m) LCS table.
    if (before === after) {
        const unchanged = (): WordDiffSegment[] => (before ? [{ text: before, changed: false }] : [])
        return { before: unchanged(), after: unchanged() }
    }

    const beforeArr = tokenize(before)
    const afterArr = tokenize(after)
    const { aKeep, bKeep } = commonSubsequence(beforeArr, afterArr)
    return {
        before: toSegments(beforeArr, aKeep),
        after: toSegments(afterArr, bKeep),
    }
}
