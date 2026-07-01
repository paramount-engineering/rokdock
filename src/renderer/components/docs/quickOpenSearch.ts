import type { DocsTreeNode } from '@shared/docs/types'

/** A flattened, navigable page entry for the quick-open palette. */
export interface QuickOpenPage {
    path: string
    title: string
    /** Top-level category label the page lives under, shown as a muted hint. */
    section: string
}

/**
 * Walk the nav tree and collect every navigable page.
 *
 * Rules:
 * - A `page` node is always included.
 * - A `directory` node is included only when it has an `indexPath`; its path
 *   becomes `indexPath` and its label becomes the title.
 * - Directories without an `indexPath` are traversed but not listed themselves.
 * - `section` is the label of the root-level ancestor each page sits under.
 */
export function flattenPages(roots: DocsTreeNode[]): QuickOpenPage[] {
    const result: QuickOpenPage[] = []
    const seen = new Set<string>()

    const add = (path: string, title: string, section: string): void => {
        if (seen.has(path)) return
        seen.add(path)
        result.push({ path, title, section })
    }

    function walk(nodes: DocsTreeNode[], parentSection: string | null): void {
        for (const node of nodes) {
            // At the top level a node's own label is the section for its subtree;
            // descendants inherit it.
            const section = parentSection ?? node.label
            if (node.kind === 'page') {
                add(node.path, node.label, section)
            } else {
                if (node.indexPath) add(node.indexPath, node.label, section)
                if (node.children) walk(node.children, section)
            }
        }
    }

    walk(roots, null)
    return result
}

/**
 * Score a page title against a query string.
 *
 * Rank tiers (higher is better):
 *   4 - exact case-insensitive match
 *   3 - title starts with the query
 *   2 - a word boundary in the title starts with the query
 *   1 - query is a contiguous substring of the title
 *   0 - query chars appear as a scattered subsequence
 *  -1 - no match (caller should exclude these)
 *
 * Within the same tier, shorter titles rank higher; ties resolve alphabetically.
 */
function scoreTitle(title: string, query: string): number {
    const lowerTitle = title.toLowerCase()
    const lowerQuery = query.toLowerCase()

    if (lowerTitle === lowerQuery) return 4
    if (lowerTitle.startsWith(lowerQuery)) return 3

    // Word-boundary match: any word in the title starts with the query.
    const words = lowerTitle.split(/\s+/)
    if (words.some(word => word.startsWith(lowerQuery))) return 2

    // Contiguous substring.
    if (lowerTitle.includes(lowerQuery)) return 1

    // Scattered subsequence: every query character appears in order.
    let position = 0
    for (const char of lowerQuery) {
        const found = lowerTitle.indexOf(char, position)
        if (found === -1) return -1
        position = found + 1
    }
    return 0
}

/**
 * Filter and rank pages against a query string.
 *
 * An empty query returns the first `max` pages in tree order (so the palette
 * shows something immediately on open). A non-empty query runs subsequence
 * fuzzy matching on each title and sorts by rank tier, then title length, then
 * alphabetically. Returns at most `max` results.
 */
export function filterPages(pages: QuickOpenPage[], query: string, max = 50): QuickOpenPage[] {
    const trimmed = query.trim()

    if (trimmed.length === 0) {
        return pages.slice(0, max)
    }

    type Scored = { page: QuickOpenPage; score: number }
    const scored: Scored[] = []

    for (const page of pages) {
        const score = scoreTitle(page.title, trimmed)
        if (score >= 0) {
            scored.push({ page, score })
        }
    }

    scored.sort((first, second) => {
        if (second.score !== first.score) return second.score - first.score
        const lengthDiff = first.page.title.length - second.page.title.length
        if (lengthDiff !== 0) return lengthDiff
        return first.page.title.localeCompare(second.page.title)
    })

    return scored.slice(0, max).map(entry => entry.page)
}
