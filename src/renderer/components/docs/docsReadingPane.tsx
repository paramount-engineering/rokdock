/**
 * DocsReadingPane: the main content area of the Developer Docs tool window.
 *
 * Renders a fetched docs page as themed markdown, handles status states
 * (idle, loading, error, not-found), and wires up link routing.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkDirective from 'remark-directive'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { rehypeTableCellMarkdown } from './rehypeTableCellMarkdown'
import { rehypeFieldTable } from './rehypeFieldTable'
import type { DocsPage, DocsLayoutMode } from '@shared/docs/types'
import { preprocessCustomBlocks } from '@shared/docs/customBlocks'
import { resolveDocLink } from '@shared/docs/linkRewrite'
import { CodeBlock } from './codeBlock'
import { useReadingPosition } from './useReadingPosition'
import { rokuDocUrl } from '@shared/docs/rokuDocUrl'
import type { Root, Element as HastElement, ElementContent as HastContent } from 'hast'
import type { Plugin } from 'unified'
import type { Node } from 'unist'
import { visit } from 'unist-util-visit'

// ---------------------------------------------------------------------------
// Callout directive plugin
// ---------------------------------------------------------------------------

// A tiny remark plugin that converts :::callout container directives into
// a div.docs-callout so rehype can render it with the themed callout style.
const remarkCalloutDirective: Plugin<[], Root> = () => {
    return (tree: Node) => {
        visit(tree, 'containerDirective', (node: Node & { name?: string; data?: Record<string, unknown> }) => {
            if (node.name !== 'callout') return
            const data = node.data ?? (node.data = {})
            data.hName = 'div'
            data.hProperties = { className: 'docs-callout' }
        })
    }
}

// A remark plugin that turns ::video{src=... poster=...} leaf directives (emitted
// by preprocessCustomBlocks for <video> tags) into a real <video controls> node.
const remarkVideoDirective: Plugin<[], Root> = () => {
    return (tree: Node) => {
        visit(tree, 'leafDirective', (node: Node & { name?: string; attributes?: Record<string, string | null | undefined>; data?: Record<string, unknown> }) => {
            if (node.name !== 'video') return
            const attrs = node.attributes ?? {}
            if (!attrs.src) return
            const data = node.data ?? (node.data = {})
            data.hName = 'video'
            data.hProperties = {
                src: attrs.src,
                ...(attrs.poster ? { poster: attrs.poster } : {}),
                ...(attrs.width ? { width: attrs.width } : {}),
                ...(attrs.height ? { height: attrs.height } : {}),
                controls: true,
                className: 'docs-video',
            }
        })
    }
}

// ---------------------------------------------------------------------------
// Sanitize schema
// ---------------------------------------------------------------------------

// Extend the default schema to allow className on div. This is required for
// the `docs-callout` class emitted by the remarkCalloutDirective plugin
// (:::callout container directives). Syntax-highlight token colors are NOT
// handled here: the highlighter injects markup via dangerouslySetInnerHTML in
// codeBlock.tsx, which bypasses the rehype-sanitize pipeline entirely.
const sanitizeSchema = {
    ...defaultSchema,
    tagNames: [...(defaultSchema.tagNames ?? []), 'video'],
    attributes: {
        ...defaultSchema.attributes,
        div: [
            ...(defaultSchema.attributes?.div ?? []),
            ['className', 'docs-callout'],
        ],
        img: [
            ...(defaultSchema.attributes?.img ?? []),
            'alt',
        ],
        video: ['src', 'poster', 'width', 'height', 'controls', ['className', 'docs-video']],
    },
    protocols: {
        ...defaultSchema.protocols,
        // Allow the doc: protocol on links. rehype-sanitize otherwise strips any
        // href whose protocol is not in its default allow-list (http/https/mailto/
        // ...), which silently dropped every internal doc: link before our <a>
        // override and resolveDocLink could route it. The href never becomes a real
        // navigation: the override intercepts onClick and calls openPage.
        href: [...(defaultSchema.protocols?.href ?? []), 'doc'],
        // src is protocol-checked by the default schema; poster is not, so add it.
        poster: ['http', 'https'],
    },
}

// react-markdown runs its own urlTransform on every href BEFORE rehype-sanitize,
// and its default drops any non-http(s)/mailto protocol (returning ''). That
// stripped doc: links a second time, independent of the sanitize allow-list. Pass
// doc: through untouched and defer to the default for everything else (so
// javascript: and other unsafe schemes are still neutralized).
function transformDocUrl(url: string): string {
    return url.startsWith('doc:') ? url : defaultUrlTransform(url)
}

// ---------------------------------------------------------------------------
// Module-level plugin arrays (stateless, hoisted so ReactMarkdown never sees
// a new array reference between renders, which would force a full reparse).
// ---------------------------------------------------------------------------

const REMARK_PLUGINS = [remarkGfm, remarkDirective, remarkCalloutDirective, remarkVideoDirective]
// rehypeRaw MUST run before rehypeSanitize: it reparses the raw HTML the Roku
// docs embed (most reference pages build their field tables as raw <table> markup,
// not GFM tables) into real hast elements, then sanitize strips anything unsafe.
// Order is load-bearing; sanitizing before raw-parsing would leave the HTML as
// escaped text.
// Three rehype pipelines. rehypeFieldTable runs LAST (after sanitize): it only
// restructures already-sanitized table content into safe record blocks.
//  - native:  omits the transform, so tables render exactly as authored.
//  - transform-all: explicit twopane/compact/cards transform every table; they
//    share one pipeline and differ only by a CSS class, so switching among them is
//    instant (no re-parse).
//  - auto: the transform leaves native-detected tables as real tables and tags the
//    rest per table.
const REHYPE_PLUGINS_NATIVE = [rehypeRaw, rehypeTableCellMarkdown, [rehypeSanitize, sanitizeSchema] as const]
const REHYPE_PLUGINS_TRANSFORM = [...REHYPE_PLUGINS_NATIVE, [rehypeFieldTable, { auto: false }] as const]
const REHYPE_PLUGINS_AUTO = [...REHYPE_PLUGINS_NATIVE, [rehypeFieldTable, { auto: true }] as const]

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DocsReadingPaneProps {
    page: DocsPage | null
    status: 'idle' | 'loading' | 'loaded' | 'error' | 'not-found'
    errorMessage?: string
    slugIndex: Record<string, string>
    /** Ancestor crumbs (category > subdir > ...) shown above the title. A crumb
     *  with a path is clickable and opens that index page. */
    breadcrumb: { label: string; path?: string }[]
    onNavigateInternal: (path: string, anchor?: string) => void
    layout: DocsLayoutMode
    /** The repo-relative path the user attempted to open (set before the fetch,
     *  so error and not-found states can link to the specific page rather than the
     *  docs home). Falls back to the home URL when absent. */
    requestedPath?: string
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ExternalButton({ targetPath }: { targetPath?: string }): React.JSX.Element {
    function handleClick(): void {
        void window.rokdock.external.openUrl(rokuDocUrl(targetPath))
    }

    return (
        <button className="docs-external-btn" onClick={handleClick}>
            Open on developer.roku.com
        </button>
    )
}

// ---------------------------------------------------------------------------
// Markdown component overrides
// ---------------------------------------------------------------------------

/** Flatten React children to plain text, treating <br> as a newline. */
function extractText(node: React.ReactNode, brToNewline: boolean): string {
    if (node === null || node === undefined || typeof node === 'boolean') return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(child => extractText(child, brToNewline)).join('')
    if (React.isValidElement(node)) {
        if (brToNewline && node.type === 'br') return '\n'
        return extractText((node.props as { children?: React.ReactNode }).children, brToNewline)
    }
    return ''
}

/**
 * Undo the backslash-escaping the Roku docs use inside code (e.g. \{ \[ \* and
 * even \\\{). CommonMark keeps these literal in code, but ReadMe (the docs' own
 * renderer) unescapes them, so code examples that read as `\\\{ values: \[` on
 * our side are clean braces/brackets on the site. We collapse any run of
 * backslashes before a punctuation char to that char, then drop line-continuation
 * backslashes at end of line. Letters/digits after a backslash (\n, \t) are left
 * alone.
 */
function unescapeCode(code: string): string {
    return code
        .replace(/\\+([^\sA-Za-z0-9])/g, '$1')
        .replace(/\\(\n|$)/g, '$1')
}

/** Flatten a hast node to text, treating <br> as a newline. */
function hastText(node: HastContent, brToNewline: boolean): string {
    if (node.type === 'text') return node.value
    if (node.type === 'element') {
        if (brToNewline && node.tagName === 'br') return '\n'
        return (node.children as HastContent[]).map(child => hastText(child, brToNewline)).join('')
    }
    return ''
}

// ---------------------------------------------------------------------------
// Column sorting (native tables + carried over to the record layouts)
// ---------------------------------------------------------------------------

interface SortState {
    /** Column header label (matched by text so it carries across layouts). */
    label: string
    dir: 1 | -1
    /** True when the sorted column is the first column (the record title). */
    isTitle: boolean
}

/** Leading numeric value of a cell ("512 MB" -> 512, "2025" -> 2025), or null. */
function leadingNumber(value: string): number | null {
    const match = value.trim().match(/^-?\d[\d,]*\.?\d*/)
    return match ? parseFloat(match[0].replace(/,/g, '')) : null
}

/** Numeric-aware comparison, falling back to locale string compare. */
function compareText(left: string, right: string): number {
    const leftNumber = leadingNumber(left)
    const rightNumber = leadingNumber(right)
    if (leftNumber !== null && rightNumber !== null && leftNumber !== rightNumber) return leftNumber - rightNumber
    return left.trim().localeCompare(right.trim())
}

/** Reorder a native table's rows by the sorted column and mark the header. */
function applyNativeSort(wrap: HTMLElement, sort: SortState): void {
    const table = wrap.querySelector('table')
    const tbody = table?.querySelector('tbody')
    if (!table || !tbody) return
    const ths = [...table.querySelectorAll<HTMLElement>('thead th')]
    const col = ths.findIndex(th => (th.textContent ?? '').trim() === sort.label)
    if (col < 0) return
    const rows = [...tbody.querySelectorAll<HTMLTableRowElement>(':scope > tr')]
    rows.sort((rowA, rowB) => compareText(rowA.cells[col]?.textContent ?? '', rowB.cells[col]?.textContent ?? '') * sort.dir)
    for (const row of rows) tbody.appendChild(row)
    ths.forEach((th, i) => {
        const active = i === col
        th.setAttribute('aria-sort', active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none')
        th.dataset.docsSort = active ? (sort.dir === 1 ? 'asc' : 'desc') : ''
    })
}

/** The value a record contributes to a given sort (title or a key/value row). */
function recordSortValue(rec: HTMLElement, sort: SortState): string {
    if (sort.isTitle) return rec.querySelector('.docs-rec-name')?.textContent ?? ''
    const row = [...rec.querySelectorAll<HTMLElement>('.docs-rec-row')].find(
        candidate => (candidate.querySelector('.docs-rec-key')?.textContent ?? '').trim() === sort.label,
    )
    return row?.querySelector('.docs-rec-val')?.textContent ?? ''
}

/** Reorder a record list to match the same sort the native table would produce. */
function applyRecordSort(list: HTMLElement, sort: SortState): void {
    const recs = [...list.querySelectorAll<HTMLElement>(':scope > .docs-rec')]
    recs.sort((recordA, recordB) => compareText(recordSortValue(recordA, sort), recordSortValue(recordB, sort)) * sort.dir)
    for (const record of recs) list.appendChild(record)
}

/** Pin a native table to fixed column widths (px), so resized widths are honored. */
function applyColumnWidths(table: HTMLElement, widths: number[]): void {
    const ths = [...table.querySelectorAll<HTMLElement>('thead th')]
    if (ths.length !== widths.length) return
    table.style.tableLayout = 'fixed'
    table.style.width = widths.reduce((sum, width) => sum + width, 0) + 'px'
    ths.forEach((th, i) => { th.style.width = widths[i] + 'px' })
}

const MIN_COLUMN_WIDTH = 48
const MAX_AUTOSIZE_WIDTH = 600

/** Resize a column to fit its widest content (header + cells), without wrapping. */
function autoSizeColumn(table: HTMLElement, colIndex: number, store: Map<number, number[]>, index: number): void {
    const headerCells = [...table.querySelectorAll<HTMLElement>('thead th')]
    const bodyRows = [...table.querySelectorAll<HTMLElement>('tbody tr')]
    const cells = [headerCells[colIndex], ...bodyRows.map(row => row.children[colIndex] as HTMLElement)].filter(Boolean)

    // Measure each cell's natural one-line width by forcing nowrap, then read the
    // overflow width. +2 covers the cell's left/right border.
    let fit = MIN_COLUMN_WIDTH
    for (const cell of cells) {
        const prevWhiteSpace = cell.style.whiteSpace
        const prevWidth = cell.style.width
        cell.style.whiteSpace = 'nowrap'
        cell.style.width = 'auto'
        fit = Math.max(fit, Math.ceil(cell.scrollWidth) + 2)
        cell.style.whiteSpace = prevWhiteSpace
        cell.style.width = prevWidth
    }
    fit = Math.min(fit, MAX_AUTOSIZE_WIDTH)

    applyColumnWidths(table, headerCells.map(cell => Math.round(cell.getBoundingClientRect().width)))
    headerCells[colIndex].style.width = fit + 'px'
    const next = headerCells.map(cell => Math.round(parseFloat(cell.style.width) || cell.getBoundingClientRect().width))
    table.style.width = next.reduce((sum, width) => sum + width, 0) + 'px'
    store.set(index, next)
}

/** Add drag handles to a native table's headers so columns can be resized. */
function setupColumnResize(table: HTMLElement, index: number, store: Map<number, number[]>): void {
    const ths = [...table.querySelectorAll<HTMLElement>('thead th')]
    ths.forEach((th, colIndex) => {
        if (th.querySelector(':scope > .docs-col-resize')) return
        const handle = document.createElement('span')
        handle.className = 'docs-col-resize'
        handle.setAttribute('aria-hidden', 'true')
        handle.title = 'Drag to resize, double-click to auto-fit'
        handle.addEventListener('click', e => e.stopPropagation()) // don't trigger sort
        handle.addEventListener('dblclick', e => {
            e.preventDefault()
            e.stopPropagation()
            autoSizeColumn(table, colIndex, store, index)
        })
        handle.addEventListener('mousedown', e => {
            e.preventDefault()
            e.stopPropagation()
            const all = [...table.querySelectorAll<HTMLElement>('thead th')]
            const widths = all.map(cell => Math.round(cell.getBoundingClientRect().width))
            applyColumnWidths(table, widths)
            const startX = e.clientX
            const startWidth = widths[colIndex]
            const onMove = (ev: MouseEvent): void => {
                all[colIndex].style.width = Math.max(MIN_COLUMN_WIDTH, startWidth + (ev.clientX - startX)) + 'px'
                const next = all.map(cell => Math.round(parseFloat(cell.style.width) || cell.getBoundingClientRect().width))
                table.style.width = next.reduce((sum, width) => sum + width, 0) + 'px'
                store.set(index, next)
            }
            const onUp = (): void => {
                document.removeEventListener('mousemove', onMove)
                document.removeEventListener('mouseup', onUp)
                document.body.style.userSelect = ''
            }
            document.body.style.userSelect = 'none'
            document.addEventListener('mousemove', onMove)
            document.addEventListener('mouseup', onUp)
        })
        th.appendChild(handle)
    })
}

/**
 * Insert a break opportunity (<wbr>) after each '.' in text children, so long
 * dotted identifiers in table headers (roDeviceInfo.GetModel()) can wrap at the
 * dot instead of forcing a wide column or breaking mid-word.
 */
function breakOnDots(children: React.ReactNode): React.ReactNode {
    return React.Children.map(children, child => {
        if (typeof child !== 'string' || !child.includes('.')) return child
        const parts = child.split(/(?<=\.)/)
        return parts.map((part, i) => (
            <React.Fragment key={i}>
                {part}
                {i < parts.length - 1 ? <wbr /> : null}
            </React.Fragment>
        ))
    })
}

/** One entry in the per-page table of contents. */
interface TocHeading {
    id: string
    text: string
    level: number
}

function TocIcon(): React.JSX.Element {
    return (
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2.5 4h1.5M2.5 8h1.5M2.5 12h1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M6.5 4h7M6.5 8h7M6.5 12h4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
    )
}

/** GitHub-style heading slug, so doc: and in-page #anchors resolve to a heading id. */
function slugifyHeading(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
}

function buildComponents(
    slugIndex: Record<string, string>,
    currentPath: string,
    onNavigateInternal: (path: string, anchor?: string) => void,
): Components {
    const heading = (tagName: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') =>
        function Heading({ children }: { children?: React.ReactNode }): React.JSX.Element {
            const Tag = tagName
            return <Tag id={slugifyHeading(extractText(children, false))}>{children}</Tag>
        }
    return {
        // Headings get a slug id so doc: and in-page #anchors can scroll to them.
        h1: heading('h1'),
        h2: heading('h2'),
        h3: heading('h3'),
        h4: heading('h4'),
        h5: heading('h5'),
        h6: heading('h6'),

        // Link routing
        a({ href, children }) {
            if (!href) {
                return <span>{children}</span>
            }

            const target = resolveDocLink(href, slugIndex, currentPath)

            if (target.kind === 'dead') {
                return <span className="docs-dead-link">{children}</span>
            }

            if (target.kind === 'internal') {
                return (
                    <a
                        href="#"
                        className="docs-link"
                        onClick={e => {
                            e.preventDefault()
                            onNavigateInternal(target.path, target.anchor)
                        }}
                    >
                        {children}
                    </a>
                )
            }

            // External
            return (
                <a
                    href={href}
                    className="docs-link"
                    onClick={e => {
                        e.preventDefault()
                        void window.rokdock.external.openUrl(href)
                    }}
                >
                    {children}
                </a>
            )
        },

        // Block code. Read the original hast node (not the rendered React
        // children): because we override `code`, the rendered child's type is our
        // component, not the string 'code', so React-based detection fails. The
        // hast node gives us the code element's language class and its raw text,
        // including <br> line breaks in raw-HTML code blocks.
        pre({ node, children }) {
            const element = node as HastElement | undefined
            const codeElement = element?.children?.find(
                (child): child is HastElement => child.type === 'element' && child.tagName === 'code',
            )
            if (codeElement) {
                const classes = codeElement.properties?.className
                const classStr = Array.isArray(classes) ? classes.join(' ') : String(classes ?? '')
                const langMatch = /language-(\S+)/.exec(classStr)
                const language = langMatch ? langMatch[1] : ''
                // Drop only the single trailing newline ReadMe appends to fenced
                // blocks. Per-line trailing whitespace is left intact: it is
                // invisible in the rendered block but can be significant in the
                // copied text (e.g. a Markdown hard break is two trailing spaces).
                const codeText = unescapeCode(hastText(codeElement, true)).replace(/\n$/, '')
                return <CodeBlock language={language} code={codeText} />
            }
            return <pre>{children}</pre>
        },

        // Inline code (block code is handled by the pre override above). Undo the
        // backslash-escaping the source uses for MDX-special characters (e.g. \{ in
        // `<code>\{ "code": ... }</code>`), which ReadMe strips on render but
        // CommonMark keeps literal inside a code span.
        code({ children }) {
            const unescaped = React.Children.map(children, child =>
                typeof child === 'string' ? unescapeCode(child) : child,
            )
            return <code className="docs-inline-code">{unescaped}</code>
        },

        // Images from image.roku.com (allowed by CSP)
        img({ src, alt }) {
            return <img src={src} alt={alt ?? ''} className="docs-img" />
        },

        // Wrap tables in a horizontally-scrollable container. Roku's reference
        // tables (many columns, nested sub-tables) are often wider than the pane,
        // and the pane clips horizontal overflow, so without this the rightmost
        // columns are cut off with no way to reach them.
        table({ children }) {
            return (
                <div className="docs-table-wrap">
                    <table>{children}</table>
                </div>
            )
        },

        // Let long dotted header identifiers wrap at the dot.
        th({ children }) {
            return <th>{breakOnDots(children)}</th>
        },
    }
}

// ---------------------------------------------------------------------------
// DocsReadingPane
// ---------------------------------------------------------------------------

export function DocsReadingPane({
    page,
    status,
    errorMessage,
    slugIndex,
    breadcrumb,
    onNavigateInternal,
    layout,
    requestedPath,
}: DocsReadingPaneProps): React.JSX.Element {
    const bodyRef = useRef<HTMLDivElement>(null)
    // Remember and restore the scroll offset per page.
    useReadingPosition(bodyRef, page?.path ?? null)
    // Sort state per table, keyed by the table's position in the page (stable across
    // layout switches), so a sort set on a native table carries to the record views.
    const sortStateRef = useRef<Map<number, SortState>>(new Map())

    // Resized column widths (px) per native table, keyed like sort state so they
    // survive re-renders and layout switches.
    const colWidthsRef = useRef<Map<number, number[]>>(new Map())

    // Per-page table of contents: extracted from the rendered headings, shown in a
    // floating panel (no permanent column), with scroll-spy highlighting.
    const [headings, setHeadings] = useState<TocHeading[]>([])
    const [tocOpen, setTocOpen] = useState(false)
    const [activeHeading, setActiveHeading] = useState('')
    const tocRef = useRef<HTMLDivElement>(null)
    const [lastUpdated, setLastUpdated] = useState<string | null>(null)

    // Memoize the preprocessed markdown so it only reruns when the page content
    // changes (not on unrelated prop updates).
    const md = useMemo(
        () => (page ? preprocessCustomBlocks(page.markdown) : ''),
        [page],
    )

    // A new page starts with no sort and no resized columns.
    useEffect(() => {
        sortStateRef.current.clear()
        colWidthsRef.current.clear()
    }, [page])

    // Fetch the last-updated date for the current page lazily from the commits API.
    useEffect(() => {
        if (!page?.path || status !== 'loaded') {
            setLastUpdated(null)
            return
        }
        const pagePath = page.path
        let ignore = false
        void window.rokdock.docs.getPageUpdated(pagePath).then((date: string | null) => {
            if (!ignore) setLastUpdated(date)
        })
        return () => { ignore = true }
    }, [page?.path, status])

    const formattedUpdated = useMemo(
        () => (lastUpdated
            ? new Date(lastUpdated).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
            : null),
        [lastUpdated],
    )

    // Wire up sorting: native tables get clickable headers; every table/record list
    // re-applies its stored sort after each render so the order survives layout
    // switches. Sorting reorders DOM nodes directly (no React re-render), so a click
    // persists until the markdown re-renders, after which this effect re-applies it.
    useEffect(() => {
        const prose = bodyRef.current?.querySelector('.docs-prose')
        if (!prose) return
        const units = [...prose.querySelectorAll<HTMLElement>('.docs-rec-list, .docs-table-wrap')].filter(
            element => element.classList.contains('docs-rec-list') ||
                (!element.closest('.docs-rec-val') && !element.closest('td') && !element.closest('th')),
        )
        units.forEach((unit, index) => {
            const isNative = unit.classList.contains('docs-table-wrap')
            if (isNative) {
                const ths = [...unit.querySelectorAll<HTMLElement>('thead th')]
                ths.forEach((th, col) => {
                    th.classList.add('docs-sortable-th')
                    th.onclick = () => {
                        const label = (th.textContent ?? '').trim()
                        const prev = sortStateRef.current.get(index)
                        const dir: 1 | -1 = prev && prev.label === label && prev.dir === 1 ? -1 : 1
                        const next: SortState = { label, dir, isTitle: col === 0 }
                        sortStateRef.current.set(index, next)
                        applyNativeSort(unit, next)
                    }
                })
                const table = unit.querySelector<HTMLElement>('table')
                if (table) {
                    setupColumnResize(table, index, colWidthsRef.current)
                    const widths = colWidthsRef.current.get(index)
                    if (widths) applyColumnWidths(table, widths)
                }
            }
            const sort = sortStateRef.current.get(index)
            if (sort) (isNative ? applyNativeSort : applyRecordSort)(unit, sort)
        })
    }, [page, layout, md])

    // Build the table of contents from the rendered headings. Two levels (h2/h3)
    // match the reference site's TOC and keep the panel scannable; deeper headings
    // would just add noise.
    useEffect(() => {
        const prose = bodyRef.current?.querySelector('.docs-prose')
        if (!prose) {
            setHeadings([])
            return
        }
        const found = [...prose.querySelectorAll<HTMLElement>('h2[id], h3[id]')]
            .map(element => ({ id: element.id, text: (element.textContent ?? '').trim(), level: Number(element.tagName[1]) }))
            .filter(h => h.id && h.text)
        setHeadings(found)
    }, [page, layout, md])

    // Scroll-spy: mark the topmost heading within the upper band of the viewport as
    // the active TOC entry. rootMargin pulls the trigger line near the top so a
    // section activates as its heading reaches the top, not the middle.
    useEffect(() => {
        const root = bodyRef.current
        if (!root || headings.length === 0) return
        const visible = new Set<string>()
        const observer = new IntersectionObserver(
            entries => {
                for (const entry of entries) {
                    if (entry.isIntersecting) visible.add(entry.target.id)
                    else visible.delete(entry.target.id)
                }
                const first = headings.find(h => visible.has(h.id))
                if (first) setActiveHeading(first.id)
            },
            { root, rootMargin: '0px 0px -72% 0px', threshold: 0 },
        )
        for (const h of headings) {
            const element = root.querySelector(`#${CSS.escape(h.id)}`)
            if (element) observer.observe(element)
        }
        return () => observer.disconnect()
    }, [headings])

    // Close the TOC panel on outside click or Escape.
    useEffect(() => {
        if (!tocOpen) return
        const onPointer = (e: MouseEvent): void => {
            if (tocRef.current && !tocRef.current.contains(e.target as globalThis.Node)) setTocOpen(false)
        }
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') setTocOpen(false)
        }
        document.addEventListener('mousedown', onPointer)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onPointer)
            document.removeEventListener('keydown', onKey)
        }
    }, [tocOpen])

    function jumpToHeading(id: string): void {
        const element = bodyRef.current?.querySelector(`#${CSS.escape(id)}`)
        element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        setActiveHeading(id)
    }

    // Flag table wrappers that overflow horizontally so the CSS can bound their
    // height, keeping the horizontal scrollbar reachable on tall wide tables.
    useEffect(() => {
        const body = bodyRef.current
        if (!body) return
        for (const wrap of body.querySelectorAll<HTMLElement>('.docs-table-wrap')) {
            wrap.classList.toggle('docs-table-wrap--overflow', wrap.scrollWidth > wrap.clientWidth + 2)
        }
    }, [page, layout, md])

    // Memoize the components map; it closes over slugIndex, page.path, and
    // onNavigateInternal, so recompute only when those actually change.
    const components = useMemo(
        () => buildComponents(slugIndex, page?.path ?? '', onNavigateInternal),
        // Only page.path feeds the component map; depending on the whole page object
        // would rebuild it (and reparse the markdown) on any unrelated page change.
        [slugIndex, page?.path, onNavigateInternal],
    )

    function renderBody(): React.JSX.Element {
        if (status === 'loading') {
            return (
                <div className="docs-pane-loading">
                    Loading...
                </div>
            )
        }

        if (status === 'idle' || !page) {
            return (
                <div className="docs-pane-empty-state">
                    Select a page from the sidebar.
                </div>
            )
        }

        if (status === 'error') {
            return (
                <div className="docs-pane-message">
                    <p className="docs-pane-message-text">
                        {errorMessage ?? 'An error occurred loading this page.'}
                    </p>
                    <ExternalButton targetPath={requestedPath} />
                </div>
            )
        }

        if (status === 'not-found') {
            return (
                <div className="docs-pane-message">
                    <p className="docs-pane-message-text">Page not found.</p>
                    <ExternalButton targetPath={requestedPath} />
                </div>
            )
        }

        // Loaded page. "native" renders tables as authored; "auto" transforms with
        // per-table detection; the explicit record modes transform every table.
        const rehypePlugins =
            layout === 'native'
                ? REHYPE_PLUGINS_NATIVE
                : layout === 'auto'
                    ? REHYPE_PLUGINS_AUTO
                    : REHYPE_PLUGINS_TRANSFORM
        return (
            <div className={`docs-prose docs-layout-${layout}`}>
                <ReactMarkdown
                    remarkPlugins={REMARK_PLUGINS}
                    rehypePlugins={rehypePlugins as never}
                    urlTransform={transformDocUrl}
                    components={components}
                >
                    {md}
                </ReactMarkdown>
            </div>
        )
    }

    return (
        <div className="docs-reading-pane">
            <div className="docs-pane-header">
                <div className="docs-pane-header-main">
                    {page && breadcrumb.length > 0 && (
                        <nav className="docs-breadcrumb" aria-label="Breadcrumb">
                            {breadcrumb.map((crumb, i) => (
                                <React.Fragment key={i}>
                                    {i > 0 && <span className="docs-breadcrumb-sep" aria-hidden="true">&gt;</span>}
                                    {crumb.path ? (
                                        <button
                                            type="button"
                                            className="docs-breadcrumb-link"
                                            onClick={() => onNavigateInternal(crumb.path!)}
                                        >
                                            {crumb.label}
                                        </button>
                                    ) : (
                                        <span className="docs-breadcrumb-item">{crumb.label}</span>
                                    )}
                                </React.Fragment>
                            ))}
                        </nav>
                    )}
                    <span className="docs-pane-title">
                        {page ? page.title : ''}
                    </span>
                    {page?.excerpt && (
                        <p className="docs-pane-excerpt">{page.excerpt}</p>
                    )}
                    {formattedUpdated && (
                        <p className="docs-pane-updated">Updated {formattedUpdated}</p>
                    )}
                </div>

                {status === 'loaded' && headings.length > 1 && (
                    <div className={`docs-toc${tocOpen ? ' docs-toc--open' : ''}`} ref={tocRef}>
                        <button
                            type="button"
                            className="docs-toc-toggle"
                            onClick={() => setTocOpen(open => !open)}
                            title="On this page"
                            aria-label="On this page"
                            aria-expanded={tocOpen}
                        >
                            <TocIcon />
                        </button>
                        {tocOpen && (
                            <nav className="docs-toc-panel" aria-label="On this page">
                                <div className="docs-toc-title">On this page</div>
                                <ul className="docs-toc-list">
                                    {headings.map(h => (
                                        <li key={h.id}>
                                            <button
                                                type="button"
                                                className={`docs-toc-link docs-toc-link--h${h.level}${activeHeading === h.id ? ' docs-toc-link--active' : ''}`}
                                                onClick={() => jumpToHeading(h.id)}
                                            >
                                                {h.text}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </nav>
                        )}
                    </div>
                )}
            </div>

            <div className="docs-pane-body" ref={bodyRef}>
                {renderBody()}
            </div>
        </div>
    )
}
