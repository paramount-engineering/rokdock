import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronLeft, faChevronRight, faXmark } from '@fortawesome/free-solid-svg-icons'
import type { DocsPage, DocsLayoutMode, DocsTreeNode } from '@shared/docs/types'
import type { AppPreferences } from '@shared/types'
import { escapeRegExp } from '@shared/escapeRegExp'
import { rokuDocUrl } from '@shared/docs/rokuDocUrl'
import { RokdockToolbar } from '../rokdock/wrappers'
import { useDocsData } from './useDocsData'
import { useDocsLibrary } from './useDocsLibrary'
import { useReadingZoom } from './useReadingZoom'
import { DocsSidebar } from './docsSidebar'
import { DocsReadingPane } from './docsReadingPane'
import { DocsWhatsNew } from './docsWhatsNew'
import { QuickOpen } from './quickOpen'
import { flattenPages } from './quickOpenSearch'
import { useDocsNotes } from './useDocsNotes'
import { DocsNote } from './docsNote'

// ---------------------------------------------------------------------------
// Status type
// ---------------------------------------------------------------------------

type PageStatus = 'idle' | 'loading' | 'loaded' | 'error' | 'not-found'

// ---------------------------------------------------------------------------
// Layout switcher options (icon toggles)
// ---------------------------------------------------------------------------

const ICON_PROPS = {
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.2,
    strokeLinecap: 'round' as const,
}

/** Left-pointing arrow (history back). */
function BackArrowIcon(): React.JSX.Element {
    return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9.5 3.5 5 8l4.5 4.5" />
            <path d="M5 8h7" />
        </svg>
    )
}

/** Right-pointing arrow (history forward). */
function ForwardArrowIcon(): React.JSX.Element {
    return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6.5 3.5 11 8l-4.5 4.5" />
            <path d="M11 8H4" />
        </svg>
    )
}

/** Double chevron (sidebar collapse/expand). An SVG so it centers geometrically
 *  like the history arrows, rather than riding high the way the "<</>>" text glyphs
 *  do in the toolbar button. */
function DoubleChevronIcon({ direction }: { direction: 'left' | 'right' }): React.JSX.Element {
    const pathData = direction === 'left'
        ? 'M7.5 4 4 8l3.5 4M12 4 8.5 8l3.5 4'
        : 'M8.5 4 12 8l-3.5 4M4 4 7.5 8L4 12'
    return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d={pathData} />
        </svg>
    )
}


/** A five-point star, outline when not favorited, filled when favorited. */
function StarIcon({ filled }: { filled: boolean }): React.JSX.Element {
    return (
        <svg viewBox="0 0 24 24" width="15" height="15" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
            <path d="M12 2.5l2.9 6.0 6.6.6-5.0 4.3 1.5 6.5L12 17.0 6.0 20.4l1.5-6.5-5.0-4.3 6.6-.6z" />
        </svg>
    )
}

/** A sticky note with a folded bottom-right corner. */
function NoteIcon(): React.JSX.Element {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 2h9v9l-3 3H2z" />
            <path d="M11 11l-3 3v-3h3z" />
            <line x1="4.5" y1="5.5" x2="9.5" y2="5.5" />
            <line x1="4.5" y1="7.5" x2="9.5" y2="7.5" />
            <line x1="4.5" y1="9.5" x2="7.5" y2="9.5" />
        </svg>
    )
}

/** An arrow-out-of-box glyph for opening the current page in the system browser. */
function ExternalLinkIcon(): React.JSX.Element {
    return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 3H3v10h10V9" />
            <path d="M9 2h5v5" />
            <path d="M14 2 8 8" />
        </svg>
    )
}

/** A back/forward history location: a docs page, or the What's New view. */
type NavEntry =
    | { kind: 'page'; path: string; anchor?: string }
    | { kind: 'whatsnew' }

// All matches get the base highlight. The one the find bar is parked on also gets
// the "current" highlight, which renders on top with a stronger tint.
const SEARCH_HIGHLIGHT = 'docs-search-hit'
const SEARCH_HIGHLIGHT_CURRENT = 'docs-search-hit-current'
// Stable empty default so a not-yet-loaded tree does not hand DocsReadingPane a
// fresh {} each render, which would bust its memoized markdown `components`.
const EMPTY_SLUG_INDEX: Record<string, string> = {}

interface HighlightRegistry {
    set(name: string, highlight: object): void
    delete(name: string): void
}

/** The CSS Custom Highlight registry, when the runtime supports it. */
function highlightRegistry(): HighlightRegistry | null {
    return (CSS as unknown as { highlights?: HighlightRegistry }).highlights ?? null
}

function clearSearchHighlight(): void {
    const registry = highlightRegistry()
    registry?.delete(SEARCH_HIGHLIGHT)
    registry?.delete(SEARCH_HIGHLIGHT_CURRENT)
}

/**
 * Run `getTarget` across animation frames (content renders a frame or two after a
 * page load) until it returns an element, then hand it to `onFound`. Gives up after
 * `maxAttempts`. Shared by anchor and search-match scrolling.
 */
function scrollWhenReady(
    getTarget: () => HTMLElement | null,
    onFound: (element: HTMLElement) => void,
    maxAttempts = 12,
): void {
    let attempts = 0
    const tick = (): void => {
        const target = getTarget()
        if (target) onFound(target)
        else if (attempts++ < maxAttempts) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
}

/**
 * Find every occurrence of the query's terms within `root` and return one Range
 * per match (in document order). Does not touch the DOM. The caller decides how to
 * highlight and which match to scroll to.
 */
function collectMatchRanges(root: HTMLElement, query: string): Range[] {
    const terms = query.trim().split(/\s+/).filter(Boolean).map(escapeRegExp)
    if (terms.length === 0) return []
    // Match the node's own text (case-insensitive) so Range offsets always index
    // the real string. Lowercasing a copy can change its length (e.g. a Turkish
    // dotted capital I expands to 2 chars), which would misalign offsets and throw
    // on setEnd. matchAll clones the
    // regex, so reusing it across nodes is safe.
    const regex = new RegExp(terms.join('|'), 'gi')

    const ranges: Range[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
        const text = node.textContent ?? ''
        for (const match of text.matchAll(regex)) {
            const at = match.index ?? 0
            const range = document.createRange()
            range.setStart(node, at)
            range.setEnd(node, at + match[0].length)
            ranges.push(range)
        }
    }
    return ranges
}

/**
 * Paint the search highlights (via the CSS Custom Highlight API, which does not
 * mutate the React-owned DOM): the base highlight over all matches, plus the
 * "current" highlight over the one at `currentIndex`.
 */
function paintMatches(ranges: Range[], currentIndex: number): void {
    const registry = highlightRegistry()
    const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => object }).Highlight
    if (!registry || !HighlightCtor) return
    registry.set(SEARCH_HIGHLIGHT, new HighlightCtor(...ranges))
    const current = ranges[currentIndex]
    if (current) registry.set(SEARCH_HIGHLIGHT_CURRENT, new HighlightCtor(current))
}

/** The element to scroll into view for a given match range. */
function rangeElement(range: Range | undefined): HTMLElement | null {
    const node = range?.startContainer
    return node ? (node.parentElement ?? null) : null
}

export interface BreadcrumbItem {
    label: string
    /** Index page to open when clicked; absent for non-navigable crumbs (top category). */
    path?: string
}

/**
 * Ancestor crumbs (category > subdir > ...) for the active page, by walking the
 * tree along directory nodes whose path is a prefix of the active page path. A
 * crumb is clickable when its directory has an index page; the top-level category
 * is expand-only (like the site), so it stays plain text.
 */
function computeBreadcrumb(roots: DocsTreeNode[], activePath: string): BreadcrumbItem[] {
    const crumbs: BreadcrumbItem[] = []
    let level: DocsTreeNode[] | undefined = roots
    let depth = 0
    while (level) {
        const dir: DocsTreeNode | undefined = level.find(
            node => node.kind === 'directory' && (activePath === node.path || activePath.startsWith(node.path + '/')),
        )
        if (!dir) break
        crumbs.push({ label: dir.label, path: depth > 0 ? dir.indexPath : undefined })
        level = dir.children
        depth++
    }
    return crumbs
}

const LAYOUT_OPTIONS: { mode: DocsLayoutMode; label: string; icon: React.JSX.Element }[] = [
    {
        mode: 'auto',
        label: 'Auto (best fit per table)',
        icon: (
            <svg {...ICON_PROPS}>
                <path d="M6.5 2 l1.3 3.2 3.2 1.3 -3.2 1.3 -1.3 3.2 -1.3 -3.2 -3.2 -1.3 3.2 -1.3z" />
                <path d="M12.5 9 l.7 1.7 1.7 .7 -1.7 .7 -.7 1.7 -.7 -1.7 -1.7 -.7 1.7 -.7z" />
            </svg>
        ),
    },
    {
        mode: 'native',
        label: 'Native table',
        icon: (
            <svg {...ICON_PROPS}>
                <rect x="1.6" y="2.6" width="12.8" height="10.8" rx="1.2" />
                <line x1="1.6" y1="6.2" x2="14.4" y2="6.2" />
                <line x1="6" y1="2.6" x2="6" y2="13.4" />
                <line x1="10.3" y1="2.6" x2="10.3" y2="13.4" />
            </svg>
        ),
    },
    {
        mode: 'twopane',
        label: 'Two-pane',
        icon: (
            <svg {...ICON_PROPS}>
                <rect x="1.6" y="2.6" width="12.8" height="10.8" rx="1.2" />
                <line x1="6" y1="2.6" x2="6" y2="13.4" />
            </svg>
        ),
    },
    {
        mode: 'compact',
        label: 'Compact',
        icon: (
            <svg {...ICON_PROPS}>
                <line x1="2" y1="4" x2="14" y2="4" />
                <line x1="2" y1="6.7" x2="14" y2="6.7" />
                <line x1="2" y1="9.3" x2="14" y2="9.3" />
                <line x1="2" y1="12" x2="14" y2="12" />
            </svg>
        ),
    },
    {
        mode: 'cards',
        label: 'Cards',
        icon: (
            <svg {...ICON_PROPS}>
                <rect x="2" y="2.4" width="12" height="4.4" rx="1.2" />
                <rect x="2" y="9.2" width="12" height="4.4" rx="1.2" />
            </svg>
        ),
    },
]

// ---------------------------------------------------------------------------
// DocsView
// ---------------------------------------------------------------------------

export function DocsView(): React.JSX.Element {
    const { tree, treeError, loadingTree, loadPage, loadWhatsNew, searchDocs } = useDocsData()
    const { favorites, isFavorite, toggleFavorite, frequentlyViewed, recordView } = useDocsLibrary()
    const {
        scale: readingScale,
        increase: increaseReadingZoom,
        decrease: decreaseReadingZoom,
        reset: resetReadingZoom,
    } = useReadingZoom()

    const notes = useDocsNotes()
    const [notesOpen, setNotesOpen] = useState(false)

    const [lookupTerm, setLookupTerm] = useState<{ query: string; token: number } | null>(null)
    const lookupTokenRef = useRef(0)

    const [page, setPage] = useState<DocsPage | null>(null)
    const [status, setStatus] = useState<PageStatus>('idle')
    const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)
    const [activePath, setActivePath] = useState<string | null>(null)
    // The path the user attempted to open, set at the start of every load so error
    // and not-found states can link to the specific page rather than the docs home.
    const [requestedPath, setRequestedPath] = useState<string | null>(null)
    // When true, the reading area shows the "What's New" feed instead of a page.
    const [whatsNewOpen, setWhatsNewOpen] = useState(false)

    // Sidebar (the nav TOC) is resizable by dragging the divider and fully
    // collapsible via the toggle. Width is clamped to a usable range.
    const DEFAULT_SIDEBAR_WIDTH = 300
    const MIN_SIDEBAR_WIDTH = 180
    const MAX_SIDEBAR_WIDTH = 640
    const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

    // Field-table layout mode, remembered per page across sessions. Each page the
    // reader explicitly switches keeps its own choice; every other page defaults to
    // Auto. Changing one page's layout never affects another. Switching among the
    // transformed modes is a pure CSS class flip; only native re-runs the pipeline.
    const [layout, setLayout] = useState<DocsLayoutMode>('auto')
    const layoutByPathRef = useRef<Record<string, DocsLayoutMode>>({})

    /** The remembered layout for a page, or Auto when it has not been customized. */
    const layoutForPath = useCallback((path: string): DocsLayoutMode => {
        return layoutByPathRef.current[path] ?? 'auto'
    }, [])

    useEffect(() => {
        void window.rokdock.store.getPreferences().then((preferences: AppPreferences) => {
            if (preferences.docsLayoutByPath) layoutByPathRef.current = { ...preferences.docsLayoutByPath }
            // Apply the remembered layout to a page already open when preferences resolve.
            setActivePath(current => {
                if (current) setLayout(layoutForPath(current))
                return current
            })
        })
    }, [layoutForPath])

    const changeLayout = useCallback((mode: DocsLayoutMode): void => {
        setLayout(mode)
        if (activePath) layoutByPathRef.current[activePath] = mode
        void window.rokdock.store.setPreferences({
            docsLayoutByPath: { ...layoutByPathRef.current },
        })
    }, [activePath])

    const startResize = useCallback(
        (e: React.MouseEvent): void => {
            e.preventDefault()
            const startX = e.clientX
            const startWidth = sidebarWidth
            const onMove = (ev: MouseEvent): void => {
                const next = Math.min(
                    MAX_SIDEBAR_WIDTH,
                    Math.max(MIN_SIDEBAR_WIDTH, startWidth + (ev.clientX - startX)),
                )
                setSidebarWidth(next)
            }
            const onUp = (): void => {
                document.removeEventListener('mousemove', onMove)
                document.removeEventListener('mouseup', onUp)
                document.body.style.userSelect = ''
            }
            document.body.style.userSelect = 'none'
            document.addEventListener('mousemove', onMove)
            document.addEventListener('mouseup', onUp)
        },
        [sidebarWidth],
    )

    // Ref to the reading pane body so anchor scrolling can target elements within it.
    const readingPaneRef = useRef<HTMLDivElement>(null)

    // Sequence counter for navigation requests. Incremented on each load so a slow
    // earlier fetch cannot overwrite a more recent navigation result.
    const navSeqRef = useRef(0)

    // Back/forward history: a stack of visited locations (a page, or the What's New
    // view) and a cursor. A new navigation truncates anything ahead of the cursor
    // and appends; back/forward just move the cursor and re-show without recording.
    // Kept in a ref (so the load callbacks never go stale) with a version counter to
    // refresh button state.
    const historyRef = useRef<{ entries: NavEntry[]; index: number }>({
        entries: [],
        index: -1,
    })
    // Bumped on every history mutation purely to trigger a re-render (the cursor
    // itself lives in historyRef); the value is never read.
    const [, setHistoryVersion] = useState(0)

    // Append a location, dropping any forward history (a fresh navigation branch).
    const pushHistory = useCallback((entry: NavEntry): void => {
        const history = historyRef.current
        const entries = history.entries.slice(0, history.index + 1)
        entries.push(entry)
        historyRef.current = { entries, index: entries.length - 1 }
        setHistoryVersion(version => version + 1)
    }, [])

    // Term to scroll to / highlight after the next page load (set when opening a
    // search result). Consumed once, so back/forward do not re-trigger it.
    const pendingFindRef = useRef<string | null>(null)

    // On-page find state for an opened search result: the match ranges (kept in a
    // ref, since Range objects do not belong in React state) and a small bar that
    // shows the position and cycles between hits. Null when no find is active.
    const matchRangesRef = useRef<Range[]>([])
    // The active match index (the total is matchRangesRef.current.length). Null when
    // no find is active.
    const [findIndex, setFindIndex] = useState<number | null>(null)

    const closeFind = useCallback((): void => {
        clearSearchHighlight()
        matchRangesRef.current = []
        setFindIndex(null)
    }, [])

    // Park on a match (wrapping around the ends), repaint, and scroll it into view.
    const goToMatch = useCallback((index: number): void => {
        const ranges = matchRangesRef.current
        if (ranges.length === 0) return
        const next = ((index % ranges.length) + ranges.length) % ranges.length
        paintMatches(ranges, next)
        rangeElement(ranges[next])?.scrollIntoView({ behavior: 'auto', block: 'center' })
        setFindIndex(next)
    }, [])

    // Low-level: fetch and render a page, applying its remembered layout. Does not
    // touch history (callers decide whether the move is recorded).
    const loadAndShow = useCallback(
        async (path: string, anchor?: string, countView = false): Promise<void> => {
            const seq = ++navSeqRef.current
            // Record the attempted path immediately so error/not-found states can open
            // the specific page on developer.roku.com rather than just the docs home.
            setRequestedPath(path)
            clearSearchHighlight()
            matchRangesRef.current = []
            setFindIndex(null)
            setWhatsNewOpen(false)
            setStatus('loading')
            setErrorMessage(undefined)
            setLayout(layoutForPath(path))

            const result = await loadPage(path)

            if (seq !== navSeqRef.current) return

            if (result.error !== undefined) {
                setStatus('error')
                setErrorMessage(result.error)
                return
            }

            if (!result.page) {
                setStatus('not-found')
                return
            }

            setPage(result.page)
            setActivePath(path)
            setStatus('loaded')
            // Only intentional navigations count toward Frequently Viewed, not
            // back/forward history replay (which reaches loadAndShow via showEntry).
            if (countView) recordView({ path, title: result.page.title })

            const findTerm = pendingFindRef.current
            pendingFindRef.current = null
            if (anchor) {
                scrollWhenReady(
                    () => readingPaneRef.current?.querySelector<HTMLElement>(`#${CSS.escape(anchor)}`) ?? null,
                    element => element.scrollIntoView({ behavior: 'auto', block: 'start' }),
                )
            } else if (findTerm) {
                scrollWhenReady(
                    () => {
                        const prose = readingPaneRef.current?.querySelector<HTMLElement>('.docs-prose')
                        if (!prose) return null
                        const ranges = collectMatchRanges(prose, findTerm)
                        if (ranges.length === 0) return null
                        matchRangesRef.current = ranges
                        paintMatches(ranges, 0)
                        setFindIndex(0)
                        return rangeElement(ranges[0])
                    },
                    element => element.scrollIntoView({ behavior: 'auto', block: 'center' }),
                )
            }
        },
        [loadPage, layoutForPath, recordView]
    )

    // Show a history location without recording it (used by back/forward).
    const showEntry = useCallback((entry: NavEntry): void => {
        if (entry.kind === 'whatsnew') {
            closeFind() // leaving the page: drop its on-page find state and highlights
            setWhatsNewOpen(true)
        } else {
            void loadAndShow(entry.path, entry.anchor)
        }
    }, [loadAndShow, closeFind])

    // User-initiated navigation (tree, links, favorites, breadcrumb): record it,
    // truncating any forward history first.
    const navigate = useCallback(
        (path: string, anchor?: string): void => {
            pushHistory({ kind: 'page', path, anchor })
            void loadAndShow(path, anchor, true)
        },
        [loadAndShow, pushHistory]
    )

    // Open a search result and scroll to / highlight the matched text on the page.
    const openSearchResult = useCallback(
        (path: string, query: string): void => {
            pendingFindRef.current = query
            navigate(path)
        },
        [navigate]
    )

    const goBack = useCallback((): void => {
        const history = historyRef.current
        if (history.index <= 0) return
        history.index -= 1
        setHistoryVersion(version => version + 1)
        showEntry(history.entries[history.index])
    }, [showEntry])

    const goForward = useCallback((): void => {
        const history = historyRef.current
        if (history.index >= history.entries.length - 1) return
        history.index += 1
        setHistoryVersion(version => version + 1)
        showEntry(history.entries[history.index])
    }, [showEntry])

    const onOpenPage = useCallback(
        (node: { path: string; label?: string }): void => {
            navigate(node.path)
        },
        [navigate]
    )

    const onOpenEntry = useCallback(
        (entry: { path: string; title: string }): void => {
            navigate(entry.path)
        },
        [navigate]
    )

    const onNavigateInternal = useCallback(
        (path: string, anchor?: string): void => {
            navigate(path, anchor)
        },
        [navigate]
    )

    const onToggleFavorite = useCallback((): void => {
        if (!page) return
        toggleFavorite({ path: page.path, title: page.title })
    }, [page, toggleFavorite])

    const openWhatsNew = useCallback((): void => {
        // Record What's New as a history location, unless it is already current.
        const history = historyRef.current
        const current = history.entries[history.index]
        if (!current || current.kind !== 'whatsnew') pushHistory({ kind: 'whatsnew' })
        closeFind() // leaving the page: drop its on-page find state and highlights
        setWhatsNewOpen(true)
    }, [pushHistory, closeFind])

    const slugIndex = tree?.slugIndex ?? EMPTY_SLUG_INDEX
    const roots = useMemo(() => tree?.roots ?? [], [tree])

    const [quickOpenVisible, setQuickOpenVisible] = useState(false)
    const quickOpenPages = useMemo(() => (tree ? flattenPages(tree.roots) : []), [tree])

    const isFav = activePath !== null && isFavorite(activePath)
    const breadcrumb = useMemo(
        () => (activePath ? computeBreadcrumb(roots, activePath) : []),
        [roots, activePath],
    )

    // Read fresh from the ref each render (setHistoryVersion forces the re-render).
    const canGoBack = historyRef.current.index > 0
    const canGoForward = historyRef.current.index < historyRef.current.entries.length - 1

    // Alt+Left / Alt+Right and the mouse back/forward buttons navigate history.
    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            if (e.altKey && e.key === 'ArrowLeft') {
                e.preventDefault()
                goBack()
            } else if (e.altKey && e.key === 'ArrowRight') {
                e.preventDefault()
                goForward()
            }
        }
        const onMouse = (e: MouseEvent): void => {
            if (e.button === 3) {
                e.preventDefault()
                goBack()
            } else if (e.button === 4) {
                e.preventDefault()
                goForward()
            }
        }
        window.addEventListener('keydown', onKey)
        window.addEventListener('mouseup', onMouse)
        return () => {
            window.removeEventListener('keydown', onKey)
            window.removeEventListener('mouseup', onMouse)
        }
    }, [goBack, goForward])

    // F3 / Shift+F3 cycle the on-page search matches and Escape clears them, while a
    // find is active. Typing in the sidebar search box keeps its own keys (Escape
    // there clears the query), so the find shortcuts ignore events from inputs.
    useEffect(() => {
        if (findIndex === null) return
        const onKey = (e: KeyboardEvent): void => {
            const target = e.target as HTMLElement | null
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
            if (e.key === 'F3') {
                e.preventDefault()
                goToMatch(findIndex + (e.shiftKey ? -1 : 1))
            } else if (e.key === 'Escape') {
                e.preventDefault()
                closeFind()
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [findIndex, goToMatch, closeFind])

    // Ctrl/Cmd+K toggles the quick-open palette. Escape-to-close is owned by the
    // palette itself (its input holds focus while open), so this registers once.
    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey) return
            if (e.key === 'k') {
                e.preventDefault()
                setQuickOpenVisible(open => !open)
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    // Ctrl/Cmd +/-/0 zoom the reading content only (the prose), independent of
    // the window UI scale. The docs window's View menu intentionally drops the
    // webFrame zoom roles so these keys reach the renderer.
    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey) return
            const target = e.target as HTMLElement | null
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
            if (e.key === '=' || e.key === '+') {
                e.preventDefault()
                increaseReadingZoom()
            } else if (e.key === '-' || e.key === '_') {
                e.preventDefault()
                decreaseReadingZoom()
            } else if (e.key === '0') {
                e.preventDefault()
                resetReadingZoom()
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [increaseReadingZoom, decreaseReadingZoom, resetReadingZoom])

    // Auto-open the notes panel when arriving at a page that already has a note.
    // hasNote has a stable identity (it reads a ref), so this runs on navigation,
    // not on every keystroke. notesLoaded re-runs it once when the persisted notes
    // finish loading, in case a page was opened before the load resolved.
    const notesHasNote = notes.hasNote
    const notesLoaded = notes.loaded
    useEffect(() => {
        setNotesOpen(activePath ? notesHasNote(activePath) : false)
    }, [activePath, notesHasNote, notesLoaded])

    // Drain the pending lookup term from main: once on boot (for a term set
    // before this window opened) and again on each docs:lookup-query nudge (so an
    // already-open window picks up new terms). Both read the same buffer, so a
    // nudge that races the boot pull still resolves to a single delivery.
    useEffect(() => {
        const drain = (): void => {
            void window.rokdock.docs.getPendingLookup().then((query: string | null) => {
                if (query) setLookupTerm({ query, token: ++lookupTokenRef.current })
            })
        }
        drain()
        return window.rokdock.docs.onLookupQuery(drain)
    }, [])

    // Expand the sidebar whenever a lookup arrives so the search box is visible.
    // Keyed only on the lookup, so a later manual collapse is not undone.
    useEffect(() => {
        if (lookupTerm) setSidebarCollapsed(false)
    }, [lookupTerm])

    // Sidebar content: show a tree-error banner or a subtle loading indicator
    // in place of the tree while it resolves.
    function renderSidebarContent(): React.JSX.Element {
        if (treeError) {
            return (
                <div
                    style={{
                        padding: '12px 16px',
                        color: 'var(--rokdock-text-muted)',
                        fontSize: 'var(--rokdock-font-sm)',
                    }}
                >
                    Failed to load docs tree: {treeError}
                </div>
            )
        }

        if (loadingTree) {
            return (
                <div
                    style={{
                        padding: '12px 16px',
                        color: 'var(--rokdock-text-dim)',
                        fontSize: 'var(--rokdock-font-sm)',
                        fontStyle: 'italic',
                    }}
                >
                    Loading...
                </div>
            )
        }

        return (
            <DocsSidebar
                roots={roots}
                activePath={activePath}
                favorites={favorites}
                frequentlyViewed={frequentlyViewed}
                onOpenPage={onOpenPage}
                onOpenEntry={onOpenEntry}
                onOpenWhatsNew={openWhatsNew}
                whatsNewActive={whatsNewOpen}
                searchDocs={searchDocs}
                onOpenSearchResult={openSearchResult}
                lookup={lookupTerm}
                notedPaths={notes.notedPaths}
            />
        )
    }

    const toolbarLeft = (
        <>
            <button
                type="button"
                className="tb-btn"
                onClick={() => setSidebarCollapsed(collapsed => !collapsed)}
                title={sidebarCollapsed ? 'Show navigation' : 'Hide navigation'}
                aria-label={sidebarCollapsed ? 'Show navigation' : 'Hide navigation'}
                aria-pressed={!sidebarCollapsed}
            >
                <DoubleChevronIcon direction={sidebarCollapsed ? 'right' : 'left'} />
            </button>
            <span className="toolbar-sep" aria-hidden="true" />
            <button
                type="button"
                className="tb-btn"
                onClick={goBack}
                disabled={!canGoBack}
                title="Back (Alt+Left)"
                aria-label="Back"
            >
                <BackArrowIcon />
            </button>
            <button
                type="button"
                className="tb-btn"
                onClick={goForward}
                disabled={!canGoForward}
                title="Forward (Alt+Right)"
                aria-label="Forward"
            >
                <ForwardArrowIcon />
            </button>
        </>
    )

    const toolbarRight = (
        <>
            {activePath !== null && !whatsNewOpen && (
                <>
                    <button
                        type="button"
                        className={`tb-btn${isFav ? ' on' : ''}`}
                        onClick={onToggleFavorite}
                        title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                        aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
                        aria-pressed={isFav}
                    >
                        <StarIcon filled={isFav} />
                    </button>
                    <button
                        type="button"
                        className={`tb-btn docs-note-toggle${notesOpen ? ' on' : ''}`}
                        onClick={() => setNotesOpen(open => !open)}
                        title="Notes"
                        aria-label="Notes"
                        aria-pressed={notesOpen}
                    >
                        <NoteIcon />
                        {activePath && notes.hasNote(activePath) && (
                            <span className="tb-btn-dot" aria-hidden="true" />
                        )}
                    </button>
                    <button
                        type="button"
                        className="tb-btn"
                        onClick={() => void window.rokdock.external.openUrl(rokuDocUrl(requestedPath ?? activePath))}
                        title="View on developer.roku.com"
                        aria-label="View on developer.roku.com"
                    >
                        <ExternalLinkIcon />
                    </button>
                    <span className="toolbar-sep" aria-hidden="true" />
                    {LAYOUT_OPTIONS.map(opt => (
                        <button
                            key={opt.mode}
                            type="button"
                            className={`tb-btn${layout === opt.mode ? ' on' : ''}`}
                            onClick={() => changeLayout(opt.mode)}
                            title={opt.label}
                            aria-label={opt.label}
                            aria-pressed={layout === opt.mode}
                        >
                            {opt.icon}
                        </button>
                    ))}
                    <span className="toolbar-sep" aria-hidden="true" />
                </>
            )}
            {React.createElement('rokdock-settings-gear', { title: 'Appearance settings' })}
        </>
    )

    return (
        <div className="docs-root">
            <QuickOpen
                pages={quickOpenPages}
                isOpen={quickOpenVisible}
                onClose={() => setQuickOpenVisible(false)}
                onOpen={(path) => {
                    onNavigateInternal(path)
                }}
            />
            <RokdockToolbar left={toolbarLeft} right={toolbarRight}>
                {findIndex !== null && !whatsNewOpen && (
                    <div className="docs-find-bar" role="group" aria-label="Matches on page">
                        <span className="docs-find-count">{findIndex + 1} / {matchRangesRef.current.length}</span>
                        <button
                            type="button"
                            className="tb-btn"
                            onClick={() => goToMatch(findIndex - 1)}
                            title="Previous match (Shift+F3)"
                            aria-label="Previous match"
                        >
                            <FontAwesomeIcon icon={faChevronLeft} />
                        </button>
                        <button
                            type="button"
                            className="tb-btn"
                            onClick={() => goToMatch(findIndex + 1)}
                            title="Next match (F3)"
                            aria-label="Next match"
                        >
                            <FontAwesomeIcon icon={faChevronRight} />
                        </button>
                        <button
                            type="button"
                            className="tb-btn"
                            onClick={closeFind}
                            title="Clear highlight (Esc)"
                            aria-label="Clear highlight"
                        >
                            <FontAwesomeIcon icon={faXmark} />
                        </button>
                    </div>
                )}
            </RokdockToolbar>
            <div className="docs-layout">
                {!sidebarCollapsed && (
                    <div className="docs-layout-sidebar" style={{ width: sidebarWidth }}>
                        {renderSidebarContent()}
                    </div>
                )}
                {!sidebarCollapsed && (
                    <div
                        className="docs-resizer"
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize navigation"
                        title="Drag to resize (double-click to reset)"
                        onMouseDown={startResize}
                        onDoubleClick={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
                    />
                )}
                <div
                    className="docs-layout-reading"
                    ref={readingPaneRef}
                    style={{ '--docs-reading-scale': String(readingScale) } as React.CSSProperties}
                >
                    {whatsNewOpen ? (
                        <DocsWhatsNew
                            loadWhatsNew={loadWhatsNew}
                            onOpenPage={onNavigateInternal}
                        />
                    ) : (
                        <DocsReadingPane
                            page={page}
                            status={status}
                            errorMessage={errorMessage}
                            slugIndex={slugIndex}
                            breadcrumb={breadcrumb}
                            onNavigateInternal={onNavigateInternal}
                            layout={layout}
                            requestedPath={requestedPath ?? undefined}
                        />
                    )}
                    {notesOpen && activePath !== null && !whatsNewOpen && (
                        <DocsNote
                            value={notes.getNote(activePath)}
                            onChange={text => notes.setNote(activePath, text)}
                            onClose={() => setNotesOpen(false)}
                        />
                    )}
                </div>
            </div>
        </div>
    )
}
