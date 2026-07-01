import { describe, it, expect } from 'vitest'
import type { TerminalLineChunk, TerminalOverlaySpan } from '@shared/terminal'
import type { TerminalSyntaxTheme } from '@renderer/styles/terminalSyntaxThemes'
import {
    detectJsonOverlaysForLine,
    mergeJsonOverlaysForLine,
    mergeTerminalLineWithJsonCache,
    overlaysShallowEqual,
    buildSegments,
    groupSegmentsForLine,
    mergeJsonGroupsSplitByWhitespace,
    overlayKey,
    jsonGroupInteractionId,
    jsonColorRuns,
    pickOverlayAt
} from '@renderer/components/terminal/overlayCompiler'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeLine(text: string, overlays: TerminalOverlaySpan[] = [], id?: number): TerminalLineChunk {
    return {
        id,
        text,
        tokens: [{ start: 0, end: text.length, kind: 'plain' }],
        overlays
    }
}

function jsonOverlay(start: number, end: number, value: string): TerminalOverlaySpan {
    return { start, end, kind: 'json', value }
}

function urlOverlay(start: number, end: number, value: string): TerminalOverlaySpan {
    return { start, end, kind: 'url', value }
}

const MINI_THEME: TerminalSyntaxTheme = {
    name: 'test',
    mode: 'dark',
    colors: {
        plain: '#fff',
        prompt: '#fff',
        brightscriptDebuggerPrompt: '#fff',
        comment: '#fff',
        separator: '#fff',
        debuggerBanner: '#fff',
        sectionHeader: '#fff',
        threadRow: '#fff',
        stackFrame: '#fff',
        sourceLineNumber: '#fff',
        selectedMarker: '#fff',
        logTag: '#fff',
        beaconMetric: '#fff',
        filePath: '#fff',
        referenceMeta: '#fff',
        rokuType: '#fff',
        functionName: '#fff',
        objectKey: '#KEY',
        objectPunctuation: '#PUNCT',
        objectStringValue: '#STR',
        objectNumberValue: '#NUM',
        objectBooleanValue: '#BOOL',
        objectNullValue: '#NULL',
        string: '#fff',
        number: '#fff',
        boolean: '#fff',
        nullish: '#fff',
        error: '#fff',
        warning: '#fff',
        info: '#fff',
        debug: '#fff',
        trace: '#fff',
        rokuSymbol: '#fff',
        keyword: '#fff',
        dateTime: '#fff',
        bracketContent: '#fff',
        pathLike: '#fff',
        url: '#fff',
        queryKey: '#fff',
        queryValue: '#fff'
    },
    background: '#000'
}

// ---------------------------------------------------------------------------
// detectJsonOverlaysForLine
// ---------------------------------------------------------------------------

describe('detectJsonOverlaysForLine', () => {
    it('returns empty array for a line with no JSON', () => {
        const lines = [makeLine('hello world')]
        const result = detectJsonOverlaysForLine(lines, 0)
        expect(result).toEqual([])
    })

    it('detects a single-line JSON object on the target line', () => {
        const obj = '{"a":1}'
        const lines = [makeLine(obj)]
        const result = detectJsonOverlaysForLine(lines, 0)
        expect(result.length).toBe(1)
        const overlay = result[0]!
        expect(overlay.kind).toBe('json')
        expect(overlay.start).toBe(0)
        expect(overlay.end).toBe(obj.length)
        // value should be pretty-printed (4-space indent)
        const parsed = JSON.parse(overlay.value)
        expect(parsed).toEqual({ a: 1 })
    })

    it('remaps multiline JSON coordinates to per-line offsets correctly', () => {
        // A JSON object whose opening brace is on line 0 and closing on line 1.
        // The target line is line 1 (the closing brace line).
        // line0: '{"a":'     (6 chars)
        // line1: '1}'         (2 chars)
        // The window text joined with \n: '{"a":\n1}'
        // The whole JSON span is [0, 8] in window text.
        // line1 starts at offset 7 in window text (6 chars + 1 newline).
        // On line 1: the JSON overlaps from 0 to 2 (the whole line).
        const line0 = makeLine('{"a":')
        const line1 = makeLine('1}')
        const lines = [line0, line1]
        const result = detectJsonOverlaysForLine(lines, 1)
        // The multiline JSON {"a":\n1} is valid JSON - JSON.parse accepts embedded newlines.
        expect(result.length).toBeGreaterThanOrEqual(1)
        const overlay = result.find((candidate) => candidate.start === 0 && candidate.end === 2)
        expect(overlay).toBeDefined()
        expect(overlay!.kind).toBe('json')
    })

    it('remaps multiline JSON: overlay on the opening line covers only partial line', () => {
        // line0: 'prefix {"a":'   -> JSON opens at offset 7
        // line1: '"b"}  suffix'   -> JSON closes at offset 4
        // Target line 0: the JSON starts at 7 and runs to end of line0 text.
        const line0 = makeLine('prefix {"a":')
        const line1 = makeLine('"b"} suffix')
        const lines = [line0, line1]
        const result = detectJsonOverlaysForLine(lines, 0)
        // The multiline JSON spans window chars 7..(len0+1+4)=7..17.
        // On line 0 the overlap is [7, 12] (end of line0 text length = 12).
        expect(result.length).toBeGreaterThanOrEqual(1)
        const overlay = result.find((candidate) => candidate.start === 7)
        expect(overlay).toBeDefined()
        expect(overlay!.end).toBe(line0.text.length)
    })

    it('returns empty array for a line beyond the end of the buffer', () => {
        const lines: TerminalLineChunk[] = []
        const result = detectJsonOverlaysForLine(lines, 0)
        expect(result).toEqual([])
    })

    it('ignores JSON-like fragments that are too short (length < 3)', () => {
        // "{}" is 2 chars - below the minimum of 3.
        const lines = [makeLine('{}')]
        const result = detectJsonOverlaysForLine(lines, 0)
        expect(result).toEqual([])
    })

    it('ignores invalid JSON', () => {
        const lines = [makeLine('{not json}')]
        const result = detectJsonOverlaysForLine(lines, 0)
        expect(result).toEqual([])
    })
})

// ---------------------------------------------------------------------------
// mergeJsonOverlaysForLine
// ---------------------------------------------------------------------------

describe('mergeJsonOverlaysForLine', () => {
    it('returns input unchanged when there is only one overlay', () => {
        const overlays = [jsonOverlay(0, 10, '{}')]
        expect(mergeJsonOverlaysForLine(overlays)).toBe(overlays)
    })

    it('removes an overlay that is entirely contained within a wider sibling', () => {
        const outer = jsonOverlay(0, 20, '{"outer":{"inner":1}}')
        const inner = jsonOverlay(9, 18, '{"inner":1}')
        const result = mergeJsonOverlaysForLine([outer, inner])
        expect(result.length).toBe(1)
        expect(result[0]).toEqual(outer)
    })

    it('keeps non-overlapping overlays', () => {
        const first = jsonOverlay(0, 5, '[1,2]')
        const second = jsonOverlay(10, 20, '{"a":"b"}')
        const result = mergeJsonOverlaysForLine([first, second])
        expect(result.length).toBe(2)
    })

    it('when two overlays share exact range, keeps the one with more content (longest value)', () => {
        // Both cover the same start/end. detectJsonOverlaysForLine deduplicates by
        // key before calling merge, so merge sees distinct positions here. Instead
        // test that the sort puts wider span first.
        const wider = jsonOverlay(0, 20, '{"x":{"y":1},"z":2}')
        const narrower = jsonOverlay(3, 15, '{"y":1}')
        const result = mergeJsonOverlaysForLine([narrower, wider])
        // wider encloses narrower -> only wider survives
        expect(result.length).toBe(1)
        expect(result[0]).toEqual(wider)
    })

    it('keeps both when spans partially overlap (neither contains the other)', () => {
        // [0,10] and [5,15] - neither fully contains the other
        const first = jsonOverlay(0, 10, '[1,2,3,4,5]')
        const second = jsonOverlay(5, 15, '{"a":1,"b":2}')
        const result = mergeJsonOverlaysForLine([first, second])
        expect(result.length).toBe(2)
    })
})

// ---------------------------------------------------------------------------
// overlaysShallowEqual
// ---------------------------------------------------------------------------

describe('overlaysShallowEqual', () => {
    it('returns true for two empty arrays', () => {
        expect(overlaysShallowEqual([], [])).toBe(true)
    })

    it('returns false when lengths differ', () => {
        expect(overlaysShallowEqual([jsonOverlay(0, 5, '{}')], [])).toBe(false)
    })

    it('returns true for structurally identical arrays', () => {
        const left = [jsonOverlay(0, 5, '[1]'), jsonOverlay(10, 20, '{"x":1}')]
        const right = [jsonOverlay(0, 5, '[1]'), jsonOverlay(10, 20, '{"x":1}')]
        expect(overlaysShallowEqual(left, right)).toBe(true)
    })

    it('returns false when start differs', () => {
        const left = [jsonOverlay(0, 5, '[1]')]
        const right = [jsonOverlay(1, 5, '[1]')]
        expect(overlaysShallowEqual(left, right)).toBe(false)
    })

    it('returns false when end differs', () => {
        const left = [jsonOverlay(0, 5, '[1]')]
        const right = [jsonOverlay(0, 6, '[1]')]
        expect(overlaysShallowEqual(left, right)).toBe(false)
    })

    it('returns false when kind differs', () => {
        const left: TerminalOverlaySpan[] = [{ start: 0, end: 5, kind: 'json', value: 'x' }]
        const right: TerminalOverlaySpan[] = [{ start: 0, end: 5, kind: 'url', value: 'x' }]
        expect(overlaysShallowEqual(left, right)).toBe(false)
    })

    it('returns false when value differs', () => {
        const left = [jsonOverlay(0, 5, '[1]')]
        const right = [jsonOverlay(0, 5, '[2]')]
        expect(overlaysShallowEqual(left, right)).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// mergeTerminalLineWithJsonCache
// ---------------------------------------------------------------------------

describe('mergeTerminalLineWithJsonCache', () => {
    it('returns the original line reference when no cache entry exists', () => {
        const line = makeLine('hello', [], 1)
        const cache = new Map<number, TerminalOverlaySpan[]>()
        expect(mergeTerminalLineWithJsonCache(line, cache)).toBe(line)
    })

    it('returns the original line reference when cache adds overlays equal to existing ones (referential stability)', () => {
        const ov = jsonOverlay(0, 5, '[1,2]')
        const line = makeLine('[1,2]', [ov], 1)
        const cache = new Map([[1, [ov]]])
        // Both tokenizer json and cache produce the same overlay -> should be stable.
        // The tokenizer json list is merged with cache; here they are identical so
        // overlaysShallowEqual should detect that and return the same line object.
        const result = mergeTerminalLineWithJsonCache(line, cache)
        expect(result).toBe(line)
    })

    it('returns a new line object when cache adds a wider span not in the original overlays', () => {
        const line = makeLine('{"a":1}', [], 42)
        const cacheOverlay = jsonOverlay(0, 7, '{"a":1}')
        const cache = new Map([[42, [cacheOverlay]]])
        const result = mergeTerminalLineWithJsonCache(line, cache)
        expect(result).not.toBe(line)
        expect(result.overlays.length).toBe(1)
        expect(result.overlays[0]).toEqual(cacheOverlay)
    })

    it('preserves non-json overlays (e.g. url) through the merge', () => {
        const urlOv = urlOverlay(0, 10, 'http://x.com')
        const line = makeLine('http://x.com text', [urlOv], 7)
        const cacheOverlay = jsonOverlay(13, 17, '[1]')
        const cache = new Map([[7, [cacheOverlay]]])
        const result = mergeTerminalLineWithJsonCache(line, cache)
        expect(result.overlays).toContainEqual(urlOv)
        expect(result.overlays).toContainEqual(cacheOverlay)
    })

    it('skips cache when tokenizer already covers the whole trimmed line as a single json overlay', () => {
        // The tokenizer overlay covers the full trimmed text, so the cache result should be ignored.
        const text = '{"a":1}'
        const tokenizerOv = jsonOverlay(0, text.length, text)
        const line = makeLine(text, [tokenizerOv], 99)
        // Cache has a different (smaller) overlay - it should not be merged in.
        const cacheOverlay = jsonOverlay(1, 4, '"a"')
        const cache = new Map([[99, [cacheOverlay]]])
        const result = mergeTerminalLineWithJsonCache(line, cache)
        // The tokenizer overlay covers the entire trimmed line, so the function
        // skips the cache and returns based on merging only the tokenizer json.
        // Overlays won't contain the cacheOverlay.
        expect(result.overlays.every((overlay) => overlay !== cacheOverlay)).toBe(true)
    })

    it('returns original line when id is undefined (no cache lookup possible)', () => {
        const line = makeLine('{"x":1}') // no id
        const cacheOverlay = jsonOverlay(0, 7, '{"x":1}')
        const cache = new Map([[0, [cacheOverlay]]])
        // id is undefined so cache.get(undefined) returns undefined -> return line unchanged
        expect(mergeTerminalLineWithJsonCache(line, cache)).toBe(line)
    })
})

// ---------------------------------------------------------------------------
// pickOverlayAt
// ---------------------------------------------------------------------------

describe('pickOverlayAt', () => {
    it('returns undefined when there are no overlays', () => {
        expect(pickOverlayAt(5, [])).toBeUndefined()
    })

    it('returns the overlay that covers the position', () => {
        const ov = jsonOverlay(3, 10, '[1]')
        expect(pickOverlayAt(5, [ov])).toBe(ov)
    })

    it('returns undefined when position is outside all overlays', () => {
        const ov = jsonOverlay(3, 10, '[1]')
        expect(pickOverlayAt(10, [ov])).toBeUndefined() // end is exclusive
        expect(pickOverlayAt(2, [ov])).toBeUndefined()
    })

    it('prefers url over json when both cover the same position', () => {
        const json = jsonOverlay(0, 20, '{"url":"http://x"}')
        const url = urlOverlay(8, 18, 'http://x')
        expect(pickOverlayAt(10, [json, url])).toBe(url)
        expect(pickOverlayAt(10, [url, json])).toBe(url)
    })

    it('prefers wider json span when two json overlays cover the same position', () => {
        const outer = jsonOverlay(0, 20, '{"outer":{"inner":1}}')
        const inner = jsonOverlay(9, 18, '{"inner":1}')
        // Both cover position 12; outer is wider.
        expect(pickOverlayAt(12, [inner, outer])).toBe(outer)
        expect(pickOverlayAt(12, [outer, inner])).toBe(outer)
    })
})

// ---------------------------------------------------------------------------
// buildSegments
// ---------------------------------------------------------------------------

describe('buildSegments', () => {
    it('returns a single plain segment for empty text', () => {
        const chunk: TerminalLineChunk = { text: '', tokens: [], overlays: [] }
        const segs = buildSegments(chunk)
        expect(segs.length).toBe(1)
        expect(segs[0]).toEqual({ text: '', kind: 'plain' })
    })

    it('splits a token on overlay boundaries', () => {
        // text: "hello [1,2] world"
        // token: whole line as plain
        // overlay: [6, 11] covers "[1,2]"
        const text = 'hello [1,2] world'
        const ov = jsonOverlay(6, 11, '[1,2]')
        const chunk: TerminalLineChunk = {
            text,
            tokens: [{ start: 0, end: text.length, kind: 'plain' }],
            overlays: [ov]
        }
        const segs = buildSegments(chunk)
        // Expect three segments: "hello ", "[1,2]" (with overlay), " world"
        expect(segs.length).toBe(3)
        expect(segs[0]!.text).toBe('hello ')
        expect(segs[0]!.overlay).toBeUndefined()
        expect(segs[1]!.text).toBe('[1,2]')
        expect(segs[1]!.overlay).toBe(ov)
        expect(segs[2]!.text).toBe(' world')
        expect(segs[2]!.overlay).toBeUndefined()
    })

    it('returns plain segment for text with no tokens', () => {
        const text = 'no tokens here'
        const chunk: TerminalLineChunk = { text, tokens: [], overlays: [] }
        const segs = buildSegments(chunk)
        expect(segs[0]).toEqual({ text, kind: 'plain' })
    })
})

// ---------------------------------------------------------------------------
// groupSegmentsForLine + mergeJsonGroupsSplitByWhitespace
// ---------------------------------------------------------------------------

describe('groupSegmentsForLine', () => {
    it('groups a plain segment with no overlay as a plain group', () => {
        const chunk = makeLine('hello world')
        const segs = buildSegments(chunk)
        const groups = groupSegmentsForLine(0, segs)
        expect(groups.length).toBe(1)
        expect(groups[0]!.kind).toBe('plain')
    })

    it('groups a json-overlay segment as a json-group', () => {
        const text = '{"a":1}'
        const ov = jsonOverlay(0, text.length, text)
        const chunk: TerminalLineChunk = {
            text,
            tokens: [{ start: 0, end: text.length, kind: 'plain' }],
            overlays: [ov]
        }
        const segs = buildSegments(chunk)
        const groups = groupSegmentsForLine(0, segs)
        expect(groups.length).toBe(1)
        expect(groups[0]!.kind).toBe('json-group')
    })

    it('produces a url group for url overlays', () => {
        const text = 'see http://x.com here'
        const ov = urlOverlay(4, 16, 'http://x.com')
        const chunk: TerminalLineChunk = {
            text,
            tokens: [{ start: 0, end: text.length, kind: 'plain' }],
            overlays: [ov]
        }
        const segs = buildSegments(chunk)
        const groups = groupSegmentsForLine(0, segs)
        expect(groups.some((group) => group.kind === 'url')).toBe(true)
    })
})

describe('mergeJsonGroupsSplitByWhitespace', () => {
    it('merges two same-key json-groups separated only by a whitespace plain segment', () => {
        const ov = jsonOverlay(0, 15, '{"a":1}')
        const key = overlayKey(0, ov)

        const groupA = {
            kind: 'json-group' as const,
            groupKey: key,
            overlay: ov,
            items: [{ segment: { text: '{"a":', kind: 'plain' as const, overlay: ov }, thisStart: 0, segIndex: 0 }]
        }
        const whitespace = {
            kind: 'plain' as const,
            segment: { text: ' ', kind: 'plain' as const },
            thisStart: 5,
            segIndex: 1
        }
        const groupB = {
            kind: 'json-group' as const,
            groupKey: key,
            overlay: ov,
            items: [{ segment: { text: '1}', kind: 'plain' as const, overlay: ov }, thisStart: 6, segIndex: 2 }]
        }

        const result = mergeJsonGroupsSplitByWhitespace([groupA, whitespace, groupB])
        expect(result.length).toBe(1)
        expect(result[0]!.kind).toBe('json-group')
        if (result[0]!.kind === 'json-group') {
            expect(result[0]!.items.length).toBe(3) // a items + whitespace + b items
        }
    })

    it('does not merge json-groups with different keys', () => {
        const ov1 = jsonOverlay(0, 7, '{"a":1}')
        const ov2 = jsonOverlay(10, 17, '{"b":2}')
        const key1 = overlayKey(0, ov1)
        const key2 = overlayKey(0, ov2)

        const groupA = {
            kind: 'json-group' as const,
            groupKey: key1,
            overlay: ov1,
            items: [{ segment: { text: '{"a":1}', kind: 'plain' as const, overlay: ov1 }, thisStart: 0, segIndex: 0 }]
        }
        const whitespace = {
            kind: 'plain' as const,
            segment: { text: '   ', kind: 'plain' as const },
            thisStart: 7,
            segIndex: 1
        }
        const groupB = {
            kind: 'json-group' as const,
            groupKey: key2,
            overlay: ov2,
            items: [{ segment: { text: '{"b":2}', kind: 'plain' as const, overlay: ov2 }, thisStart: 10, segIndex: 2 }]
        }

        const result = mergeJsonGroupsSplitByWhitespace([groupA, whitespace, groupB])
        expect(result.length).toBe(3)
    })

    it('does not merge when the middle segment is non-whitespace plain', () => {
        const ov = jsonOverlay(0, 7, '{"a":1}')
        const key = overlayKey(0, ov)

        const groupA = {
            kind: 'json-group' as const,
            groupKey: key,
            overlay: ov,
            items: [{ segment: { text: '{"a":', kind: 'plain' as const, overlay: ov }, thisStart: 0, segIndex: 0 }]
        }
        const nonWs = {
            kind: 'plain' as const,
            segment: { text: 'x', kind: 'plain' as const },
            thisStart: 5,
            segIndex: 1
        }
        const groupB = {
            kind: 'json-group' as const,
            groupKey: key,
            overlay: ov,
            items: [{ segment: { text: '1}', kind: 'plain' as const, overlay: ov }, thisStart: 6, segIndex: 2 }]
        }

        const result = mergeJsonGroupsSplitByWhitespace([groupA, nonWs, groupB])
        expect(result.length).toBe(3)
    })
})

// ---------------------------------------------------------------------------
// overlayKey + jsonGroupInteractionId
// ---------------------------------------------------------------------------

describe('overlayKey', () => {
    it('is deterministic for the same json overlay', () => {
        const ov = jsonOverlay(0, 10, '{"x":1}')
        expect(overlayKey(0, ov)).toBe(overlayKey(0, ov))
    })

    it('uses value-based key for json overlays (not position-based)', () => {
        // Same value on different lines or positions should produce the same key.
        const ov1 = jsonOverlay(0, 7, '{"x":1}')
        const ov2 = jsonOverlay(5, 12, '{"x":1}')
        expect(overlayKey(0, ov1)).toBe(overlayKey(99, ov2))
    })

    it('uses position-based key for url overlays', () => {
        const ov1 = urlOverlay(0, 10, 'http://x.com')
        const ov2 = urlOverlay(0, 10, 'http://x.com')
        // Same line index and same position -> same key
        expect(overlayKey(3, ov1)).toBe(overlayKey(3, ov2))
        // Different line index -> different key
        expect(overlayKey(3, ov1)).not.toBe(overlayKey(4, ov1))
    })

    it('json key format starts with "json:" prefix', () => {
        const ov = jsonOverlay(0, 7, '{"x":1}')
        expect(overlayKey(0, ov)).toMatch(/^json:/)
    })
})

describe('jsonGroupInteractionId', () => {
    it('is deterministic for the same input', () => {
        const key = 'json:7:{"x":1}'
        expect(jsonGroupInteractionId(key)).toBe(jsonGroupInteractionId(key))
    })

    it('starts with "j" prefix', () => {
        expect(jsonGroupInteractionId('some-key')).toMatch(/^j/)
    })

    it('produces different ids for different keys', () => {
        const id1 = jsonGroupInteractionId('json:7:{"x":1}')
        const id2 = jsonGroupInteractionId('json:7:{"x":2}')
        expect(id1).not.toBe(id2)
    })

    it('produces a stable id regardless of how it is called (no stateful side effects)', () => {
        const key = 'json:20:{"a":1,"b":"hello world"}   '
        const first = jsonGroupInteractionId(key)
        const second = jsonGroupInteractionId(key)
        const third = jsonGroupInteractionId(key)
        expect(first).toBe(second)
        expect(second).toBe(third)
    })
})

// ---------------------------------------------------------------------------
// jsonColorRuns
// ---------------------------------------------------------------------------

describe('jsonColorRuns', () => {
    const FALLBACK = '#FALLBACK'

    it('colors object keys with objectKey color', () => {
        const json = '{"name":"value"}'
        const runs = jsonColorRuns(json, MINI_THEME, FALLBACK)
        const keyRun = runs.find((run) => run.text === '"name"')
        expect(keyRun).toBeDefined()
        expect(keyRun!.color).toBe('#KEY')
    })

    it('colors string values with objectStringValue color', () => {
        const json = '{"name":"hello"}'
        const runs = jsonColorRuns(json, MINI_THEME, FALLBACK)
        const strRun = runs.find((run) => run.text === '"hello"')
        expect(strRun).toBeDefined()
        expect(strRun!.color).toBe('#STR')
    })

    it('colors numeric values with objectNumberValue color', () => {
        const json = '{"count":42}'
        const runs = jsonColorRuns(json, MINI_THEME, FALLBACK)
        const numRun = runs.find((run) => run.text === '42')
        expect(numRun).toBeDefined()
        expect(numRun!.color).toBe('#NUM')
    })

    it('colors boolean values with objectBooleanValue color', () => {
        const json = '{"ok":true}'
        const runs = jsonColorRuns(json, MINI_THEME, FALLBACK)
        const boolRun = runs.find((run) => run.text === 'true')
        expect(boolRun).toBeDefined()
        expect(boolRun!.color).toBe('#BOOL')
    })

    it('colors null values with objectNullValue color', () => {
        const json = '{"x":null}'
        const runs = jsonColorRuns(json, MINI_THEME, FALLBACK)
        const nullRun = runs.find((run) => run.text === 'null')
        expect(nullRun).toBeDefined()
        expect(nullRun!.color).toBe('#NULL')
    })

    it('colors punctuation with objectPunctuation color', () => {
        const json = '{"a":1}'
        const runs = jsonColorRuns(json, MINI_THEME, FALLBACK)
        const punctRuns = runs.filter((run) => run.color === '#PUNCT')
        // Should have at least { and }
        expect(punctRuns.length).toBeGreaterThanOrEqual(2)
    })

    it('returns a single fallback run for empty string', () => {
        const runs = jsonColorRuns('', MINI_THEME, FALLBACK)
        expect(runs).toEqual([{ text: '', color: FALLBACK }])
    })

    it('produces runs that concatenate back to the original text', () => {
        const json = '{"name":"Alice","age":30,"active":true,"extra":null}'
        const runs = jsonColorRuns(json, MINI_THEME, FALLBACK)
        const reconstructed = runs.map((run) => run.text).join('')
        expect(reconstructed).toBe(json)
    })

    it('handles negative numbers correctly', () => {
        const json = '{"delta":-5}'
        const runs = jsonColorRuns(json, MINI_THEME, FALLBACK)
        const numRun = runs.find((run) => run.text === '-5')
        expect(numRun).toBeDefined()
        expect(numRun!.color).toBe('#NUM')
    })

    it('handles floating-point numbers', () => {
        const json = '{"pi":3.14}'
        const runs = jsonColorRuns(json, MINI_THEME, FALLBACK)
        const numRun = runs.find((run) => run.text === '3.14')
        expect(numRun).toBeDefined()
        expect(numRun!.color).toBe('#NUM')
    })

    // NOTE: Potential latent bug found during testing.
    // The regex for object keys is: /"(?:\\.|[^"\\])*"(?=\s*:)/
    // For false and null, the color is objectBooleanValue / objectNullValue respectively.
    // However, 'false' matched against /^-?\d/ is false, which is correct.
    // 'false' goes to the boolean branch (token === 'true' || token === 'false') -> correct.
    it('colors false with objectBooleanValue color', () => {
        const json = '{"flag":false}'
        const runs = jsonColorRuns(json, MINI_THEME, FALLBACK)
        const boolRun = runs.find((run) => run.text === 'false')
        expect(boolRun).toBeDefined()
        expect(boolRun!.color).toBe('#BOOL')
    })
})
