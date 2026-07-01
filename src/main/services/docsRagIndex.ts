/**
 * A live, in-memory chunk-level lexical index over the Roku developer docs.
 *
 * Chunks each doc page by heading and scores chunks by the distinct, length-weighted
 * meaningful query terms they contain, behind a relevance gate (the docs are
 * API-name-heavy, where distinctive identifiers carry the signal and common words do not).
 * Built lazily from the corpus DocsService already fetches and disk-caches, and
 * memoized for the session via a promise (the same pattern as DocsService's own
 * search index). No build step, no shipped artifact: it tracks the live docs.
 */
import { markdownToPlainText } from '../../shared/docs/plainText'

export interface DocChunk {
    path: string
    title: string
    heading: string
    text: string
}

interface DocsServiceLike {
    listPageLabels(): Promise<Array<[string, string]>>
    getPage(path: string): Promise<{ markdown: string }>
}

interface IndexedChunk {
    chunk: DocChunk
    hay: string
}

const MAX_CHUNK_CHARS = 1200
const DEFAULT_TOP_K = 4
const MAX_TOTAL_CHARS = 5000
/** A matched term this long or longer is distinctive enough to count on its own. */
const DISTINCTIVE_TERM_LEN = 6

/**
 * Generic English plus stack-trace / log-structural words that carry no documentation
 * topic signal. Domain words (field, node, set, scene, screen, ...) are deliberately
 * NOT here. Without this filter a warning full of common words matches unrelated pages
 * on sheer frequency (the "ifDeviceInfo for an AppScene warning" bug).
 */
const STOPWORDS = new Set([
    'the', 'and', 'for', 'are', 'was', 'were', 'its', 'that', 'this', 'with', 'from',
    'have', 'has', 'had', 'not', 'but', 'you', 'your', 'will', 'can', 'could', 'would',
    'should', 'then', 'than', 'when', 'where', 'what', 'which', 'while', 'into', 'onto',
    'out', 'off', 'about', 'there', 'here', 'they', 'them', 'their', 'our', 'his', 'her',
    'also', 'any', 'all', 'some', 'use', 'used', 'using', 'via', 'per', 'etc',
    // stack-trace / log structure, not documentation topics:
    'warning', 'error', 'occurred', 'tried', 'line', 'file', 'failed',
])

/**
 * Extract the meaningful (topic-bearing) terms from a query: lowercase, strip file
 * paths and line numbers and bare numbers, split on non-alphanumerics, then drop
 * stopwords and tokens shorter than three characters. Deduped, order preserved.
 */
function meaningfulTerms(text: string): string[] {
    const cleaned = text
        .toLowerCase()
        .replace(/pkg:\/\S+/g, ' ')       // file paths (pkg:/source/...)
        .replace(/\bline\s+\d+\b/g, ' ')  // "line 1802"
    const seen = new Set<string>()
    const out: string[] = []
    for (const token of cleaned.split(/[^a-z0-9]+/)) {
        if (token.length < 3) continue
        if (/^\d+$/.test(token)) continue
        if (STOPWORDS.has(token)) continue
        if (seen.has(token)) continue
        seen.add(token)
        out.push(token)
    }
    return out
}

/** Split a page's markdown into heading-scoped, length-capped plain-text chunks. */
function chunkMarkdown(markdown: string, path: string, title: string): DocChunk[] {
    const chunks: DocChunk[] = []
    let heading = title
    let buf: string[] = []
    const flush = (): void => {
        const text = markdownToPlainText(buf.join('\n')).trim()
        buf = []
        if (!text) return
        for (let i = 0; i < text.length; i += MAX_CHUNK_CHARS) {
            chunks.push({ path, title, heading, text: text.slice(i, i + MAX_CHUNK_CHARS) })
        }
    }
    for (const line of markdown.split('\n')) {
        const match = /^#{1,6}\s+(.*)$/.exec(line)
        if (match) {
            flush()
            heading = match[1].trim() || title
        } else {
            buf.push(line)
        }
    }
    flush()
    return chunks
}

export class DocsRagIndex {
    private indexPromise: Promise<IndexedChunk[]> | null = null

    constructor(private docs: DocsServiceLike) {}

    /**
     * The most relevant chunks for a query. Scores each chunk by the summed length of
     * the DISTINCT meaningful query terms it contains (length is a cheap rarity proxy:
     * a distinctive identifier like "rosgnode" outweighs common words like "set"). A
     * chunk must match at least two distinct terms, or one distinctive term
     * (>= DISTINCTIVE_TERM_LEN), to count at all, so a noisy stack trace with no real
     * topic overlap returns nothing instead of the highest-frequency unrelated page.
     * Bounded by top-K and a total-size budget.
     */
    async query(text: string, k: number = DEFAULT_TOP_K): Promise<DocChunk[]> {
        const terms = meaningfulTerms(text)
        if (terms.length === 0) return []
        const chunks = await this.getIndex()
        const scored: Array<{ chunk: DocChunk; score: number }> = []
        for (const { chunk, hay } of chunks) {
            const matched = terms.filter(term => hay.includes(term))
            const relevant = matched.length >= 2 || matched.some(term => term.length >= DISTINCTIVE_TERM_LEN)
            if (!relevant) continue
            const score = matched.reduce((sum, term) => sum + term.length, 0)
            scored.push({ chunk, score })
        }
        scored.sort((entryA, entryB) => entryB.score - entryA.score)
        const out: DocChunk[] = []
        let total = 0
        for (const { chunk } of scored.slice(0, k)) {
            if (total + chunk.text.length > MAX_TOTAL_CHARS) break
            out.push(chunk)
            total += chunk.text.length
        }
        return out
    }

    /** Lazily build and memoize the chunk index; reset the memo on a build failure so it retries. */
    private getIndex(): Promise<IndexedChunk[]> {
        if (this.indexPromise === null) {
            this.indexPromise = this.build().catch(err => {
                this.indexPromise = null
                throw err
            })
        }
        return this.indexPromise
    }

    private async build(): Promise<IndexedChunk[]> {
        const labels = await this.docs.listPageLabels()
        const all: IndexedChunk[] = []
        await Promise.all(labels.map(async ([path, title]) => {
            try {
                const page = await this.docs.getPage(path)
                for (const chunk of chunkMarkdown(page.markdown, path, title)) {
                    all.push({ chunk, hay: `${chunk.title} ${chunk.heading} ${chunk.text}`.toLowerCase() })
                }
            } catch {
                /* skip a page that fails to load */
            }
        }))
        return all
    }
}
