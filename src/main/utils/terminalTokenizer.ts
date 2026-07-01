/**
 * BrightScript / Roku debug terminal tokenizer.
 *
 * Takes a raw string line from the Roku debug Telnet session and returns a
 * TerminalLineChunk containing:
 *  - tokens[]: syntax highlight spans (file paths, URLs, types, keywords, etc.)
 *  - overlays[]: interactive spans for clickable URLs and expandable JSON objects
 *
 * Token priority system: higher-priority tokens win when ranges overlap. Regex
 * constants at the top of the file define every pattern. The main entry point is
 * tokenizeTerminalLine() which runs all applicable patterns against the input text
 * and assembles the final span arrays.
 *
 * JSON detection: when a '{' or '[' is found in the line, findMatchingBracket()
 * locates the closing counterpart. If the enclosed content is valid JSON, an
 * 'json' overlay span is added so the renderer can render an expand button.
 *
 * URL detection: full URLs are wrapped in 'url' overlay spans. Query string
 * key=value pairs within the URL are also annotated as separate token spans
 * (queryKey, queryValue) for color differentiation.
 *
 * This module runs in the main process (called by TelnetSessionService per line).
 * It must stay free of DOM or renderer dependencies.
 */

import type { TerminalLineChunk, TerminalOverlaySpan, TerminalTokenKind, TerminalTokenSpan } from '../../shared/terminal'
import { findMatchingBracket } from '../../shared/jsonUtils'

const URL_RE = /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s"'<>`|\\^{}[\]]+/g
const QUERY_RE = /(?<key>[^=&\s]+)=(?<value>[^&\s]+)/g
const PROMPT_RE = /Brightscript Debugger>\s?/gi
const BRIGHTSCRIPT_DEBUGGER_PROMPT_RE = /^BrightScript Debugger>\s?/i
const CONNECTED_RE = /^Connected to\s+\d{1,3}(?:\.\d{1,3}){3}:\d+\s*$/i
const COMMAND_PROMPT_RE = /^>\s*(\w+)?/
const COMMENT_RE = /(?<=\s|^)'[^\r\n]*/g
const ERROR_RE = /\b(?:Syntax Error|Exception|Unhandled|Traceback)\b/gi
const BRIGHTSCRIPT_ERROR_RE = /\bBRIGHTSCRIPT:\s*ERROR\b.*$/i
const DATE_RE = /\b(?:\d{4}-\d{2}-\d{2})(?:[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z?)?\b/g
const SHORT_TIMESTAMP_RE = /\b\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?\b/g
const STRING_RE = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g
const NUMBER_RE = /(?<![\w.])-?\d+(?:\.\d+)?(?:e[+-]?\d+)?(?![\w.])/gi
const HEX_RE = /\b0x[0-9a-f]+\b/gi
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi
const BOOLEAN_RE = /\b(?:true|false)\b/gi
const NULL_RE = /\b(?:null|nil|none|invalid|undefined)\b/gi
const SECTION_HEADER_RE = /^(?:Current Function|Source Digest\(s\)|Backtrace|Local Variables|Threads|Thread selected|Thread attached|Break in)\b.*$/i
const DEBUGGER_BANNER_RE = /^(?:BrightScript Micro Debugger\.|Enter any BrightScript statement, debug commands, or HELP\.|Suspending threads\.\.\.)$/i
const DASH_SEPARATOR_RE = /-{5,}/g
const STAR_SEPARATOR_RE = /\*{5,}/g
const EQUALS_SEPARATOR_RE = /={5,}/g
const FILE_PATH_RE = /\b(?:pkg|tmp|lib):\/[^\s)]+/g
const THREAD_ROW_RE = /^\s*\d+\*?\s+/
const STACK_FRAME_RE = /^#\d+\s+Function\b.*$/i
const SOURCE_LINE_RE = /^\s*(\d{3}):(\*)?/
const TYPE_RE = /\bro[A-Z][A-Za-z0-9:_]*\b/g
const METHOD_CALL_RE = /\b[A-Za-z_][A-Za-z0-9_]*(?=\()/g
const REFCOUNT_RE = /\brefcnt=\d+\b/g
const LEVEL_PATH_RE = /\b(?<level>info|debug|warn|warning|error|fatal|trace)\/[A-Za-z0-9_.-]+(?::)?/gi
const BEACON_METRIC_RE = /\b(?:TimeBase|Duration|DialogTime)\([^)]*\)|\bPending Render Pass\b/g
const LEVEL_BRACKET_RE = /\[(?<tag>[^\]]+)\]/g
const BRIGHTSCRIPT_KEYWORD_RE = /\b(?:sub|function|end|if|then|else|elseif|for|each|to|step|next|while|exit|return|goto|stop|print|dim|as|integer|longinteger|long|float|double|string|boolean|object|dynamic|void|interface|invalid|true|false|and|or|not|mod)\b/gi
const VB_KEYWORD_RE = /\b(?:dim|as|if|then|else|elseif|end|for|each|next|while|wend|do|loop|until|select|case|function|sub|byref|byval|set|let|get|class|module|namespace|imports|public|private|protected|friend|shared|static|const|enum|structure|interface|inherits|implements|try|catch|finally|throw|throws|return|exit|continue|goto|with|not|and|or|xor|mod|is|isnot|nothing|me|mybase|myclass|new|property|synclock|using|addhandler|removehandler|handles|addressof|default|option|explicit|strict|infer|resume)\b/gi
const DEBUGGER_COMMAND_ROW_RE = /^(\s*[A-Za-z][\w|?<>]*)(\s{2,})(.+)$/
const DEBUGGER_HELP_PROSE_RE = /^\s*(?:Command List:|Type any expression\b|of the current function\b|to trigger a breakpoint\b|Then use 'c', 's', or other commands\.)/i

const JSON_TOKEN_RE = /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b|[{}\[\]:,]/g

/**
 * Module-scoped scratch arrays for tokenizeTerminalLine.
 * Single-threaded reuse optimization: these are grown as needed and written/read
 * only within one tokenizeTerminalLine call, so no stale data crosses call boundaries.
 * The active slice [0, scratchLength) is logically reset at the start of each call.
 */
let scratchKind: TerminalTokenKind[] = []
let scratchPriority: number[] = []

const PRIORITY_KEYWORD = 200
const PRIORITY_STRING = 210
const PRIORITY_COMMENT = 250
const PRIORITY_PROMPT = 300
const PRIORITY_URL = 310
const PRIORITY_JSON = 320
const PRIORITY_DEBUGGER_PROMPT = 330
/** Washes a whole line to a diagnostic severity color, above all normal tokens. */
const PRIORITY_DIAGNOSTIC_BLOCK = 400
/** Re-applies filePath over the diagnostic wash so pkg:/ paths keep their identity. */
const PRIORITY_DIAGNOSTIC_FILEPATH = 401

/**
 * Appends an overlay to the list only if an identical entry (same kind, start, end, and
 * value length) does not already exist. Prevents duplicate overlays from overlapping
 * regex passes or JSON/URL detection running over the same region twice.
 *
 * The seenKeys Set is maintained by the caller alongside the overlays array so that
 * membership testing is O(1) instead of an O(n) linear scan on every push.
 *
 * @param overlays - Mutable overlay array to append to.
 * @param seenKeys - Mutable Set of already-added keys, kept in sync with overlays.
 * @param overlay - Candidate overlay span to add.
 */
function pushOverlayUnique(overlays: TerminalOverlaySpan[], seenKeys: Set<string>, overlay: TerminalOverlaySpan): void {
    const key = `${overlay.kind}:${overlay.start}:${overlay.end}:${overlay.value.length}`
    if (!seenKeys.has(key)) {
        seenKeys.add(key)
        overlays.push(overlay)
    }
}

/** Returns true if two character ranges [aStart, aEnd) and [bStart, bEnd) overlap. */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
    return aStart < bEnd && bStart < aEnd
}

/**
 * Determines which character ranges within a terminal line are eligible for keyword
 * highlighting. This narrows keyword application to avoid false positives in:
 *  - Debugger help prose lines (plain English descriptions).
 *  - BrightScript debugger prompt lines (the prompt itself, not user input).
 *  - Debugger command-list rows (highlight only the command column, not the description).
 *
 * @param text - The raw terminal line text.
 * @returns Array of character ranges within which keyword patterns should be applied.
 */
function computeKeywordHighlightRanges(text: string): Array<{ start: number; end: number }> {
    if (!text) return []
    if (DEBUGGER_HELP_PROSE_RE.test(text)) return []
    if (BRIGHTSCRIPT_DEBUGGER_PROMPT_RE.test(text)) return []

    const commandRow = text.match(DEBUGGER_COMMAND_ROW_RE)
    if (commandRow && commandRow.index !== undefined) {
        // In debugger command-list rows, highlight only the command column, not prose description.
        const rowStart = commandRow.index
        const commandRaw = commandRow[1]
        const firstChar = commandRaw.search(/\S|$/)
        return [{ start: rowStart + firstChar, end: rowStart + commandRaw.length }]
    }

    return [{ start: 0, end: text.length }]
}

/**
 * Produces fine-grained token spans for a JSON snippet so each value type
 * (key, string, number, boolean, null, punctuation) receives its own color.
 *
 * @param raw - The raw JSON substring extracted from the terminal line.
 * @param offset - Character offset of `raw` within the full line, used to produce
 *   absolute start/end positions in the returned spans.
 * @returns Array of token spans with absolute positions relative to the full line.
 */
function tokenizeJsonSnippet(raw: string, offset: number): TerminalTokenSpan[] {
    const spans: TerminalTokenSpan[] = []
    JSON_TOKEN_RE.lastIndex = 0
    while (true) {
        const match = JSON_TOKEN_RE.exec(raw)
        if (!match) break
        const token = match[0]
        const start = offset + match.index
        const end = start + token.length
        const tail = raw.slice(match.index + token.length)
        let kind: TerminalTokenKind

        if (token.startsWith('"')) {
            const isKey = /^\s*:/.test(tail)
            kind = isKey ? 'objectKey' : 'objectStringValue'
        } else if (/^-?\d/.test(token)) {
            kind = 'objectNumberValue'
        } else if (token === 'true' || token === 'false') {
            kind = 'objectBooleanValue'
        } else if (token === 'null') {
            kind = 'objectNullValue'
        } else {
            kind = 'objectPunctuation'
        }
        spans.push({ start, end, kind })
    }
    return spans
}

type JsonCandidate = {
    start: number
    end: number
    rawForTokenize: string | null
    pretty: string
}

/**
 * Removes candidates that are entirely contained within another candidate so that
 * only the outermost JSON spans are kept. This prevents nested objects from each
 * receiving their own overlay when the parent already covers the same range.
 *
 * @param candidates - All detected JSON candidates for the current line, unsorted.
 * @returns Filtered list containing only non-nested (outermost) candidates.
 */
function filterOutNestedJsonCandidates(candidates: JsonCandidate[]): JsonCandidate[] {
    return candidates
        .sort((entryA, entryB) => (entryA.start - entryB.start) || (entryB.end - entryA.end))
        .filter((candidate, index, all) => {
            return !all.some((other, otherIndex) =>
                otherIndex !== index
                && other.start <= candidate.start
                && other.end >= candidate.end
                && (other.start !== candidate.start || other.end !== candidate.end))
        })
}

/**
 * Scans the terminal line for parseable JSON and produces overlay + token spans for each hit.
 *
 * Two detection strategies are used:
 *  1. Bracket scanning: finds '{' and '[' characters, resolves the matching closing bracket,
 *     and attempts JSON.parse on the enclosed text.
 *  2. Quoted string payloads: double-quoted strings that themselves contain valid JSON
 *     (e.g. log lines that print stringified objects).
 *
 * Nested candidates are filtered so only the outermost JSON region is annotated.
 *
 * @param text - The raw terminal line text.
 * @returns Object containing 'json' overlay spans (for the expand button) and fine-grained
 *   token spans for syntax colouring within each detected JSON region.
 */
function detectAndTokenizeJson(text: string): { overlays: TerminalOverlaySpan[]; spans: TerminalTokenSpan[]; seenKeys: Set<string> } {
    const candidates: JsonCandidate[] = []

    // 1) Raw JSON object/array snippets
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (ch !== '{' && ch !== '[') continue
        const end = findMatchingBracket(text, i)
        if (end < 0) continue
        const raw = text.slice(i, end + 1)
        if (raw.length < 3) continue
        try {
            const parsed = JSON.parse(raw)
            candidates.push({
                start: i,
                end: end + 1,
                rawForTokenize: raw,
                pretty: JSON.stringify(parsed, null, 4)
            })
        } catch {
            // Not strict JSON
        }
    }

    // 2) Quoted JSON string payloads, e.g. "{\"k\":1}"
    STRING_RE.lastIndex = 0
    while (true) {
        const match = STRING_RE.exec(text)
        if (!match) break
        const quoted = match[0]
        if (!quoted.startsWith('"')) continue
        try {
            const inner = JSON.parse(quoted) as unknown
            if (typeof inner !== 'string') continue
            const parsedInner = JSON.parse(inner)
            candidates.push({
                start: match.index,
                end: match.index + quoted.length,
                rawForTokenize: null,
                pretty: JSON.stringify(parsedInner, null, 4)
            })
            // Keep the outer quoted payload as a string token; don't remap chars inside escaped content.
        } catch {
            // Not embedded JSON
        }
    }

    const overlays: TerminalOverlaySpan[] = []
    const seenKeys: Set<string> = new Set()
    const spans: TerminalTokenSpan[] = []
    const filtered = filterOutNestedJsonCandidates(candidates)
    for (const candidate of filtered) {
        pushOverlayUnique(overlays, seenKeys, {
            start: candidate.start,
            end: candidate.end,
            kind: 'json',
            value: candidate.pretty
        })
        if (candidate.rawForTokenize) {
            spans.push(...tokenizeJsonSnippet(candidate.rawForTokenize, candidate.start))
        }
    }

    return { overlays, spans, seenKeys }
}

/**
 * Tokenizes a single raw terminal line from a Roku Telnet debug session into
 * syntax-highlighted spans and interactive overlays.
 *
 * The function maintains a per-character kind/priority array. Each regex pattern is
 * applied in order; a pattern only overwrites a character's kind when its priority
 * is >= the currently assigned priority. The final pass collapses adjacent characters
 * with the same kind into contiguous TerminalTokenSpan entries.
 *
 * When blockSeverity is provided the whole line is washed to that severity kind
 * at PRIORITY_DIAGNOSTIC_BLOCK (above every normal token), then FILE_PATH_RE is
 * re-applied at PRIORITY_DIAGNOSTIC_FILEPATH so pkg:/ paths keep their identity
 * and remain visually distinct from the surrounding severity color.
 *
 * @param text - The raw text content of one terminal line.
 * @param blockSeverity - Optional severity kind to tint the whole line. When set,
 *   normal tokens are overridden except for pkg:/ file paths.
 * @returns TerminalLineChunk containing the original text, an array of token spans
 *   for syntax highlighting, and an array of overlay spans for interactive elements
 *   (clickable URLs, expandable JSON objects).
 */
export function tokenizeTerminalLine(text: string, blockSeverity?: 'warning' | 'error'): TerminalLineChunk {
    const length = text.length
    // Grow scratch arrays if needed, then logically reset the active slice.
    if (scratchKind.length < length) {
        scratchKind = new Array(length).fill('plain')
        scratchPriority = new Array(length).fill(0)
    } else {
        for (let i = 0; i < length; i++) {
            scratchKind[i] = 'plain'
            scratchPriority[i] = 0
        }
    }
    const kindByIndex = scratchKind
    const priorityByIndex = scratchPriority
    const overlays: TerminalOverlaySpan[] = []
    const overlayKeys: Set<string> = new Set()
    const keywordRanges = computeKeywordHighlightRanges(text)

    const apply = (start: number, end: number, kind: TerminalTokenKind, priority: number) => {
        if (start < 0 || end <= start || end > length) return
        for (let i = start; i < end; i++) {
            if (priority >= priorityByIndex[i]) {
                priorityByIndex[i] = priority
                kindByIndex[i] = kind
            }
        }
    }

    const applyRegex = (regex: RegExp, kind: TerminalTokenKind, priority: number) => {
        regex.lastIndex = 0
        while (true) {
            const match = regex.exec(text)
            if (!match) break
            if (!match[0]) {
                regex.lastIndex += 1
                continue
            }
            apply(match.index, match.index + match[0].length, kind, priority)
        }
    }
    const applyRegexInRanges = (regex: RegExp, kind: TerminalTokenKind, priority: number, ranges: Array<{ start: number; end: number }>) => {
        if (ranges.length === 0) return
        regex.lastIndex = 0
        while (true) {
            const match = regex.exec(text)
            if (!match) break
            if (!match[0]) {
                regex.lastIndex += 1
                continue
            }
            const start = match.index
            const end = start + match[0].length
            if (!ranges.some((range) => overlaps(start, end, range.start, range.end))) continue
            apply(start, end, kind, priority)
        }
    }
    // Base generic parsing
    applyRegex(PROMPT_RE, 'prompt', PRIORITY_PROMPT)
    applyRegexInRanges(BRIGHTSCRIPT_KEYWORD_RE, 'keyword', PRIORITY_KEYWORD, keywordRanges)
    applyRegexInRanges(VB_KEYWORD_RE, 'keyword', PRIORITY_KEYWORD, keywordRanges)
    applyRegex(DASH_SEPARATOR_RE, 'separator', 260)
    applyRegex(STAR_SEPARATOR_RE, 'separator', 260)
    applyRegex(EQUALS_SEPARATOR_RE, 'separator', 260)
    applyRegex(COMMENT_RE, 'comment', PRIORITY_COMMENT)
    applyRegex(ERROR_RE, 'error', 280)
    applyRegex(HEX_RE, 'number', 235)
    applyRegex(UUID_RE, 'pathLike', 235)
    applyRegex(DATE_RE, 'dateTime', 230)
    applyRegex(SHORT_TIMESTAMP_RE, 'dateTime', 230)
    applyRegex(STRING_RE, 'string', PRIORITY_STRING)
    applyRegex(NUMBER_RE, 'number', 205)
    applyRegex(BOOLEAN_RE, 'boolean', 206)
    applyRegex(NULL_RE, 'nullish', 206)
    applyRegex(FILE_PATH_RE, 'filePath', 240)
    applyRegex(TYPE_RE, 'rokuType', 245)
    applyRegex(METHOD_CALL_RE, 'functionName', 215)
    applyRegex(REFCOUNT_RE, 'referenceMeta', 240)
    applyRegex(BEACON_METRIC_RE, 'beaconMetric', 240)

    if (SECTION_HEADER_RE.test(text)) {
        apply(0, text.length, 'sectionHeader', 270)
    }
    if (BRIGHTSCRIPT_ERROR_RE.test(text)) {
        apply(0, text.length, 'error', PRIORITY_PROMPT)
    }
    if (CONNECTED_RE.test(text)) {
        apply(0, text.length, 'debuggerBanner', 280)
    }
    if (BRIGHTSCRIPT_DEBUGGER_PROMPT_RE.test(text)) {
        apply(0, text.length, 'brightscriptDebuggerPrompt', PRIORITY_DEBUGGER_PROMPT)
    }
    if (DEBUGGER_BANNER_RE.test(text)) {
        apply(0, text.length, 'debuggerBanner', 270)
    }
    const threadRowMatch = text.match(THREAD_ROW_RE)
    if (threadRowMatch) apply(threadRowMatch.index ?? 0, (threadRowMatch.index ?? 0) + threadRowMatch[0].length, 'threadRow', 275)
    if (STACK_FRAME_RE.test(text)) {
        apply(0, text.length, 'stackFrame', 275)
    }
    const sourceLine = text.match(SOURCE_LINE_RE)
    if (sourceLine && sourceLine.index !== undefined) {
        const start = sourceLine.index
        const lineNumber = sourceLine[1]
        const marker = sourceLine[2]
        apply(start, start + lineNumber.length + 1, 'sourceLineNumber', 285)
        if (marker) {
            apply(start + lineNumber.length + 1, start + lineNumber.length + 2, 'selectedMarker', 290)
        }
    }
    const commandPrompt = text.match(COMMAND_PROMPT_RE)
    if (commandPrompt && text.startsWith('>')) {
        apply(0, 1, 'prompt', PRIORITY_PROMPT)
        if (commandPrompt[1]) {
            const cmdStart = text.indexOf(commandPrompt[1])
            if (cmdStart >= 0) apply(cmdStart, cmdStart + commandPrompt[1].length, 'functionName', 285)
        }
    }

    LEVEL_BRACKET_RE.lastIndex = 0
    while (true) {
        const match = LEVEL_BRACKET_RE.exec(text)
        if (!match) break
        const tag = (match.groups?.tag ?? '').trim()
        if (!tag) continue
        const lower = tag.toLowerCase()
        apply(match.index, match.index + match[0].length, 'logTag', 291)
        let kind: TerminalTokenKind = 'info'
        if (lower === 'i' || lower === 'info' || lower.startsWith('info.') || lower.startsWith('success.')) {
            kind = 'info'
        } else if (lower === 'd' || lower === 'debug') {
            kind = 'debug'
        } else if (lower === 't' || lower === 'trace') {
            kind = 'trace'
        } else if (lower === 'w' || lower === 'warn' || lower === 'warning' || lower.startsWith('warning.')) {
            kind = 'warning'
        } else if (lower === 'e' || lower === 'error' || lower === 'fatal' || lower.startsWith('error.')) {
            kind = 'error'
        }
        apply(match.index, match.index + match[0].length, kind, 295)
    }

    LEVEL_PATH_RE.lastIndex = 0
    while (true) {
        const match = LEVEL_PATH_RE.exec(text)
        if (!match) break
        const level = (match.groups?.level ?? '').toLowerCase()
        let kind: TerminalTokenKind = 'info'
        if (level === 'debug') kind = 'debug'
        else if (level === 'trace') kind = 'trace'
        else if (level === 'warn' || level === 'warning') kind = 'warning'
        else if (level === 'error' || level === 'fatal') kind = 'error'
        apply(match.index, match.index + match[0].length, kind, 292)
    }

    // URL overlays + URL/query tokenization
    URL_RE.lastIndex = 0
    while (true) {
        const match = URL_RE.exec(text)
        if (!match) break
        const value = match[0]
        const start = match.index
        const end = start + value.length
        pushOverlayUnique(overlays, overlayKeys, { start, end, kind: 'url', value })
        apply(start, end, 'url', PRIORITY_URL)

        const questionMarkIdx = value.indexOf('?')
        if (questionMarkIdx >= 0) {
            const queryStart = questionMarkIdx + 1
            const query = value.slice(queryStart)
            QUERY_RE.lastIndex = 0
            while (true) {
                const queryMatch = QUERY_RE.exec(query)
                if (!queryMatch || !queryMatch.groups) break
                const key = queryMatch.groups.key
                const val = queryMatch.groups.value
                if (!key || !val) continue
                const keyStart = queryStart + queryMatch.index
                const valStart = keyStart + key.length + 1 // +1 for '='
                apply(start + keyStart, start + keyStart + key.length, 'queryKey', 315)
                apply(start + valStart, start + valStart + val.length, 'queryValue', 315)
            }
        }
    }

    // Strict JSON detection + standard JSON tokenization (highest precedence)
    const jsonResult = detectAndTokenizeJson(text)
    for (const key of jsonResult.seenKeys) overlayKeys.add(key)
    for (const overlay of jsonResult.overlays) overlays.push(overlay)
    for (const span of jsonResult.spans) apply(span.start, span.end, span.kind, PRIORITY_JSON)

    // Remove URL overlays that fall entirely within a JSON overlay (e.g. URLs inside JSON string values)
    const jsonOverlays = overlays.filter(overlay => overlay.kind === 'json')
    for (let i = overlays.length - 1; i >= 0; i--) {
        const overlay = overlays[i]!
        if (overlay.kind === 'url' && jsonOverlays.some(j => overlay.start >= j.start && overlay.end <= j.end)) {
            overlays.splice(i, 1)
        }
    }

    if (blockSeverity !== undefined) {
        // Wash the whole line to the diagnostic severity color, overriding every
        // normal token so the block stands out as a unit.
        apply(0, length, blockSeverity, PRIORITY_DIAGNOSTIC_BLOCK)
        // Re-apply file paths above the wash so pkg:/ locations remain visually
        // distinct and keep any filePath-specific renderer behavior.
        applyRegex(FILE_PATH_RE, 'filePath', PRIORITY_DIAGNOSTIC_FILEPATH)
    }

    const tokens: TerminalTokenSpan[] = []
    if (length === 0) {
        tokens.push({ start: 0, end: 0, kind: 'plain' })
    } else {
        let start = 0
        let activeKind = kindByIndex[0]
        for (let i = 1; i < length; i++) {
            if (kindByIndex[i] !== activeKind) {
                tokens.push({ start, end: i, kind: activeKind })
                start = i
                activeKind = kindByIndex[i]
            }
        }
        tokens.push({ start, end: length, kind: activeKind })
    }

    return { text, tokens, overlays }
}
