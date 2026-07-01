/**
 * Pure overlay-compilation logic extracted from customTerminalView.tsx.
 *
 * All functions here are side-effect-free and React/DOM-agnostic. They operate
 * only on TerminalLineChunk data and produce RenderSegment / LineSegmentGroup
 * values that the component uses for virtualized rendering.
 *
 * Keeping this logic in a separate module makes it independently testable and
 * removes it from the React component's surface area.
 */
import { findMatchingBracket } from '../../../shared/jsonUtils'
import type { TerminalLineChunk, TerminalOverlaySpan, TerminalTokenSpan } from '../../../shared/terminal'
import type { TerminalSyntaxTheme } from '../../styles/terminalSyntaxThemes'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const JSON_SCAN_RADIUS = 40
export const JSON_DETECT_MAX_LINES = 600
export const JSON_DETECT_MAX_LINES_WRAPPED = 180

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RenderSegment = {
    text: string
    kind: TerminalTokenSpan['kind']
    overlay?: TerminalOverlaySpan
}

/** One interactive wrapper per logical JSON blob; buildSegments splits on tokenizer tokens so we merge runs. */
export type LineSegmentGroup =
    | {
        kind: 'json-group'
        groupKey: string
        overlay: TerminalOverlaySpan
        items: Array<{ segment: RenderSegment; thisStart: number; segIndex: number }>
    }
    | { kind: 'url'; overlay: TerminalOverlaySpan; items: Array<{ segment: RenderSegment; thisStart: number; segIndex: number }> }
    | { kind: 'plain'; segment: RenderSegment; thisStart: number; segIndex: number }

// ---------------------------------------------------------------------------
// JSON overlay detection
// ---------------------------------------------------------------------------

/**
 * Scan a window of lines around `lineIndex` for JSON objects/arrays that
 * overlap the target line. Each valid JSON value found becomes a
 * TerminalOverlaySpan with kind 'json' and a pretty-printed `value`.
 *
 * Uses findMatchingBracket() for bracket matching and JSON.parse() for
 * validation. Overlapping spans are de-duplicated and merged before return.
 */
export function detectJsonOverlaysForLine(lines: TerminalLineChunk[], lineIndex: number): TerminalOverlaySpan[] {
    const startLine = Math.max(0, lineIndex - JSON_SCAN_RADIUS)
    const endLine = Math.min(lines.length - 1, lineIndex + JSON_SCAN_RADIUS)
    if (endLine < startLine) return []

    const windowLines = lines.slice(startLine, endLine + 1)
    const lineOffsets: number[] = []
    let offset = 0
    for (let i = 0; i < windowLines.length; i++) {
        lineOffsets.push(offset)
        offset += windowLines[i].text.length + (i < windowLines.length - 1 ? 1 : 0)
    }
    const text = windowLines.map((line) => line.text).join('\n')
    const targetStart = lineOffsets[lineIndex - startLine]
    const targetEnd = targetStart + windowLines[lineIndex - startLine].text.length

    const overlays: TerminalOverlaySpan[] = []
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (ch !== '{' && ch !== '[') continue
        const end = findMatchingBracket(text, i)
        if (end < 0) continue
        const rangeStart = i
        const rangeEnd = end + 1
        if (rangeEnd <= targetStart || rangeStart >= targetEnd) continue
        const raw = text.slice(rangeStart, rangeEnd)
        if (raw.length < 3) continue
        try {
            const parsed = JSON.parse(raw)
            const overlapStart = Math.max(targetStart, rangeStart)
            const overlapEnd = Math.min(targetEnd, rangeEnd)
            overlays.push({
                start: overlapStart - targetStart,
                end: overlapEnd - targetStart,
                kind: 'json',
                // 4-space indent to match the main-process tokenizer (terminalTokenizer.ts),
                // so JSON opened from the viewer formats identically regardless of which
                // detection path (intra-line tokenizer vs multiline fallback) produced it.
                value: JSON.stringify(parsed, null, 4)
            })
        } catch {
            // Not valid JSON.
        }
    }

    const dedup = new Map<string, TerminalOverlaySpan>()
    for (const overlay of overlays) {
        const key = `${overlay.kind}:${overlay.start}:${overlay.end}`
        const existing = dedup.get(key)
        if (!existing || overlay.value.length > existing.value.length) {
            dedup.set(key, overlay)
        }
    }
    const merged = mergeJsonOverlaysForLine(Array.from(dedup.values()))
    return merged
}

/**
 * When the tokenizer already found a JSON object/array that spans the whole trimmed line,
 * multiline fallback detection only duplicates work (O(window x braces x JSON.parse)).
 */
export function tokenizerCoversTrimmedLineAsSingleJson(line: TerminalLineChunk): boolean {
    const text = line.text
    const start = text.search(/\S/)
    if (start === -1) return false
    let end = text.length
    while (end > start && /\s/.test(text[end - 1])) end--
    return line.overlays.some(
        (overlay) => overlay.kind === 'json' && overlay.start <= start && overlay.end >= end
    )
}

/**
 * Drop JSON overlay spans that are entirely contained within a wider sibling span.
 * Sorted by descending length so the largest span wins when two share the same range.
 */
export function mergeJsonOverlaysForLine(jsonOverlays: TerminalOverlaySpan[]): TerminalOverlaySpan[] {
    if (jsonOverlays.length <= 1) return jsonOverlays
    const sorted = [...jsonOverlays].sort((first, second) => second.end - second.start - (first.end - first.start))
    const kept: TerminalOverlaySpan[] = []
    for (const candidate of sorted) {
        if (kept.some((wider) => wider.start <= candidate.start && wider.end >= candidate.end)) continue
        kept.push(candidate)
    }
    return kept
}

/**
 * Return true when two overlay arrays are structurally identical (same length,
 * same start/end/kind/value at every position). Used to skip unnecessary line
 * object allocations when the cache produces the same data as the original line.
 */
export function overlaysShallowEqual(left: TerminalOverlaySpan[], right: TerminalOverlaySpan[]): boolean {
    if (left.length !== right.length) return false
    for (let i = 0; i < left.length; i++) {
        const leftOverlay = left[i]!
        const rightOverlay = right[i]!
        if (
            leftOverlay.start !== rightOverlay.start
            || leftOverlay.end !== rightOverlay.end
            || leftOverlay.kind !== rightOverlay.kind
            || leftOverlay.value !== rightOverlay.value
        ) {
            return false
        }
    }
    return true
}

/**
 * Merge multiline JSON fallback overlays from `cache` into a line's overlay list.
 * If the tokenizer already emitted a single JSON span covering the whole trimmed
 * line, the cache result is skipped to avoid redundant work. Returns the original
 * `line` object unchanged when the merged overlays are equal (referential stability).
 *
 * @param line - The terminal line to annotate.
 * @param cache - Map from line id to the fallback overlays computed by detectJsonOverlaysForLine.
 */
export function mergeTerminalLineWithJsonCache(
    line: TerminalLineChunk,
    cache: ReadonlyMap<number, TerminalOverlaySpan[]>
): TerminalLineChunk {
    const ovs = line.overlays
    const nonJson: TerminalOverlaySpan[] = []
    const tokenizerJson: TerminalOverlaySpan[] = []
    for (let i = 0; i < ovs.length; i++) {
        const overlay = ovs[i]!
        if (overlay.kind === 'json') tokenizerJson.push(overlay)
        else nonJson.push(overlay)
    }

    if (tokenizerCoversTrimmedLineAsSingleJson(line)) {
        const mergedOverlays = [...nonJson, ...mergeJsonOverlaysForLine(tokenizerJson)]
        return overlaysShallowEqual(mergedOverlays, line.overlays)
            ? line
            : { ...line, overlays: mergedOverlays }
    }

    const cached = line.id != null ? cache.get(line.id) : undefined
    if (!cached || cached.length === 0) return line
    const mergedJson = mergeJsonOverlaysForLine([...tokenizerJson, ...cached])
    const mergedOverlays = [...nonJson, ...mergedJson]
    return overlaysShallowEqual(mergedOverlays, line.overlays)
        ? line
        : { ...line, overlays: mergedOverlays }
}

// ---------------------------------------------------------------------------
// Overlay priority and picking
// ---------------------------------------------------------------------------

/**
 * Numeric priority used when two overlays compete for the same character position.
 * URL overlays beat JSON overlays so clickable links are always reachable.
 * Internal to this module; only pickOverlayAt uses it.
 */
function overlayPriority(overlay: TerminalOverlaySpan): number {
    return overlay.kind === 'url' ? 2 : 1
}

/** Resolve overlay at a character index without allocating a per-code-unit array (large lines). */
export function pickOverlayAt(pos: number, overlays: TerminalOverlaySpan[]): TerminalOverlaySpan | undefined {
    let best: TerminalOverlaySpan | undefined
    for (const overlay of overlays) {
        if (pos < overlay.start || pos >= overlay.end) continue
        if (!best) {
            best = overlay
            continue
        }
        const priorityDelta = overlayPriority(overlay) - overlayPriority(best)
        if (priorityDelta > 0) {
            best = overlay
            continue
        }
        if (priorityDelta < 0) continue
        // Same priority (e.g. json vs json): prefer wider span so a multi-line parent beats a nested chip.
        const spanWidth = (span: TerminalOverlaySpan) => span.end - span.start
        if (spanWidth(overlay) > spanWidth(best)) best = overlay
    }
    return best
}

// ---------------------------------------------------------------------------
// Segment building
// ---------------------------------------------------------------------------

/**
 * Convert a raw TerminalLineChunk into a flat array of RenderSegments ready for
 * React rendering. Each segment corresponds to a contiguous run of characters
 * that share the same token kind and overlay (or lack thereof).
 *
 * Iterates over the tokenizer spans and subdivides each one wherever the active
 * overlay changes, using pickOverlayAt() for O(overlays) lookup per position.
 */
export function buildSegments(chunk: TerminalLineChunk): RenderSegment[] {
    const { text, tokens, overlays } = chunk
    if (!text) return [{ text: '', kind: 'plain' }]
    const segments: RenderSegment[] = []

    for (const token of tokens) {
        if (token.end <= token.start || token.start >= text.length) continue
        const tokenStart = Math.max(0, token.start)
        const tokenEnd = Math.min(text.length, token.end)
        let runStart = tokenStart
        let runOverlay = pickOverlayAt(tokenStart, overlays)
        for (let i = tokenStart + 1; i < tokenEnd; i++) {
            const currentOverlay = pickOverlayAt(i, overlays)
            if (currentOverlay !== runOverlay) {
                segments.push({
                    text: text.slice(runStart, i),
                    kind: token.kind,
                    overlay: runOverlay
                })
                runStart = i
                runOverlay = currentOverlay
            }
        }
        segments.push({
            text: text.slice(runStart, tokenEnd),
            kind: token.kind,
            overlay: runOverlay
        })
    }

    return segments.length > 0 ? segments : [{ text, kind: 'plain' }]
}

// ---------------------------------------------------------------------------
// Group building
// ---------------------------------------------------------------------------

/**
 * Collapse a flat RenderSegment array into higher-level LineSegmentGroup entries
 * that can be rendered as single interactive DOM wrappers. Adjacent segments that
 * share the same JSON overlay key are fused into one json-group; URL segments are
 * similarly fused; anything else becomes a plain group. After the initial pass,
 * mergeJsonGroupsSplitByWhitespace() is called to bridge any whitespace-only plain
 * segments that split a logical JSON blob across two json-group entries.
 */
export function groupSegmentsForLine(lineIndex: number, segments: RenderSegment[]): LineSegmentGroup[] {
    const groups: LineSegmentGroup[] = []
    let segmentStart = 0
    let jsonGroupKey: string | null = null
    let jsonItems: Array<{ segment: RenderSegment; thisStart: number; segIndex: number }> = []
    let urlOverlay: TerminalOverlaySpan | null = null
    let urlItems: Array<{ segment: RenderSegment; thisStart: number; segIndex: number }> = []

    const flushJson = () => {
        if (jsonItems.length === 0 || jsonGroupKey == null) return
        groups.push({
            kind: 'json-group',
            groupKey: jsonGroupKey,
            overlay: jsonItems[0]!.segment.overlay!,
            items: jsonItems
        })
        jsonItems = []
        jsonGroupKey = null
    }

    const flushUrl = () => {
        if (urlItems.length === 0 || urlOverlay == null) return
        groups.push({ kind: 'url', overlay: urlOverlay, items: urlItems })
        urlItems = []
        urlOverlay = null
    }

    for (let segIndex = 0; segIndex < segments.length; segIndex++) {
        const segment = segments[segIndex]!
        const thisStart = segmentStart
        segmentStart += segment.text.length

        if (segment.overlay?.kind === 'json') {
            flushUrl()
            const key = overlayKey(lineIndex, segment.overlay)
            if (jsonGroupKey === key) {
                jsonItems.push({ segment, thisStart, segIndex })
            } else {
                flushJson()
                jsonGroupKey = key
                jsonItems = [{ segment, thisStart, segIndex }]
            }
            continue
        }

        flushJson()

        if (segment.overlay?.kind === 'url') {
            if (urlOverlay === segment.overlay) {
                urlItems.push({ segment, thisStart, segIndex })
            } else {
                flushUrl()
                urlOverlay = segment.overlay
                urlItems = [{ segment, thisStart, segIndex }]
            }
        } else {
            flushUrl()
            groups.push({ kind: 'plain', segment, thisStart, segIndex })
        }
    }
    flushJson()
    flushUrl()
    return mergeJsonGroupsSplitByWhitespace(groups)
}

/** Same logical JSON can appear as many segments; plain gaps that are only whitespace still sit between them in DOM order. */
export function mergeJsonGroupsSplitByWhitespace(groups: LineSegmentGroup[]): LineSegmentGroup[] {
    let current = groups
    let guard = 0
    while (guard++ < 50) {
        let changed = false
        const res: LineSegmentGroup[] = []
        for (let i = 0; i < current.length; ) {
            const firstGroup = current[i]
            const middleGroup = current[i + 1]
            const lastGroup = current[i + 2]
            if (
                firstGroup?.kind === 'json-group'
                && middleGroup?.kind === 'plain'
                && /^\s+$/.test(middleGroup.segment.text)
                && lastGroup?.kind === 'json-group'
                && lastGroup.groupKey === firstGroup.groupKey
            ) {
                res.push({
                    kind: 'json-group',
                    groupKey: firstGroup.groupKey,
                    overlay: firstGroup.overlay,
                    items: [
                        ...firstGroup.items,
                        { segment: middleGroup.segment, thisStart: middleGroup.thisStart, segIndex: middleGroup.segIndex },
                        ...lastGroup.items
                    ]
                })
                i += 3
                changed = true
                continue
            }
            res.push(firstGroup!)
            i++
        }
        current = res
        if (!changed) break
    }
    return current
}

// ---------------------------------------------------------------------------
// Overlay key and interaction id
// ---------------------------------------------------------------------------

/**
 * Produce a stable string key that identifies a unique logical overlay instance.
 * JSON overlays are keyed by content so that the same JSON blob on multiple lines
 * maps to one interaction group. URL overlays include the line index to keep
 * distinct even if the URL text repeats.
 */
export function overlayKey(lineIndex: number, overlay: TerminalOverlaySpan): string {
    if (overlay.kind === 'json') {
        return `json:${overlay.value.length}:${overlay.value.slice(0, 80)}`
    }
    return `${lineIndex}:${overlay.kind}:${overlay.start}:${overlay.end}:${overlay.value.length}`
}

/** Safe DOM id for data-json-ig (overlay key can contain quotes / long JSON). */
export function jsonGroupInteractionId(overlayKeyStr: string): string {
    let hash = 2166136261
    for (let i = 0; i < overlayKeyStr.length; i++) {
        hash ^= overlayKeyStr.charCodeAt(i)
        hash = Math.imul(hash, 16777619)
    }
    return `j${(hash >>> 0).toString(36)}`
}

// ---------------------------------------------------------------------------
// JSON color runs
// ---------------------------------------------------------------------------

/**
 * Tokenize a JSON string (typically a pretty-printed JSON value) into colored
 * runs for inline rendering inside a JSON overlay span. Uses a local regex (not
 * a module-level stateful /g regex) to prevent lastIndex leakage across calls.
 * Maps each token to the corresponding TerminalSyntaxTheme color.
 *
 * @param text - The JSON text to colorize (may be a single line or multi-line).
 * @param syntaxTheme - Active syntax theme supplying per-token colors.
 * @param fallbackColor - Color used for unrecognized characters between tokens.
 */
export function jsonColorRuns(text: string, syntaxTheme: TerminalSyntaxTheme, fallbackColor: string): Array<{ text: string; color: string }> {
    const JSON_TOKEN_RE = /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b|[{}\[\]:,]/g
    const runs: Array<{ text: string; color: string }> = []
    let cursor = 0

    while (true) {
        const match = JSON_TOKEN_RE.exec(text)
        if (!match) break
        const token = match[0]
        const start = match.index
        const end = start + token.length
        if (start > cursor) {
            runs.push({ text: text.slice(cursor, start), color: fallbackColor })
        }

        let color = fallbackColor
        const tokenAfter = text.slice(end)
        if (token.startsWith('"')) {
            const nextNonSpace = tokenAfter.match(/^\s*(:)?/)?.[1]
            color = nextNonSpace === ':'
                ? syntaxTheme.colors.objectKey
                : syntaxTheme.colors.objectStringValue
        } else if (/^-?\d/.test(token)) {
            color = syntaxTheme.colors.objectNumberValue
        } else if (token === 'true' || token === 'false') {
            color = syntaxTheme.colors.objectBooleanValue
        } else if (token === 'null') {
            color = syntaxTheme.colors.objectNullValue
        } else {
            color = syntaxTheme.colors.objectPunctuation
        }

        runs.push({ text: token, color })
        cursor = end
    }

    if (cursor < text.length) {
        runs.push({ text: text.slice(cursor), color: fallbackColor })
    }
    return runs.length > 0 ? runs : [{ text, color: fallbackColor }]
}
