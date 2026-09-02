/**
 * Virtualized terminal renderer with syntax highlighting, URL overlays, and
 * inline JSON expansion.
 *
 * Each line is a TerminalLineChunk array (token spans + optional overlay spans)
 * produced by the main-process tokenizer. Lines are rendered in a virtualized
 * list: only visible rows (plus a small overscan) are in the DOM, with spacer
 * divs for the hidden regions. This keeps rendering fast even with the full
 * TERMINAL_MAX_BUFFER_LINES buffer loaded.
 *
 * Key capabilities:
 *  - Syntax highlighting: RenderSegments are colored using the active
 *    TerminalSyntaxTheme (mapped from the user's chosen theme preset).
 *  - URL overlays: spans with an 'url' overlay kind render as clickable links.
 *  - JSON expansion: lines detected as JSON objects/arrays show a toggle caret.
 *    Click expands the line into pretty-printed indented JSON with highlighting.
 *    findMatchingBracket() handles nested structures during expansion.
 *  - Search: Ctrl+F opens an inline search bar. Matches are highlighted across
 *    all buffered lines; Ctrl+G / F3 cycles through matches and the list scrolls
 *    to keep the active match visible.
 *  - Copy: Ctrl+C copies selected text; toolbar copy button copies the full buffer.
 *  - Clear: resets the line buffer and clears the per-tab cache entry.
 *  - Auto-scroll: sticks to the bottom as new lines arrive; pauses if the user
 *    scrolls up and resumes when they scroll back to the bottom.
 *  - Word-wrap: toggled per-tab, causes lines to wrap rather than scroll horizontally.
 *
 * The clearTerminalCache() export is called by TerminalPane when a tab closes
 * so the buffer map does not leak memory.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCaretDown, faCaretUp, faCheck, faChevronRight, faClockRotateLeft, faCopy, faXmark } from '@fortawesome/free-solid-svg-icons'
import type { CSSProperties } from 'react'
import { useAppStore, type TabInfo } from '../store/appStore'
import { resolveThemeMode } from '../styles/theme'
import {
    TERMINAL_MAX_BUFFER_LINES,
    type TerminalLineChunk,
    type TerminalOverlaySpan,
    type TerminalTokenSpan
} from '../../shared/terminal'
import { resolveSyntaxTheme, type TerminalSyntaxTheme } from '../styles/terminalSyntaxThemes'
import { escapeRegExp } from '@shared/escapeRegExp'
import { createRegexMatchClient } from './terminal/regexMatchClient'
import type { RegexMatchClient } from './terminal/regexMatchClient'
import { resolveTerminalCopyText } from './terminal/terminalCopy'
import { computeAppRunBoundaries, buildRunBoundaryGradient } from './terminal/terminalLaunchBanner'
import { linesForCopy, resolveBufferLineIndex, toFilteredPosition } from './terminal/terminalLineFilterView'
import { compileLineFilter } from '@shared/lineFilter'
import { selectionQualifiesForLookup, qualifyingLookupTerm } from './terminalDocsLookup'
import { wrapInCodeFence } from '../codeFence'
import TerminalSelectionToolbar from './terminalSelectionToolbar'
import ConfirmDialog from './common/confirmDialog'
import RegexFilterDialog from './terminal/regexFilterDialog'
import {
    buildSegments,
    groupSegmentsForLine,
    jsonColorRuns,
    jsonGroupInteractionId,
    JSON_DETECT_MAX_LINES,
    JSON_DETECT_MAX_LINES_WRAPPED,
    mergeTerminalLineWithJsonCache,
    overlayKey,
    detectJsonOverlaysForLine,
    tokenizerCoversTrimmedLineAsSingleJson,
    type LineSegmentGroup,
    type RenderSegment
} from './terminal/overlayCompiler'

/**
 * Buffer line index for a DOM node, read from the nearest ancestor row's data-line-index.
 * Returns null when the node is outside a rendered row (e.g. a spacer or a detached node
 * whose row was unmounted by virtualization). closest() still resolves against a detached
 * row, so a drag anchor recorded while its row was mounted survives the row unmounting.
 */
function lineIndexFromNode(node: Node | null): number | null {
    if (!node) return null
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
    const raw = element?.closest('[data-line-index]')?.getAttribute('data-line-index')
    const index = raw != null ? Number(raw) : NaN
    return Number.isInteger(index) ? index : null
}

type SearchMatch = {
    lineIndex: number
    start: number
    end: number
}

type SearchState = {
    matches: SearchMatch[]
    regexError: string | null
}

const MAX_LINES = TERMINAL_MAX_BUFFER_LINES
/** Cap lines merged per React update - smaller batches = shorter frames during chatty streams. */
const MAX_CHUNKS_PER_FLUSH = 72
/** Stable empty arrays for zustand selectors - inactive tabs avoid subscribing to the global histories. */
const STABLE_EMPTY_COMMAND_HISTORY: string[] = []
const STABLE_EMPTY_FILTER_HISTORY: string[] = []
// Search highlight colors are sourced from theme.colors.searchHighlight* tokens at the usage sites.
const VIRTUAL_LINE_HEIGHT = 18
// Matches styles.viewport's horizontal padding: a row that needs to paint edge-to-edge
// (app-run banding) bleeds past it with a negative margin, compensated by equal padding so
// the line's own text stays put.
const VIEWPORT_HORIZONTAL_PADDING = 10
// App-run boundary divider (see buildRunBoundaryGradient): thickness of the accent line, and
// the CSS var references its gradient stops are built from.
const RUN_DIVIDER_THICKNESS_PX = 2
const RUN_TINT_CSS_VAR = 'var(--rokdock-terminal-launch-banner-bg)'
const RUN_ACCENT_CSS_VAR = 'var(--rokdock-terminal-launch-banner-accent)'
// Selection toolbar hover hysteresis: a discrete mousemove sample can land in the small
// gap between the selection and the toolbar (fast movement does not sample every pixel),
// which would otherwise hide the toolbar before the very next sample reaches it. Delaying
// both the show and the hide lets a momentary excursion (through the gap, or a transient
// hover before intent is clear) get overridden by the next contradicting sample instead
// of taking effect immediately.
const TOOLBAR_SHOW_DELAY_MS = 80
const TOOLBAR_HIDE_DELAY_MS = 200
const VIRTUAL_OVERSCAN_LINES = 80
const WRAP_AUTOSCROLL_RENDER_WINDOW_LINES = 700

/** Preserves terminal lines across component unmount/remount (e.g. when a tab is split to another pane). */
const terminalLinesCache = new Map<string, TerminalLineChunk[]>()

/**
 * Remove the cached line buffer for a closed tab so it does not leak memory.
 * Called by TerminalPane when a tab is destroyed.
 */
export function clearTerminalCache(tabId: string): void {
    terminalLinesCache.delete(tabId)
}

/** Read a tab's cached line buffer (write-through). Used by the terminal-output responder. */
export function readTerminalCache(tabId: string): TerminalLineChunk[] | undefined {
    return terminalLinesCache.get(tabId)
}



/**
 * Walk up the DOM from a mouseleave relatedTarget to find the nearest element
 * carrying a data-json-ig attribute. Returns its value, or null if the pointer
 * has moved outside all JSON interaction groups.
 */
function readJsonInteractionIdFromRelatedTarget(rel: EventTarget | null): string | null {
    if (rel == null || typeof (rel as Node).nodeType !== 'number') return null
    const node = rel as Node
    const rootEl =
        node.nodeType === Node.ELEMENT_NODE ? (node as Element) : (node as ChildNode).parentElement
    if (!rootEl) return null
    return rootEl.closest('[data-json-ig]')?.getAttribute('data-json-ig') ?? null
}

const JSON_LINK_ACTIVE_CLASS = 'rokdock-terminal-json-link-active'

/** Remove the hover-active CSS class from every JSON link element inside `root`. */
function clearJsonLinkActiveInRoot(root: HTMLElement | null): void {
    if (!root) return
    root.querySelectorAll(`.${JSON_LINK_ACTIVE_CLASS}`).forEach((element) => {
        element.classList.remove(JSON_LINK_ACTIVE_CLASS)
    })
}

/**
 * Add the hover-active CSS class to every element in `root` that shares the
 * given interaction-group id (data-json-ig attribute). Clears any previously
 * active group first so only one group is highlighted at a time.
 */
function setJsonLinkActiveGroupInRoot(root: HTMLElement | null, ig: string): void {
    if (!root) return
    clearJsonLinkActiveInRoot(root)
    const selector = `[data-json-ig="${CSS.escape(ig)}"]`
    root.querySelectorAll(selector).forEach((element) => {
        element.classList.add(JSON_LINK_ACTIVE_CLASS)
    })
}

/**
 * Remove the hover-active CSS class from every element in `root` that belongs
 * to the given interaction-group id. Called on mouseleave when the pointer moves
 * to an element outside the group.
 */
function clearJsonLinkActiveGroupInRoot(root: HTMLElement | null, ig: string): void {
    if (!root) return
    const selector = `[data-json-ig="${CSS.escape(ig)}"]`
    root.querySelectorAll(selector).forEach((element) => {
        element.classList.remove(JSON_LINK_ACTIVE_CLASS)
    })
}

/** Return true when two half-open character ranges [startA, endA) and [startB, endB) overlap. */
function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
    return startA < endB && startB < endA
}

/**
 * Build a map from line id to its index within the first `count` entries of `lines`
 * (defaults to the whole array). Lines with a null id are skipped. Used by the
 * incremental JSON-fallback merge to locate dirty lines by id.
 */
function buildIdToIndexMap(lines: TerminalLineChunk[], count: number = lines.length): Map<number, number> {
    const idToIndex = new Map<number, number>()
    for (let i = 0; i < count; i++) {
        const id = lines[i]!.id
        if (id != null) idToIndex.set(id, i)
    }
    return idToIndex
}

/**
 * While `open`, close the flyout as soon as a mousedown lands outside `rootRef`. Capture phase,
 * so the dismissal happens before the click reaches whatever was pressed. Used by both history
 * flyouts (the command input's and the filter bar's).
 */
function useDismissOnOutsideMouseDown(
    open: boolean,
    rootRef: React.RefObject<HTMLElement | null>,
    setOpen: (open: boolean) => void
): void {
    useEffect(() => {
        if (!open) return
        const onPointerDown = (event: MouseEvent) => {
            const root = rootRef.current
            const target = event.target as Node | null
            if (!root || !target || root.contains(target)) return
            setOpen(false)
        }
        window.addEventListener('mousedown', onPointerDown, true)
        return () => window.removeEventListener('mousedown', onPointerDown, true)
    }, [open, rootRef, setOpen])
}

type HistoryWalkStep = {
    /** The new cursor, or null once the walk lands back on the in-progress draft. */
    index: number | null
    /** The text to put in the input. */
    text: string
    /** Present only on the first step away from the in-progress text, which must be stashed. */
    draft?: string
}

/**
 * One Up/Down step through a history list, shared by the command input and the filter input
 * (their arrow-key handling is otherwise identical). 'older' walks toward the start of the
 * list, stashing the in-progress text as the draft on the first step. 'newer' walks back
 * toward the end and restores that draft once it passes the newest entry. Returns null when
 * the key should be left alone: an empty history, or a 'newer' step with no walk in progress.
 */
function walkInputHistory(options: {
    entries: string[]
    index: number | null
    direction: 'older' | 'newer'
    currentText: string
    draft: string
}): HistoryWalkStep | null {
    const { entries, index, direction, currentText, draft } = options
    if (direction === 'older') {
        if (entries.length === 0) return null
        if (index === null) {
            const newest = entries.length - 1
            return { index: newest, text: entries[newest]!, draft: currentText }
        }
        const older = Math.max(0, index - 1)
        return { index: older, text: entries[older]! }
    }
    if (index === null) return null
    if (index >= entries.length - 1) return { index: null, text: draft }
    const newer = index + 1
    return { index: newer, text: entries[newer]! }
}

/**
 * Build a timestamped log filename for a device tab (rokdock-[label-]<ip>-<port>-<ts>.log).
 * `label` inserts an optional segment (e.g. 'stream') after the rokdock- prefix.
 */
function buildLogFilename(deviceIp: string, port: number, label?: string): string {
    const ip = deviceIp.replace(/\./g, '-')
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    return `rokdock-${label ? label + '-' : ''}${ip}-${port}-${ts}.log`
}

type HighlightSegmentTextFn = (
    lineIndex: number,
    segmentStart: number,
    text: string,
    color: string,
    keyPrefix: string
) => React.ReactNode

type TerminalOutputLineProps = {
    line: TerminalLineChunk
    lineIndex: number
    groups: LineSegmentGroup[]
    isMatchedLine: boolean
    isActiveMatchLine: boolean
    /** True for a Compiling/Running marker line that actually starts a new block (see computeAppRunBoundaries). */
    isAppRunStart: boolean
    /**
     * Pre-built CSS gradient for the line immediately before a run-start marker, or null for
     * every other line. Unifies the divider and the run-tint color change into one gradient so
     * they land on the exact same pixel (see buildRunBoundaryGradient) instead of the tint
     * flipping at the row boundary while the divider floats elsewhere within this row.
     */
    dividerGradient: string | null
    /**
     * True when this line should paint the run tint: it belongs to an odd-numbered block (see
     * computeAppRunBoundaries) AND the user has app-run banding enabled. The setting is
     * folded in by the caller, which needs it for the gradient's colors anyway.
     */
    showAppRunOverlay: boolean
    styles: Record<string, React.CSSProperties>
    outputRef: React.RefObject<HTMLDivElement | null>
    tokenColor: (kind: TerminalTokenSpan['kind']) => string
    syntaxTheme: TerminalSyntaxTheme
    highlightSegmentText: HighlightSegmentTextFn
    colorStyleFor: (color: string) => React.CSSProperties
    openJsonViewer: (jsonValue: string) => void
    requestOpenExternalUrl: (url: string | null) => void
}

/**
 * Memoized renderer for a single terminal output line. Accepts pre-computed
 * LineSegmentGroups so it never rebuilds segments on re-render. Renders JSON
 * overlay groups as clickable spans (opens the JSON viewer on click), URL overlays
 * as anchor tags (intercepted to show the external-link confirmation dialog), and
 * plain text segments as colored spans. Search highlights are injected via the
 * highlightSegmentText callback.
 *
 * The custom equality check ensures the component only re-renders when props that
 * actually affect output change, ignoring parent-level re-renders triggered by
 * unrelated state.
 */
const TerminalOutputLine = React.memo(function TerminalOutputLine({
    line,
    lineIndex,
    groups,
    isMatchedLine,
    isActiveMatchLine,
    isAppRunStart,
    dividerGradient,
    showAppRunOverlay,
    styles,
    outputRef,
    tokenColor,
    syntaxTheme,
    highlightSegmentText,
    colorStyleFor,
    openJsonViewer,
    requestOpenExternalUrl
}: TerminalOutputLineProps) {
    // A boundary row's gradient already contains this run's tint, so the flat overlay would
    // only paint over it.
    let appRunStyle: React.CSSProperties = {}
    if (dividerGradient != null) appRunStyle = { ...styles.lineAppRunBoundaryBleed, backgroundImage: dividerGradient }
    else if (showAppRunOverlay) appRunStyle = styles.lineAppRunOverlay
    return (
        <div
            data-line
            data-line-index={lineIndex}
            data-app-run-start={isAppRunStart || undefined}
            data-app-run-overlay={showAppRunOverlay || undefined}
            style={{
                ...styles.line,
                ...appRunStyle,
                ...(isMatchedLine ? styles.lineSearchMatch : {}),
                ...(isActiveMatchLine ? styles.lineSearchActive : {})
            }}
        >
            {groups.map((group, groupIndex) => {
                if (group.kind === 'json-group') {
                    const { overlay, groupKey, items } = group
                    const jsonIg = jsonGroupInteractionId(groupKey)
                    return (
                        <span
                            key={`${lineIndex}:jg:${groupKey}:${groupIndex}`}
                            className="rokdock-terminal-json-link"
                            data-json-ig={jsonIg}
                            title={`Click to view JSON (${overlay.value.length.toLocaleString()} chars)`}
                            onMouseEnter={() => setJsonLinkActiveGroupInRoot(outputRef.current, jsonIg)}
                            onMouseLeave={(e) => {
                                const nextIg = readJsonInteractionIdFromRelatedTarget(e.relatedTarget)
                                if (nextIg === jsonIg) return
                                clearJsonLinkActiveGroupInRoot(outputRef.current, jsonIg)
                            }}
                            onClick={() => {
                                if (!overlay.value) return
                                openJsonViewer(overlay.value)
                            }}
                        >
                            {items.map(({ segment, thisStart, segIndex }) => {
                                const color = tokenColor(segment.kind)
                                if (segment.overlay?.kind !== 'json') {
                                    return (
                                        <React.Fragment key={`${groupKey}:${segIndex}`}>
                                            {highlightSegmentText(
                                                lineIndex,
                                                thisStart,
                                                segment.text,
                                                color,
                                                `${groupKey}:${segIndex}:bridge`
                                            )}
                                        </React.Fragment>
                                    )
                                }
                                let runStart = thisStart
                                return (
                                    <React.Fragment key={`${groupKey}:${segIndex}`}>
                                        {jsonColorRuns(segment.text, syntaxTheme, color).map((run, runIndex) => {
                                            const node = highlightSegmentText(
                                                lineIndex,
                                                runStart,
                                                run.text,
                                                run.color,
                                                `${groupKey}:${segIndex}:json:${runIndex}`
                                            )
                                            runStart += run.text.length
                                            return (
                                                <React.Fragment key={`${groupKey}:${segIndex}:jr:${runIndex}`}>
                                                    {node}
                                                </React.Fragment>
                                            )
                                        })}
                                    </React.Fragment>
                                )
                            })}
                        </span>
                    )
                }

                if (group.kind === 'url') {
                    const id = overlayKey(lineIndex, group.overlay)
                    return (
                        <a
                            key={id}
                            className="rokdock-terminal-url-link"
                            href={group.overlay.value}
                            title={`Explore URL: ${group.overlay.value}`}
                            onClick={(event) => {
                                event.preventDefault()
                                requestOpenExternalUrl(group.overlay.value)
                            }}
                        >
                            {group.items.map(({ segment, thisStart, segIndex }) => {
                                const color = tokenColor(segment.kind)
                                return (
                                    <span key={segIndex} style={colorStyleFor(color)}>
                                        {highlightSegmentText(lineIndex, thisStart, segment.text, color, `${id}:${segIndex}:url`)}
                                    </span>
                                )
                            })}
                        </a>
                    )
                }

                const { segment, thisStart, segIndex } = group
                const color = tokenColor(segment.kind)
                return (
                    <span key={`${lineIndex}:${segIndex}`} style={colorStyleFor(color)}>
                        {highlightSegmentText(lineIndex, thisStart, segment.text, color, `${lineIndex}:${segIndex}:plain`)}
                    </span>
                )
            })}
        </div>
    )
}, (prev, next) => (
    prev.line === next.line
    && prev.groups === next.groups
    && prev.lineIndex === next.lineIndex
    && prev.isMatchedLine === next.isMatchedLine
    && prev.isActiveMatchLine === next.isActiveMatchLine
    && prev.isAppRunStart === next.isAppRunStart
    && prev.dividerGradient === next.dividerGradient
    && prev.showAppRunOverlay === next.showAppRunOverlay
    && prev.styles === next.styles
    && prev.tokenColor === next.tokenColor
    && prev.syntaxTheme === next.syntaxTheme
    && prev.highlightSegmentText === next.highlightSegmentText
    && prev.colorStyleFor === next.colorStyleFor
    && prev.openJsonViewer === next.openJsonViewer
    && prev.requestOpenExternalUrl === next.requestOpenExternalUrl
))

/**
 * Collapsible query-parameter table shown inside the external-URL confirmation
 * dialog. Parses the URL's search string, renders key/value pairs in a sortable
 * table, and provides one-click copy buttons for TSV and table formats.
 * Returns null when the URL has no query parameters or cannot be parsed.
 */
function ExternalUrlQueryParams({ url }: { url: string }) {
    // Hooks must run unconditionally before any early return (rules-of-hooks).
    const [sortCol, setSortCol] = React.useState<'key' | 'value' | null>(null)
    const [sortAsc, setSortAsc] = React.useState(true)
    const [copiedAll, setCopiedAll] = React.useState<'tsv' | 'table' | null>(null)
    const [open, setOpen] = React.useState(false)

    let baseParams: Array<[string, string]> = []
    try {
        const parsed = new URL(url)
        baseParams = Array.from(parsed.searchParams.entries())
    } catch {
        return null
    }
    if (baseParams.length === 0) return null

    const handleSort = (col: 'key' | 'value') => {
        if (sortCol === col) setSortAsc(ascending => !ascending)
        else { setSortCol(col); setSortAsc(true) }
    }

    const params = sortCol
        ? [...baseParams].sort(([aKey, aValue], [bKey, bValue]) => {
            const aField = sortCol === 'key' ? aKey : aValue
            const bField = sortCol === 'key' ? bKey : bValue
            return sortAsc ? aField.localeCompare(bField) : bField.localeCompare(aField)
        })
        : baseParams

    const arrow = (col: 'key' | 'value') =>
        sortCol === col
            ? <span style={{ fontSize: 7, marginLeft: 3, verticalAlign: 'middle' }}>{sortAsc ? '\u25b2' : '\u25bc'}</span>
            : null

    const copyAll = (format: 'tsv' | 'table') => {
        let text: string
        if (format === 'tsv') {
            text = params.map(([key, value]) => `${key}\t${value}`).join('\n')
        } else {
            const keyWidth = Math.max(...params.map(([key]) => key.length))
            text = params.map(([key, value]) => `${key.padEnd(keyWidth)}  ${value}`).join('\n')
        }
        void navigator.clipboard.writeText(text)
        setCopiedAll(format)
        window.setTimeout(() => setCopiedAll(null), 2000)
    }

    const thStyle: React.CSSProperties = {
        padding: '3px 8px 4px 0',
        textAlign: 'left',
        fontSize: 'var(--rokdock-font-xxs)',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: 'var(--rokdock-text-muted)',
        borderBottom: '1px solid var(--rokdock-border)',
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap'
    }

    const copyBtnStyle = (active: boolean): React.CSSProperties => ({
        background: 'none',
        border: '1px solid var(--rokdock-border)',
        borderRadius: 'var(--rokdock-radius-sm)',
        cursor: 'pointer',
        padding: '1px 6px',
        fontSize: 'var(--rokdock-font-xxs)',
        fontFamily: 'var(--rokdock-font-ui)',
        fontWeight: 600,
        color: active ? 'var(--rokdock-state-online)' : 'var(--rokdock-text-muted)',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        flexShrink: 0
    })

    return (
        <details style={{ fontSize: 'var(--rokdock-font-xs)', color: 'var(--rokdock-text-muted)' }} onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
            <summary style={{ cursor: 'pointer', userSelect: 'none', padding: '2px 0', outline: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', listStyle: 'none' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 8, display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}><FontAwesomeIcon icon={faChevronRight} /></span>
                    Query params ({baseParams.length})
                </span>
                <span style={{ display: 'flex', gap: 4 }} onClick={e => e.preventDefault()}>
                    <button style={copyBtnStyle(copiedAll === 'table')} onClick={() => copyAll('table')}>
                        <FontAwesomeIcon icon={copiedAll === 'table' ? faCheck : faCopy} />
                        Table
                    </button>
                    <button style={copyBtnStyle(copiedAll === 'tsv')} onClick={() => copyAll('tsv')}>
                        <FontAwesomeIcon icon={copiedAll === 'tsv' ? faCheck : faCopy} />
                        TSV
                    </button>
                </span>
            </summary>
            <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--rokdock-font-xs)' }}>
                    <thead>
                        <tr>
                            <th style={thStyle} onClick={() => handleSort('key')}>Key{arrow('key')}</th>
                            <th style={{ ...thStyle, paddingRight: 0 }} onClick={() => handleSort('value')}>Value{arrow('value')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {params.map(([key, value], i) => (
                            <tr key={i} style={{ borderTop: i > 0 ? '1px solid var(--rokdock-border)' : undefined }}>
                                <td style={{
                                    padding: '3px 8px 3px 0',
                                    color: 'var(--rokdock-brand-primary-light)',
                                    whiteSpace: 'nowrap',
                                    verticalAlign: 'top',
                                    width: '1%'
                                }}>
                                    {key}
                                </td>
                                <td style={{
                                    padding: '3px 0',
                                    color: 'var(--rokdock-text-dim)',
                                    wordBreak: 'break-all',
                                    verticalAlign: 'top'
                                }}>
                                    {value}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </details>
    )
}

/**
 * Core terminal UI for one tab. Manages the line buffer, virtualized rendering,
 * JSON fallback detection, search, copy, auto-scroll, word-wrap, command input,
 * command history, output streaming, and the external-URL confirmation dialog.
 *
 * Exported as a memoized component (see terminalTabVisualPropsEqual) so that
 * activity pulses on inactive tabs do not trigger re-renders.
 *
 * @param tab - Immutable tab descriptor from the app store (id, device, status, etc.).
 * @param isActive - Whether this tab is currently focused in its pane.
 */
function CustomTerminalView({ tab, isActive }: { tab: TabInfo; isActive: boolean }) {
    const updateTabStatus = useAppStore((state) => state.updateTabStatus)
    const markTabActivity = useAppStore((state) => state.markTabActivity)
    const toggleTabAutoScroll = useAppStore((state) => state.toggleTabAutoScroll)
    const toggleTabWordWrap = useAppStore((state) => state.toggleTabWordWrap)
    const setSearchVisible = useAppStore((state) => state.setSearchVisible)
    const toggleSearch = useAppStore((state) => state.toggleSearch)
    const searchVisible = useAppStore((state) => state.searchVisible[tab.id] ?? false)
    const syntaxPreset = useAppStore((state) => state.terminalSyntaxThemePreset)
    const syntaxCustom = useAppStore((state) => state.terminalSyntaxThemeCustomColors)
    const themeMode = resolveThemeMode(useAppStore((state) => state.themeMode))
    const terminalFontSize = useAppStore((state) => state.terminalFontSize)
    const terminalFontFamily = useAppStore((state) => state.terminalFontFamily)
    const fallbackColor = useAppStore((state) => state.terminalFallbackColor)
    const terminalUseThemeBackground = useAppStore((state) => state.terminalUseThemeBackground)
    const highlightAppLaunchLines = useAppStore((state) => state.terminalHighlightAppLaunchLines)
    const terminalCommandHistory = useAppStore(
        useCallback(
            (state) => (isActive ? state.terminalCommandHistory : STABLE_EMPTY_COMMAND_HISTORY),
            [isActive]
        )
    )
    const addTerminalCommandHistory = useAppStore((state) => state.addTerminalCommandHistory)
    const terminalFilterHistory = useAppStore(
        useCallback(
            (state) => (isActive ? state.terminalFilterHistory : STABLE_EMPTY_FILTER_HISTORY),
            [isActive]
        )
    )
    const addTerminalFilterHistory = useAppStore((state) => state.addTerminalFilterHistory)
    const setTerminalBufferLineCount = useAppStore((state) => state.setTerminalBufferLineCount)
    const aiConfigured = useAppStore((state) => state.aiConfigured)
    const openChatWith = useAppStore((state) => state.openChatWith)

    // Seed from the write-through cache so a remounted view (pane move, or the left panel being
    // collapsed then reopened) restores its last-known buffer. The initializer runs once on mount,
    // before the write-through effect below, so it cannot be clobbered by that effect's first run.
    const [lines, setLines] = useState<TerminalLineChunk[]>(() => terminalLinesCache.get(tab.id) ?? [])
    const [input, setInput] = useState('')
    const [historyIndex, setHistoryIndex] = useState<number | null>(null)
    const [historyDraft, setHistoryDraft] = useState('')
    const [pendingExternalUrl, setPendingExternalUrl] = useState<string | null>(null)
    const [urlCopied, setUrlCopied] = useState(false)
    // Floating selection toolbar, anchored at the cursor when the user finishes
    // selecting text in the output. null when there is no selection at all. Carries
    // the selection's own bounding rect (not just its top-left) so hovering can be
    // hit-tested against it (see toolbarHovered below).
    const [selectionAnchor, setSelectionAnchor] = useState<{ x: number; y: number; width: number; height: number; selection: string; term: string | null } | null>(null)
    // Whether the toolbar should actually be shown: true only while the pointer is over
    // the selected text or the toolbar itself, not merely while a selection exists (so it
    // does not linger over unrelated output the user has since moved to).
    const [toolbarHovered, setToolbarHovered] = useState(false)
    const toolbarElRef = useRef<HTMLDivElement>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [searchCursor, setSearchCursor] = useState(0)
    const [searchMatchCase, setSearchMatchCase] = useState(false)
    const [searchWholeWord, setSearchWholeWord] = useState(false)
    const [searchRegex, setSearchRegex] = useState(false)
    const [filterVisible, setFilterVisible] = useState(false)
    const [filterPatternText, setFilterPatternText] = useState('')
    // The live filter's own regex worker outcome: which buffer indices currently match (null =
    // no filter, show everything), and any validation/timeout message to show in the filter bar.
    const [liveFilterState, setLiveFilterState] = useState<{ indices: number[] | null; error: string | null }>({
        indices: null,
        error: null
    })
    const [historyMenuOpen, setHistoryMenuOpen] = useState(false)
    const [filterHistoryIndex, setFilterHistoryIndex] = useState<number | null>(null)
    const [filterHistoryDraft, setFilterHistoryDraft] = useState('')
    const [filterHistoryMenuOpen, setFilterHistoryMenuOpen] = useState(false)
    const [streamFilePath, setStreamFilePath] = useState<string | null>(null)
    // Optional line filter for Save-output / Stream-to-file: the prompt mode plus a
    // snapshot of the buffer texts taken when it opens (for the live match count), null
    // when closed; and the compiled regex applied to streamed lines (null = every line).
    const [filterPrompt, setFilterPrompt] = useState<{ mode: 'save' | 'stream'; sampleLines: string[] } | null>(null)
    const streamFilterRef = useRef<RegExp | null>(null)
    const markActivityRafRef = useRef<number | null>(null)
    const bufferCountRafRef = useRef<number | null>(null)
    const pendingBufferLineCountRef = useRef<number | null>(null)

    // Write through to the module cache so an always-mounted responder can read the focused tab's
    // buffer even while this component is unmounted (e.g. the left panel is collapsed).
    useLayoutEffect(() => {
        terminalLinesCache.set(tab.id, lines)
    }, [lines, tab.id])

    useLayoutEffect(() => {
        pendingBufferLineCountRef.current = lines.length
        if (bufferCountRafRef.current != null) return
        bufferCountRafRef.current = requestAnimationFrame(() => {
            bufferCountRafRef.current = null
            const lineCount = pendingBufferLineCountRef.current
            if (lineCount != null) setTerminalBufferLineCount(tab.id, lineCount)
        })
        return () => {
            if (bufferCountRafRef.current != null) {
                window.cancelAnimationFrame(bufferCountRafRef.current)
                bufferCountRafRef.current = null
            }
        }
    }, [lines.length, setTerminalBufferLineCount, tab.id])

    const viewportRef = useRef<HTMLDivElement | null>(null)
    const containerRef = useRef<HTMLDivElement | null>(null)
    const outputRef = useRef<HTMLDivElement | null>(null)
    const inputBarRef = useRef<HTMLDivElement | null>(null)
    const filterBarRef = useRef<HTMLDivElement | null>(null)
    const inputRef = useRef<HTMLInputElement | null>(null)
    const searchInputRef = useRef<HTMLInputElement | null>(null)
    const filterInputRef = useRef<HTMLInputElement | null>(null)
    const prevSearchVisibleRef = useRef(searchVisible)
    const viewportScrollRafRef = useRef<number | null>(null)
    const streamWriteInFlightRef = useRef(false)
    const streamCursorRef = useRef(0)
    const lineIdRef = useRef(1)
    const pendingChunksRef = useRef<TerminalLineChunk[]>([])
    const flushRafRef = useRef<number | null>(null)
    const jsonFallbackCacheRef = useRef<Map<number, TerminalOverlaySpan[]>>(new Map())
    const [jsonFallbackGen, setJsonFallbackGen] = useState(0)
    /** Multiline JSON fallback is expensive; skip until the user moves the pointer over the output. */
    const [jsonHoverDetectEnabled, setJsonHoverDetectEnabled] = useState(false)
    /** Reuse merged head rows when only new lines are appended (same jsonFallbackGen). */
    const jsonMergeIncRef = useRef<{
        source: TerminalLineChunk[] | null
        merged: TerminalLineChunk[] | null
        gen: number
    }>({ source: null, merged: null, gen: -1 })
    const dirtyJsonLineIdsRef = useRef<Set<number>>(new Set())
    const lineGroupCacheRef = useRef<Map<number, { lineRef: TerminalLineChunk; groups: LineSegmentGroup[] }>>(new Map())
    const colorStyleCacheRef = useRef<Map<string, React.CSSProperties>>(new Map())
    const [viewportScrollTop, setViewportScrollTop] = useState(0)
    const [viewportHeight, setViewportHeight] = useState(0)

    const syntaxTheme = useMemo(() => resolveSyntaxTheme(syntaxPreset, themeMode, syntaxCustom), [syntaxPreset, themeMode, syntaxCustom])

    useEffect(() => {
        colorStyleCacheRef.current.clear()
    }, [syntaxTheme])

    useEffect(() => {
        if (!isActive) clearJsonLinkActiveInRoot(outputRef.current)
    }, [isActive])

    const linesWithJsonFallback = useMemo(() => {
        const inc = jsonMergeIncRef.current

        if (!isActive) {
            inc.source = null
            inc.merged = null
            return lines
        }

        const cache = jsonFallbackCacheRef.current
        if (!jsonHoverDetectEnabled || cache.size === 0) {
            inc.source = null
            inc.merged = null
            dirtyJsonLineIdsRef.current.clear()
            return lines
        }

        if (inc.merged && inc.source === lines && inc.gen === jsonFallbackGen) {
            if (dirtyJsonLineIdsRef.current.size === 0) {
                return inc.merged
            }
            const dirtyIds = dirtyJsonLineIdsRef.current
            const idToIndex = buildIdToIndexMap(lines)
            const next = inc.merged.slice()
            let touched = 0
            for (const id of dirtyIds) {
                const idx = idToIndex.get(id)
                if (idx == null) continue
                const mergedLine = mergeTerminalLineWithJsonCache(lines[idx]!, cache)
                if (next[idx] !== mergedLine) {
                    next[idx] = mergedLine
                    touched += 1
                }
            }
            dirtyIds.clear()
            if (touched > 0) inc.merged = next
            return inc.merged
        }

        if (inc.merged && inc.source === lines && inc.gen !== jsonFallbackGen) {
            const dirtyIds = dirtyJsonLineIdsRef.current
            if (dirtyIds.size === 0) {
                inc.gen = jsonFallbackGen
                return inc.merged
            }
            const idToIndex = buildIdToIndexMap(lines)
            const next = inc.merged.slice()
            let touched = 0
            for (const id of dirtyIds) {
                const idx = idToIndex.get(id)
                if (idx == null) continue
                const mergedLine = mergeTerminalLineWithJsonCache(lines[idx]!, cache)
                if (next[idx] !== mergedLine) {
                    next[idx] = mergedLine
                    touched += 1
                }
            }
            dirtyIds.clear()
            if (touched > 0) inc.merged = next
            inc.gen = jsonFallbackGen
            return inc.merged
        }

        if (
            inc.merged &&
            inc.source &&
            lines.length > inc.source.length &&
            inc.merged.length === inc.source.length
        ) {
            let prefixUnchanged = true
            for (let i = 0; i < inc.source.length; i++) {
                if (lines[i] !== inc.source[i]) {
                    prefixUnchanged = false
                    break
                }
            }
            if (prefixUnchanged) {
                let prefixMerged = inc.merged
                if (inc.gen !== jsonFallbackGen) {
                    const dirtyIds = dirtyJsonLineIdsRef.current
                    if (dirtyIds.size > 0) {
                        const idToIndex = buildIdToIndexMap(lines, inc.source.length)
                        const next = inc.merged.slice()
                        let touched = 0
                        for (const id of dirtyIds) {
                            const idx = idToIndex.get(id)
                            if (idx == null) continue
                            const mergedLine = mergeTerminalLineWithJsonCache(lines[idx]!, cache)
                            if (next[idx] !== mergedLine) {
                                next[idx] = mergedLine
                                touched += 1
                            }
                        }
                        if (touched > 0) prefixMerged = next
                    }
                    dirtyIds.clear()
                }
                const tail: TerminalLineChunk[] = []
                for (let i = inc.source.length; i < lines.length; i++) {
                    tail.push(mergeTerminalLineWithJsonCache(lines[i]!, cache))
                }
                const result = prefixMerged.concat(tail)
                inc.source = lines
                inc.merged = result
                inc.gen = jsonFallbackGen
                return result
            }
        }

        if (
            inc.merged &&
            inc.source &&
            lines.length === inc.source.length &&
            lines.length > 0 &&
            inc.merged.length === inc.source.length
        ) {
            const maxShift = Math.min(MAX_CHUNKS_PER_FLUSH, lines.length)
            let shift = -1
            for (let candidate = 1; candidate <= maxShift; candidate++) {
                if (lines[0] !== inc.source[candidate]) continue
                let matches = true
                for (let i = 0; i < lines.length - candidate; i++) {
                    if (lines[i] !== inc.source[i + candidate]) {
                        matches = false
                        break
                    }
                }
                if (matches) {
                    shift = candidate
                    break
                }
            }
            if (shift > 0) {
                // BUFFER ROTATION: lines === inc.source shifted left by `shift`.
                // inc.merged[shift..N-1] corresponds to lines[0..N-shift-1], so
                // slice off the dropped prefix and reuse it as the retained region.
                // The tail (lines[N-shift..N-1]) is always fresh-merged below.
                //
                // Dirty-id correctness analysis (see decisions.md for full proof):
                //   Dirty ids are added exclusively in processSlice(), which always
                //   calls setJsonFallbackGen() in the same rAF frame once it finishes
                //   processing. That gen bump causes inc.gen < jsonFallbackGen to be
                //   true by the time this useMemo re-runs, so the guard below fires
                //   and all retained dirty ids are applied.
                //
                //   The only exception is a multi-frame processSlice that has already
                //   populated dirtyIds but not yet called setJsonFallbackGen when a
                //   buffer rotation triggers a re-render. In that window the guard
                //   below is skipped, so the prefix carries transiently stale overlays
                //   for those dirty ids. The gen bump fires within one to two rAF
                //   frames (~16-32 ms), after which the identity branch applies all
                //   accumulated dirty ids and the display is correct. This is a
                //   cosmetic flicker, not a data-correctness failure: no permanently
                //   divergent state is possible.
                //
                //   Dirty ids for DROPPED lines (inc.source[0..shift-1]) are absent
                //   from the id->index map for the new lines array and are simply
                //   skipped, which is correct because those lines no longer exist.
                //
                //   Dirty ids for TAIL lines (lines[N-shift..N-1]) cannot exist yet
                //   because those are newly appended lines that have never entered the
                //   JSON detection pipeline. They are fresh-merged below.
                let prefixMerged = inc.merged.slice(shift)
                if (inc.gen !== jsonFallbackGen) {
                    const dirtyIds = dirtyJsonLineIdsRef.current
                    if (dirtyIds.size > 0) {
                        const idToIndex = buildIdToIndexMap(lines, lines.length - shift)
                        const next = prefixMerged.slice()
                        let touched = 0
                        for (const id of dirtyIds) {
                            const idx = idToIndex.get(id)
                            if (idx == null || idx >= next.length) continue
                            const mergedLine = mergeTerminalLineWithJsonCache(lines[idx]!, cache)
                            if (next[idx] !== mergedLine) {
                                next[idx] = mergedLine
                                touched += 1
                            }
                        }
                        if (touched > 0) prefixMerged = next
                    }
                    dirtyIds.clear()
                }
                const tail: TerminalLineChunk[] = []
                for (let i = lines.length - shift; i < lines.length; i++) {
                    tail.push(mergeTerminalLineWithJsonCache(lines[i]!, cache))
                }
                const result = prefixMerged.concat(tail)
                inc.source = lines
                inc.merged = result
                inc.gen = jsonFallbackGen
                return result
            }
        }

        const out: TerminalLineChunk[] = []
        for (let i = 0; i < lines.length; i++) {
            out.push(mergeTerminalLineWithJsonCache(lines[i]!, cache))
        }
        inc.source = lines
        inc.merged = out
        inc.gen = jsonFallbackGen
        return out
    }, [isActive, lines, jsonFallbackGen, jsonHoverDetectEnabled])

    const linesWithJsonFallbackRef = useRef(linesWithJsonFallback)
    linesWithJsonFallbackRef.current = linesWithJsonFallback

    /**
     * The raw text of every buffered line. Built once per buffer change and shared by the three
     * consumers that need the whole buffer as plain strings: search matching, the live filter,
     * and the app-run banding flags.
     */
    const bufferLineTexts = useMemo(
        () => linesWithJsonFallback.map((line) => line.text),
        [linesWithJsonFallback]
    )

    useEffect(() => {
        if (!isActive) return

        const cache = jsonFallbackCacheRef.current
        const lineIds = new Set(lines.map((line) => line.id).filter((id): id is number => id != null))
        for (const id of cache.keys()) {
            if (!lineIds.has(id)) cache.delete(id)
        }

        if (!jsonHoverDetectEnabled) return

        const uncached: number[] = []
        const detectMaxLines = tab.wordWrap ? JSON_DETECT_MAX_LINES_WRAPPED : JSON_DETECT_MAX_LINES
        const scanStartIndex = lines.length > detectMaxLines
            ? lines.length - detectMaxLines
            : 0
        for (let i = scanStartIndex; i < lines.length; i++) {
            const line = lines[i]
            if (line.id != null && cache.has(line.id)) continue
            if (tokenizerCoversTrimmedLineAsSingleJson(line)) {
                if (line.id != null) cache.set(line.id, [])
                continue
            }
            uncached.push(i)
        }

        if (uncached.length === 0) return

        let cancelled = false
        const debounceMs = tab.wordWrap
            ? (uncached.length > 20 ? 320 : 120)
            : (uncached.length > 50 ? 200 : 50)
        const debounceTimer = setTimeout(() => {
            let idx = 0
            let changed = false

            const processSlice = () => {
                if (cancelled) return
                const deadline = performance.now() + (tab.wordWrap ? 4 : 8)
                while (idx < uncached.length && performance.now() < deadline) {
                    const i = uncached[idx++]
                    if (i >= lines.length) continue
                    const line = lines[i]
                    const detected = detectJsonOverlaysForLine(lines, i)
                    if (line.id != null) {
                        cache.set(line.id, detected)
                        dirtyJsonLineIdsRef.current.add(line.id)
                        changed = true
                    }
                }

                if (idx < uncached.length) {
                    requestAnimationFrame(processSlice)
                } else if (changed) {
                    setJsonFallbackGen((gen) => gen + 1)
                }
            }

            requestAnimationFrame(processSlice)
        }, debounceMs)

        return () => {
            if (cancelled) return
            cancelled = true
            clearTimeout(debounceTimer)
        }
    }, [isActive, lines, jsonHoverDetectEnabled, tab.wordWrap])

    // Search matching runs in a Web Worker (regexMatchClient) so a catastrophic-backtracking
    // user pattern cannot freeze the renderer: the client hard-terminates a stuck worker on a
    // watchdog timeout and surfaces "Pattern too slow" instead of hanging. The run is debounced,
    // and the previous matches stay on screen until the new result arrives (no per-keystroke flicker).
    const searchClientRef = useRef<RegexMatchClient | null>(null)
    const filterClientRef = useRef<RegexMatchClient | null>(null)
    const streamClientRef = useRef<RegexMatchClient | null>(null)
    const liveFilterClientRef = useRef<RegexMatchClient | null>(null)
    useEffect(() => () => {
        searchClientRef.current?.dispose()
        searchClientRef.current = null
        filterClientRef.current?.dispose()
        filterClientRef.current = null
        streamClientRef.current?.dispose()
        streamClientRef.current = null
        liveFilterClientRef.current?.dispose()
        liveFilterClientRef.current = null
    }, [])
    const ensureFilterClient = (): RegexMatchClient => {
        if (!filterClientRef.current) filterClientRef.current = createRegexMatchClient()
        return filterClientRef.current
    }
    // Set once the stream filter times out on a streamed line: from then on the stream is written
    // unfiltered (see the stream effect), so a catastrophic pattern on a future line cannot freeze
    // or repeatedly stall the write loop. Reset when a new stream starts or streaming stops.
    const streamFilterTimedOutRef = useRef(false)

    const [searchState, setSearchState] = useState<SearchState>({ matches: [], regexError: null })
    useEffect(() => {
        if (!isActive) { setSearchState({ matches: [], regexError: null }); return }
        const query = searchQuery.trim()
        if (!query) { setSearchState({ matches: [], regexError: null }); return }
        let source = searchRegex ? query : escapeRegExp(query)
        if (searchWholeWord) source = `\\b${source}\\b`
        const flags = searchMatchCase ? 'g' : 'gi'

        let cancelled = false
        const debounce = setTimeout(() => {
            if (!searchClientRef.current) searchClientRef.current = createRegexMatchClient()
            void searchClientRef.current.search(source, flags, bufferLineTexts).then((outcome) => {
                if (cancelled) return
                if (outcome.status === 'ok') setSearchState({ matches: outcome.value, regexError: null })
                else if (outcome.status === 'invalid') setSearchState({ matches: [], regexError: 'Invalid regex' })
                else if (outcome.status === 'timeout') setSearchState({ matches: [], regexError: 'Pattern too slow' })
                // 'superseded': a newer keystroke is already in flight; let it set the state.
            })
        }, 120)
        return () => { cancelled = true; clearTimeout(debounce) }
    }, [bufferLineTexts, isActive, searchMatchCase, searchQuery, searchRegex, searchWholeWord])

    // The live filter never discards a line from the buffer, only which buffer indices are
    // displayed. Matching runs in the same debounced regex worker as search (see above) for the
    // same catastrophic-backtracking safety, re-running whenever the buffer grows so newly
    // streamed lines are picked up without the user retyping the pattern.
    const lastRecordedFilterPatternRef = useRef<string | null>(null)
    useEffect(() => {
        if (!filterVisible) { setLiveFilterState({ indices: null, error: null }); return }
        const { regex, error } = compileLineFilter(filterPatternText)
        if (error) { setLiveFilterState({ indices: null, error: `Invalid regex: ${error}` }); return }
        if (!regex) { setLiveFilterState({ indices: null, error: null }); return }

        let cancelled = false
        const debounce = setTimeout(() => {
            if (!liveFilterClientRef.current) liveFilterClientRef.current = createRegexMatchClient()
            void liveFilterClientRef.current.filter(regex.source, regex.flags, bufferLineTexts).then((outcome) => {
                if (cancelled) return
                if (outcome.status === 'ok') {
                    setLiveFilterState({ indices: outcome.value, error: null })
                    // Record once per pattern, not on every re-run this effect does as the
                    // buffer grows while the same pattern stays active.
                    if (lastRecordedFilterPatternRef.current !== filterPatternText) {
                        lastRecordedFilterPatternRef.current = filterPatternText
                        addTerminalFilterHistory(filterPatternText)
                    }
                }
                else if (outcome.status === 'invalid') setLiveFilterState({ indices: null, error: 'Invalid regex' })
                else if (outcome.status === 'timeout') setLiveFilterState({ indices: null, error: 'Pattern too slow' })
                // 'superseded': a newer edit or buffer growth already has a request in flight.
            })
        }, 120)
        return () => { cancelled = true; clearTimeout(debounce) }
    }, [addTerminalFilterHistory, bufferLineTexts, filterVisible, filterPatternText])

    const filteredLineIndices = liveFilterState.indices
    const filteredLineIndicesRef = useRef(filteredLineIndices)
    filteredLineIndicesRef.current = filteredLineIndices
    const filteredLineIndexSet = useMemo(
        () => (filteredLineIndices ? new Set(filteredLineIndices) : null),
        [filteredLineIndices]
    )

    const searchMatches = useMemo(
        () => (filteredLineIndexSet ? searchState.matches.filter((match) => filteredLineIndexSet.has(match.lineIndex)) : searchState.matches),
        [filteredLineIndexSet, searchState.matches]
    )
    const searchRegexError = searchState.regexError
    const activeSearchMatch = searchMatches.length > 0 ? searchMatches[Math.min(searchCursor, searchMatches.length - 1)] : null
    const matchedLineIndexes = useMemo(() => {
        const indexes = new Set<number>()
        for (const match of searchMatches) indexes.add(match.lineIndex)
        return indexes
    }, [searchMatches])
    const lineMatchesByIndex = useMemo(() => {
        const byLine = new Map<number, SearchMatch[]>()
        for (const match of searchMatches) {
            const list = byLine.get(match.lineIndex)
            if (list) list.push(match)
            else byLine.set(match.lineIndex, [match])
        }
        return byLine
    }, [searchMatches])

    useEffect(() => {
        const cache = lineGroupCacheRef.current
        const live = new Set<number>()
        for (const line of linesWithJsonFallback) {
            if (line.id != null) live.add(line.id)
        }
        for (const id of cache.keys()) {
            if (!live.has(id)) {
                cache.delete(id)
            }
        }
    }, [linesWithJsonFallback])

    useEffect(() => {
        const viewport = viewportRef.current
        if (!viewport) return
        const updateHeight = () => setViewportHeight(viewport.clientHeight)
        updateHeight()

        const ro = new ResizeObserver(() => updateHeight())
        ro.observe(viewport)
        return () => ro.disconnect()
    }, [])

    useEffect(
        () => () => {
            if (viewportScrollRafRef.current != null) {
                window.cancelAnimationFrame(viewportScrollRafRef.current)
                viewportScrollRafRef.current = null
            }
        },
        []
    )

    /**
     * Scroll handler for the virtualized viewport. Deferred to a rAF so the
     * virtualization window (virtualStartIndex / virtualEndIndex) updates at most
     * once per animation frame even during fast scroll gestures.
     */
    const onViewportScroll = useCallback(() => {
        // The toolbar is anchored to a viewport point, so scrolling invalidates it.
        setSelectionAnchor(null)
        if (viewportScrollRafRef.current != null) return
        viewportScrollRafRef.current = window.requestAnimationFrame(() => {
            viewportScrollRafRef.current = null
            const viewport = viewportRef.current
            if (!viewport) return
            setViewportScrollTop(viewport.scrollTop)
        })
    }, [])

    // Copy support for the virtualized output. selectAllActiveRef marks a Select All so a
    // copy pulls the whole scrollback; dragStartLineIndexRef records where a drag selection
    // began (captured while that row is still rendered) so the anchor survives the row
    // unmounting mid-drag.
    const selectAllActiveRef = useRef(false)
    const dragStartLineIndexRef = useRef<number | null>(null)

    // The text a copy should place on the clipboard. Falls back from the (virtualization-
    // truncated) DOM selection to the full line buffer. See resolveTerminalCopyText.
    // While a live filter is active, Select All and a drag selection both resolve against
    // the filtered (visible) lines only, not the hidden ones still sitting in the buffer.
    const getSelectedText = useCallback((): string => {
        const selection = window.getSelection()
        const nativeText = selection?.toString() ?? ''
        const rawAnchorLineIndex = lineIndexFromNode(selection?.anchorNode ?? null) ?? dragStartLineIndexRef.current
        const rawFocusLineIndex = lineIndexFromNode(selection?.focusNode ?? null)
        const filtered = filteredLineIndicesRef.current
        return resolveTerminalCopyText(
            {
                selectAllActive: selectAllActiveRef.current,
                nativeText,
                anchorLineIndex: toFilteredPosition(filtered, rawAnchorLineIndex),
                focusLineIndex: toFilteredPosition(filtered, rawFocusLineIndex)
            },
            linesForCopy(linesWithJsonFallbackRef.current.map((line) => line.text), filtered)
        )
    }, [])

    // A fresh mouse drag starts a new manual selection: forget any Select All and record the
    // starting row so a drag that scrolls the anchor out of the DOM can still be resolved.
    const onOutputMouseDown = useCallback((event: React.MouseEvent): void => {
        selectAllActiveRef.current = false
        dragStartLineIndexRef.current = lineIndexFromNode(event.target as Node)
    }, [])

    // Override native copy (Cmd/Ctrl+C, the Edit menu copy role, a drag selection) for copies
    // originating in this terminal's output. The output is virtualized, so the browser's own
    // copy only includes the rows currently in the DOM. Rebuild the full text from the buffer
    // and write it to the event's clipboardData instead.
    useEffect(() => {
        const onCopy = (event: ClipboardEvent): void => {
            const output = outputRef.current
            const selection = window.getSelection()
            if (!output || !selection) return
            if (!output.contains(selection.anchorNode) && !output.contains(selection.focusNode)) return
            const text = getSelectedText()
            if (!text) return
            event.preventDefault()
            event.clipboardData?.setData('text/plain', text)
        }
        document.addEventListener('copy', onCopy)
        return () => document.removeEventListener('copy', onCopy)
    }, [getSelectedText])

    // Show the selection toolbar anchored at the TOP-LEFT of the selection when the
    // user finishes selecting text in the output, so it can sit just above the
    // selection rather than over it. Captures both the full selection (for Explain)
    // and the qualifying short term (for docs lookup, null when not applicable).
    const onOutputMouseUp = useCallback(() => {
        const selection = window.getSelection()
        const text = selection?.toString() ?? ''
        if (!text.trim() || !selection || selection.rangeCount === 0) {
            setSelectionAnchor(null)
            return
        }
        const rect = selection.getRangeAt(0).getBoundingClientRect()
        setSelectionAnchor({ x: rect.left, y: rect.top, width: rect.width, height: rect.height, selection: text, term: qualifyingLookupTerm() })
        // The mouseup point is where the selection was just finished, so it is on (or
        // adjacent to) the selection itself; the mousemove effect below takes over from here.
        setToolbarHovered(true)
    }, [])

    // Only keep the toolbar visible while the pointer is over the selected text or over
    // the toolbar itself. The toolbar sits just above the selection with a small gap;
    // checking both rects (not just the selection's) lets the pointer cross that gap on
    // the way to a button without the toolbar disappearing first. That alone is not
    // enough on fast movement, though: a mousemove sample can land IN the gap (between
    // the two rects) and briefly read as neither, so showing/hiding is delayed rather
    // than applied on the raw sample - a pending opposite-direction change cancels it,
    // so a momentary gap sample never takes effect once the very next sample (on the
    // toolbar) arrives before the timer fires.
    useEffect(() => {
        if (!selectionAnchor) return
        /** Cancels a pending timer (if any) and returns null, so callers can write `x = cancelTimer(x)`. */
        const cancelTimer = (timer: ReturnType<typeof setTimeout> | null): null => {
            if (timer) clearTimeout(timer)
            return null
        }
        let showTimer: ReturnType<typeof setTimeout> | null = null
        let hideTimer: ReturnType<typeof setTimeout> | null = null
        const onMouseMove = (event: MouseEvent): void => {
            const { clientX, clientY } = event
            const withinSelection = (
                clientX >= selectionAnchor.x && clientX <= selectionAnchor.x + selectionAnchor.width
                && clientY >= selectionAnchor.y && clientY <= selectionAnchor.y + selectionAnchor.height
            )
            const toolbarRect = toolbarElRef.current?.getBoundingClientRect()
            const withinToolbar = !!toolbarRect
                && clientX >= toolbarRect.left && clientX <= toolbarRect.right
                && clientY >= toolbarRect.top && clientY <= toolbarRect.bottom
            const shouldShow = withinSelection || withinToolbar
            if (shouldShow) {
                hideTimer = cancelTimer(hideTimer)
                if (!showTimer) showTimer = setTimeout(() => { showTimer = null; setToolbarHovered(true) }, TOOLBAR_SHOW_DELAY_MS)
            } else {
                showTimer = cancelTimer(showTimer)
                if (!hideTimer) hideTimer = setTimeout(() => { hideTimer = null; setToolbarHovered(false) }, TOOLBAR_HIDE_DELAY_MS)
            }
        }
        document.addEventListener('mousemove', onMouseMove)
        return () => {
            document.removeEventListener('mousemove', onMouseMove)
            showTimer = cancelTimer(showTimer)
            hideTimer = cancelTimer(hideTimer)
        }
    }, [selectionAnchor])

    // Hide the toolbar once the selection is collapsed (a click elsewhere, a new
    // selection, or keyboard deselection). Keyed on the toolbar's presence so the
    // listener attaches once, not on every new selection.
    const toolbarVisible = selectionAnchor !== null
    useEffect(() => {
        if (!toolbarVisible) return
        const onSelectionChange = (): void => {
            if (!window.getSelection()?.toString().trim()) setSelectionAnchor(null)
        }
        document.addEventListener('selectionchange', onSelectionChange)
        return () => document.removeEventListener('selectionchange', onSelectionChange)
    }, [toolbarVisible])

    // The toolbar is pinned to a fixed viewport point captured when the selection
    // was made. Resizing the layout (e.g. dragging the AI chat panel divider) moves
    // the output without firing a scroll, so the toolbar would otherwise strand over
    // now-hidden content. Clear it on any viewport resize, mirroring onViewportScroll.
    // Attached at mount, where the anchor is null, so the observer's initial callback
    // is a no-op rather than dismissing a fresh selection.
    useEffect(() => {
        const viewport = viewportRef.current
        if (!viewport) return
        const observer = new ResizeObserver(() => setSelectionAnchor(null))
        observer.observe(viewport)
        return () => observer.disconnect()
    }, [])

    /**
     * Return the LineSegmentGroups for a terminal line, using a per-line identity
     * cache keyed by line.id. The cache is invalidated whenever the line object
     * reference changes (i.e. after overlays are merged or the tokenizer re-runs).
     */
    const groupsForLine = useCallback((line: TerminalLineChunk, lineIndex: number): LineSegmentGroup[] => {
        if (line.id != null) {
            const hit = lineGroupCacheRef.current.get(line.id)
            if (hit?.lineRef === line) return hit.groups
        }
        const groups = groupSegmentsForLine(lineIndex, buildSegments(line))
        if (line.id != null) {
            lineGroupCacheRef.current.set(line.id, { lineRef: line, groups })
        }
        return groups
    }, [])

    // Fixed-height virtualization stays ON during search: rendering the whole buffer (up to
    // TERMINAL_MAX_BUFFER_LINES) when the find bar opened froze the terminal. The scroll-to-match
    // effect brings an off-screen active match into the virtual window (set scrollTop, then
    // scrollIntoView on the next frame), so jump-to-match still works without mounting every line.
    // Word-wrap rows have variable height and cannot use fixed-height virtualization, so wrapped
    // search still renders the full buffer (its match jump relies on the line already being in the DOM).
    const shouldVirtualize = !tab.wordWrap
    const shouldWindowWrapRows = tab.wordWrap && tab.autoScroll && !searchVisible
    const totalVisibleLineCount = filteredLineIndices ? filteredLineIndices.length : linesWithJsonFallback.length
    const virtualStartIndex = shouldVirtualize
        ? Math.max(0, Math.floor(viewportScrollTop / VIRTUAL_LINE_HEIGHT) - VIRTUAL_OVERSCAN_LINES)
        : 0
    const virtualEndIndex = shouldVirtualize
        ? Math.min(
            totalVisibleLineCount,
            Math.ceil((viewportScrollTop + Math.max(viewportHeight, VIRTUAL_LINE_HEIGHT)) / VIRTUAL_LINE_HEIGHT)
                + VIRTUAL_OVERSCAN_LINES
        )
        : totalVisibleLineCount
    const virtualTopSpacer = shouldVirtualize ? virtualStartIndex * VIRTUAL_LINE_HEIGHT : 0
    const virtualBottomSpacer = shouldVirtualize
        ? Math.max(0, (totalVisibleLineCount - virtualEndIndex) * VIRTUAL_LINE_HEIGHT)
        : 0
    const wrapWindowStartIndex = shouldWindowWrapRows
        ? Math.max(0, totalVisibleLineCount - WRAP_AUTOSCROLL_RENDER_WINDOW_LINES)
        : 0
    const renderStartIndex = shouldVirtualize ? virtualStartIndex : wrapWindowStartIndex
    const renderEndIndex = shouldVirtualize ? virtualEndIndex : totalVisibleLineCount
    // Which block (compile+run cycle) each buffer line belongs to, and which lines actually
    // start a new block (see computeAppRunBoundaries). Computed once over the whole buffer so
    // the alternating tint is correct regardless of which window is currently virtualized into view.
    const appRunBoundaries = useMemo(() => computeAppRunBoundaries(bufferLineTexts), [bufferLineTexts])
    const visibleRows = useMemo(() => {
        const rows: Array<{
            line: TerminalLineChunk
            lineIndex: number
            groups: LineSegmentGroup[]
            isMatchedLine: boolean
            isActiveMatchLine: boolean
            isAppRunStart: boolean
            dividerGradient: string | null
            showAppRunOverlay: boolean
        }> = []
        /** Whether one buffer line carries the alternating run tint. */
        const hasRunTint = (bufferIndex: number): boolean => (
            highlightAppLaunchLines && appRunBoundaries.tint[bufferIndex] === true
        )
        /** That same line's tint as a gradient stop color. */
        const runTintColor = (bufferIndex: number): string => (
            hasRunTint(bufferIndex) ? RUN_TINT_CSS_VAR : 'transparent'
        )
        for (let i = renderStartIndex; i < renderEndIndex; i++) {
            const bufferIndex = resolveBufferLineIndex(filteredLineIndices, i)
            const line = linesWithJsonFallback[bufferIndex]!
            // The divider is drawn by the row BEFORE a block-start marker so the accent rule lands
            // on the seam between the two blocks rather than inside the new block's first line.
            const nextLine = linesWithJsonFallback[bufferIndex + 1]
            let dividerGradient: string | null = null
            if (nextLine != null && appRunBoundaries.blockStart[bufferIndex + 1] === true) {
                dividerGradient = buildRunBoundaryGradient({
                    rowHeightPx: VIRTUAL_LINE_HEIGHT,
                    dividerThicknessPx: RUN_DIVIDER_THICKNESS_PX,
                    centered: line.text.trim() === '',
                    beforeColor: runTintColor(bufferIndex),
                    afterColor: runTintColor(bufferIndex + 1),
                    accentColor: RUN_ACCENT_CSS_VAR
                })
            }
            rows.push({
                line,
                lineIndex: bufferIndex,
                groups: groupsForLine(line, bufferIndex),
                isMatchedLine: matchedLineIndexes.has(bufferIndex),
                isActiveMatchLine: activeSearchMatch?.lineIndex === bufferIndex,
                isAppRunStart: appRunBoundaries.blockStart[bufferIndex] === true,
                dividerGradient,
                showAppRunOverlay: hasRunTint(bufferIndex)
            })
        }
        return rows
    }, [
        activeSearchMatch?.lineIndex,
        appRunBoundaries,
        filteredLineIndices,
        groupsForLine,
        highlightAppLaunchLines,
        linesWithJsonFallback,
        matchedLineIndexes,
        renderEndIndex,
        renderStartIndex
    ])

    /**
     * Map a token kind to its display color from the active syntax theme.
     * When the user has chosen the 'none' preset the fallback color is used
     * for all kinds so the terminal renders as plain text.
     */
    const tokenColor = useCallback(
        (kind: TerminalTokenSpan['kind']) => {
            if (syntaxPreset === 'none') {
                return fallbackColor || syntaxTheme.colors.plain
            }
            return syntaxTheme.colors[kind] ?? syntaxTheme.colors.plain
        },
        [fallbackColor, syntaxPreset, syntaxTheme.colors]
    )

    /**
     * Return a memoized { color } style object for the given CSS color string.
     * Caching avoids creating a new object on every render which would defeat
     * React.memo checks inside TerminalOutputLine.
     */
    const colorStyleFor = useCallback((color: string): React.CSSProperties => {
        const cached = colorStyleCacheRef.current.get(color)
        if (cached) return cached
        const next = { color }
        colorStyleCacheRef.current.set(color, next)
        return next
    }, [])

    /**
     * Drain up to MAX_CHUNKS_PER_FLUSH lines from the pending-chunks queue into
     * React state. If further chunks remain after the batch, schedules another
     * rAF so subsequent batches are spread across frames rather than all
     * processed in a single synchronous update. This keeps individual frames
     * short during high-throughput log streams.
     */
    const flushPendingTerminalLines = useCallback(() => {
        flushRafRef.current = null
        const queue = pendingChunksRef.current
        if (queue.length === 0) return

        const batch = queue.splice(0, MAX_CHUNKS_PER_FLUSH)
        setLines((prev) => {
            const additions = batch.map((chunk) => ({ ...chunk, id: lineIdRef.current++ }))
            const combined = prev.concat(additions)
            return combined.length > MAX_LINES ? combined.slice(combined.length - MAX_LINES) : combined
        })

        if (queue.length > 0) {
            flushRafRef.current = window.requestAnimationFrame(() => {
                flushPendingTerminalLines()
            })
        }
    }, [])

    /**
     * Clear all in-flight and cached terminal data without touching React line
     * state. Called before setLines([]) so intermediate renders during the clear
     * do not see stale JSON cache entries or dangling rAF callbacks.
     */
    const resetTerminalBuffers = useCallback(() => {
        pendingChunksRef.current = []
        if (flushRafRef.current !== null) {
            window.cancelAnimationFrame(flushRafRef.current)
            flushRafRef.current = null
        }
        lineIdRef.current = 1
        jsonFallbackCacheRef.current.clear()
        lineGroupCacheRef.current.clear()
        dirtyJsonLineIdsRef.current.clear()
        jsonMergeIncRef.current = { source: null, merged: null, gen: -1 }
        setViewportScrollTop(0)
        setJsonHoverDetectEnabled(false)
    }, [])

    /**
     * Clears the terminal buffer. The single home for this action: it used to be duplicated
     * between the context-menu 'clear' handler and the Alt+C input shortcut, and the two copies
     * had already drifted (the shortcut skipped the terminalLinesCache delete, and neither reset
     * the live filter's matched indices, which then pointed past the end of the emptied buffer
     * and crashed the render loop on the very next frame).
     */
    const clearTerminal = useCallback(() => {
        resetTerminalBuffers()
        terminalLinesCache.delete(tab.id)
        setLines([])
        setLiveFilterState({ indices: null, error: null })
    }, [resetTerminalBuffers, tab.id])

    /**
     * Enqueue a single terminal line chunk and schedule a rAF flush if one is
     * not already pending. Multiple calls between frames are batched into a
     * single state update by flushPendingTerminalLines.
     */
    const appendLine = useCallback(
        (chunk: TerminalLineChunk) => {
            pendingChunksRef.current.push(chunk)
            if (flushRafRef.current !== null) return
            flushRafRef.current = window.requestAnimationFrame(() => {
                flushPendingTerminalLines()
            })
        },
        [flushPendingTerminalLines]
    )

    useEffect(
        () => () => {
            if (flushRafRef.current !== null) {
                window.cancelAnimationFrame(flushRafRef.current)
                flushRafRef.current = null
            }
            pendingChunksRef.current = []
        },
        []
    )

    /**
     * Send the current input string to the terminal process, append it to the
     * visible line buffer (merged onto the last line or added as a new line),
     * push it into the command history, and reset the input field.
     */
    const submitCommand = useCallback(() => {
        if (!input) return
        const command = input
        setLines((prev) => {
            if (prev.length === 0) {
                return [{
                    id: lineIdRef.current++,
                    text: command,
                    tokens: [{ start: 0, end: command.length, kind: 'plain' }],
                    overlays: []
                }]
            }
            const next = [...prev]
            const last = next[next.length - 1]
            const needsSeparator = last.text.length > 0 && !/\s$/.test(last.text)
            const separator = needsSeparator ? ' ' : ''
            const mergedText = `${last.text}${separator}${command}`
            const commandStart = last.text.length + separator.length
            next[next.length - 1] = {
                ...last,
                id: last.id ?? lineIdRef.current++,
                text: mergedText,
                tokens: [
                    ...last.tokens.map((token) => ({ ...token })),
                    { start: commandStart, end: commandStart + command.length, kind: 'plain' }
                ],
                overlays: []
            }
            return next
        })
        window.rokdock.terminal.write(tab.id, `${command}\r\n`)
        addTerminalCommandHistory(command)
        setInput('')
        setHistoryIndex(null)
        setHistoryDraft('')
        setHistoryMenuOpen(false)
    }, [addTerminalCommandHistory, input, tab.id])

    /** Appends a one-line warning message to the terminal. */
    const appendWarning = useCallback((message: string) => {
        appendLine({ text: message, tokens: [{ start: 0, end: message.length, kind: 'warning' }], overlays: [] })
    }, [appendLine])

    useEffect(() => {
        if (!streamFilePath || linesWithJsonFallback.length === 0) return
        if (streamWriteInFlightRef.current) return
        const from = Math.max(0, Math.min(streamCursorRef.current, linesWithJsonFallback.length))
        if (from >= linesWithJsonFallback.length) return
        // Advance only past the lines examined THIS pass (this snapshot's length), not the
        // live ref length. Lines that arrive during the async filter/append are then picked up by
        // a later pass instead of being skipped over.
        const examinedEnd = linesWithJsonFallback.length
        const newTexts = linesWithJsonFallback.slice(from).map((line) => line.text)
        const filter = streamFilterRef.current
        // Single-in-flight: hold the gate across the async filter AND the append so batches stay
        // strictly ordered (the worker preserves input order, so writes remain FIFO).
        streamWriteInFlightRef.current = true
        void (async () => {
            try {
                // Filter this batch in the regex worker so a catastrophic pattern on a future line
                // cannot freeze the renderer. On timeout the worker is terminated and streaming
                // continues UNFILTERED from then on (one-time warning); line order is never disturbed.
                let kept: string[]
                if (!filter || streamFilterTimedOutRef.current) {
                    kept = newTexts
                } else {
                    if (!streamClientRef.current) streamClientRef.current = createRegexMatchClient()
                    const outcome = await streamClientRef.current.filter(filter.source, filter.flags, newTexts)
                    if (outcome.status === 'ok') {
                        kept = outcome.value.map((index) => newTexts[index]!)
                    } else {
                        streamFilterTimedOutRef.current = true
                        appendWarning('Filter pattern too slow on a streamed line; writing subsequent lines unfiltered.')
                        kept = newTexts
                    }
                }
                if (kept.length === 0) {
                    streamCursorRef.current = examinedEnd
                    return
                }
                const ok = await window.rokdock.dialog.appendFile(streamFilePath, kept.join('\n') + '\n')
                if (ok) streamCursorRef.current = examinedEnd
            } finally {
                streamWriteInFlightRef.current = false
            }
        })()
    }, [linesWithJsonFallback, streamFilePath, appendWarning])

    useEffect(() => {
        const unsubData = window.rokdock.terminal.onData((id: string, chunk: TerminalLineChunk) => {
            if (id !== tab.id) return
            if (tab.status === 'connecting') updateTabStatus(id, 'connected')
            const state = useAppStore.getState()
            const pane = tab.paneId === 'a' ? state.paneA : state.paneB
            if (pane?.activeTabId !== id) {
                if (markActivityRafRef.current == null) {
                    markActivityRafRef.current = window.requestAnimationFrame(() => {
                        markActivityRafRef.current = null
                        const latestState = useAppStore.getState()
                        const latestPane = tab.paneId === 'a' ? latestState.paneA : latestState.paneB
                        if (latestPane?.activeTabId !== tab.id) {
                            markTabActivity(tab.id)
                        }
                    })
                }
            }
            appendLine(chunk)
        })
        const unsubExit = window.rokdock.terminal.onExit((id: string, exitCode: number) => {
            if (id !== tab.id) return
            updateTabStatus(id, 'disconnected')
            streamCursorRef.current = linesWithJsonFallbackRef.current.length
            streamFilterRef.current = null
            streamFilterTimedOutRef.current = false
            setStreamFilePath(null)
            appendLine({
                text: `Process exited (code ${exitCode})`,
                tokens: [{ start: 0, end: `Process exited (code ${exitCode})`.length, kind: 'warning' }],
                overlays: []
            })
        })
        const unsubStatus = window.rokdock.terminal.onStatus((id: string, status: string) => {
            if (id === tab.id) updateTabStatus(id, status as TabInfo['status'])
        })
        const unsubMenu = window.rokdock.contextMenu.onAction((tabId: string, action: string) => {
            if (tabId !== tab.id) return
            if (action === 'copy') {
                const text = getSelectedText()
                if (text) void navigator.clipboard.writeText(text)
            } else if (action === 'paste') {
                void navigator.clipboard.readText().then((text) => setInput((prev) => prev + text))
            } else if (action === 'select-all' && outputRef.current) {
                const range = document.createRange()
                range.selectNodeContents(outputRef.current)
                const selection = window.getSelection()
                selection?.removeAllRanges()
                selection?.addRange(range)
                // The DOM selection only covers the virtualized rows; this flag tells the copy
                // paths to pull the whole buffer instead.
                selectAllActiveRef.current = true
            } else if (action === 'clear') {
                clearTerminal()
            } else if (action === 'find') {
                toggleSearch(tab.id)
            } else if (action === 'toggle-filter') {
                setFilterVisible((prev) => !prev)
            } else if (action === 'toggle-autoscroll') {
                toggleTabAutoScroll(tab.id)
            } else if (action === 'toggle-wordwrap') {
                toggleTabWordWrap(tab.id)
            } else if (action === 'disconnect') {
                void window.rokdock.terminal.kill(tab.id)
            } else if (action === 'reconnect') {
                updateTabStatus(tab.id, 'connecting')
                void window.rokdock.terminal
                    .reconnect(tab.id, tab.deviceIp, tab.deviceName, tab.port)
                    .catch(() => updateTabStatus(tab.id, 'error'))
            } else if (action === 'save-output') {
                // Prompt for an optional line filter before saving (empty = every line).
                setFilterPrompt({ mode: 'save', sampleLines: linesWithJsonFallbackRef.current.map((line) => line.text) })
            } else if (action === 'start-stream-output') {
                // Prompt for an optional line filter before choosing the stream file.
                setFilterPrompt({ mode: 'stream', sampleLines: linesWithJsonFallbackRef.current.map((line) => line.text) })
            } else if (action === 'stop-stream-output') {
                streamCursorRef.current = linesWithJsonFallbackRef.current.length
                streamFilterRef.current = null
                streamFilterTimedOutRef.current = false
                setStreamFilePath(null)
                appendLine({
                    text: 'Stopped streaming terminal output.',
                    tokens: [{ start: 0, end: 'Stopped streaming terminal output.'.length, kind: 'info' }],
                    overlays: []
                })
            } else if (action === 'lookup-docs') {
                const term = qualifyingLookupTerm()
                if (term) void window.rokdock.docs.lookUp(term)
            } else if (action === 'explain') {
                const selection = window.getSelection()?.toString() ?? ''
                if (selection.trim()) void openChatWith(wrapInCodeFence(selection, 'roku-console'))
            }
        })
        return () => {
            if (markActivityRafRef.current != null) {
                window.cancelAnimationFrame(markActivityRafRef.current)
                markActivityRafRef.current = null
            }
            unsubData()
            unsubExit()
            unsubStatus()
            unsubMenu()
        }
    }, [
        appendLine,
        clearTerminal,
        getSelectedText,
        markTabActivity,
        streamFilePath,
        tab.deviceIp,
        tab.deviceName,
        tab.id,
        tab.paneId,
        tab.port,
        tab.status,
        openChatWith,
        toggleSearch,
        toggleTabAutoScroll,
        toggleTabWordWrap,
        updateTabStatus
    ])

    // Save the current buffer, keeping only the lines matching the chosen filter. Filtering runs in
    // the regex worker: the buffer can grow between opening the dialog and confirming, so a pattern
    // the dialog validated may still meet an unseen line here. A too-slow pattern aborts the save
    // (the worker is terminated) instead of freezing the app.
    const handleFilteredSave = async (regex: RegExp | null) => {
        setFilterPrompt(null)
        const texts = linesWithJsonFallbackRef.current.map((line) => line.text)
        let content: string
        if (!regex) {
            content = texts.join('\n')
        } else {
            const outcome = await ensureFilterClient().filter(regex.source, regex.flags, texts)
            if (outcome.status === 'timeout') { appendWarning('Filter pattern too slow; save aborted.'); return }
            if (outcome.status !== 'ok') return // invalid: the dialog gates this, so treat as a no-op
            content = outcome.value.map((index) => texts[index]!).join('\n')
        }
        const ok = await window.rokdock.dialog.saveFile(buildLogFilename(tab.deviceIp, tab.port), content)
        if (!ok) appendWarning('Save output canceled or failed.')
    }

    // Begin streaming to a chosen file, writing only lines matching the chosen filter.
    const handleFilteredStream = (regex: RegExp | null) => {
        setFilterPrompt(null)
        void window.rokdock.dialog.pickSavePath(buildLogFilename(tab.deviceIp, tab.port, 'stream')).then((filePath: string | null) => {
            if (!filePath) return
            streamFilterRef.current = regex
            streamFilterTimedOutRef.current = false
            streamCursorRef.current = linesWithJsonFallbackRef.current.length
            setStreamFilePath(filePath)
            const message = `Streaming terminal output to: ${filePath}${regex ? ` (filter: ${regex.source})` : ''}`
            appendLine({ text: message, tokens: [{ start: 0, end: message.length, kind: 'info' }], overlays: [] })
        })
    }

    // Depend on lines, not linesWithJsonFallback: the latter also gets a new array
    // reference whenever the background JSON-hover-fallback cache finishes merging (see
    // jsonFallbackGen above), which has nothing to do with new output arriving. Firing
    // this effect on that unrelated churn snapped the view to the bottom mid-scroll or
    // mid-selection, destroying whatever the user was doing the moment that background
    // merge happened to complete.
    useEffect(() => {
        if (!tab.autoScroll || !viewportRef.current) return
        viewportRef.current.scrollTop = viewportRef.current.scrollHeight
    }, [lines, tab.autoScroll])

    useEffect(() => {
        if (isActive) inputRef.current?.focus()
    }, [isActive])

    useEffect(() => {
        if (!searchVisible) return
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
    }, [searchVisible])

    useEffect(() => {
        if (!filterVisible) return
        filterInputRef.current?.focus()
        filterInputRef.current?.select()
    }, [filterVisible])

    useEffect(() => {
        if (prevSearchVisibleRef.current && !searchVisible) {
            window.requestAnimationFrame(() => {
                containerRef.current?.focus()
            })
        }
        prevSearchVisibleRef.current = searchVisible
    }, [searchVisible])

    /** Hide the inline search bar and clear search state for this tab. */
    const closeSearchBar = useCallback(() => {
        setSearchVisible(tab.id, false)
    }, [setSearchVisible, tab.id])

    // Ctrl/Cmd+F opens Find, Ctrl/Cmd+Shift+F toggles the live filter bar. One listener, since
    // the two shortcuts differ only in the shift modifier and share every guard (same key, same
    // "the event started inside this terminal" containment check). The context menu's
    // accelerator labels are decorative for a popup menu (Electron does not bind them globally),
    // so this listener is the real trigger for both.
    useEffect(() => {
        if (!isActive) return
        const onKeyDown = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey) return
            if (event.key.toLowerCase() !== 'f') return
            const container = containerRef.current
            const target = event.target as Node | null
            if (!container || !target || !container.contains(target)) return
            event.preventDefault()
            if (event.shiftKey) setFilterVisible((prev) => !prev)
            else setSearchVisible(tab.id, true)
        }
        window.addEventListener('keydown', onKeyDown, true)
        return () => window.removeEventListener('keydown', onKeyDown, true)
    }, [isActive, setSearchVisible, tab.id])

    useEffect(() => {
        if (!searchVisible) {
            setSearchQuery('')
            setSearchCursor(0)
        }
    }, [searchVisible])

    const closeFilterBar = useCallback(() => {
        setFilterVisible(false)
    }, [])

    useEffect(() => {
        if (!filterVisible) {
            setFilterPatternText('')
            setFilterHistoryIndex(null)
            setFilterHistoryDraft('')
            setFilterHistoryMenuOpen(false)
        }
    }, [filterVisible])

    useDismissOnOutsideMouseDown(historyMenuOpen, inputBarRef, setHistoryMenuOpen)
    useDismissOnOutsideMouseDown(filterHistoryMenuOpen, filterBarRef, setFilterHistoryMenuOpen)

    useEffect(() => {
        if (searchMatches.length === 0) {
            setSearchCursor(0)
            return
        }
        if (searchCursor >= searchMatches.length) {
            setSearchCursor(searchMatches.length - 1)
        }
    }, [searchCursor, searchMatches.length])

    useEffect(() => {
        if (!activeSearchMatch) return
        const output = outputRef.current
        const viewport = viewportRef.current
        if (!output || !viewport) return

        const selector = `[data-line-index="${activeSearchMatch.lineIndex}"]`
        const existing = output.querySelector(selector) as HTMLElement | null
        if (existing) {
            existing.scrollIntoView({ block: 'nearest' })
            return
        }

        if (!shouldVirtualize) return
        viewport.scrollTop = Math.max(
            0,
            activeSearchMatch.lineIndex * VIRTUAL_LINE_HEIGHT - Math.floor(viewport.clientHeight / 2)
        )
        window.requestAnimationFrame(() => {
            const afterScroll = output.querySelector(selector) as HTMLElement | null
            afterScroll?.scrollIntoView({ block: 'nearest' })
        })
    }, [activeSearchMatch, shouldVirtualize])

    useEffect(() => {
        if (!isActive) return
        const onKeyDown = (event: KeyboardEvent) => {
            if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
            if (event.key.toLowerCase() !== 'c') return
            const container = containerRef.current
            if (!container) return
            const target = event.target as Node | null
            if (!target || !container.contains(target)) return
            event.preventDefault()
            clearTerminal()
        }
        window.addEventListener('keydown', onKeyDown, true)
        return () => window.removeEventListener('keydown', onKeyDown, true)
    }, [clearTerminal, isActive])

    /**
     * Advance the active search match cursor by `direction` (+1 = forward, -1 =
     * backward), wrapping around at both ends of the match list. The viewport
     * scroll-to-match effect fires reactively via the activeSearchMatch dependency.
     */
    const goToSearchMatch = useCallback((direction: 1 | -1) => {
        if (searchMatches.length === 0) return
        setSearchCursor((prev) => {
            const next = prev + direction
            if (next < 0) return searchMatches.length - 1
            if (next >= searchMatches.length) return 0
            return next
        })
    }, [searchMatches.length])

    /**
     * Wrap the text of a single render segment with search-highlight spans.
     * Splits the text at every search-match boundary that overlaps this segment,
     * rendering non-matching runs with `colorStyleFor(color)` and matching runs
     * with the theme's searchHighlightMatch (or searchHighlightActive) background.
     * Returns a plain span when there are no overlapping matches.
     *
     * @param lineIndex - Index of the owning line in the buffer (for match lookup).
     * @param segmentStart - Character offset of the segment within the full line text.
     * @param text - The segment text to render.
     * @param color - Foreground color for non-highlighted characters.
     * @param keyPrefix - Stable React key prefix to avoid key collisions.
     */
    const highlightSegmentText = useCallback(
        (
            lineIndex: number,
            segmentStart: number,
            text: string,
            color: string,
            keyPrefix: string
        ): React.ReactNode => {
            const segmentEnd = segmentStart + text.length
            const matches = lineMatchesByIndex.get(lineIndex)
            if (!matches || matches.length === 0) return <span style={colorStyleFor(color)}>{text}</span>
            const overlapping = matches.filter((match) => rangesOverlap(segmentStart, segmentEnd, match.start, match.end))
            if (overlapping.length === 0) return <span style={colorStyleFor(color)}>{text}</span>

            const nodes: React.ReactNode[] = []
            let cursor = segmentStart
            let part = 0
            for (const match of overlapping) {
                const from = Math.max(segmentStart, match.start)
                const to = Math.min(segmentEnd, match.end)
                if (from > cursor) {
                    const startOffset = cursor - segmentStart
                    const endOffset = from - segmentStart
                    nodes.push(
                        <span key={`${keyPrefix}:plain:${part++}`} style={colorStyleFor(color)}>
                            {text.slice(startOffset, endOffset)}
                        </span>
                    )
                }

                const startOffset = from - segmentStart
                const endOffset = to - segmentStart
                const isActive = !!activeSearchMatch
                    && activeSearchMatch.lineIndex === lineIndex
                    && activeSearchMatch.start === match.start
                    && activeSearchMatch.end === match.end
                nodes.push(
                    <span
                        key={`${keyPrefix}:hit:${part++}`}
                        style={{
                            color,
                            background: isActive ? 'var(--rokdock-search-highlight-active)' : 'var(--rokdock-search-highlight-match)',
                            borderRadius: 2
                        }}
                    >
                        {text.slice(startOffset, endOffset)}
                    </span>
                )
                cursor = to
            }

            if (cursor < segmentEnd) {
                const startOffset = cursor - segmentStart
                nodes.push(
                    <span key={`${keyPrefix}:tail`} style={colorStyleFor(color)}>
                        {text.slice(startOffset)}
                    </span>
                )
            }
            return nodes
        },
        [activeSearchMatch, colorStyleFor, lineMatchesByIndex]
    )

    /**
     * Open the standalone JSON viewer window/tab for the given pretty-printed
     * JSON value. The viewer reads the persisted code-surface appearance (font,
     * syntax theme, background) on boot, which matches the terminal because both
     * come from the same prefs, so no appearance is passed here.
     */
    const openJsonViewer = useCallback((jsonValue: string) => {
        void window.rokdock.json.addTab(jsonValue)
    }, [])

    /**
     * Set the URL that is pending user confirmation before being opened in the
     * system browser. Triggers the ConfirmDialog overlay.
     */
    const requestOpenExternalUrl = useCallback((url: string | null) => {
        setPendingExternalUrl(url)
    }, [])

    const styles = useMemo(() => buildStyles(), [])

    return (
        <>
            <div
                ref={containerRef}
                style={{
                    ...styles.container,
                    background: terminalUseThemeBackground ? syntaxTheme.background : 'var(--rokdock-bg-terminal)'
                }}
                tabIndex={0}
                onContextMenu={(e) => {
                    setSelectionAnchor(null)
                    e.preventDefault()
                    const selectionText = window.getSelection()?.toString() ?? ''
                    window.rokdock.contextMenu.showTerminalMenu({
                        tabId: tab.id,
                        autoScroll: tab.autoScroll,
                        wordWrap: tab.wordWrap,
                        hasSelection: !!selectionText,
                        lookupEligible: selectionQualifiesForLookup(selectionText),
                        aiAvailable: aiConfigured,
                        isDisconnected: tab.status === 'disconnected',
                        isStreaming: !!streamFilePath
                    })
                }}
            >
                {searchVisible && (
                    <div style={styles.searchBar}>
                        <input
                            ref={searchInputRef}
                            className="terminal-search-input"
                            style={styles.searchInput}
                            type="text"
                            placeholder="Search..."
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value)
                                setSearchCursor(0)
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                    closeSearchBar()
                                } else if (e.key === 'Enter') {
                                    e.preventDefault()
                                    goToSearchMatch(e.shiftKey ? -1 : 1)
                                }
                            }}
                        />
                        <div style={styles.searchOptionGroup}>
                            <button
                                style={{ ...styles.searchOptionBtn, ...(searchMatchCase ? styles.searchOptionBtnActive : {}) }}
                                title="Match Case"
                                onClick={() => {
                                    setSearchMatchCase((prev) => !prev)
                                    setSearchCursor(0)
                                }}
                            >
                                Aa
                            </button>
                            <button
                                style={{ ...styles.searchOptionBtn, ...(searchWholeWord ? styles.searchOptionBtnActive : {}) }}
                                title="Match Whole Word"
                                onClick={() => {
                                    setSearchWholeWord((prev) => !prev)
                                    setSearchCursor(0)
                                }}
                            >
                                W
                            </button>
                            <button
                                style={{ ...styles.searchOptionBtn, ...(searchRegex ? styles.searchOptionBtnActive : {}) }}
                                title="Use Regex"
                                onClick={() => {
                                    setSearchRegex((prev) => !prev)
                                    setSearchCursor(0)
                                }}
                            >
                                .*
                            </button>
                        </div>
                        <span style={styles.searchSeparator} aria-hidden="true" />
                        <span style={styles.searchCount}>
                            {searchRegexError ?? (searchMatches.length === 0 ? '0 / 0' : `${searchCursor + 1} / ${searchMatches.length}`)}
                        </span>
                        <div style={styles.searchIconGroup}>
                            <button style={styles.searchNavBtn} title="Previous" onClick={() => goToSearchMatch(-1)}><FontAwesomeIcon icon={faCaretUp} /></button>
                            <button style={styles.searchNavBtn} title="Next" onClick={() => goToSearchMatch(1)}><FontAwesomeIcon icon={faCaretDown} /></button>
                            <button style={styles.searchCloseBtn} title="Close search" onClick={closeSearchBar}><FontAwesomeIcon icon={faXmark} /></button>
                        </div>
                    </div>
                )}
                {filterVisible && (
                    <div ref={filterBarRef} style={styles.searchBar}>
                        <input
                            ref={filterInputRef}
                            className="terminal-filter-input"
                            style={styles.searchInput}
                            type="text"
                            placeholder="Filter regex (empty = show all lines)..."
                            aria-label="Filter terminal output"
                            value={filterPatternText}
                            onChange={(e) => {
                                if (filterHistoryIndex !== null) setFilterHistoryIndex(null)
                                setFilterPatternText(e.target.value)
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') { closeFilterBar(); return }
                                if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
                                const step = walkInputHistory({
                                    entries: terminalFilterHistory,
                                    index: filterHistoryIndex,
                                    direction: e.key === 'ArrowUp' ? 'older' : 'newer',
                                    currentText: filterPatternText,
                                    draft: filterHistoryDraft
                                })
                                if (!step) return
                                e.preventDefault()
                                if (step.draft !== undefined) setFilterHistoryDraft(step.draft)
                                setFilterHistoryIndex(step.index)
                                setFilterPatternText(step.text)
                            }}
                        />
                        <span style={styles.searchSeparator} aria-hidden="true" />
                        <span style={{ ...styles.searchCount, ...(liveFilterState.error ? { color: 'var(--rokdock-error-text)' } : {}) }}>
                            {liveFilterState.error
                                ?? (filteredLineIndices ? `${filteredLineIndices.length} / ${linesWithJsonFallback.length}` : 'showing all')}
                        </span>
                        <div style={styles.searchIconGroup}>
                            <button
                                type="button"
                                className="terminal-filter-history-toggle"
                                style={styles.historyToggleBtn}
                                title="Filter history"
                                onClick={() => {
                                    setFilterHistoryMenuOpen((prev) => !prev)
                                    filterInputRef.current?.focus()
                                }}
                                disabled={terminalFilterHistory.length === 0}
                            >
                                <FontAwesomeIcon icon={faClockRotateLeft} />
                            </button>
                            <button style={styles.searchCloseBtn} title="Close filter" onClick={closeFilterBar}><FontAwesomeIcon icon={faXmark} /></button>
                        </div>
                        {filterHistoryMenuOpen && terminalFilterHistory.length > 0 && (
                            <div className="terminal-filter-history-flyout" style={styles.filterHistoryFlyout}>
                                {[...terminalFilterHistory].slice(-20).reverse().map((pattern) => (
                                    <button
                                        key={pattern}
                                        style={styles.historyItem}
                                        onMouseDown={(e) => {
                                            e.preventDefault()
                                            setFilterHistoryIndex(null)
                                            setFilterPatternText(pattern)
                                            setFilterHistoryMenuOpen(false)
                                            filterInputRef.current?.focus()
                                        }}
                                    >
                                        {pattern}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                <div
                    ref={viewportRef}
                    className="terminal-viewport-scroll"
                    title={
                        isActive && !jsonHoverDetectEnabled
                            ? 'Move the pointer here to detect multi-line JSON in the output'
                            : undefined
                    }
                    onPointerEnter={() => {
                        if (isActive) setJsonHoverDetectEnabled(true)
                    }}
                    onMouseDown={onOutputMouseDown}
                    onMouseUp={onOutputMouseUp}
                    onScroll={onViewportScroll}
                    style={{
                        ...styles.viewport,
                        whiteSpace: tab.wordWrap ? 'pre-wrap' : 'pre',
                        overflowWrap: tab.wordWrap ? 'anywhere' : 'normal',
                        wordBreak: tab.wordWrap ? 'break-word' : 'normal'
                    }}
                >
                    <div ref={outputRef} style={{ ...styles.output, fontFamily: terminalFontFamily || 'var(--rokdock-font-mono)', fontSize: terminalFontSize }}>
                        {virtualTopSpacer > 0 && (
                            <div style={{ height: virtualTopSpacer }} aria-hidden="true" />
                        )}
                        {visibleRows.map((row) => (
                            <TerminalOutputLine
                                key={row.line.id ?? `${row.lineIndex}-${row.line.text.length}`}
                                line={row.line}
                                lineIndex={row.lineIndex}
                                groups={row.groups}
                                isMatchedLine={row.isMatchedLine}
                                isActiveMatchLine={row.isActiveMatchLine}
                                isAppRunStart={row.isAppRunStart}
                                dividerGradient={row.dividerGradient}
                                showAppRunOverlay={row.showAppRunOverlay}
                                styles={styles}
                                outputRef={outputRef}
                                tokenColor={tokenColor}
                                syntaxTheme={syntaxTheme}
                                highlightSegmentText={highlightSegmentText}
                                colorStyleFor={colorStyleFor}
                                openJsonViewer={openJsonViewer}
                                requestOpenExternalUrl={requestOpenExternalUrl}
                            />
                        ))}
                        {virtualBottomSpacer > 0 && (
                            <div style={{ height: virtualBottomSpacer }} aria-hidden="true" />
                        )}
                    </div>
                </div>
                <div ref={inputBarRef} style={styles.inputBar}>
                    <input
                        ref={inputRef}
                        style={{ ...styles.commandInput, fontFamily: terminalFontFamily || 'var(--rokdock-font-mono)', fontSize: terminalFontSize }}
                        value={input}
                        onChange={(e) => {
                            if (historyIndex !== null) setHistoryIndex(null)
                            setInput(e.target.value)
                        }}
                        onKeyDown={(e) => {
                            // Alt+C is handled by the container-level keydown listener (capture
                            // phase, fires before this), which also covers the command input
                            // since it sits inside containerRef. No separate handling here.
                            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
                                const target = inputRef.current
                                const hasSelection = !!target && target.selectionStart !== target.selectionEnd
                                if (!hasSelection) {
                                    e.preventDefault()
                                    window.rokdock.terminal.write(tab.id, '\x03')
                                    return
                                }
                            }

                            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                const step = walkInputHistory({
                                    entries: terminalCommandHistory,
                                    index: historyIndex,
                                    direction: e.key === 'ArrowUp' ? 'older' : 'newer',
                                    currentText: input,
                                    draft: historyDraft
                                })
                                if (!step) return
                                e.preventDefault()
                                if (step.draft !== undefined) setHistoryDraft(step.draft)
                                setHistoryIndex(step.index)
                                setInput(step.text)
                                return
                            }

                            if (e.key === 'Enter') {
                                e.preventDefault()
                                submitCommand()
                            }
                        }}
                        placeholder={tab.status === 'connected' ? 'Enter command...' : 'Terminal disconnected'}
                        disabled={tab.status === 'disconnected'}
                    />
                    <button
                        type="button"
                        style={styles.historyToggleBtn}
                        title="Command history"
                        onClick={() => {
                            setHistoryMenuOpen((prev) => !prev)
                            inputRef.current?.focus()
                        }}
                        disabled={terminalCommandHistory.length === 0}
                    >
                        <FontAwesomeIcon icon={faClockRotateLeft} />
                    </button>
                    {historyMenuOpen && terminalCommandHistory.length > 0 && (
                        <div style={styles.historyFlyout}>
                            {[...terminalCommandHistory].slice(-20).reverse().map((command) => (
                                <button
                                    key={command}
                                    style={styles.historyItem}
                                    onMouseDown={(e) => {
                                        e.preventDefault()
                                        setInput(command)
                                        setHistoryMenuOpen(false)
                                        inputRef.current?.focus()
                                    }}
                                >
                                    {command}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                {selectionAnchor && toolbarHovered && (
                    <TerminalSelectionToolbar
                        rootRef={toolbarElRef}
                        anchor={{ x: selectionAnchor.x, y: selectionAnchor.y }}
                        selection={selectionAnchor.selection}
                        term={selectionAnchor.term}
                        aiAvailable={aiConfigured}
                        onCopy={() => {
                            const text = getSelectedText()
                            if (text) void navigator.clipboard.writeText(text)
                            setSelectionAnchor(null)
                        }}
                        onLookup={() => {
                            if (selectionAnchor.term) void window.rokdock.docs.lookUp(selectionAnchor.term)
                            setSelectionAnchor(null)
                        }}
                        onExplain={() => {
                            void openChatWith(wrapInCodeFence(selectionAnchor.selection, 'roku-console'))
                            setSelectionAnchor(null)
                        }}
                        onClose={() => setSelectionAnchor(null)}
                    />
                )}
            </div>
            <RegexFilterDialog
                open={!!filterPrompt}
                title={filterPrompt?.mode === 'stream' ? 'Stream Output to File' : 'Save Output'}
                description={filterPrompt?.mode === 'stream'
                    ? 'Pick a file to stream this terminal to. Optionally filter which lines get written.'
                    : 'Save the current terminal output. Optionally filter which lines get written.'}
                confirmLabel={filterPrompt?.mode === 'stream' ? 'Choose File...' : 'Save...'}
                sampleLines={filterPrompt?.sampleLines}
                initialPattern={filterVisible ? filterPatternText : ''}
                countMatches={(source, flags, lines) => ensureFilterClient().filter(source, flags, lines)}
                onCancel={() => setFilterPrompt(null)}
                onConfirm={(regex) => {
                    if (filterPrompt?.mode === 'stream') void handleFilteredStream(regex)
                    else void handleFilteredSave(regex)
                }}
            />
            <ConfirmDialog
                open={!!pendingExternalUrl}
                title="Open External Link"
                width={580}
                message="Open this URL in your browser?"
                confirmLabel="Open Link"
                onCancel={() => { setPendingExternalUrl(null); setUrlCopied(false) }}
                onConfirm={() => {
                    if (pendingExternalUrl) void window.rokdock.external.openUrl(pendingExternalUrl)
                    setPendingExternalUrl(null)
                    setUrlCopied(false)
                }}
            >
                {pendingExternalUrl && (
                    <>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: -4 }}>
                            <span style={{ fontSize: 'var(--rokdock-font-xxs)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--rokdock-text-muted)' }}>URL</span>
                            <button
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: urlCopied ? 'var(--rokdock-state-online)' : 'var(--rokdock-text-muted)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--rokdock-font-ui)' }}
                                onClick={() => {
                                    void navigator.clipboard.writeText(pendingExternalUrl)
                                    setUrlCopied(true)
                                    window.setTimeout(() => setUrlCopied(false), 2000)
                                }}
                            >
                                <FontAwesomeIcon icon={urlCopied ? faCheck : faCopy} />
                                {urlCopied ? 'Copied' : 'Copy'}
                            </button>
                        </div>
                        <div style={{
                            fontFamily: 'var(--rokdock-font-mono)',
                            fontSize: 'var(--rokdock-font-xs)',
                            color: 'var(--rokdock-text-dim)',
                            background: 'var(--rokdock-bg-input)',
                            border: '1px solid var(--rokdock-border)',
                            borderRadius: 'var(--rokdock-radius-sm)',
                            padding: '6px 8px',
                            wordBreak: 'break-all',
                            maxHeight: 120,
                            overflowY: 'auto',
                            lineHeight: 1.5
                        }}>
                            {pendingExternalUrl}
                        </div>
                        <ExternalUrlQueryParams url={pendingExternalUrl} />
                    </>
                )}
            </ConfirmDialog>
        </>
    )
}

/**
 * Custom React.memo equality function for CustomTerminalView. Ignores the
 * `hasActivity` field (used only by the tab-row badge) so that unread-activity
 * pulses on an inactive tab do not force a re-render of the terminal content.
 */
function terminalTabVisualPropsEqual(
    prev: { tab: TabInfo; isActive: boolean },
    next: { tab: TabInfo; isActive: boolean }
): boolean {
    if (prev.isActive !== next.isActive) return false
    const prevTab = prev.tab
    const nextTab = next.tab
    return (
        prevTab.id === nextTab.id
        && prevTab.deviceIp === nextTab.deviceIp
        && prevTab.deviceName === nextTab.deviceName
        && prevTab.port === nextTab.port
        && prevTab.status === nextTab.status
        && prevTab.autoScroll === nextTab.autoScroll
        && prevTab.wordWrap === nextTab.wordWrap
    )
}

export default React.memo(CustomTerminalView, terminalTabVisualPropsEqual)

/**
 * Compute the full set of inline style objects for the terminal UI.
 * Extracted from the component body so it can be memoized with useMemo and
 * shared down to TerminalOutputLine without triggering extra re-renders.
 * Style values come from the --rokdock-* CSS variables, so it takes no arguments.
 */
function buildStyles(): Record<string, React.CSSProperties> {
    const monoInput: React.CSSProperties = {
        padding: '6px 8px',
        border: '1px solid var(--rokdock-border)',
        borderRadius: 'var(--rokdock-radius-md)',
        background: 'var(--rokdock-bg-input)',
        color: 'var(--rokdock-text-primary)',
        fontSize: 12,
        fontFamily: 'var(--rokdock-font-mono)',
        outline: 'none',
        transition: 'border-color var(--rokdock-transition-fast), box-shadow var(--rokdock-transition-fast)'
    }
    const smallBtn: React.CSSProperties = {
        width: 22,
        height: 22,
        border: 'none',
        borderRadius: 'var(--rokdock-radius-sm)',
        background: 'transparent',
        color: 'var(--rokdock-text-dim)',
        fontSize: 11,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
    }
    // Lets a row paint past the viewport's own horizontal padding (negative margin, compensated
    // by equal padding so the line's text does not shift) so an app-run tint or divider reaches
    // the true edges instead of stopping at the viewport's inset content box.
    const edgeToEdgeBleed: React.CSSProperties = {
        margin: `0 -${VIEWPORT_HORIZONTAL_PADDING}px`,
        padding: `0 ${VIEWPORT_HORIZONTAL_PADDING}px`
    }
    // Shared chrome for the two history flyouts. Each adds its own vertical anchoring: the
    // command history opens upward from the input bar pinned to the very bottom, the filter
    // history opens downward from the filter bar at the top.
    const historyFlyoutChrome: React.CSSProperties = {
        position: 'absolute',
        right: 0,
        minWidth: 280,
        maxWidth: '70%',
        maxHeight: 220,
        overflowY: 'auto',
        background: 'var(--rokdock-bg-panel)',
        borderLeft: '1px solid var(--rokdock-border)',
        borderRight: '1px solid var(--rokdock-border)',
        zIndex: 5
    }
    return {
        container: { display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: 'var(--rokdock-bg-terminal)' },
        searchBar: { display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', background: 'linear-gradient(90deg, var(--rokdock-bg-surface) 0%, var(--rokdock-bg-panel) 100%)', borderBottom: '1px solid var(--rokdock-border)', boxShadow: '0 1px 4px var(--rokdock-shadow-subtle)', position: 'relative' },
        searchInput: { ...monoInput, flex: 1, padding: '3px 5px' },
        searchOptionGroup: { display: 'flex', alignItems: 'center', gap: 2 },
        searchOptionBtn: {
            ...smallBtn,
            minWidth: 24,
            height: 20,
            padding: '0 5px',
            fontSize: 'var(--rokdock-font-xxs)',
            fontFamily: 'var(--rokdock-font-ui)'
        },
        searchOptionBtnActive: {
            background: 'var(--rokdock-brand-primary)',
            color: 'var(--rokdock-text-bright)',
            borderColor: 'var(--rokdock-brand-primary-dark)'
        },
        searchCount: {
            fontSize: 'var(--rokdock-font-xs)',
            color: 'var(--rokdock-text-muted)',
            fontFamily: 'var(--rokdock-font-mono)',
            minWidth: 52,
            textAlign: 'right'
        },
        searchSeparator: {
            width: 1,
            alignSelf: 'stretch',
            background: 'var(--rokdock-border)',
            opacity: 0.75,
            margin: '0 2px'
        },
        searchNavBtn: { ...smallBtn, fontSize: 'var(--rokdock-font-xxs)' },
        searchCloseBtn: smallBtn,
        searchIconGroup: { display: 'flex', alignItems: 'center', gap: 2 },
        viewport: { flex: 1, minHeight: 0, overflow: 'auto', padding: `8px ${VIEWPORT_HORIZONTAL_PADDING}px` },
        // Render debug output literally: a ligature-capable mono font (e.g. JetBrains
        // Mono) otherwise fuses sequences like -> or != into a single glyph, which
        // misrepresents what the device actually emitted.
        output: { lineHeight: 1.45, userSelect: 'text', fontVariantLigatures: 'none', fontFeatureSettings: '"liga" 0, "calt" 0' },
        line: { minHeight: 18 },
        // The row carrying dividerGradient (a background-image, not a border or box-shadow:
        // neither can draw a line floating away from an edge, and any real geometry here would
        // add to this row's box and desync the fixed-height virtualization math,
        // VIRTUAL_LINE_HEIGHT). buildRunBoundaryGradient bakes the run-tint color change and the
        // divider line into one gradient (bottom-anchored, or centered in a blank line) so they
        // always land on the same pixel. The actual backgroundImage is set alongside this style
        // at the usage site.
        lineAppRunBoundaryBleed: edgeToEdgeBleed,
        // A subtle wash applied across every line of an odd-numbered block (see
        // computeAppRunBoundaries), so consecutive app launches are visually distinguishable
        // as banded regions while scrolling, not just a marker on the one boundary line.
        lineAppRunOverlay: {
            ...edgeToEdgeBleed,
            // backgroundColor, not the background shorthand: a boundary row's backgroundImage
            // can land on the same row, and the shorthand would reset that image back to none.
            backgroundColor: 'var(--rokdock-terminal-launch-banner-bg)'
        },
        // backgroundColor, not the background shorthand, for the same reason as lineAppRunOverlay
        // above: a search match can land on the same row as a boundary row's backgroundImage.
        lineSearchMatch: { backgroundColor: 'var(--rokdock-search-line-bg)', borderRadius: 3 },
        lineSearchActive: { backgroundColor: 'var(--rokdock-search-line-active-bg)', outline: '1px solid var(--rokdock-brand-primary-light)', borderRadius: 3 },
        inputBar: { borderTop: '1px solid var(--rokdock-border)', padding: 0, background: 'var(--rokdock-bg-surface)', position: 'relative', display: 'flex', alignItems: 'center' },
        commandInput: { ...monoInput, flex: 1, width: '100%', borderRadius: 0, border: 'none', padding: '6px 8px' },
        historyToggleBtn: {
            ...smallBtn,
            width: 24,
            height: 24,
            marginRight: 4,
            flexShrink: 0,
            opacity: 0.92
        },
        historyFlyout: {
            ...historyFlyoutChrome,
            bottom: '100%',
            borderTop: '1px solid var(--rokdock-border)',
            boxShadow: '0 -4px 12px var(--rokdock-shadow-subtle)'
        },
        historyItem: {
            width: '100%',
            border: 'none',
            textAlign: 'left',
            padding: '6px 10px',
            background: 'transparent',
            color: 'var(--rokdock-text-primary)',
            fontFamily: 'var(--rokdock-font-mono)',
            fontSize: 'var(--rokdock-font-sm)',
            cursor: 'pointer'
        },
        filterHistoryFlyout: {
            ...historyFlyoutChrome,
            top: '100%',
            borderBottom: '1px solid var(--rokdock-border)',
            boxShadow: '0 4px 12px var(--rokdock-shadow-subtle)'
        }
    }
}
