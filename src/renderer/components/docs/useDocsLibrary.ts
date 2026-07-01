import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { DocsLibraryEntry } from '@shared/docs/types'
import type { AppPreferences } from '@shared/types'

/** A page appears under "Frequently Viewed" once viewed this many times. */
export const MIN_VIEWS_FOR_FREQUENT = 5
/** Cap on the "Frequently Viewed" list. */
export const MAX_FREQUENTLY_VIEWED = 10

type ViewCounts = NonNullable<AppPreferences['docsViewCounts']>

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * If an entry with the same path exists in `list`, remove it; otherwise append
 * `entry` to the end.
 */
export function toggleFavorite(
    list: DocsLibraryEntry[],
    entry: DocsLibraryEntry
): DocsLibraryEntry[] {
    const exists = list.some(e => e.path === entry.path)
    if (exists) {
        return list.filter(e => e.path !== entry.path)
    }
    return [...list, entry]
}

/** Record one more view of a page, refreshing its stored title. */
export function recordView(counts: ViewCounts, entry: DocsLibraryEntry): ViewCounts {
    const prev = counts[entry.path]
    return { ...counts, [entry.path]: { title: entry.title, count: (prev?.count ?? 0) + 1 } }
}

/** The most-viewed pages meeting the threshold, highest first, capped. */
export function selectFrequentlyViewed(
    counts: ViewCounts,
    minViews = MIN_VIEWS_FOR_FREQUENT,
    max = MAX_FREQUENTLY_VIEWED,
): DocsLibraryEntry[] {
    return Object.entries(counts)
        .filter(([, entry]) => entry.count >= minViews)
        .sort((first, second) => second[1].count - first[1].count || first[1].title.localeCompare(second[1].title))
        .slice(0, max)
        .map(([path, entry]) => ({ path, title: entry.title }))
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface DocsLibraryHook {
    favorites: DocsLibraryEntry[]
    isFavorite: (path: string) => boolean
    toggleFavorite: (entry: DocsLibraryEntry) => void
    /** Most-viewed pages (>= MIN_VIEWS_FOR_FREQUENT), highest first, capped. */
    frequentlyViewed: DocsLibraryEntry[]
    /** Count one view of a page (call when a page is opened). */
    recordView: (entry: DocsLibraryEntry) => void
}

export function useDocsLibrary(): DocsLibraryHook {
    const [favorites, setFavorites] = useState<DocsLibraryEntry[]>([])
    const [viewCounts, setViewCounts] = useState<ViewCounts>({})
    // Skip persisting until the initial load has run; only user-driven changes
    // should write back.
    const persistReady = useRef(false)

    useEffect(() => {
        void window.rokdock.store.getPreferences().then((preferences: AppPreferences) => {
            setFavorites(preferences.favoriteDocs ?? [])
            setViewCounts(preferences.docsViewCounts ?? {})
            persistReady.current = true
        })
    }, [])

    // Persist as state changes, outside the setState updaters so the updaters stay
    // pure (no doubled IPC under StrictMode's double-invocation).
    useEffect(() => {
        if (persistReady.current) void window.rokdock.store.setPreferences({ favoriteDocs: favorites })
    }, [favorites])
    useEffect(() => {
        if (persistReady.current) void window.rokdock.store.setPreferences({ docsViewCounts: viewCounts })
    }, [viewCounts])

    const isFavorite = useCallback(
        (path: string): boolean => favorites.some(e => e.path === path),
        [favorites]
    )

    const handleToggleFavorite = useCallback(
        (entry: DocsLibraryEntry): void => setFavorites(current => toggleFavorite(current, entry)),
        []
    )

    const handleRecordView = useCallback(
        (entry: DocsLibraryEntry): void => setViewCounts(current => recordView(current, entry)),
        []
    )

    const frequentlyViewed = useMemo(() => selectFrequentlyViewed(viewCounts), [viewCounts])

    return {
        favorites,
        isFavorite,
        toggleFavorite: handleToggleFavorite,
        frequentlyViewed,
        recordView: handleRecordView,
    }
}
