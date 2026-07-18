import { describe, it, expect } from 'vitest'
import {
    formatJson,
    minifyJson,
    findEnclosingSpan,
    sortJsonValue,
    reindentJson,
    lineIndentAt,
    decodeNestedJson,
    utf8ByteLength,
    isJsonlContent,
    isJsonlMode,
    expandJsonl,
    compactJsonl,
    jsonlRecordErrors,
    countJsonlRecords,
} from '@renderer/jsonFormat'

// utf8ByteLength

describe('utf8ByteLength', () => {
    const encoder = new TextEncoder()
    // Each case must match TextEncoder exactly, across the 1/2/3/4-byte ranges.
    const cases = [
        '',
        'plain ascii {}[]',
        'a', // 1 byte
        '\u00e9', // 2 bytes
        '\u20ac', // 3 bytes
        '\u{1f600}', // 4 bytes (surrogate pair)
        `{"emoji":"\u{1f600}","accent":"caf\u00e9","euro":"\u20ac"}`,
        `mixed \u{1f600} \u00e9 \u20ac text`,
    ]
    for (const text of cases) {
        it(`matches TextEncoder for ${JSON.stringify(text)}`, () => {
            expect(utf8ByteLength(text)).toBe(encoder.encode(text).length)
        })
    }

    it('treats a lone surrogate as U+FFFD (3 bytes), like TextEncoder', () => {
        const loneSurrogate = '\ud83d' // high surrogate with no low surrogate following
        expect(utf8ByteLength(loneSurrogate)).toBe(encoder.encode(loneSurrogate).length)
        expect(utf8ByteLength(loneSurrogate)).toBe(3)
    })
})

// formatJson

describe('formatJson', () => {
    it('formats compact JSON with 2-space indentation', () => {
        const result = formatJson('{"a":1,"b":2}')
        expect(result).toBe('{\n  "a": 1,\n  "b": 2\n}')
    })

    it('round-trips already-formatted JSON unchanged', () => {
        const input = '{\n  "a": 1\n}'
        expect(formatJson(input)).toBe(input)
    })

    it('throws on invalid JSON', () => {
        expect(() => formatJson('{bad}')).toThrow()
    })
})

// minifyJson

describe('minifyJson', () => {
    it('removes all whitespace from formatted JSON', () => {
        const result = minifyJson('{\n    "a": 1,\n    "b": 2\n}')
        expect(result).toBe('{"a":1,"b":2}')
    })

    it('round-trips already-minified JSON unchanged', () => {
        const input = '{"x":true}'
        expect(minifyJson(input)).toBe(input)
    })

    it('throws on invalid JSON', () => {
        expect(() => minifyJson('[1,2,')).toThrow()
    })
})

// findEnclosingSpan

describe('findEnclosingSpan', () => {
    it('finds the enclosing object when cursor is inside', () => {
        const text = '{"a":1}'
        // Cursor on the 'a' key (index 2)
        const span = findEnclosingSpan(text, 2)
        expect(span).toEqual({ start: 0, end: 6 })
    })

    it('finds the enclosing array when cursor is inside', () => {
        const text = '[1,2,3]'
        const span = findEnclosingSpan(text, 3)
        expect(span).toEqual({ start: 0, end: 6 })
    })

    it('returns null when cursor is outside any bracket pair', () => {
        const text = 'null'
        const span = findEnclosingSpan(text, 2)
        expect(span).toBeNull()
    })

    it('finds the innermost bracket pair for nested structures', () => {
        const text = '{"outer":{"inner":1}}'
        // Cursor at index 17 (inside the inner object)
        const span = findEnclosingSpan(text, 17)
        expect(span).toEqual({ start: 9, end: 19 })
    })

    it('ignores a closing brace inside a string value (forward scan)', () => {
        const text = '{"k": "a}b"}'
        expect(findEnclosingSpan(text, 2)).toEqual({ start: 0, end: 11 })
    })

    it('ignores a closing bracket inside a string value (backward scan)', () => {
        const text = '{"a":"]","b":2}'
        expect(findEnclosingSpan(text, 13)).toEqual({ start: 0, end: 14 })
    })

    it('treats an escaped quote inside a string as string content', () => {
        const text = '{"a":"x\\"}y"}'
        expect(findEnclosingSpan(text, 2)).toEqual({ start: 0, end: 12 })
    })

    it('finds the enclosing object when the cursor sits on a bracket inside a string', () => {
        const text = '{"a":"p{q"}'
        expect(findEnclosingSpan(text, 7)).toEqual({ start: 0, end: 10 })
    })
})

// sortJsonValue

describe('sortJsonValue', () => {
    it('sorts object keys alphabetically', () => {
        const result = sortJsonValue('{"z":3,"a":1,"m":2}')
        expect(result).not.toBeNull()
        const parsed = JSON.parse(result!)
        expect(Object.keys(parsed)).toEqual(['a', 'm', 'z'])
    })

    it('sorts array values', () => {
        const result = sortJsonValue('["banana","apple","cherry"]')
        expect(result).not.toBeNull()
        const parsed = JSON.parse(result!) as string[]
        expect(parsed).toEqual(['apple', 'banana', 'cherry'])
    })

    it('returns null for a non-sortable scalar', () => {
        expect(sortJsonValue('42')).toBeNull()
    })

    it('returns null for invalid JSON', () => {
        expect(sortJsonValue('{bad}')).toBeNull()
    })
})

// reindentJson

describe('reindentJson', () => {
    it('prepends base indent to every line after the first', () => {
        const input = '{\n    "a": 1\n}'
        const result = reindentJson(input, '  ')
        expect(result).toBe('{\n      "a": 1\n  }')
    })

    it('leaves a single-line string unchanged', () => {
        expect(reindentJson('{"a":1}', '    ')).toBe('{"a":1}')
    })

    it('does not indent the first line', () => {
        const result = reindentJson('[\n  1\n]', '\t')
        expect(result.startsWith('[')).toBe(true)
    })
})

// lineIndentAt

describe('lineIndentAt', () => {
    it('returns the leading whitespace of the line, not the offset column', () => {
        const text = '{\n  "appConfig": {\n    "b": 1\n  }\n}'
        // The brace of appConfig's value sits late on line 2, after `  "appConfig": `.
        const braceIndex = text.indexOf('{', 1)
        expect(lineIndentAt(text, braceIndex)).toBe('  ')
    })

    it('returns empty indent for an offset on the first line', () => {
        expect(lineIndentAt('{\n  "a": 1\n}', 0)).toBe('')
    })

    it('handles tab indentation', () => {
        const text = '{\n\t"a": 1\n}'
        expect(lineIndentAt(text, text.indexOf('"a"'))).toBe('\t')
    })
})

// sort-at-cursor reindent (regression: nested value indentation)

describe('sort reindent for a nested value', () => {
    it('indents sorted nested keys one level deeper than the key, not under the bracket column', () => {
        const text = [
            '{',
            '  "appConfig": {',
            '    "z_key": "1",',
            '    "a_key": "2"',
            '  }',
            '}'
        ].join('\n')
        // Mirror doSortAtCursor: find the object at the cursor, sort it, reindent to the line indent.
        const span = findEnclosingSpan(text, text.indexOf('z_key'))!
        const sorted = sortJsonValue(text.substring(span.start, span.end + 1))!
        const replacement = reindentJson(sorted, lineIndentAt(text, span.start))
        // Keys at 4 spaces (parent 2 + one level), closing brace back at 2. NOT pushed to the
        // bracket column (which was the bug: keys landed ~15 spaces in).
        expect(replacement).toBe([
            '{',
            '    "a_key": "2",',
            '    "z_key": "1"',
            '  }'
        ].join('\n'))
    })
})

// decodeNestedJson

describe('decodeNestedJson', () => {
    it('decodes an escaped JSON string literal into formatted JSON', () => {
        const raw = JSON.stringify('{"a":1}') // the literal "{\"a\":1}" as it appears in a document
        expect(decodeNestedJson(raw)).toBe('{\n  "a": 1\n}')
    })

    it('decodes a nested array literal', () => {
        const raw = JSON.stringify('[1,2]')
        expect(decodeNestedJson(raw)).toBe('[\n  1,\n  2\n]')
    })

    it('returns null when the decoded content is not JSON', () => {
        expect(decodeNestedJson(JSON.stringify('hello world'))).toBeNull()
    })

    it('returns null when the literal is not a JSON string', () => {
        expect(decodeNestedJson('42')).toBeNull()
        expect(decodeNestedJson('{"a":1}')).toBeNull()
    })

    it('returns null for malformed input', () => {
        expect(decodeNestedJson('"unterminated')).toBeNull()
    })
})

// isJsonlContent

describe('isJsonlContent', () => {
    it('returns true for two valid records joined by newline', () => {
        expect(isJsonlContent('{"a":1}\n{"b":2}')).toBe(true)
    })

    it('returns false for a single valid JSON object', () => {
        expect(isJsonlContent('{"a":1}')).toBe(false)
    })

    it('returns false for a pretty-printed multi-line JSON array', () => {
        expect(isJsonlContent('[\n  1,\n  2\n]')).toBe(false)
    })

    it('returns false when a line is invalid', () => {
        expect(isJsonlContent('{"a":1}\n{bad}')).toBe(false)
    })

    it('returns false for a single non-empty line', () => {
        expect(isJsonlContent('"hello"')).toBe(false)
    })

    it('returns true for expanded (pretty-printed) multi-line records', () => {
        expect(isJsonlContent('{\n  "a": 1\n}\n{\n  "b": 2\n}')).toBe(true)
    })

    it('returns true for two bare primitives on separate lines', () => {
        expect(isJsonlContent('1\n2')).toBe(true)
    })
})

// isJsonlMode

describe('isJsonlMode', () => {
    it('returns true for a .jsonl filepath regardless of content', () => {
        expect(isJsonlMode('transcript.jsonl', '{"a":1}')).toBe(true)
    })

    it('returns true for a .json filepath when content is valid JSONL', () => {
        expect(isJsonlMode('data.json', '{"a":1}\n{"b":2}')).toBe(true)
    })

    it('returns false for a .json filepath with a single valid object', () => {
        expect(isJsonlMode('data.json', '{"a":1}')).toBe(false)
    })
})

// expandJsonl / compactJsonl

describe('expandJsonl', () => {
    it('pretty-prints each record across lines, separated by single newlines', () => {
        expect(expandJsonl('{"a":1}\n{"b":2}')).toBe('{\n  "a": 1\n}\n{\n  "b": 2\n}')
    })

    it('throws on a bad record', () => {
        expect(() => expandJsonl('{"a":1}\n{bad}')).toThrow()
    })
})

describe('compactJsonl', () => {
    it('collapses records to one compact line each, dropping blank lines', () => {
        expect(compactJsonl('{"a":  1}\n\n{"b":2}')).toBe('{"a":1}\n{"b":2}')
    })

    it('reverses expandJsonl (round trip)', () => {
        const compact = '{"a":1}\n{"b":2}'
        expect(compactJsonl(expandJsonl(compact))).toBe(compact)
    })

    it('throws on a bad record', () => {
        expect(() => compactJsonl('{"a":1}\n{bad}')).toThrow()
    })
})

// jsonlRecordErrors

describe('jsonlRecordErrors', () => {
    it('reports the offsets and message for one bad record', () => {
        const text = '{"a":1}\n{bad}\n{"c":3}'
        const errors = jsonlRecordErrors(text)
        expect(errors).toHaveLength(1)
        expect(text.slice(errors[0].from, errors[0].to)).toBe('{bad}')
        expect(errors[0].message.length).toBeGreaterThan(0)
    })

    it('locates a bad record that spans multiple lines', () => {
        const text = '{\n  "a": 1\n}\n{\n  bad\n}'
        const errors = jsonlRecordErrors(text)
        expect(errors).toHaveLength(1)
        expect(text.slice(errors[0].from, errors[0].to)).toBe('{\n  bad\n}')
    })

    it('returns an empty array when all records are valid', () => {
        expect(jsonlRecordErrors('{"a":1}\n{"b":2}')).toEqual([])
    })
})

// countJsonlRecords

describe('countJsonlRecords', () => {
    it('counts records, ignoring blank lines between them', () => {
        expect(countJsonlRecords('{"a":1}\n\n{"b":2}')).toBe(2)
    })

    it('counts a multi-line record as one', () => {
        expect(countJsonlRecords('{\n  "a": 1\n}\n{\n  "b": 2\n}')).toBe(2)
    })

    it('returns 0 for an empty string', () => {
        expect(countJsonlRecords('')).toBe(0)
    })
})
