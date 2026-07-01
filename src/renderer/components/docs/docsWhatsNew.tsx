/**
 * "What's New" view: docs pages changed on the live docs branch within a chosen
 * window, grouped by section, each expandable to its source diff and clickable
 * into the viewer. Rendered in place of the reading pane.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronRight, faArrowRight } from '@fortawesome/free-solid-svg-icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { markdownToPlainText, extractLinkTargets } from '@shared/docs/plainText'
import { wordDiff, type WordDiffSegment } from '@shared/docs/wordDiff'
import type { WhatsNewResult } from '@shared/docs/types'

interface DocsWhatsNewProps {
    loadWhatsNew: (since: string) => Promise<{ result?: WhatsNewResult; error?: string }>
    onOpenPage: (path: string) => void
}

const WINDOW_OPTIONS: { value: number; label: string }[] = [
    { value: 7, label: '7 days' },
    { value: 30, label: '30 days' },
    { value: 90, label: '90 days' },
]

type Status = 'loading' | 'loaded' | 'error'
type DiffMode = 'rendered' | 'source'

// Stable empty array so the memo below doesn't see a new [] reference each render.
const NO_ENTRIES: WhatsNewResult['entries'] = []

const DIFF_MODE_OPTIONS: { value: DiffMode; label: string }[] = [
    { value: 'rendered', label: 'Rendered' },
    { value: 'source', label: 'Source' },
]

/** A select-one pill group (time window, diff view, ...). */
function SegmentedControl<T extends string | number>({ label, options, value, onChange }: {
    label: string
    options: { value: T; label: string }[]
    value: T
    onChange: (value: T) => void
}): React.JSX.Element {
    return (
        <div className="docs-whatsnew-controls" role="group" aria-label={label}>
            {options.map(opt => (
                <button
                    key={opt.value}
                    type="button"
                    className={`docs-whatsnew-window${value === opt.value ? ' docs-whatsnew-window--active' : ''}`}
                    onClick={() => onChange(opt.value)}
                    aria-pressed={value === opt.value}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    )
}

/**
 * One change region. `before`/`after` are the COMPLETE old/new text of the region
 * (context lines interleaved in original order), so markdown structures that span
 * the change (fenced code blocks, lists, tables) stay intact when rendered.
 */
interface Hunk {
    before: string
    after: string
    hasDel: boolean
    hasAdd: boolean
}

/** Drop fully-blank leading/trailing lines (edge context) that render as gaps. */
function trimBlankLines(lines: string[]): string {
    const out = [...lines]
    while (out.length && out[0].trim() === '') out.shift()
    while (out.length && out[out.length - 1].trim() === '') out.pop()
    return out.join('\n')
}

type DiffLineKind = 'gap' | 'meta' | 'add' | 'del' | 'context'

/** Classify one unified-diff line and strip its prefix. The single source of truth
 *  for the diff format, shared by the hunk parser and the source view. */
function classifyDiffLine(line: string): { kind: DiffLineKind; text: string } {
    if (line.startsWith('@@')) return { kind: 'gap', text: line }
    // File headers and the "\ No newline at end of file" marker are not content.
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('\\')) return { kind: 'meta', text: line }
    if (line.startsWith('+')) return { kind: 'add', text: line.slice(1) }
    if (line.startsWith('-')) return { kind: 'del', text: line.slice(1) }
    return { kind: 'context', text: line.startsWith(' ') ? line.slice(1) : line }
}

/** Split a unified diff into hunks, reconstructing each side's full text. */
function parseHunks(patch: string): Hunk[] {
    const hunks: Hunk[] = []
    let before: string[] = []
    let after: string[] = []
    let hasDel = false
    let hasAdd = false
    let open = false
    const flush = (): void => {
        if (open && (before.length || after.length)) {
            hunks.push({ before: trimBlankLines(before), after: trimBlankLines(after), hasDel, hasAdd })
        }
        before = []
        after = []
        hasDel = false
        hasAdd = false
    }
    for (const line of patch.split('\n')) {
        const { kind, text } = classifyDiffLine(line)
        if (kind === 'gap') { flush(); open = true; continue }
        if (kind === 'meta') continue
        if (!open) open = true
        if (kind === 'add') { after.push(text); hasAdd = true }
        else if (kind === 'del') { before.push(text); hasDel = true }
        else { before.push(text); after.push(text) }
    }
    flush()
    return hunks
}

/** A coherent markdown render of one side of a hunk, tinted by change kind. */
function DiffBlock({ kind, text }: { kind: 'del' | 'add' | 'same'; text: string }): React.JSX.Element {
    return (
        <div className={`docs-diff-block docs-diff-block--${kind}`}>
            <div className="docs-prose docs-diff-prose">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={DIFF_MARKDOWN_COMPONENTS}>
                    {text}
                </ReactMarkdown>
            </div>
        </div>
    )
}

/**
 * A change with no edit to the actual content: the prose AND every link/image
 * target are identical, so only markup/formatting differs. A changed href or image
 * src reads as identical plain text, so it is checked separately (otherwise the
 * "Content only" filter would silently hide a retargeted link).
 */
function isInconsequentialHunk(hunk: Hunk): boolean {
    return hunk.hasDel && hunk.hasAdd
        && markdownToPlainText(hunk.before) === markdownToPlainText(hunk.after)
        && extractLinkTargets(hunk.before) === extractLinkTargets(hunk.after)
}

/** True when a page has at least one change that affects the rendered docs. */
function hasContentChange(patch?: string): boolean {
    if (!patch) return true // diff omitted (too large): can't judge, so keep it
    const hunks = parseHunks(patch)
    return hunks.length === 0 || hunks.some(hunk => !isInconsequentialHunk(hunk))
}

/** Render one diff line's word segments, emphasizing the changed words. */
function diffLineContent(segments: WordDiffSegment[]): React.ReactNode {
    if (segments.length === 0) return ' '
    return segments.map((seg, i) =>
        seg.changed ? <span key={i} className="docs-diff-word">{seg.text}</span> : seg.text,
    )
}

/**
 * Source view: line-level tracked changes (precise, shows fence/markup edits).
 * A run of removed lines immediately followed by added lines is a modification:
 * the lines are paired up and only the changed words within each pair are
 * emphasized, so a one-word edit no longer strikes and re-prints the whole line.
 */
const DiffSource = React.memo(function DiffSource({ patch }: { patch: string }): React.JSX.Element {
    const rows: React.JSX.Element[] = []
    let pendingDel: string[] = []
    let pendingAdd: string[] = []
    let key = 0

    // Emit the buffered del/add run, pairing lines positionally for word-diffing.
    const flushPending = (): void => {
        const count = Math.max(pendingDel.length, pendingAdd.length)
        for (let i = 0; i < count; i++) {
            const del = pendingDel[i]
            const add = pendingAdd[i]
            if (del !== undefined && add !== undefined) {
                const { before, after } = wordDiff(del, add)
                rows.push(<div key={key++} className="docs-diff-del">{diffLineContent(before)}</div>)
                rows.push(<div key={key++} className="docs-diff-add">{diffLineContent(after)}</div>)
            } else if (del !== undefined) {
                rows.push(<div key={key++} className="docs-diff-del">{del || ' '}</div>)
            } else {
                rows.push(<div key={key++} className="docs-diff-add">{add || ' '}</div>)
            }
        }
        pendingDel = []
        pendingAdd = []
    }

    for (const line of patch.split('\n')) {
        const { kind, text } = classifyDiffLine(line)
        if (kind === 'meta') continue
        if (kind === 'del') { pendingDel.push(text); continue }
        if (kind === 'add') { pendingAdd.push(text); continue }
        // A context line or hunk boundary closes any open modification run.
        flushPending()
        if (kind === 'gap') {
            if (rows.length > 0) rows.push(<div key={key++} className="docs-diff-gap" aria-hidden="true" />)
        } else {
            rows.push(<div key={key++} className="docs-diff-ctx">{text || ' '}</div>)
        }
    }
    flushPending()

    return <div className="docs-diff">{rows}</div>
})

// Inside a diff preview, links and images are inert: this is a snapshot of a
// change, not a live page, so a link must not navigate the window and a relative
// image src must not 404. Links keep their text (styled), images show alt text.
const DIFF_MARKDOWN_COMPONENTS = {
    a: ({ children }: { children?: React.ReactNode }) => <span className="docs-diff-link">{children}</span>,
    img: ({ alt }: { alt?: string }) => <span className="docs-diff-img">{alt ?? 'image'}</span>,
}

/**
 * Rendered view: per hunk, the full before (removed) and after (added) versions,
 * each rendered as coherent markdown so fences/lists/tables stay intact. A hunk
 * with no removals shows only the after; with no additions, only the before.
 */
const DiffRendered = React.memo(function DiffRendered({ patch, contentOnly }: { patch: string; contentOnly: boolean }): React.JSX.Element {
    // Classify each hunk once (each check scans the markdown), then, when
    // content-only, drop the inconsequential (formatting-only) ones entirely.
    const hunks = parseHunks(patch)
        .map(hunk => ({ hunk, inconsequential: isInconsequentialHunk(hunk) }))
        .filter(({ inconsequential }) => !contentOnly || !inconsequential)
    return (
        <div className="docs-diff docs-diff--rendered">
            {hunks.map(({ hunk, inconsequential }, i) => {
                const gap = i > 0 ? <div className="docs-diff-gap" aria-hidden="true" /> : null
                // Showing everything: a modification whose rendered output is identical
                // (e.g. a fence-language tag) is one neutral block plus a Source pointer.
                if (inconsequential) {
                    return (
                        <React.Fragment key={i}>
                            {gap}
                            <DiffBlock kind="same" text={hunk.after} />
                            <div className="docs-diff-note">
                                No text change (formatting/markup only). Switch to Source to see it.
                            </div>
                        </React.Fragment>
                    )
                }
                return (
                    <React.Fragment key={i}>
                        {gap}
                        {hunk.hasDel && <DiffBlock kind="del" text={hunk.before} />}
                        {hunk.hasAdd && <DiffBlock kind="add" text={hunk.after} />}
                    </React.Fragment>
                )
            })}
        </div>
    )
})

export function DocsWhatsNew({ loadWhatsNew, onOpenPage }: DocsWhatsNewProps): React.JSX.Element {
    const [days, setDays] = useState(30)
    const [status, setStatus] = useState<Status>('loading')
    const [result, setResult] = useState<WhatsNewResult | null>(null)
    const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)
    const [expanded, setExpanded] = useState<Set<string>>(new Set())
    const [diffMode, setDiffMode] = useState<DiffMode>('rendered')
    // Hide pages whose only changes are inconsequential (formatting-only).
    const [contentOnly, setContentOnly] = useState(true)

    const toggleExpanded = useCallback((path: string): void => {
        setExpanded(prev => {
            const next = new Set(prev)
            if (next.has(path)) next.delete(path)
            else next.add(path)
            return next
        })
    }, [])

    const refresh = useCallback(
        (windowDays: number): void => {
            setStatus('loading')
            setExpanded(new Set())
            // Floor to the hour so repeated opens of the same window reuse the
            // service cache instead of issuing a fresh (rate-limited) API call.
            const hourMs = 60 * 60 * 1000
            const sinceMs = Math.floor((Date.now() - windowDays * 24 * hourMs) / hourMs) * hourMs
            const since = new Date(sinceMs).toISOString()
            void loadWhatsNew(since).then(({ result: loaded, error }) => {
                if (error !== undefined || !loaded) {
                    setStatus('error')
                    setErrorMessage(error ?? 'Failed to load changes.')
                    return
                }
                setResult(loaded)
                setStatus('loaded')
            })
        },
        [loadWhatsNew],
    )

    useEffect(() => {
        refresh(days)
    }, [days, refresh])

    // Optionally drop pages with only inconsequential (formatting-only) changes,
    // then group the (already section-sorted) entries by section. Memoized so the
    // per-entry patch parsing only reruns when the data or the filter changes, not
    // on unrelated re-renders (expanding a row, switching diff mode).
    const allEntries = result?.entries ?? NO_ENTRIES
    const shownEntries = useMemo(
        () => (contentOnly ? allEntries.filter(e => hasContentChange(e.patch)) : allEntries),
        [allEntries, contentOnly],
    )
    const hiddenCount = allEntries.length - shownEntries.length
    const groups = useMemo(() => {
        const out: { key: string; pages: WhatsNewResult['entries'] }[] = []
        for (const entry of shownEntries) {
            const last = out[out.length - 1]
            if (last && last.key === entry.section) last.pages.push(entry)
            else out.push({ key: entry.section, pages: [entry] })
        }
        return out
    }, [shownEntries])

    return (
        <div className="docs-reading-pane">
            <div className="docs-pane-header">
                <span className="docs-pane-title">What's New</span>
                <p className="docs-pane-excerpt">Docs pages updated in the live Roku documentation</p>
            </div>

            <div className="docs-pane-body">
                <div className="docs-whatsnew">
                    <div className="docs-whatsnew-toolbar">
                        <SegmentedControl label="Time window" options={WINDOW_OPTIONS} value={days} onChange={setDays} />
                        <SegmentedControl label="Diff view" options={DIFF_MODE_OPTIONS} value={diffMode} onChange={setDiffMode} />
                        <div className="docs-whatsnew-controls" role="group" aria-label="Filter">
                            <button
                                type="button"
                                className={`docs-whatsnew-window${contentOnly ? ' docs-whatsnew-window--active' : ''}`}
                                onClick={() => setContentOnly(current => !current)}
                                aria-pressed={contentOnly}
                                title="Hide pages with no text changes (formatting/markup edits only)"
                            >
                                Content only
                            </button>
                        </div>
                    </div>

                    {status === 'loaded' && result?.stale && (
                        <div className="docs-whatsnew-message docs-whatsnew-subtle">
                            Showing the last cached changes. Could not reach GitHub.
                            {result.staleAsOf
                                ? ` Last updated ${new Date(result.staleAsOf).toLocaleString()}.`
                                : ''}
                        </div>
                    )}

                    {status === 'loading' && (
                        <div className="docs-whatsnew-message">Loading changes...</div>
                    )}

                    {status === 'error' && (
                        <div className="docs-whatsnew-message">
                            {errorMessage}
                            <div className="docs-whatsnew-subtle">
                                GitHub limits unauthenticated requests; if this persists, try again later.
                            </div>
                        </div>
                    )}

                    {status === 'loaded' && shownEntries.length === 0 && (
                        <div className="docs-whatsnew-message">
                            {allEntries.length === 0
                                ? 'No documentation changes in this window.'
                                : 'No text changes in this window (only formatting/markup edits).'}
                        </div>
                    )}

                    {status === 'loaded' && groups.map(group => (
                        <div key={group.key} className="docs-whatsnew-group">
                            <div className="docs-whatsnew-date">{group.key}</div>
                            <ul className="docs-whatsnew-list">
                                {group.pages.map(page => {
                                    const isOpen = expanded.has(page.path)
                                    return (
                                        <li key={page.path}>
                                            <div className="docs-whatsnew-row">
                                                <button
                                                    type="button"
                                                    className={`docs-whatsnew-caret${isOpen ? ' docs-whatsnew-caret--open' : ''}`}
                                                    onClick={() => toggleExpanded(page.path)}
                                                    aria-expanded={isOpen}
                                                    aria-label={isOpen ? 'Hide changes' : 'Show changes'}
                                                >
                                                    <FontAwesomeIcon icon={faChevronRight} />
                                                </button>
                                                <button
                                                    type="button"
                                                    className="docs-whatsnew-link"
                                                    onClick={() => onOpenPage(page.path)}
                                                >
                                                    {page.status === 'added' && (
                                                        <span className="docs-whatsnew-tag">New</span>
                                                    )}
                                                    {page.title}
                                                </button>
                                                <span className="docs-whatsnew-stat">
                                                    {page.additions > 0 && (
                                                        <span className="docs-whatsnew-add">+{page.additions}</span>
                                                    )}
                                                    {page.deletions > 0 && (
                                                        <span className="docs-whatsnew-del">-{page.deletions}</span>
                                                    )}
                                                </span>
                                            </div>
                                            {isOpen && (
                                                <div className="docs-whatsnew-changes">
                                                    {page.patch ? (
                                                        diffMode === 'rendered'
                                                            ? <DiffRendered patch={page.patch} contentOnly={contentOnly} />
                                                            : <DiffSource patch={page.patch} />
                                                    ) : (
                                                        <div className="docs-whatsnew-subtle">
                                                            Diff too large to show inline.
                                                        </div>
                                                    )}
                                                    <button
                                                        type="button"
                                                        className="docs-whatsnew-open"
                                                        onClick={() => onOpenPage(page.path)}
                                                    >
                                                        Open page <FontAwesomeIcon icon={faArrowRight} />
                                                    </button>
                                                </div>
                                            )}
                                        </li>
                                    )
                                })}
                            </ul>
                        </div>
                    ))}

                    {status === 'loaded' && hiddenCount > 0 && (
                        <div className="docs-whatsnew-subtle">
                            {hiddenCount} {hiddenCount === 1 ? 'change' : 'changes'} with no text edits hidden.
                            {' '}
                            <button type="button" className="docs-whatsnew-inline-toggle" onClick={() => setContentOnly(false)}>
                                Show all
                            </button>
                        </div>
                    )}

                    {status === 'loaded' && result && result.truncated && (
                        <div className="docs-whatsnew-subtle">
                            Showing the first {result.entries.length} changes; more exist in this window.
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
