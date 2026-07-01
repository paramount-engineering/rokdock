/**
 * Pure string preprocessor for Roku developer docs markdown.
 *
 * The Roku docs embed several JSX-style custom components that react-markdown
 * cannot parse. This module converts them to standard constructs before the
 * markdown is handed to the renderer:
 *
 *   <Callout theme="...">children</Callout>
 *   <BlockQuote>children</BlockQuote>
 *     -> :::callout fenced container (remark-directive style)
 *
 *   <RokuTable columns={[...]} data={[...]} />
 *     -> GFM markdown table (or :::callout fallback on parse failure)
 *
 *   <Image src="..." alt="..." title="..." />
 *     -> standard markdown image ![alt](src "title")
 *
 *   <video src="..." poster="..." width="..." height="..." controls />
 *     -> ::video{...} leaf directive (markdown has no native video syntax;
 *        a remark plugin renders it as a real <video controls> element)
 *
 * No DOM, no imports. Pure string -> string.
 */

/** Wrap content in a :::callout fenced container block. */
function wrapCallout(inner: string): string {
    return `\n:::callout\n${inner.trim()}\n:::\n`
}

/**
 * Collapse blank lines inside every top-level <table>...</table> span.
 *
 * Roku's reference pages build their field tables as raw HTML <table> blocks, and
 * some (e.g. the Video node) contain blank lines between cells. In CommonMark a
 * blank line terminates a raw HTML block, so the parser ends the table at the
 * first blank line and the remaining rows render as orphaned literal text. HTML
 * is whitespace-insensitive between tags, so collapsing the interior blank lines
 * to single newlines keeps the whole table one HTML block without changing how it
 * renders. Nested tables are handled by depth-matching to the outer </table>.
 */
function collapseBlankLinesInHtmlTables(markdown: string): string {
    const lower = markdown.toLowerCase()
    let result = ''
    let cursor = 0

    while (cursor < markdown.length) {
        const open = lower.indexOf('<table', cursor)
        if (open === -1) {
            result += markdown.slice(cursor)
            break
        }
        result += markdown.slice(cursor, open)

        // Walk to the matching </table>, counting nested <table> opens.
        let depth = 1
        let scan = open + 6
        let closeEnd = -1
        while (scan < markdown.length) {
            const nextOpen = lower.indexOf('<table', scan)
            const nextClose = lower.indexOf('</table', scan)
            if (nextClose === -1) break
            if (nextOpen !== -1 && nextOpen < nextClose) {
                depth++
                scan = nextOpen + 6
            } else {
                depth--
                if (depth === 0) {
                    closeEnd = markdown.indexOf('>', nextClose)
                    break
                }
                scan = nextClose + 7
            }
        }

        if (closeEnd === -1) {
            // Unbalanced table markup: emit the remainder unchanged.
            result += markdown.slice(open)
            break
        }

        const span = markdown.slice(open, closeEnd + 1)
        result += span.replace(/\n[ \t]*(?:\n[ \t]*)+/g, '\n')
        cursor = closeEnd + 1
    }

    return result
}

/** Extract a double- or single-quoted JSX string attribute, or null. */
function jsxStringAttr(markup: string, name: string): string | null {
    const match =
        markup.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`)) ??
        markup.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`))
    return match ? match[1] : null
}

/**
 * Convert unquoted JS object keys in a JS-array-literal string to quoted JSON
 * keys so JSON.parse can handle it.
 *
 * Handles patterns like: {header:"A",accessor:"a"} -> {"header":"A","accessor":"a"}
 */
function jsArrayLiteralToJson(text: string): string {
    // Quote unquoted object keys (word chars followed by colon, not already quoted).
    return text.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/g, '$1"$2"$3')
}

/**
 * Extract the raw text of a named JSX prop whose value is a {...} literal.
 * Returns the contents of the outermost braces (not including the braces
 * themselves) or null if the prop is not found.
 */
function extractJsxBraceProp(markup: string, propName: string): string | null {
    const propIndex = markup.indexOf(`${propName}={`)
    if (propIndex === -1) return null

    const openBrace = propIndex + propName.length + 1
    if (markup[openBrace] !== '{') return null

    // Walk forward matching braces to find the closing one.
    let depth = 0
    let closeIndex = -1
    for (let i = openBrace; i < markup.length; i++) {
        if (markup[i] === '{') depth++
        else if (markup[i] === '}') {
            depth--
            if (depth === 0) {
                closeIndex = i
                break
            }
        }
    }
    if (closeIndex === -1) return null
    // Return the content inside the outer braces (the JSX expression value),
    // not the braces themselves.
    return markup.slice(openBrace + 1, closeIndex)
}

interface TableColumn {
    header: string
    accessor: string
}

/**
 * Parse the columns and data props from a <RokuTable> markup string.
 * Returns null on any parse failure so the caller can fall back gracefully.
 */
function parseRokuTableProps(
    markup: string,
): { columns: TableColumn[]; data: Record<string, string>[] } | null {
    try {
        const columnsBrace = extractJsxBraceProp(markup, 'columns')
        const dataBrace = extractJsxBraceProp(markup, 'data')
        if (!columnsBrace || !dataBrace) return null

        const columns = JSON.parse(jsArrayLiteralToJson(columnsBrace)) as unknown
        const data = JSON.parse(jsArrayLiteralToJson(dataBrace)) as unknown

        if (!Array.isArray(columns) || !Array.isArray(data)) return null

        // Validate each column has the expected shape.
        for (const col of columns) {
            if (
                typeof col !== 'object' ||
                col === null ||
                typeof (col as Record<string, unknown>)['header'] !== 'string' ||
                typeof (col as Record<string, unknown>)['accessor'] !== 'string'
            ) {
                return null
            }
        }

        return {
            columns: columns as TableColumn[],
            data: data as Record<string, string>[],
        }
    } catch {
        return null
    }
}

/** Build a GFM markdown table string from parsed columns and row data. */
function buildMarkdownTable(columns: TableColumn[], data: Record<string, string>[]): string {
    const headers = columns.map((col) => col.header)
    const headerRow = `| ${headers.join(' | ')} |`
    const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`
    const dataRows = data.map((row) => {
        const cells = columns.map((col) => String(row[col.accessor] ?? ''))
        return `| ${cells.join(' | ')} |`
    })
    return [headerRow, separatorRow, ...dataRows].join('\n')
}

/** Fallback emitted when a RokuTable cannot be parsed. */
const TABLE_FALLBACK = wrapCallout(
    'This table could not be rendered. View the page on developer.roku.com.',
)

/**
 * Preprocess Roku docs markdown, converting JSX custom components to standard
 * markdown constructs that react-markdown can render.
 *
 * Passes ordinary markdown (including plain blockquotes) through unchanged.
 */
export function preprocessCustomBlocks(markdown: string): string {
    let result = markdown

    // Convert <Image .../> (and the rare paired form) to a markdown image first,
    // so images embedded inside other components (e.g. a Callout) also convert.
    result = result.replace(/<Image\b[^>]*?\/?>(?:\s*<\/Image>)?/gs, (match) => {
        const src = jsxStringAttr(match, 'src')
        if (!src) return ''
        const alt = (jsxStringAttr(match, 'alt') ?? '').replace(/[[\]]/g, '')
        const title = jsxStringAttr(match, 'title')
        const titlePart = title ? ` "${title.replace(/"/g, '')}"` : ''
        return `\n\n![${alt}](${src}${titlePart})\n\n`
    })

    // Convert <video .../> (and the rare paired form) to a ::video leaf
    // directive. jsxStringAttr finds the first src=, so a nested <source src>
    // is handled too. A remark plugin turns the directive into a real <video>.
    result = result.replace(/<video\b[^>]*?\/>|<video\b[^>]*?>.*?<\/video>/gs, (match) => {
        const src = jsxStringAttr(match, 'src')
        if (!src) return ''
        const attrs = [`src="${src}"`]
        const poster = jsxStringAttr(match, 'poster')
        if (poster) attrs.push(`poster="${poster}"`)
        const width = jsxStringAttr(match, 'width')
        if (width) attrs.push(`width="${width}"`)
        const height = jsxStringAttr(match, 'height')
        if (height) attrs.push(`height="${height}"`)
        return `\n\n::video{${attrs.join(' ')}}\n\n`
    })

    // Replace self-closing <RokuTable .../> before the paired-tag pass so
    // the paired-tag regex cannot accidentally match anything inside it.
    result = result.replace(/<RokuTable\s[^>]*\/>/gs, (match) => {
        const parsed = parseRokuTableProps(match)
        if (!parsed) return TABLE_FALLBACK
        return buildMarkdownTable(parsed.columns, parsed.data)
    })

    // Replace <Callout ...>...</Callout> (non-greedy, dotAll).
    result = result.replace(/<Callout(?:\s[^>]*)?>(.+?)<\/Callout>/gs, (_match, inner) =>
        wrapCallout(inner),
    )

    // Replace <BlockQuote ...>...</BlockQuote> (non-greedy, dotAll).
    result = result.replace(/<BlockQuote(?:\s[^>]*)?>(.+?)<\/BlockQuote>/gs, (_match, inner) =>
        wrapCallout(inner),
    )

    // Keep raw HTML tables intact: collapse interior blank lines so a blank line
    // mid-table does not terminate the HTML block (which would orphan later rows).
    result = collapseBlankLinesInHtmlTables(result)

    return result
}
