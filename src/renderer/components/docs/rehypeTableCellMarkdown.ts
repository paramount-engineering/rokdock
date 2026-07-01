/**
 * rehype plugin: re-parse inline markdown inside raw-HTML table cells.
 *
 * The Roku docs build their reference tables as raw HTML <table> markup, and the
 * cells contain markdown (cross-reference links, emphasis, inline code, and
 * backslash-escaped punctuation like READ\_WRITE). CommonMark treats raw-HTML
 * block content as opaque, so none of that markdown is processed and it renders
 * literally. ReadMe (the docs' own renderer) does process it. This plugin closes
 * the gap by taking each <td>/<th> text node, parsing it with a real markdown
 * parser, and splicing the resulting inline nodes back in.
 *
 * Runs AFTER rehype-raw (so the table is real hast) and BEFORE rehype-sanitize
 * (so any <a> produced from a markdown link is sanitized and then routed by the
 * reading pane's <a> override). Text inside <code>/<pre> is left untouched (code
 * is not markdown), and nested cells are processed on their own visit, never
 * twice.
 */

import { visit } from 'unist-util-visit'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { toHast } from 'mdast-util-to-hast'
import type { Root, Element, Text, ElementContent, RootContent } from 'hast'
import type { Plugin } from 'unified'

const CELL_TAGS = new Set(['td', 'th'])
// Subtrees whose text must NOT be markdown-parsed (code) or that are handled by
// their own visit (nested cells).
const STOP_TAGS = new Set(['td', 'th', 'code', 'pre'])

// Only reparse text that could contain markdown, to avoid the parser cost on
// plain prose and to leave ordinary text byte-identical.
const MARKDOWN_HINT = /[\\[`*_]/

/**
 * Remove the common leading indentation from every line. The Roku docs indent
 * cell markup for readability (e.g. 8 spaces before each "* item"), and CommonMark
 * treats 4+ leading spaces as an indented code block, so the indentation would turn
 * a bullet list into a gray code box. Stripping the shared indent restores the
 * intended block structure (lists, etc.) while preserving relative nesting.
 */
function dedent(text: string): string {
    const lines = text.split('\n')
    let min = Infinity
    for (const line of lines) {
        if (line.trim() === '') continue
        const indent = line.length - line.trimStart().length
        if (indent < min) min = indent
    }
    if (min === Infinity || min === 0) return text
    return lines.map(line => line.slice(min)).join('\n')
}

/** Parse a run of cell text as markdown and return the resulting hast nodes. */
function cellMarkdownToHast(value: string): ElementContent[] {
    const mdast = fromMarkdown(dedent(value))
    const hast = toHast(mdast) as Root
    const out: ElementContent[] = []
    for (const node of hast.children as RootContent[]) {
        // toHast wraps inline content in a paragraph; unwrap it back to inline so
        // a plain text cell does not gain a block <p>. Block nodes (lists, etc.)
        // pass through as-is.
        if (node.type === 'element' && node.tagName === 'p') {
            out.push(...(node.children as ElementContent[]))
        } else {
            out.push(node as ElementContent)
        }
    }
    return out
}

/**
 * Replace the text-node children of a cell (recursing through inline wrappers
 * like <span>/<strong>) with inline-markdown-parsed hast. Stops at code/pre and
 * nested cells.
 */
function processCellChildren(parent: Element): void {
    const next: ElementContent[] = []
    for (const child of parent.children) {
        if (child.type === 'text') {
            const value = (child as Text).value
            if (MARKDOWN_HINT.test(value)) {
                next.push(...cellMarkdownToHast(value))
            } else {
                next.push(child)
            }
        } else {
            if (child.type === 'element' && !STOP_TAGS.has((child as Element).tagName)) {
                processCellChildren(child as Element)
            }
            next.push(child)
        }
    }
    parent.children = next
}

export const rehypeTableCellMarkdown: Plugin<[], Root> = () => {
    return (tree: Root) => {
        // Collect cells first, then process, so the tree is not mutated mid-walk.
        const cells: Element[] = []
        visit(tree, 'element', (node: Element) => {
            if (CELL_TAGS.has(node.tagName)) cells.push(node)
        })
        for (const cell of cells) processCellChildren(cell)
    }
}
