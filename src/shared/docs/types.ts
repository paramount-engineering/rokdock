/** A node in the docs navigation tree. A directory has children; a page has a path. */
export interface DocsTreeNode {
    /** Slug = filename/dirname basename, used as the node id and for doc: link resolution. */
    slug: string
    /** Display label (humanized slug in v1). */
    label: string
    /** Repo-relative path. For a page, the .md file path; for a directory, the dir path. */
    path: string
    kind: 'page' | 'directory'
    /** Present for directories. Empty array means not-yet-loaded for a lazy directory. */
    children?: DocsTreeNode[]
    /**
     * For a directory that contains an index.md, the path to that index page.
     * The directory node opens this page when clicked, and the index is not
     * listed as a separate child.
     */
    indexPath?: string
}

/** The full nav structure plus the slug->path index, returned by docs:get-tree. */
export interface DocsTree {
    roots: DocsTreeNode[]
    /** slug (lowercased) -> repo-relative .md path, for doc: link resolution. */
    slugIndex: Record<string, string>
}

/** A fetched page, returned by docs:get-page. */
export interface DocsPage {
    path: string
    /** Front-matter title when present, else the humanized slug. */
    title: string
    /** Front-matter excerpt when present. Omitted when absent. */
    excerpt?: string
    /** Markdown body with front-matter stripped. */
    markdown: string
    /**
     * ISO commit date of the most recent commit touching this page.
     * Populated lazily via getPageLastUpdated and persisted in the page cache.
     */
    lastUpdated?: string
}

/** A persisted library entry (favorite or recent). Metadata only, never page content. */
export interface DocsLibraryEntry {
    path: string
    title: string
}

/** One full-text search hit. */
export interface DocsSearchResult {
    /** Repo-relative .md path, matching DocsTreeNode.path so the viewer can open it. */
    path: string
    /** Page title (front-matter title or slug). */
    title: string
    /** Top-level category the page lives under (e.g. "REFERENCES"). */
    section: string
    /** A short plain-text excerpt around the first match, for display. */
    snippet: string
}

/** One docs page that changed, for the "What's New" feed. */
export interface WhatsNewEntry {
    /** Repo-relative .md path, matching DocsTreeNode.path so the viewer can open it. */
    path: string
    /** Display label (front-matter title or slug). */
    title: string
    /** Top-level category the page lives under (e.g. "REFERENCES"), for grouping. */
    section: string
    /** Whether the page was added or modified in the window. */
    status: 'added' | 'modified'
    /** Lines added / removed across the window. */
    additions: number
    deletions: number
    /** Unified diff (the actual source changes), expandable in the UI. Absent when
     * GitHub omits it (e.g. the diff is too large). */
    patch?: string
}

/** Result of a "What's New" query: docs pages changed since a date. */
export interface WhatsNewResult {
    entries: WhatsNewEntry[]
    /** The ISO date the query covered changes since. */
    since: string
    /** True when the changed-file set was capped, so some changes are not shown. */
    truncated: boolean
    /** True when this result was served from the last-good cache after a live
     *  fetch failed (e.g. a GitHub rate-limit 403). */
    stale?: boolean
    /** ISO timestamp the cached result was last successfully fetched. Set only
     *  when stale is true. */
    staleAsOf?: string
}

/**
 * How field-reference tables are presented. The reader can switch between these.
 *  - auto:    per-table choice (twopane for description-heavy, compact for matrices)
 *  - native:  the table exactly as authored (multi-column; scrolls if wide)
 *  - twopane: name rail + labeled key/value list
 *  - compact: a dense, bordered key/value table
 *  - cards:   one record per row, name on top, key/value below
 */
export type DocsLayoutMode = 'auto' | 'native' | 'twopane' | 'compact' | 'cards'
