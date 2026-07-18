/**
 * Pure JSON and text utilities for the JSON Editor renderer entry.
 *
 * All functions are stateless and free of side effects so they can be
 * unit-tested without a DOM or Electron context.
 */

import { JSON_INDENT_WIDTH } from '../shared/jsonIndent'

// -- Byte size -------------------------------------------------------------------

/**
 * UTF-8 byte length of a string, computed without allocating an encoder buffer
 * (the editor calls this on every document change to update the status bar).
 * Matches TextEncoder: a valid surrogate pair is one 4-byte code point, and a
 * lone surrogate becomes U+FFFD (3 bytes).
 */
export function utf8ByteLength(text: string): number {
    let bytes = 0
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i)
        if (code < 0x80) {
            bytes += 1
        } else if (code < 0x800) {
            bytes += 2
        } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
            const next = text.charCodeAt(i + 1)
            if (next >= 0xdc00 && next <= 0xdfff) {
                bytes += 4
                i++
            } else {
                bytes += 3
            }
        } else {
            bytes += 3
        }
    }
    return bytes
}

// -- Format / Minify -----------------------------------------------------------

/**
 * Indent width (spaces) for JSON in this editor. Single source of truth: it
 * drives both the pretty-printers here (format and sort) and the editor's own
 * typing indent / tab size in jsonEditor.ts.
 */
export const INDENT_WIDTH = JSON_INDENT_WIDTH

/**
 * Parses and re-serializes the given text with INDENT_WIDTH-space indentation.
 * Throws a SyntaxError if the text is not valid JSON.
 */
export function formatJson(text: string): string {
    return JSON.stringify(JSON.parse(text), null, INDENT_WIDTH)
}

/**
 * Parses and re-serializes the given text with no whitespace.
 * Throws a SyntaxError if the text is not valid JSON.
 */
export function minifyJson(text: string): string {
    return JSON.stringify(JSON.parse(text))
}

/**
 * Decodes a raw JSON string literal (including its surrounding quotes) and, when
 * its decoded content is itself valid JSON, returns that content pretty-printed.
 * Returns null when the input is not a JSON string literal, or when its decoded
 * content is not valid JSON. Used by the editor's "unescape nested JSON" action
 * to expand an embedded payload into a readable document.
 */
export function decodeNestedJson(rawStringLiteral: string): string | null {
    let decoded: unknown
    try {
        decoded = JSON.parse(rawStringLiteral)
    } catch {
        return null
    }
    if (typeof decoded !== 'string') return null
    try {
        return formatJson(decoded)
    } catch {
        return null
    }
}

// -- Span Detection ------------------------------------------------------------

/**
 * Builds a per-character mask where true marks characters that are part of a
 * JSON string token (the quotes, the content, and escaped characters). Used so
 * the bracket scans below ignore brackets that appear inside string values.
 */
function computeStringMask(text: string): boolean[] {
    const mask = new Array<boolean>(text.length).fill(false)
    let inString = false
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (inString) {
            mask[i] = true
            if (ch === '\\') {
                i++
                if (i < text.length) mask[i] = true
                continue
            }
            if (ch === '"') inString = false
        } else if (ch === '"') {
            inString = true
            mask[i] = true
        }
    }
    return mask
}

/**
 * Finds the start and end indices (inclusive) of the innermost object or array
 * that encloses the given cursor index.
 *
 * Walks backwards from `index` to find the nearest unmatched opening bracket,
 * then forward to find its matching closing bracket. Returns null if no
 * enclosing bracket pair exists.
 *
 * String values are handled correctly: brackets that appear inside JSON string
 * tokens (including those adjacent to escaped quotes) are ignored by both scans.
 */
export function findEnclosingSpan(
    text: string,
    index: number
): { start: number; end: number } | null {
    const inString = computeStringMask(text)

    let depth = 0
    let start = -1
    for (let i = Math.min(index, text.length - 1); i >= 0; i--) {
        if (inString[i]) continue
        const ch = text[i]
        if (ch === '}' || ch === ']') {
            depth++
        } else if (ch === '{' || ch === '[') {
            if (depth === 0) {
                start = i
                break
            }
            depth--
        }
    }

    if (start < 0) return null

    const openChar = text[start]
    const closeChar = openChar === '{' ? '}' : ']'
    let nestDepth = 0
    let end = -1
    for (let j = start; j < text.length; j++) {
        if (inString[j]) continue
        if (text[j] === openChar) nestDepth++
        else if (text[j] === closeChar) {
            nestDepth--
            if (nestDepth === 0) {
                end = j
                break
            }
        }
    }

    if (end < 0) return null
    return { start, end }
}

// -- Sort ----------------------------------------------------------------------

/**
 * Parses the JSON slice, sorts the top-level keys (for objects) or values
 * (for arrays), and re-serializes with INDENT_WIDTH-space indentation.
 *
 * Returns null when the slice is not valid JSON, is not an object or array,
 * or contains only a scalar value that is not sortable.
 */
export function sortJsonValue(slice: string): string | null {
    let parsed: unknown
    try {
        parsed = JSON.parse(slice)
    } catch {
        return null
    }

    if (Array.isArray(parsed)) {
        return JSON.stringify((parsed as unknown[]).slice().sort(), null, INDENT_WIDTH)
    }

    if (typeof parsed === 'object' && parsed !== null) {
        const sorted: Record<string, unknown> = {}
        for (const key of Object.keys(parsed as Record<string, unknown>).sort()) {
            sorted[key] = (parsed as Record<string, unknown>)[key]
        }
        return JSON.stringify(sorted, null, INDENT_WIDTH)
    }

    return null
}

// -- Indent --------------------------------------------------------------------

/**
 * Prepends `baseIndent` to every line in `jsonStr` after the first. Used when replacing a
 * value span in the editor: the first line stays where the opening bracket already sits, and
 * later lines are shifted to the value's own indentation level so nested keys sit one level
 * deeper and the closing bracket returns to the parent's indent.
 */
export function reindentJson(jsonStr: string, baseIndent: string): string {
    return jsonStr
        .split('\n')
        .map((line, index) => (index === 0 ? line : baseIndent + line))
        .join('\n')
}

/**
 * Returns the leading whitespace (indentation) of the line containing `offset` in `text`.
 * This is the value's indentation LEVEL, not the column of a bracket that may sit later on
 * the line after a `"key": ` prefix, so it is the correct base indent for reindenting a
 * replaced value span.
 */
export function lineIndentAt(text: string, offset: number): string {
    const lineStart = text.lastIndexOf('\n', offset - 1) + 1
    let end = lineStart
    while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end++
    return text.slice(lineStart, end)
}

// JSONL

/** One JSONL record: its exact source text and the buffer offsets it spans. */
export interface JsonlRecord {
    text: string
    from: number
    to: number
}

/** True for the four JSON insignificant-whitespace characters (space, tab, LF, CR). */
function isJsonWhitespace(charCode: number): boolean {
    return charCode === 32 || charCode === 9 || charCode === 10 || charCode === 13
}

/**
 * Split a buffer of whitespace-separated JSON values into records, tracking
 * string and brace/bracket depth so a record that spans multiple lines (a
 * pretty-printed object) stays whole and several compact records on one line
 * still split. Each record carries its source text and document offsets so the
 * linter can mark an invalid record in place. A trailing unterminated value
 * becomes a final record, which the linter then reports as invalid. This single
 * scan backs isJsonlContent, expandJsonl, compactJsonl, jsonlRecordErrors, and
 * countJsonlRecords.
 */
function splitJsonRecords(text: string): JsonlRecord[] {
    const records: JsonlRecord[] = []
    const length = text.length
    let index = 0
    while (index < length) {
        while (index < length && isJsonWhitespace(text.charCodeAt(index))) index++
        if (index >= length) break
        // The outer skip leaves `from` on a non-whitespace character, so the inner
        // loop's depth-0 whitespace break never fires on the first iteration.
        const from = index
        let depth = 0
        let inString = false
        let escaped = false
        while (index < length) {
            const char = text[index]
            if (inString) {
                if (escaped) escaped = false
                else if (char === '\\') escaped = true
                else if (char === '"') inString = false
                index++
                continue
            }
            if (char === '"') {
                inString = true
                index++
                continue
            }
            if (char === '{' || char === '[') {
                depth++
                index++
                continue
            }
            if (char === '}' || char === ']') {
                depth--
                index++
                if (depth <= 0) break
                continue
            }
            // At the top level, whitespace ends a primitive value (number or keyword).
            if (depth === 0 && isJsonWhitespace(text.charCodeAt(index))) break
            index++
        }
        records.push({ text: text.slice(from, index), from, to: index })
    }
    return records
}

/**
 * Returns true when the text looks like a JSONL document: two or more records,
 * the buffer as a whole is NOT valid JSON (ruling out a single pretty-printed
 * value or a JSON array), and every record IS valid JSON.
 */
export function isJsonlContent(text: string): boolean {
    const records = splitJsonRecords(text)
    if (records.length < 2) return false
    try {
        JSON.parse(text.trim())
        return false
    } catch {
        // Whole buffer is not a single JSON value; continue checking per-record.
    }
    for (const { text: record } of records) {
        try {
            JSON.parse(record)
        } catch {
            return false
        }
    }
    return true
}

/**
 * Returns true when the editor should operate in JSONL mode: either the file
 * extension is .jsonl (extension-based override) or the buffer content passes
 * the isJsonlContent heuristic.
 */
export function isJsonlMode(filePath: string | null, text: string): boolean {
    if (filePath !== null && filePath.toLowerCase().endsWith('.jsonl')) return true
    return isJsonlContent(text)
}

/**
 * Expands a JSONL buffer by pretty-printing each record across multiple lines,
 * separated by single newlines. The result is still recognized as JSONL (the
 * records remain distinct top-level values), so compactJsonl reverses it.
 * Throws if any record is invalid JSON; the caller handles that with a toast.
 */
export function expandJsonl(text: string): string {
    return splitJsonRecords(text)
        .map(({ text: record }) => JSON.stringify(JSON.parse(record), null, INDENT_WIDTH))
        .join('\n')
}

/**
 * Collapses a JSONL buffer to one compact record per line, the canonical JSONL
 * form. Reverses expandJsonl. Throws if any record is invalid JSON.
 */
export function compactJsonl(text: string): string {
    return splitJsonRecords(text)
        .map(({ text: record }) => JSON.stringify(JSON.parse(record)))
        .join('\n')
}

/**
 * Lints a JSONL buffer record by record and returns one entry per invalid
 * record. Each entry carries the buffer offsets it spans and the parse error.
 */
export function jsonlRecordErrors(text: string): Array<{ from: number; to: number; message: string }> {
    const errors: Array<{ from: number; to: number; message: string }> = []
    for (const { text: record, from, to } of splitJsonRecords(text)) {
        try {
            JSON.parse(record)
        } catch (parseError) {
            errors.push({ from, to, message: (parseError as Error).message })
        }
    }
    return errors
}

/** Returns the number of records in a JSONL buffer. */
export function countJsonlRecords(text: string): number {
    return splitJsonRecords(text).length
}
