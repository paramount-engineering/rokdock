// BrightScript StreamLanguage tokenizer for CodeMirror 6.
//
// Vocabulary sources (factual word lists only; no grammar file vendored):
//   - Roku BrightScript Reference: https://developer.roku.com/docs/references/brightscript/language/
//   - RokuCommunity brighterscript TextMate grammar:
//     https://github.com/rokucommunity/brighterscript/blob/master/syntaxes/brightscript.tmLanguage.json
//
// Only the keyword/type-name lists are derived from those sources.
// The tokenizer logic is original.

import type { StreamParser } from '@codemirror/language'
import { tags } from '@lezer/highlight'

// Keywords lowercased. Includes language keywords and primitive type names because
// BrightScript authors commonly encounter them in function signatures, and
// highlighting them is the primary value here.
const KEYWORDS = new Set([
    'and',
    'as',
    'boolean',
    'dim',
    'dynamic',
    'each',
    'else',
    'elseif',
    'end',
    'endfor',
    'endfunction',
    'endif',
    'endsub',
    'endwhile',
    'exit',
    'exitfor',
    'exitwhile',
    'false',
    'float',
    'for',
    'function',
    'goto',
    'if',
    'in',
    'integer',
    'interface',
    'invalid',
    'let',
    'library',
    'longinteger',
    'mod',
    'm',
    'new',
    'next',
    'not',
    'object',
    'or',
    'print',
    'return',
    'step',
    'stop',
    'string',
    'sub',
    'then',
    'to',
    'true',
    'void',
    'while',
    'double',
])

type BrightScriptState = Record<string, never>

export const brightscriptStreamParser: StreamParser<BrightScriptState> = {
    startState(): BrightScriptState {
        return {}
    },

    copyState(_state: BrightScriptState): BrightScriptState {
        return {}
    },

    token(stream, _state): string | null {
        // Eat leading whitespace. Not a token.
        if (stream.eatSpace()) return null

        // Apostrophe line comment.
        if (stream.eat("'")) {
            stream.skipToEnd()
            return 'comment'
        }

        // REM keyword comment. Only matches at a word boundary (i.e. the next char
        // is not an identifier continuation), so identifiers like "remote" are safe.
        if (stream.match(/^rem(?![a-z0-9_])/i)) {
            stream.skipToEnd()
            return 'comment'
        }

        // Double-quoted string. BrightScript uses "" to escape a quote inside a
        // string. For highlighting, consuming to the next unescaped quote or EOL is
        // acceptable.
        if (stream.eat('"')) {
            let ch: string | void
            while (!stream.eol()) {
                ch = stream.next()
                if (ch === '"') {
                    // A doubled quote is an escaped quote. Peek ahead.
                    if (stream.peek() === '"') {
                        stream.next() // consume the second quote and continue
                    } else {
                        break // closing quote
                    }
                }
            }
            return 'string'
        }

        // Hex number: &hXXXX (also &oXXXX for octal).
        if (stream.match(/^&[ho][0-9a-f]*/i)) {
            return 'number'
        }

        // Decimal / floating-point number with optional BrightScript type suffix.
        if (stream.match(/^\d+\.?\d*([eE][+-]?\d+)?[%&!#]?/)) {
            return 'number'
        }

        // Identifier: keyword, function call, or plain variable.
        const wordMatch = stream.match(/^[a-z_][a-z0-9_]*/i)
        if (wordMatch) {
            const word = (wordMatch as RegExpMatchArray)[0].toLowerCase()
            if (KEYWORDS.has(word)) return 'keyword'
            // An identifier immediately followed by '(' is a function call (built-in
            // or user-defined) or a function/sub definition name. This is the bulk of
            // the visible color in API-heavy snippets (CreateObject, addFields, ...).
            if (stream.peek() === '(') return 'function'
            return 'variableName'
        }

        // Punctuation: brackets, separators, and the member-access dot.
        if (stream.match(/^[(){}\[\],;:.]/)) return 'punctuation'

        // Operators.
        const op = stream.next()
        if (op && '+-*/<>=^\\'.includes(op)) return 'operator'

        return null
    },

    // Map the custom token names to highlight tags. 'function' uses a modified tag
    // so it can be colored distinctly from keywords; the rest use names the default
    // table already recognizes, but punctuation is listed for certainty.
    tokenTable: {
        function: tags.function(tags.variableName),
        punctuation: tags.punctuation,
    },
}
