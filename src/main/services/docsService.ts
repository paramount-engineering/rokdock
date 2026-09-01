/**
 * Main-process service for fetching and caching the official Roku developer docs.
 *
 * On first call to getTree(), fetches the full GitHub tree API once and then
 * concurrently fetches every page's front-matter and every directory's
 * _order.yaml. The fully labeled, ordered, and hidden-filtered nav tree is
 * returned and memoized. Individual pages are fetched on demand and cached.
 *
 * The renderer never touches the network directly. It reads docs through IPC
 * handlers that delegate to an instance of this class.
 */

import {
    buildNavTree,
    buildSlugIndex,
    humanizeSlug,
    orderChildren,
    parseFrontMatterField,
    parseFrontMatterMeta,
    parseFrontMatterTitle,
    slugFromPath,
    stripFrontMatter,
} from '../../shared/docs/navTree'
import { escapeRegExp } from '../../shared/escapeRegExp'
import { markdownToPlainText } from '../../shared/docs/plainText'
import type { DocsPage, DocsSearchResult, DocsTree, DocsTreeNode, WhatsNewEntry, WhatsNewResult } from '../../shared/docs/types'
import { DocsCache } from './docsCache'

/** One indexed page for full-text search. `haystack` is lowercased title+body. */
interface SearchDoc {
    path: string
    title: string
    section: string
    text: string
    haystack: string
}

/** One changed file from the GitHub compare endpoint. */
interface CompareFile {
    filename: string
    status: string
    additions?: number
    deletions?: number
    patch?: string
}

const SEARCH_MAX_RESULTS = 40
const SEARCH_SNIPPET_BEFORE = 60
const SEARCH_SNIPPET_AFTER = 110

const DOCS_REPO = 'rokudev/dev-doc'
const DOCS_REF = 'v2.0'
const TREE_API = `https://api.github.com/repos/${DOCS_REPO}/git/trees/${DOCS_REF}?recursive=1`
const RAW_BASE = `https://raw.githubusercontent.com/${DOCS_REPO}/${DOCS_REF}/`

// "What's New" reads the same ref the viewer renders. v2.0 is the repo's live,
// actively-updated default branch (not a frozen tag), so this both reflects ongoing
// Roku updates and keeps every changed page openable in the viewer.
const WHATS_NEW_REF = DOCS_REF
const COMMITS_API = `https://api.github.com/repos/${DOCS_REPO}/commits`
const COMPARE_API = `https://api.github.com/repos/${DOCS_REPO}/compare`
// The compare endpoint returns up to 300 files/page. Cap pagination so a window
// with a very large diff cannot fan out unbounded API calls (60/hr unauthenticated).
const WHATS_NEW_MAX_PAGES = 5

/** Top-level docs category for a page path (docs/<CATEGORY>/...), for grouping. */
function sectionForPath(path: string): string {
    const parts = path.split('/')
    return parts.length > 1 ? parts[1] : 'docs'
}

/** Count non-overlapping occurrences of a (non-empty) substring. */
function occurrences(haystack: string, needle: string): number {
    if (!needle) return 0
    let count = 0
    let from = 0
    for (;;) {
        const at = haystack.indexOf(needle, from)
        if (at < 0) break
        count++
        from = at + needle.length
    }
    return count
}

/** A short plain-text excerpt centered on the first matching term. Matches via a
 *  case-insensitive regex so the (potentially large) page text is not lowercased. */
function makeSnippet(text: string, terms: string[]): string {
    const match = text.match(new RegExp(terms.map(escapeRegExp).join('|'), 'i'))
    const pos = match?.index ?? -1
    if (pos < 0) {
        return text.length > 180 ? `${text.slice(0, 180).trimEnd()}...` : text
    }
    const start = Math.max(0, pos - SEARCH_SNIPPET_BEFORE)
    const end = Math.min(text.length, pos + SEARCH_SNIPPET_AFTER)
    const prefix = start > 0 ? '...' : ''
    const suffix = end < text.length ? '...' : ''
    return `${prefix}${text.slice(start, end).trim()}${suffix}`
}

/** Yield control back to the event loop via a real macrotask, not just a microtask, so
 *  pending IPC and timers get a chance to run before the caller's next item starts. */
function yieldToEventLoop(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve))
}

/**
 * Run at most `limit` tasks at a time from `items`, applying `fn` to each. Yields to the
 * event loop after every completed item, not only between the network-bound awaits `fn`
 * usually contains. Without this, a run whose `fn` resolves with no genuine I/O wait (a
 * warm disk-cache hit, for example) never gives the event loop a chance to run anything
 * else: every `await` inside the loop only defers to the microtask queue, which is fully
 * drained before Node ever checks for pending macrotasks like IPC messages or timers, so
 * a long batch of such items starves the whole process until the batch finishes.
 */
export async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length)
    let nextIndex = 0

    async function worker(): Promise<void> {
        while (nextIndex < items.length) {
            const index = nextIndex++
            results[index] = await fn(items[index])
            await yieldToEventLoop()
        }
    }

    const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())
    await Promise.all(workers)
    return results
}

/** Parse a _order.yaml text into a slug array. */
function parseOrderYaml(text: string): string[] {
    const slugs: string[] = []
    for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^\s*-\s*(.+?)\s*$/)
        if (match) {
            slugs.push(match[1].replace(/^['"]|['"]$/g, ''))
        }
    }
    return slugs
}

/**
 * Walk a node tree and collect the dir paths of all directory nodes (to know
 * which _order.yaml files to fetch).
 */
function collectDirPaths(nodes: DocsTreeNode[]): string[] {
    const paths: string[] = []
    function walk(children: DocsTreeNode[]): void {
        for (const node of children) {
            if (node.kind === 'directory') {
                paths.push(node.path)
                if (node.children) walk(node.children)
            }
        }
    }
    walk(nodes)
    return paths
}

/**
 * Flatten a nav tree into a path -> label map for every openable page, including
 * directory index pages (index.md is folded into the directory's indexPath, not a
 * separate page node, but it is still a real, openable file).
 */
function collectPageLabels(nodes: DocsTreeNode[], out: Map<string, string>): Map<string, string> {
    for (const node of nodes) {
        if (node.kind === 'page') {
            out.set(node.path, node.label)
        } else {
            if (node.indexPath) out.set(node.indexPath, node.label)
            if (node.children) collectPageLabels(node.children, out)
        }
    }
    return out
}

/**
 * Apply labels, ordering, and hidden-page collection to the raw tree produced
 * by buildNavTree. Mutates the tree in place and returns the hidden pages.
 */
function applyMetaAndOrder(
    nodes: DocsTreeNode[],
    meta: Map<string, { title?: string; hidden: boolean }>,
    orderMap: Map<string, string[]>,
    isTopLevel: boolean,
): DocsTreeNode[] {
    const hidden: DocsTreeNode[] = []

    for (const node of nodes) {
        if (node.kind === 'directory') {
            // Label: top-level category -> folder name verbatim; nested dir -> index title or humanized.
            if (isTopLevel) {
                node.label = node.slug
            } else {
                const indexMeta = node.indexPath ? meta.get(node.indexPath) : undefined
                node.label = indexMeta?.title ?? humanizeSlug(node.slug)
            }

            if (node.children) {
                // Recurse into children, collecting their hidden pages.
                const childHidden = applyMetaAndOrder(node.children, meta, orderMap, false)
                hidden.push(...childHidden)

                // Remove hidden pages from this directory's children.
                node.children = node.children.filter(child => !childHidden.includes(child))

                // Order children via the directory's _order.yaml.
                const orderSlugs = orderMap.get(node.path) ?? []
                node.children = orderChildren(node.children, orderSlugs)
            }
        } else {
            // Page node: label from front-matter title, falling back to the raw
            // slug. The site (ReadMe) shows a title-less page's slug verbatim
            // (e.g. "script", not "Script"), so the fallback is not humanized.
            const pageMeta = meta.get(node.path)
            node.label = pageMeta?.title ?? slugFromPath(node.path)

            if (pageMeta?.hidden) {
                hidden.push(node)
            }
        }
    }

    return hidden
}

export class DocsService {
    private treePromise: Promise<DocsTree> | null = null
    private pageCache = new Map<string, DocsPage>()
    private whatsNewCache = new Map<string, Promise<WhatsNewResult>>()
    private searchIndexPromise: Promise<SearchDoc[]> | null = null
    private revalidatePromise: Promise<void> | null = null
    private readonly cache: DocsCache | null

    /**
     * @param cacheDir Optional userData subdirectory for the persistent disk
     *   cache. When omitted (e.g. in unit tests), only the in-memory and network
     *   tiers are active and behavior is unchanged.
     */
    constructor(cacheDir?: string) {
        this.cache = cacheDir ? new DocsCache(cacheDir, DOCS_REF) : null
        // Discard a cache left behind by a different docs ref/schema before any
        // read can serve from it.
        try { this.cache?.reconcile() } catch { /* best-effort: a bad cache must never break construction */ }
    }

    /**
     * Fetch the full repo tree and build the complete labeled, ordered nav
     * tree. The result is memoized: subsequent calls return the same resolved
     * object without hitting the network again.
     */
    async getTree(): Promise<DocsTree> {
        if (this.treePromise === null) {
            this.treePromise = this.loadTree().catch(err => {
                this.treePromise = null
                throw err
            })
        }
        return this.treePromise
    }

    private async loadTree(): Promise<DocsTree> {
        if (this.cache?.isValidFor()) {
            const cached = this.cache.readTree()
            if (cached !== null) return cached
        }
        const tree = await this.fetchTree()
        this.cache?.writeTree(tree)
        return tree
    }

    private async fetchTree(): Promise<DocsTree> {
        // 1. Fetch the recursive GitHub tree.
        const response = await fetch(TREE_API)
        if (!response.ok) {
            throw new Error(`Failed to load docs tree (${response.status} ${response.statusText})`)
        }
        const json = await response.json() as { tree: Array<{ path: string; type: string }>; truncated: boolean }

        // Keep only .md blobs under docs/ (exclude reference/ entirely).
        const mdPaths = json.tree
            .filter(entry => entry.type === 'blob')
            .map(entry => entry.path)
            .filter(filePath => filePath.startsWith('docs/') && filePath.endsWith('.md'))

        // 2. Build the structural tree (index.md folded into indexPath).
        const rawRoots = buildNavTree(mdPaths)

        // The roots from buildNavTree include a "docs" wrapper node; unwrap to
        // get the top-level category nodes (direct children of docs/).
        const docsNode = rawRoots.find(node => node.slug === 'docs' && node.kind === 'directory')
        const categoryNodes: DocsTreeNode[] = docsNode?.children ?? rawRoots

        // 3. Collect all directory paths (for _order.yaml fetches).
        //    Also include "docs" itself for the top-level _order.yaml.
        const dirPaths = ['docs', ...collectDirPaths(categoryNodes)]

        // 4. Fetch front-matter for every .md file at concurrency ~40.
        const metaMap = new Map<string, { title?: string; hidden: boolean }>()
        await pooled(mdPaths, 40, async (path) => {
            try {
                const res = await fetch(`${RAW_BASE}${path}`, {
                    headers: { Range: 'bytes=0-4095' },
                })
                // Accept 200 or 206 (partial content).
                if (!res.ok && res.status !== 206) {
                    metaMap.set(path, { hidden: false })
                    return
                }
                const chunk = await res.text()
                metaMap.set(path, parseFrontMatterMeta(chunk))
            } catch {
                metaMap.set(path, { hidden: false })
            }
        })

        // 5. Fetch _order.yaml for every directory at concurrency ~40.
        const orderMap = new Map<string, string[]>()
        await pooled(dirPaths, 40, async (dir) => {
            try {
                const res = await fetch(`${RAW_BASE}${dir}/_order.yaml`)
                if (!res.ok) return
                const text = await res.text()
                orderMap.set(dir, parseOrderYaml(text))
            } catch {
                // Missing order file is fine; the directory keeps alpha order.
            }
        })

        // 6. Apply labels + ordering + collect hidden pages.
        const hiddenPages = applyMetaAndOrder(categoryNodes, metaMap, orderMap, true)

        // 7. Order the top-level category nodes via docs/_order.yaml.
        const topOrderSlugs = orderMap.get('docs') ?? []
        let roots = orderChildren(categoryNodes, topOrderSlugs)

        // 8. Append synthetic Hidden node last (if any hidden pages exist).
        if (hiddenPages.length > 0) {
            const hiddenChildren = [...hiddenPages].sort((nodeA, nodeB) => nodeA.label.localeCompare(nodeB.label))
            const hiddenNode: DocsTreeNode = {
                slug: '__hidden__',
                label: 'Hidden',
                path: '__hidden__',
                kind: 'directory',
                children: hiddenChildren,
            }
            roots = [...roots, hiddenNode]
        }

        // 9. Build slug index (index.md -> folder slug).
        const slugIndex = buildSlugIndex(mdPaths)

        return { roots, slugIndex }
    }

    /** The current HEAD commit SHA of the docs ref (one API call). */
    private async fetchHeadSha(): Promise<string> {
        const res = await fetch(`${COMMITS_API}?sha=${DOCS_REF}&per_page=1`)
        if (!res.ok) {
            throw new Error(`Failed to load docs head (${res.status} ${res.statusText})`)
        }
        const commits = await res.json() as Array<{ sha: string }>
        if (commits.length === 0) throw new Error('Docs ref has no commits')
        return commits[0].sha
    }

    /**
     * Stale-while-revalidate: compare the cached build SHA against the current
     * HEAD. If unchanged, do nothing. If changed, refetch only the changed docs
     * pages (delete removed ones), rebuild the tree, drop the stale in-memory
     * pages and search index, then record the new SHA. Memoized so it runs at
     * most once per session. Best-effort: a failure leaves the cache as-is.
     */
    private revalidate(): Promise<void> {
        if (this.cache === null) return Promise.resolve()
        if (this.revalidatePromise === null) {
            this.revalidatePromise = this.runRevalidate().catch(() => { /* keep serving stale */ })
        }
        return this.revalidatePromise
    }

    private async runRevalidate(): Promise<void> {
        if (this.cache === null) return
        const head = await this.fetchHeadSha()
        const known = this.cache.getSha()
        if (known === null) {
            // Cold path: tree built but no recorded sha. No compare ran, so there
            // is nothing stale to reconcile. Adopt the current head.
            // Note: the corpus warm runs after this and fetches from a moving
            // branch ref, so the tree, this head sha, and the page bodies can come
            // from slightly different commits. The next session's revalidate
            // reconciles any in-between delta.
            this.cache.setSha(head)
            return
        }
        if (known === head) return
        const { files, truncated } = await this.fetchCompareFiles(known, head)
        const changedDocs = files.filter(changedFile => changedFile.filename.startsWith('docs/') && changedFile.filename.endsWith('.md'))
        // Rebuild the tree: structure may have changed.
        this.treePromise = null
        const tree = await this.fetchTree()
        this.cache.writeTree(tree)
        this.treePromise = Promise.resolve(tree)
        // Refresh each changed page on disk; drop its stale in-memory copy.
        for (const file of changedDocs) {
            this.pageCache.delete(file.filename)
            if (file.status === 'removed') {
                this.cache.deletePage(file.filename)
            } else {
                try { await this.refetchPage(file.filename) } catch { /* leave stale */ }
            }
        }
        // Force the search index to rebuild from the refreshed corpus.
        this.searchIndexPromise = null
        // Only advance the sha when the FULL changed-file set was applied. A
        // truncated compare (diff beyond WHATS_NEW_MAX_PAGES) left tail pages
        // stale on disk; leaving the sha unchanged lets the next session retry
        // (the per-session memoization would otherwise block a re-attempt).
        if (!truncated) this.cache.setSha(head)
    }

    /** Fetch a page from the network and overwrite both cache tiers (bypasses
     *  the disk read in getPage, which would return the stale copy). Reuses the
     *  shared fetchPageFromNetwork helper. */
    private async refetchPage(pagePath: string): Promise<void> {
        const page = await this.fetchPageFromNetwork(pagePath)
        this.pageCache.set(pagePath, page)
        this.cache?.writePage(page)
    }

    /** Fetch and persist the entire page corpus (via the memoized search-index
     *  build, which calls getPage for every page). No-op without a disk cache. */
    private async warmCorpus(): Promise<void> {
        if (this.cache === null) return
        await this.getSearchIndex()
    }

    /**
     * Background entry point, called fire-and-forget when a docs window opens:
     * ensure the tree, revalidate against HEAD, then warm the full corpus to
     * disk. Best-effort; each phase is independently memoized.
     */
    async prime(): Promise<void> {
        try {
            await this.getTree()
            await this.revalidate()
            await this.warmCorpus()
        } catch { /* best-effort background priming */ }
    }

    /** Fetch a single page from the raw CDN and parse it into a DocsPage. Does
     *  not touch either cache tier; callers decide what to populate. */
    private async fetchPageFromNetwork(path: string): Promise<DocsPage> {
        const response = await fetch(`${RAW_BASE}${path}`)
        if (!response.ok) {
            throw new Error(`Failed to load page (${response.status} ${response.statusText})`)
        }
        const body = await response.text()
        // A title-less page falls back to its raw slug (see applyMetaAndOrder).
        const title = parseFrontMatterTitle(body) ?? slugFromPath(path)
        const excerptRaw = parseFrontMatterField(body, 'excerpt')
        const markdown = stripFrontMatter(body)
        const page: DocsPage = { path, title, markdown }
        if (excerptRaw) page.excerpt = excerptRaw
        return page
    }

    /**
     * Fetch a single markdown page by its repo-relative path.
     * Checks the in-memory cache, then the disk cache, then the network.
     * Strips front-matter from the body and resolves the title from
     * front-matter or falls back to the raw slug. Cached by path.
     */
    async getPage(path: string): Promise<DocsPage> {
        const cached = this.pageCache.get(path)
        if (cached !== undefined) return cached

        const fromDisk = this.cache?.readPage(path)
        if (fromDisk) {
            this.pageCache.set(path, fromDisk)
            return fromDisk
        }

        const page = await this.fetchPageFromNetwork(path)
        this.pageCache.set(path, page)
        this.cache?.writePage(page)
        return page
    }

    /**
     * Build the "What's New" feed: docs pages changed on the live branch since the
     * given ISO date.
     *
     * Uses the GitHub compare endpoint, which returns the COMPLETE changed-file set
     * between two commits in a handful of paginated calls, rather than one call per
     * commit (unaffordable under the 60/hr unauthenticated limit). The base is the
     * most recent commit at/before the since-date. Changed docs pages are mapped to
     * their nav labels (pages absent from the tree are dropped, since they cannot be
     * opened) and grouped by section in the renderer. Memoized per since-date.
     */
    async getWhatsNew(sinceISO: string): Promise<WhatsNewResult> {
        let pending = this.whatsNewCache.get(sinceISO)
        if (pending === undefined) {
            pending = this.fetchWhatsNew(sinceISO)
                .then(result => {
                    try { this.cache?.writeLastWhatsNew(result) } catch { /* best-effort: a failed cache write must not fail a successful fetch */ }
                    return result
                })
                .catch(err => {
                    this.whatsNewCache.delete(sinceISO)
                    const last = this.cache?.readLastWhatsNew()
                    if (last) {
                        return { ...last.result, stale: true, staleAsOf: last.savedAt }
                    }
                    throw err
                })
            this.whatsNewCache.set(sinceISO, pending)
        }
        return pending
    }

    private async fetchWhatsNew(sinceISO: string): Promise<WhatsNewResult> {
        const tree = await this.getTree()
        const labels = collectPageLabels(tree.roots, new Map())

        // 1. Find the base: the most recent commit at/before the since-date. Comparing
        //    base...head then yields exactly the changes within the window.
        const baseUrl = `${COMMITS_API}?sha=${WHATS_NEW_REF}&until=${encodeURIComponent(sinceISO)}&per_page=1`
        const baseRes = await fetch(baseUrl)
        if (!baseRes.ok) {
            throw new Error(`Failed to load changes (${baseRes.status} ${baseRes.statusText})`)
        }
        const baseCommits = await baseRes.json() as Array<{ sha: string }>
        if (baseCommits.length === 0) {
            // Window predates the repo's history; nothing to compare against.
            return { entries: [], since: sinceISO, truncated: false }
        }
        const base = baseCommits[0].sha

        // 2. Page through the compare's changed-file list. Each file appears once
        //    with its aggregate diff (patch) and line counts.
        const byPath = new Map<string, WhatsNewEntry>()
        const { files, truncated } = await this.fetchCompareFiles(base, WHATS_NEW_REF)
        for (const file of files) {
            const path = file.filename
            if (!path.startsWith('docs/') || !path.endsWith('.md')) continue
            if (!labels.has(path)) continue // not an openable nav page
            const entry: WhatsNewEntry = {
                path,
                title: labels.get(path) ?? slugFromPath(path),
                section: sectionForPath(path),
                status: file.status === 'added' ? 'added' : 'modified',
                additions: file.additions ?? 0,
                deletions: file.deletions ?? 0,
            }
            if (file.patch) entry.patch = file.patch
            byPath.set(path, entry)
        }

        const entries = [...byPath.values()].sort((entryA, entryB) =>
            entryA.section !== entryB.section ? entryA.section.localeCompare(entryB.section) : entryA.title.localeCompare(entryB.title),
        )

        return { entries, since: sinceISO, truncated }
    }

    /**
     * Page through the compare endpoint's changed-file list for base...head and
     * return the raw file entries. Capped at WHATS_NEW_MAX_PAGES so a huge diff
     * cannot fan out unbounded API calls. `truncated` is true when the cap was hit.
     */
    private async fetchCompareFiles(base: string, head: string): Promise<{ files: CompareFile[]; truncated: boolean }> {
        const all: CompareFile[] = []
        let truncated = false
        let page = 1
        for (; page <= WHATS_NEW_MAX_PAGES; page++) {
            const res = await fetch(`${COMPARE_API}/${base}...${head}?per_page=300&page=${page}`)
            if (!res.ok) {
                throw new Error(`Failed to load changes (${res.status} ${res.statusText})`)
            }
            const data = await res.json() as { files?: CompareFile[] }
            const files = data.files ?? []
            all.push(...files)
            if (files.length < 300) break
            if (page === WHATS_NEW_MAX_PAGES) truncated = true
        }
        return { files: all, truncated }
    }

    /** Every openable page as [repo-relative path, label]. Backs the docs RAG index. */
    async listPageLabels(): Promise<Array<[string, string]>> {
        const tree = await this.getTree()
        return [...collectPageLabels(tree.roots, new Map()).entries()]
    }

    /**
     * Full-text search across all docs pages. The index (every page's plain-text
     * body) is built once on first use and memoized; building it also warms the
     * page cache, so opening a result is instant. An empty query just ensures the
     * index is built (used to pre-warm on search-box focus) and returns nothing.
     */
    async searchDocs(query: string): Promise<DocsSearchResult[]> {
        const index = await this.getSearchIndex()
        const normalized = query.trim().toLowerCase()
        if (!normalized) return []

        const terms = normalized.split(/\s+/).filter(Boolean)
        const scored: { doc: SearchDoc; score: number }[] = []
        for (const doc of index) {
            // Require every term somewhere in the page (title or body).
            if (!terms.every(term => doc.haystack.includes(term))) continue
            const titleLower = doc.title.toLowerCase()
            let score = 0
            for (const term of terms) {
                if (titleLower.includes(term)) score += 10
                score += occurrences(doc.haystack, term)
            }
            if (doc.haystack.includes(normalized)) score += 5 // whole-phrase bonus
            scored.push({ doc, score })
        }
        scored.sort((entryA, entryB) => entryB.score - entryA.score || entryA.doc.title.localeCompare(entryB.doc.title))

        return scored.slice(0, SEARCH_MAX_RESULTS).map(({ doc }) => ({
            path: doc.path,
            title: doc.title,
            section: doc.section,
            snippet: makeSnippet(doc.text, terms),
        }))
    }

    private getSearchIndex(): Promise<SearchDoc[]> {
        if (this.searchIndexPromise === null) {
            this.searchIndexPromise = this.buildSearchIndex().catch(err => {
                this.searchIndexPromise = null
                throw err
            })
        }
        return this.searchIndexPromise
    }

    private async buildSearchIndex(): Promise<SearchDoc[]> {
        const tree = await this.getTree()
        const labels = [...collectPageLabels(tree.roots, new Map()).entries()]
        const docs = await pooled(labels, 20, async ([path, title]) => {
            try {
                const page = await this.getPage(path) // cached; also warms page loads
                const text = markdownToPlainText(page.markdown)
                return { path, title, section: sectionForPath(path), text, haystack: `${title} ${text}`.toLowerCase() }
            } catch {
                return null
            }
        })
        return docs.filter((doc): doc is SearchDoc => doc !== null)
    }

    /**
     * Return the ISO date of the most recent commit that touched the given page.
     * Checks the in-memory cache, then the disk cache, and finally fetches from
     * the GitHub commits API. Persists the date into both cache tiers when found.
     * Never throws to the caller (returns null on any error).
     */
    async getPageLastUpdated(path: string): Promise<string | null> {
        try {
            const memPage = this.pageCache.get(path)
            if (memPage?.lastUpdated) return memPage.lastUpdated

            const diskPage = this.cache?.readPage(path)
            if (diskPage?.lastUpdated) {
                this.pageCache.set(path, diskPage)
                return diskPage.lastUpdated
            }

            const url = `${COMMITS_API}?path=${encodeURIComponent(path)}&sha=${DOCS_REF}&per_page=1`
            const res = await fetch(url)
            if (!res.ok) return null

            const commits = await res.json() as Array<{ commit?: { committer?: { date?: string } } }>
            const date = commits[0]?.commit?.committer?.date ?? null

            if (date) {
                // Persist the date so it survives across sessions. A changed page
                // is refetched fresh by revalidation (without a date), so this
                // naturally re-resolves. Build a new object rather than mutating
                // the cached instance, which getPage hands out by reference.
                const base = memPage ?? diskPage
                if (base) {
                    const page = { ...base, lastUpdated: date }
                    this.pageCache.set(path, page)
                    this.cache?.writePage(page)
                }
            }

            return date
        } catch {
            return null
        }
    }

    /**
     * Reset all caches, in-memory and on disk. Intended for use in tests and for
     * manual cache invalidation (e.g. when the user triggers a docs refresh).
     * Without clearing the disk tier, getPage/getTree would just repopulate
     * memory from the stale disk copy, making the invalidation a no-op.
     */
    clearCache(): void {
        this.treePromise = null
        this.pageCache.clear()
        this.whatsNewCache.clear()
        this.searchIndexPromise = null
        this.cache?.clear()
    }
}
