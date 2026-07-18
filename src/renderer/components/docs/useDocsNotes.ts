import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { AppPreferences } from '@shared/types'

type NotesMap = NonNullable<AppPreferences['docsNotesByPath']>

const SAVE_DEBOUNCE_MS = 400

// ---------------------------------------------------------------------------
// Pure helper
// ---------------------------------------------------------------------------

/**
 * Return a new map with the note for `path` set to `text`. When `text` trims
 * to empty the key is removed. Never mutates the input map.
 */
export function setNoteInMap(
    map: NotesMap,
    path: string,
    text: string,
): NotesMap {
    const next = { ...map }
    if (text.trim() === '') {
        delete next[path]
    } else {
        next[path] = text
    }
    return next
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface DocsNotesHook {
    getNote: (path: string) => string
    setNote: (path: string, text: string) => void
    hasNote: (path: string) => boolean
    /** Reactive set of repo-relative paths that currently have a note, for
     *  marking pages in the nav tree. Updates as notes are added or cleared. */
    notedPaths: Set<string>
    /** True once the persisted notes have loaded, so a caller can react to the
     *  first load (e.g. open the note panel for a page that already has one). */
    loaded: boolean
}

export function useDocsNotes(): DocsNotesHook {
    const [notesByPath, setNotesByPath] = useState<NotesMap>({})
    const [loaded, setLoaded] = useState(false)
    // A stable mirror of the latest map so hasNote keeps a stable identity (an
    // effect keyed on the page path can depend on it without re-running on every
    // keystroke). getNote reads state so the controlled textarea re-renders.
    const notesRef = useRef<NotesMap>({})
    const saveTimerRef = useRef<number | null>(null)
    // The latest map awaiting a debounced write, flushed if we unmount first.
    const pendingRef = useRef<NotesMap | null>(null)
    // Skip persisting until the initial load has run.
    const persistReady = useRef(false)

    useEffect(() => {
        void window.rokdock.store.getPreferences().then((preferences: AppPreferences) => {
            const stored = preferences.docsNotesByPath ?? {}
            notesRef.current = stored
            setNotesByPath(stored)
            setLoaded(true)
            persistReady.current = true
        })
        return () => {
            if (saveTimerRef.current !== null) {
                window.clearTimeout(saveTimerRef.current)
                // Flush the pending write so a note typed just before the window
                // closes is not lost to the debounce.
                if (pendingRef.current !== null) {
                    void window.rokdock.store.setPreferences({ docsNotesByPath: pendingRef.current })
                    pendingRef.current = null
                }
            }
        }
    }, [])

    // Mirror the latest map into the ref and persist (debounced) outside the
    // setState updater, so the updater stays pure and StrictMode's double-invoke
    // cannot schedule the timer or fire the IPC write twice.
    useEffect(() => {
        notesRef.current = notesByPath
        if (!persistReady.current) return
        pendingRef.current = notesByPath
        if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = window.setTimeout(() => {
            void window.rokdock.store.setPreferences({ docsNotesByPath: notesByPath })
            pendingRef.current = null
            saveTimerRef.current = null
        }, SAVE_DEBOUNCE_MS)
    }, [notesByPath])

    const getNote = useCallback(
        (path: string): string => notesByPath[path] ?? '',
        [notesByPath],
    )

    const hasNote = useCallback((path: string): boolean => {
        const note = notesRef.current[path]
        return typeof note === 'string' && note.trim().length > 0
    }, [])

    const setNote = useCallback(
        (path: string, text: string): void => setNotesByPath(current => setNoteInMap(current, path, text)),
        [],
    )

    // Membership only flips when a note crosses empty<->non-empty, but typing
    // within an already-noted page changes notesByPath on every keystroke. Reuse
    // the previous Set when the membership is unchanged so consumers (the nav
    // tree) keep a stable reference and do not re-render per keystroke.
    const notedPathsRef = useRef<Set<string>>(new Set())
    const notedPaths = useMemo(() => {
        const next = new Set(Object.keys(notesByPath).filter(path => notesByPath[path].trim().length > 0))
        const prev = notedPathsRef.current
        if (prev.size === next.size && [...next].every(path => prev.has(path))) return prev
        notedPathsRef.current = next
        return next
    }, [notesByPath])

    return { getNote, hasNote, setNote, notedPaths, loaded }
}
