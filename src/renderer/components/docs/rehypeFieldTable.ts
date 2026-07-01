/**
 * rehype plugin: present wide reference tables as readable record blocks.
 *
 * Roku's reference pages use multi-column tables (Field / Type / Default / Access
 * Permission / Description, or Attribute / Type / Values / Description, etc.) that
 * are really a list of field records. Rendered as a literal grid they cram the
 * description into a narrow column and force horizontal scrolling. This transform
 * rewrites each TOP-LEVEL table with 3+ columns into a stack of records: the first
 * column becomes the record title, the remaining columns become labeled key/value
 * rows (labels taken from the header), and long descriptions flow full width.
 *
 * Nested tables (the small Key/Type/Value grids inside a description cell) are left
 * as tables: the walk does not recurse into a table it transforms, so they render
 * normally inside the record's value.
 *
 * Runs AFTER rehype-sanitize, so it only restructures already-sanitized content
 * into new, safe elements (no sanitize schema changes needed).
 */

import type { Root, Element, ElementContent, Text } from 'hast'
import type { Plugin } from 'unified'

function text(value: string): Text {
    return { type: 'text', value }
}

function element(tagName: string, className: string | null, children: ElementContent[]): Element {
    return {
        type: 'element',
        tagName,
        properties: className ? { className: [className] } : {},
        children,
    }
}

function textContent(node: ElementContent): string {
    if (node.type === 'text') return node.value
    if (node.type === 'element') return (node.children as ElementContent[]).map(textContent).join('')
    return ''
}

/** True when a cell holds something worth showing (non-blank text or an element like a nested table or image). */
function hasContent(nodes: ElementContent[]): boolean {
    return nodes.some(node => {
        if (node.type === 'text') return node.value.trim().length > 0
        if (node.type === 'element') {
            if (node.tagName === 'table' || node.tagName === 'img') return true
            return hasContent(node.children as ElementContent[])
        }
        return false
    })
}

function childElements(node: Element, tagNames: string[]): Element[] {
    return (node.children as ElementContent[]).filter(
        (child): child is Element => child.type === 'element' && tagNames.includes(child.tagName),
    )
}

function rowCells(tr: Element): Element[] {
    return childElements(tr, ['td', 'th'])
}

/** True when any node in the subtree is one of the given block tags. */
function containsTag(nodes: ElementContent[], tagNames: string[]): boolean {
    return nodes.some(node => {
        if (node.type !== 'element') return false
        if (tagNames.includes(node.tagName)) return true
        return containsTag(node.children as ElementContent[], tagNames)
    })
}

// Auto layout, content-aware. The decision is per COLUMN, not per cell, so one
// stray long note in an otherwise tabular matrix does not flip the whole table:
//  - any column that is structurally "long" (prose in most rows, or block content
//    like a list / nested table / code) -> two-pane (field reference: a name rail
//    with labeled key/values, long values flowing full width)
//  - else a narrow short-value table -> native (a real grid reads best and stays
//    row-comparable and sortable)
//  - else a wide short-value matrix -> compact records (avoids horizontal scroll)
const LONG_TEXT = 70
const NARROW_COLUMNS = 4
// A column counts as "long" only when a meaningful share of its cells are long,
// so a single outlier row cannot drive the layout.
const LONG_ROW_FRACTION = 0.34

/** True when a non-title column holds prose in most rows or any block content. */
function isLongColumn(columnIndex: number, bodyRows: Element[]): boolean {
    const threshold = Math.max(1, Math.ceil(bodyRows.length * LONG_ROW_FRACTION))
    let longCells = 0
    for (const tr of bodyRows) {
        const cell = rowCells(tr)[columnIndex]
        if (!cell) continue
        const kids = cell.children as ElementContent[]
        // Block content (list, nested table, code, quote) always reads better as a
        // full-width value than crammed into a grid cell.
        if (containsTag(kids, ['table', 'ul', 'ol', 'pre', 'blockquote'])) return true
        if (textContent(cell).trim().length > LONG_TEXT) {
            longCells++
            if (longCells >= threshold) return true
        }
    }
    return false
}

function autoChoice(headers: string[], bodyRows: Element[]): 'native' | 'twopane' | 'compact' {
    for (let i = 1; i < headers.length; i++) {
        if (isLongColumn(i, bodyRows)) return 'twopane'
    }
    return headers.length <= NARROW_COLUMNS ? 'native' : 'compact'
}

/**
 * Convert an eligible table into a record list, or return null when it should stay
 * a real table (not a field-reference table, or in auto mode content that reads
 * better as a native table).
 *
 * Each row becomes a record: the first column is the title and every other column
 * a labeled key/value row, so every value (e.g. a spec table's "Supported: No")
 * is identified by its column. Long descriptions and nested tables sit in the
 * value cell. The layout modes restyle this one structure.
 *
 * @param auto - when true, leave content that auto-detects as native untransformed;
 *   when false (an explicit record mode), transform every eligible table.
 */
function tableToRecordList(table: Element, auto: boolean): Element | null {
    const sections = childElements(table, ['thead', 'tbody'])
    const thead = sections.find(section => section.tagName === 'thead')
    const tbody = sections.find(section => section.tagName === 'tbody') ?? table

    const headRow = thead ? childElements(thead, ['tr'])[0] : undefined
    if (!headRow) return null
    const headers = rowCells(headRow).map(textContent)
    if (headers.length < 3) return null

    const bodyRows = childElements(tbody, ['tr'])
    if (bodyRows.length === 0) return null

    const choice = autoChoice(headers, bodyRows)
    // Auto leaves small/short tables as real tables; explicit modes transform all.
    if (auto && choice === 'native') return null
    const listVariant = choice === 'twopane' ? 'twopane' : 'compact'

    const records: ElementContent[] = bodyRows.map(tr => {
        const cells = rowCells(tr)
        const titleChildren = cells[0] ? (cells[0].children as ElementContent[]) : []

        const kvRows: ElementContent[] = []
        for (let i = 1; i < headers.length; i++) {
            const cell = cells[i]
            if (!cell) continue
            const value = cell.children as ElementContent[]
            if (!hasContent(value)) continue
            kvRows.push(
                element('div', 'docs-rec-row', [
                    element('div', 'docs-rec-key', [text(headers[i])]),
                    element('div', 'docs-rec-val', value),
                ]),
            )
        }

        return element('div', 'docs-rec', [
            element('div', 'docs-rec-name', titleChildren),
            element('div', 'docs-rec-kv', kvRows),
        ])
    })

    // Tag the list with the auto-detected variant. Explicit modes ignore this (their
    // prose-level class wins); auto mode defers to it per table.
    return element('div', `docs-rec-list docs-rec-list--${listVariant}`, records)
}

interface FieldTableOptions {
    /** Auto mode: leave native-detected tables untransformed (default false). */
    auto?: boolean
}

export const rehypeFieldTable: Plugin<[FieldTableOptions?], Root> = (options = {}) => {
    const auto = options.auto ?? false
    return (tree: Root) => {
        const transform = (parent: Element | Root): void => {
            const children = parent.children as ElementContent[]
            for (let i = 0; i < children.length; i++) {
                const node = children[i]
                if (node.type !== 'element') continue
                if (node.tagName === 'table') {
                    const records = tableToRecordList(node, auto)
                    if (records) children[i] = records
                    // Either way, do not recurse into the table: a transformed
                    // table's nested tables now live inside the record values and
                    // should remain tables; an un-transformed table keeps its own.
                } else {
                    transform(node)
                }
            }
        }
        transform(tree)
    }
}
