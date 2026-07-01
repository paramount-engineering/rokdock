import { describe, it, expect } from 'vitest'
import { tokenizeTerminalLine } from '@main/utils/terminalTokenizer'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kindAt(text: string, index: number): string {
    const result = tokenizeTerminalLine(text)
    // Walk token spans to find which kind covers position `index`
    for (const token of result.tokens) {
        if (token.start <= index && index < token.end) return token.kind
    }
    return 'plain'
}

function hasOverlayKind(text: string, kind: string): boolean {
    const result = tokenizeTerminalLine(text)
    return result.overlays.some(overlay => overlay.kind === kind)
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

describe('tokenizeTerminalLine - plain text', () => {
    it('returns a single plain token for a line with no special content', () => {
        const result = tokenizeTerminalLine('hello world')
        expect(result.text).toBe('hello world')
        expect(result.tokens).toHaveLength(1)
        expect(result.tokens[0]!.kind).toBe('plain')
        expect(result.tokens[0]!.start).toBe(0)
        expect(result.tokens[0]!.end).toBe(11)
        expect(result.overlays).toHaveLength(0)
    })

    it('returns a plain token for an empty string with zero-length span', () => {
        const result = tokenizeTerminalLine('')
        expect(result.text).toBe('')
        expect(result.tokens).toHaveLength(1)
        expect(result.tokens[0]!.kind).toBe('plain')
        expect(result.tokens[0]!.start).toBe(0)
        expect(result.tokens[0]!.end).toBe(0)
        expect(result.overlays).toHaveLength(0)
    })

    it('returns a plain token for a whitespace-only line', () => {
        const result = tokenizeTerminalLine('   ')
        expect(result.tokens[0]!.kind).toBe('plain')
        expect(result.overlays).toHaveLength(0)
    })
})

// ---------------------------------------------------------------------------
// JSON detection and overlay
// ---------------------------------------------------------------------------

describe('tokenizeTerminalLine - JSON overlay', () => {
    it('produces a json overlay for an inline JSON object', () => {
        const text = 'log output: {"key":"value"}'
        const result = tokenizeTerminalLine(text)
        const jsonOverlay = result.overlays.find(overlay => overlay.kind === 'json')
        expect(jsonOverlay).toBeDefined()
        const start = text.indexOf('{')
        const end = text.lastIndexOf('}') + 1
        expect(jsonOverlay!.start).toBe(start)
        expect(jsonOverlay!.end).toBe(end)
        // value is pretty-printed with 4-space indent
        const parsed = JSON.parse(jsonOverlay!.value)
        expect(parsed).toEqual({ key: 'value' })
        expect(jsonOverlay!.value).toContain('    ')
    })

    it('produces a json overlay for an inline JSON array', () => {
        const text = 'items: [1,2,3]'
        const result = tokenizeTerminalLine(text)
        const jsonOverlay = result.overlays.find(overlay => overlay.kind === 'json')
        expect(jsonOverlay).toBeDefined()
        expect(JSON.parse(jsonOverlay!.value)).toEqual([1, 2, 3])
    })

    it('does not produce a json overlay for a JSON object shorter than 3 characters', () => {
        // "{}" is 2 chars - below the minimum
        const result = tokenizeTerminalLine('got {}')
        expect(result.overlays.find(overlay => overlay.kind === 'json')).toBeUndefined()
    })

    it('does not produce a json overlay for an unmatched opening brace', () => {
        const result = tokenizeTerminalLine('no close brace {')
        expect(result.overlays.find(overlay => overlay.kind === 'json')).toBeUndefined()
    })

    it('does not produce a json overlay for invalid JSON content', () => {
        // Has balanced braces but is not valid JSON
        const result = tokenizeTerminalLine('{not: valid json}')
        expect(result.overlays.find(overlay => overlay.kind === 'json')).toBeUndefined()
    })

    it('produces json token kinds inside the JSON region', () => {
        const text = '{"count":42}'
        const result = tokenizeTerminalLine(text)
        // "count" is at index 1-8, should be objectKey
        const keyStart = text.indexOf('"count"')
        expect(kindAt(text, keyStart)).toBe('objectKey')
        // 42 is at index 9-11, should be objectNumberValue
        const numStart = text.indexOf('42')
        expect(kindAt(text, numStart)).toBe('objectNumberValue')
    })

    it('removes URL overlays that fall entirely within a JSON overlay', () => {
        // A JSON object containing a URL should not produce a separate url overlay
        const text = '{"url":"http://example.com/path"}'
        const result = tokenizeTerminalLine(text)
        const urlOverlay = result.overlays.find(overlay => overlay.kind === 'url')
        expect(urlOverlay).toBeUndefined()
    })
})

// ---------------------------------------------------------------------------
// URL overlay
// ---------------------------------------------------------------------------

describe('tokenizeTerminalLine - URL overlay', () => {
    it('produces a url overlay for an HTTP URL', () => {
        const text = 'see https://example.com for details'
        const result = tokenizeTerminalLine(text)
        const urlOverlay = result.overlays.find(overlay => overlay.kind === 'url')
        expect(urlOverlay).toBeDefined()
        expect(urlOverlay!.value).toBe('https://example.com')
    })

    it('produces url token kind for the URL region', () => {
        const text = 'visit http://roku.com now'
        const urlStart = text.indexOf('http://')
        expect(kindAt(text, urlStart)).toBe('url')
    })

    it('tokenizes query key and value within a URL', () => {
        const text = 'http://device.local/launch/12345?contentId=abc&mediaType=movie'
        const result = tokenizeTerminalLine(text)
        const keyStart = text.indexOf('contentId')
        const valStart = text.indexOf('abc')
        expect(kindAt(text, keyStart)).toBe('queryKey')
        expect(kindAt(text, valStart)).toBe('queryValue')
    })
})

// ---------------------------------------------------------------------------
// Keyword highlighting
// ---------------------------------------------------------------------------

describe('tokenizeTerminalLine - keyword highlighting', () => {
    it('highlights a BrightScript keyword in regular code output', () => {
        const text = 'if x = 1 then return true'
        const result = tokenizeTerminalLine(text)
        // 'if', 'then', 'return', 'true' should all have keyword or boolean kind
        const ifStart = text.indexOf('if')
        const kind = kindAt(text, ifStart)
        expect(['keyword', 'boolean']).toContain(kind)
    })

    it('does NOT highlight keywords in the BrightScript debugger prompt line', () => {
        // The whole line is marked brightscriptDebuggerPrompt at higher priority
        const text = 'BrightScript Debugger> if true then'
        const result = tokenizeTerminalLine(text)
        // The entire line should be brightscriptDebuggerPrompt at high priority
        expect(result.tokens[0]!.kind).toBe('brightscriptDebuggerPrompt')
    })

    it('highlights "true" as boolean kind', () => {
        const text = 'result = true'
        const trueStart = text.indexOf('true')
        // boolean has priority 206, keyword has priority 200; boolean wins
        expect(kindAt(text, trueStart)).toBe('boolean')
    })

    it('highlights "null" and "invalid" as nullish kind', () => {
        const text = 'value = invalid'
        const invalidStart = text.indexOf('invalid')
        expect(kindAt(text, invalidStart)).toBe('nullish')
    })
})

// ---------------------------------------------------------------------------
// BrightScript debugger output patterns
// ---------------------------------------------------------------------------

describe('tokenizeTerminalLine - debugger output', () => {
    it('marks the BrightScript debugger prompt as brightscriptDebuggerPrompt', () => {
        const text = 'BrightScript Debugger> '
        const result = tokenizeTerminalLine(text)
        expect(result.tokens[0]!.kind).toBe('brightscriptDebuggerPrompt')
    })

    it('marks a section header line as sectionHeader', () => {
        const text = 'Backtrace'
        const result = tokenizeTerminalLine(text)
        expect(result.tokens[0]!.kind).toBe('sectionHeader')
    })

    it('marks "Local Variables" as sectionHeader', () => {
        const result = tokenizeTerminalLine('Local Variables')
        expect(result.tokens[0]!.kind).toBe('sectionHeader')
    })

    it('marks a stack frame line as stackFrame', () => {
        const text = '#0  Function main() As Void'
        const result = tokenizeTerminalLine(text)
        expect(result.tokens[0]!.kind).toBe('stackFrame')
    })

    it('marks a BrightScript ERROR line as error', () => {
        const text = 'BRIGHTSCRIPT: ERROR .Invalid member access on invalid value'
        const result = tokenizeTerminalLine(text)
        expect(result.tokens[0]!.kind).toBe('error')
    })

    it('marks a source line number as sourceLineNumber', () => {
        const text = '042: m.content = data'
        const result = tokenizeTerminalLine(text)
        const numStart = text.indexOf('042')
        expect(kindAt(text, numStart)).toBe('sourceLineNumber')
    })

    it('marks a pkg: file path as filePath', () => {
        const text = 'source: pkg:/components/MainScene.brs line 10'
        const pathStart = text.indexOf('pkg:/')
        expect(kindAt(text, pathStart)).toBe('filePath')
    })

    it('marks a roArray type identifier as rokuType', () => {
        const text = 'type is roArray'
        const typeStart = text.indexOf('roArray')
        expect(kindAt(text, typeStart)).toBe('rokuType')
    })

    it('marks a dash separator (5+ dashes) as separator', () => {
        const text = '-----'
        const result = tokenizeTerminalLine(text)
        expect(result.tokens[0]!.kind).toBe('separator')
    })

    it('marks a log tag like [ERROR] as error kind', () => {
        const text = '[ERROR] something went wrong'
        const tagStart = text.indexOf('[ERROR]')
        expect(kindAt(text, tagStart)).toBe('error')
    })

    it('marks a log tag like [DEBUG] as debug kind', () => {
        const text = '[DEBUG] checkpoint reached'
        const tagStart = text.indexOf('[DEBUG]')
        expect(kindAt(text, tagStart)).toBe('debug')
    })

    it('marks a "Connected to" line as debuggerBanner', () => {
        const text = 'Connected to 192.168.1.100:8085'
        const result = tokenizeTerminalLine(text)
        expect(result.tokens[0]!.kind).toBe('debuggerBanner')
    })

    it('marks a debugger banner line as debuggerBanner', () => {
        const text = 'BrightScript Micro Debugger.'
        const result = tokenizeTerminalLine(text)
        expect(result.tokens[0]!.kind).toBe('debuggerBanner')
    })
})

// ---------------------------------------------------------------------------
// Numbers, hex, dates
// ---------------------------------------------------------------------------

describe('tokenizeTerminalLine - number and date tokens', () => {
    it('marks a hex literal as number kind', () => {
        const text = 'value = 0xFF00'
        const hexStart = text.indexOf('0xFF00')
        expect(kindAt(text, hexStart)).toBe('number')
    })

    it('marks an ISO date as dateTime kind', () => {
        const text = 'timestamp: 2024-06-01'
        const dateStart = text.indexOf('2024-06-01')
        expect(kindAt(text, dateStart)).toBe('dateTime')
    })
})

// ---------------------------------------------------------------------------
// Token continuity invariant
// ---------------------------------------------------------------------------

describe('tokenizeTerminalLine - token continuity', () => {
    it('tokens cover the entire input text without gaps', () => {
        const texts = [
            'BrightScript Debugger> print m.content',
            '{"key":"val","n":42}',
            'pkg:/source/main.brs:42',
            'http://192.168.1.1:8060/query/media-player?x=1',
            '042: m.video = roVideoPlayer',
            ''
        ]
        for (const text of texts) {
            const result = tokenizeTerminalLine(text)
            let pos = 0
            for (const token of result.tokens) {
                expect(token.start).toBe(pos)
                pos = token.end
            }
            expect(pos).toBe(text.length)
        }
    })
})

// ---------------------------------------------------------------------------
// Equals separator (new)
// ---------------------------------------------------------------------------

describe('tokenizeTerminalLine - equals separator', () => {
    it('marks a run of 5 equals signs as separator', () => {
        const result = tokenizeTerminalLine('=====')
        expect(result.tokens[0]!.kind).toBe('separator')
    })

    it('marks a longer run of equals signs as separator', () => {
        const result = tokenizeTerminalLine('=================================================================')
        expect(result.tokens[0]!.kind).toBe('separator')
    })

    it('marks equals separator embedded mid-line as separator', () => {
        const text = 'before ===== after'
        const sepStart = text.indexOf('=====')
        expect(kindAt(text, sepStart)).toBe('separator')
    })

    it('does not mark 4 equals signs as separator', () => {
        const result = tokenizeTerminalLine('====')
        expect(result.tokens[0]!.kind).not.toBe('separator')
    })
})

// ---------------------------------------------------------------------------
// blockSeverity parameter (new)
// ---------------------------------------------------------------------------

describe('tokenizeTerminalLine - blockSeverity parameter', () => {
    it('washes a plain line to warning when blockSeverity is warning', () => {
        const text = 'Tried to set nonexistent field "foo" of a "Bar" node'
        const result = tokenizeTerminalLine(text, 'warning')
        // Every character should be warning (no filePath present)
        for (const token of result.tokens) {
            expect(token.kind).toBe('warning')
        }
    })

    it('washes a plain line to error when blockSeverity is error', () => {
        const text = 'Error occurred while setting a field'
        const result = tokenizeTerminalLine(text, 'error')
        for (const token of result.tokens) {
            expect(token.kind).toBe('error')
        }
    })

    it('re-applies filePath over the severity wash so pkg:/ paths stay filePath', () => {
        const text = '   at line 1802 of file pkg:/source/framework/utils.brs'
        const result = tokenizeTerminalLine(text, 'warning')
        const pathStart = text.indexOf('pkg:/')
        // The path region should be filePath, not warning
        const pathToken = result.tokens.find(token => token.start <= pathStart && pathStart < token.end)
        expect(pathToken?.kind).toBe('filePath')
        // Text before the path should be warning
        const beforeToken = result.tokens.find(token => token.start === 0)
        expect(beforeToken?.kind).toBe('warning')
    })

    it('re-applies filePath for error severity as well', () => {
        const text = 'at pkg:/source/app.brs line 42'
        const result = tokenizeTerminalLine(text, 'error')
        const pathStart = text.indexOf('pkg:/')
        const pathToken = result.tokens.find(token => token.start <= pathStart && pathStart < token.end)
        expect(pathToken?.kind).toBe('filePath')
    })

    it('produces unchanged output when no blockSeverity is provided', () => {
        const text = '-----'
        const withoutSeverity = tokenizeTerminalLine(text)
        const withUndefined = tokenizeTerminalLine(text, undefined)
        expect(withoutSeverity.tokens).toEqual(withUndefined.tokens)
        expect(withoutSeverity.tokens[0]!.kind).toBe('separator')
    })

    it('tokens still cover the full length under blockSeverity', () => {
        const text = '-- Tried to set nonexistent field "foo" at pkg:/src/main.brs'
        const result = tokenizeTerminalLine(text, 'warning')
        let pos = 0
        for (const token of result.tokens) {
            expect(token.start).toBe(pos)
            pos = token.end
        }
        expect(pos).toBe(text.length)
    })
})
