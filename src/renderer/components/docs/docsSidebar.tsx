/**
 * DocsSidebar: the left-hand navigation panel for the Developer Docs tool window.
 *
 * Sections top to bottom:
 *  1. Search box (full-text). When a query is present, results replace the
 *     Favorites/Notes/Browse sections; clearing the box restores them.
 *  2. What's New entry
 *  3. Favorites collapsible section (marks entries that also have a note)
 *  4. Browse section with the full DocsTree
 *  4b. Notes: every page that currently has a note (collapsed by default, expansion remembered)
 *  5. Frequently Viewed (shown once a page crosses the view threshold, collapsed by default, expansion remembered)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faWandMagicSparkles } from '@fortawesome/free-solid-svg-icons'
import type { DocsTreeNode, DocsLibraryEntry, DocsSearchResult } from '@shared/docs/types'
import { escapeRegExp } from '@shared/escapeRegExp'
import CollapsibleSection from '../common/collapsibleSection'
import { DocsTree, NoteMarker } from './docsTree'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DocsSidebarProps {
    roots: DocsTreeNode[]
    activePath: string | null
    favorites: DocsLibraryEntry[]
    /** Most-viewed pages, shown in a bottom section when non-empty. */
    frequentlyViewed: DocsLibraryEntry[]
    onOpenPage: (node: { path: string; label?: string }) => void
    onOpenEntry: (entry: DocsLibraryEntry) => void
    onOpenWhatsNew: () => void
    whatsNewActive: boolean
    searchDocs: (query: string) => Promise<{ results?: DocsSearchResult[]; error?: string }>
    /** Open a search hit and scroll to / highlight the matched text on the page. */
    onOpenSearchResult: (path: string, query: string) => void
    /** When set, injects this term into the sidebar search and focuses the input. */
    lookup?: { query: string; token: number } | null
    /** Repo-relative paths that have a note, marked in the browse tree and Favorites. */
    notedPaths?: Set<string>
    /** Pages that currently have a note, listed in their own Notes section. */
    notedEntries?: DocsLibraryEntry[]
}

const SEARCH_DEBOUNCE_MS = 200

/** A case-insensitive regex matching any query term, or null for an empty query. */
function buildHighlightRegex(query: string): RegExp | null {
    const terms = query.trim().split(/\s+/).filter(Boolean).map(escapeRegExp)
    // One capturing group => String.split keeps the matched terms at odd indices.
    return terms.length ? new RegExp(`(${terms.join('|')})`, 'gi') : null
}

/** Wrap matched terms in <mark> for display. The regex is built once per query. */
function highlight(text: string, regex: RegExp | null): React.ReactNode {
    if (!regex) return text
    return text.split(regex).map((part, i) =>
        i % 2 === 1 ? <mark key={i} className="docs-search-mark">{part}</mark> : part,
    )
}

// ---------------------------------------------------------------------------
// Search results
// ---------------------------------------------------------------------------

type SearchStatus = 'building' | 'searching' | 'done'

interface SearchResultsProps {
    query: string
    results: DocsSearchResult[]
    status: SearchStatus
    onOpenPath: (path: string) => void
}

function SearchResults({ query, results, status, onOpenPath }: SearchResultsProps): React.JSX.Element {
    if (status === 'building' && results.length === 0) {
        // First query of the session: every page is being fetched to build the index.
        return <div className="docs-sidebar-empty">Building search index...</div>
    }
    if (status === 'searching' && results.length === 0) {
        return <div className="docs-sidebar-empty">Searching...</div>
    }
    if (results.length === 0) {
        return <div className="docs-sidebar-empty">No matches for "{query.trim()}"</div>
    }
    const regex = buildHighlightRegex(query)
    return (
        <ul className="docs-search-results">
            {results.map(result => (
                <li key={result.path}>
                    <button
                        type="button"
                        className="docs-search-result"
                        onClick={() => onOpenPath(result.path)}
                    >
                        <span className="docs-search-result-head">
                            <span className="docs-search-title">{highlight(result.title, regex)}</span>
                            <span className="docs-search-section">{result.section}</span>
                        </span>
                        <span className="docs-search-snippet">{highlight(result.snippet, regex)}</span>
                    </button>
                </li>
            ))}
        </ul>
    )
}

// ---------------------------------------------------------------------------
// Entry row (Favorites)
// ---------------------------------------------------------------------------

interface EntryRowProps {
    entry: DocsLibraryEntry
    isActive: boolean
    onClick: () => void
    /** Show the sticky-note marker when this page has a note. */
    noted?: boolean
}

function EntryRow({ entry, isActive, onClick, noted }: EntryRowProps): React.JSX.Element {
    return (
        <div
            role="button"
            tabIndex={0}
            className={`docs-nav-row docs-fav-row${isActive ? ' docs-nav-row--active' : ''}`}
            onClick={onClick}
            onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onClick()
                }
            }}
        >
            <span className="docs-fav-label">{entry.title}</span>
            {noted && <NoteMarker />}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Dim helper for empty states
// ---------------------------------------------------------------------------

function EmptyState({ text }: { text: string }): React.JSX.Element {
    return <div className="docs-sidebar-empty">{text}</div>
}

// ---------------------------------------------------------------------------
// DocsSidebar
// ---------------------------------------------------------------------------

export function DocsSidebar({
    roots,
    activePath,
    favorites,
    frequentlyViewed,
    onOpenPage,
    onOpenEntry,
    onOpenWhatsNew,
    whatsNewActive,
    searchDocs,
    onOpenSearchResult,
    lookup,
    notedPaths,
    notedEntries,
}: DocsSidebarProps): React.JSX.Element {
    const [query, setQuery] = useState('')
    const [results, setResults] = useState<DocsSearchResult[]>([])
    const [searchStatus, setSearchStatus] = useState<SearchStatus>('done')
    // Tracks the query the latest in-flight search was for, so stale responses
    // (from a debounce that resolved late) are discarded.
    const latestQuery = useRef('')
    const prewarmed = useRef(false)
    // True once the (one-time) full-text index has finished building. Until then a
    // query shows "Building search index..." instead of "Searching...", since the
    // first request is fetching every page, not just matching.
    const indexReady = useRef(false)
    const searchInputRef = useRef<HTMLInputElement>(null)

    // Focusing the box kicks off the (one-time) index build so it is ready, or
    // nearly so, by the time the user finishes typing.
    const prewarm = useCallback(() => {
        if (prewarmed.current) return
        prewarmed.current = true
        void searchDocs('').then(() => { indexReady.current = true })
    }, [searchDocs])

    // Debounced full-text search; clears results when the box is empty.
    useEffect(() => {
        const trimmed = query.trim()
        latestQuery.current = trimmed
        if (!trimmed) {
            setResults([])
            setSearchStatus('done')
            return
        }
        setSearchStatus(indexReady.current ? 'searching' : 'building')
        const handle = setTimeout(() => {
            void searchDocs(trimmed).then(({ results: hits }) => {
                indexReady.current = true
                if (latestQuery.current !== trimmed) return // a newer query superseded this
                setResults(hits ?? [])
                setSearchStatus('done')
            })
        }, SEARCH_DEBOUNCE_MS)
        return () => clearTimeout(handle)
    }, [query, searchDocs])

    // Inject a lookup term from the terminal context-menu action. Keys on token so
    // the same query string sent again still re-triggers. Focus fires after state
    // settles so the input is populated before focus runs.
    useEffect(() => {
        if (!lookup) return
        setQuery(lookup.query)
        setTimeout(() => { searchInputRef.current?.focus() }, 0)
    }, [lookup?.token])  // eslint-disable-line react-hooks/exhaustive-deps

    const searching = query.trim().length > 0

    return (
        <div className="docs-sidebar">
            {/* 1. Search */}
            <div className="docs-sidebar-search-wrap">
                <input
                    ref={searchInputRef}
                    type="search"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onFocus={prewarm}
                    onKeyDown={e => {
                        if (e.key === 'Escape') setQuery('')
                        else if (e.key === 'Enter' && results[0]) onOpenSearchResult(results[0].path, query)
                    }}
                    placeholder="Search docs"
                    aria-label="Search documentation"
                    className="docs-sidebar-search"
                />
            </div>

            {searching ? (
                <SearchResults
                    query={query}
                    results={results}
                    status={searchStatus}
                    onOpenPath={path => onOpenSearchResult(path, query)}
                />
            ) : (
                <>
                    {/* 2. What's New */}
                    <div className="docs-sidebar-whatsnew">
                        <button
                            type="button"
                            className={`docs-whatsnew-entry${whatsNewActive ? ' docs-whatsnew-entry--active' : ''}`}
                            onClick={onOpenWhatsNew}
                            aria-pressed={whatsNewActive}
                        >
                            <span className="docs-whatsnew-entry-icon" aria-hidden="true"><FontAwesomeIcon icon={faWandMagicSparkles} /></span>
                            What's New
                        </button>
                    </div>

                    {/* 3. Favorites */}
                    <CollapsibleSection title="Favorites" defaultOpen={true}>
                        {favorites.length === 0 ? (
                            <EmptyState text="No favorites yet" />
                        ) : (
                            favorites.map(entry => (
                                <EntryRow
                                    key={entry.path}
                                    entry={entry}
                                    isActive={entry.path === activePath}
                                    onClick={() => onOpenEntry(entry)}
                                    noted={notedPaths?.has(entry.path) ?? false}
                                />
                            ))
                        )}
                    </CollapsibleSection>

                    {/* 4. Browse */}
                    <CollapsibleSection title="Browse" defaultOpen={true} collapsible={false}>
                        <DocsTree
                            roots={roots}
                            activePath={activePath}
                            onOpenPage={onOpenPage}
                            notedPaths={notedPaths}
                        />
                    </CollapsibleSection>

                    {/* 4b. Notes: every page that currently has a note (collapsed by default, expansion remembered) */}
                    {notedEntries && notedEntries.length > 0 && (
                        <CollapsibleSection title="Notes" id="docsNotes" defaultOpen={false}>
                            {notedEntries.map(entry => (
                                <EntryRow
                                    key={entry.path}
                                    entry={entry}
                                    isActive={entry.path === activePath}
                                    onClick={() => onOpenEntry(entry)}
                                />
                            ))}
                        </CollapsibleSection>
                    )}

                    {/* 5. Frequently Viewed, at the bottom, shown once a page crosses the view threshold
                          (collapsed by default, expansion remembered) */}
                    {frequentlyViewed.length > 0 && (
                        <CollapsibleSection title="Frequently Viewed" id="docsFrequentlyViewed" defaultOpen={false}>
                            {frequentlyViewed.map(entry => (
                                <EntryRow
                                    key={entry.path}
                                    entry={entry}
                                    isActive={entry.path === activePath}
                                    onClick={() => onOpenEntry(entry)}
                                    noted={notedPaths?.has(entry.path) ?? false}
                                />
                            ))}
                        </CollapsibleSection>
                    )}
                </>
            )}
        </div>
    )
}
