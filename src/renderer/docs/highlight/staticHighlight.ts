/**
 * Static syntax highlighter for the Developer Docs tool window.
 *
 * Parses code with CodeMirror parsers (no editor instance needed) and emits
 * an HTML string where each colored token is a <span> with an inline
 * style="color: var(--rokdock-...)" so the output is reactive to the live
 * app theme without any stylesheet injection.
 *
 * The approach: HighlightStyle.define() with explicit sentinel class names,
 * then highlightTree() from @lezer/highlight. The callback receives the
 * sentinel class and we map it to the matching --rokdock-* CSS variable.
 */

import { HighlightStyle } from '@codemirror/language'
import { StreamLanguage } from '@codemirror/language'
import type { Language, StreamParser } from '@codemirror/language'
import { tags, highlightTree } from '@lezer/highlight'
import { jsonLanguage } from '@codemirror/lang-json'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { c } from '@codemirror/legacy-modes/mode/clike'
import { javascript } from '@codemirror/legacy-modes/mode/javascript'
import { python } from '@codemirror/legacy-modes/mode/python'
import { escapeHtml } from '@shared/htmlEscape'
import { brightscriptStreamParser } from './brightscript'

// Sentinel class names that map to rokdock CSS vars. Kept short to avoid
// polluting any downstream DOM, but descriptive enough to be greppable.
const TOK_KEYWORD = 'rd-tok-kw'
const TOK_STRING = 'rd-tok-str'
const TOK_NUMBER = 'rd-tok-num'
const TOK_BOOL = 'rd-tok-bool'
const TOK_NULL = 'rd-tok-null'
const TOK_COMMENT = 'rd-tok-cmt'
const TOK_PROPERTY = 'rd-tok-prop'
const TOK_PUNCTUATION = 'rd-tok-punc'
const TOK_OPERATOR = 'rd-tok-op'
const TOK_TYPE = 'rd-tok-type'
const TOK_FUNCTION = 'rd-tok-fn'

// CSS variable for each sentinel class. Keyed to the same --rokdock-json-*
// vars that jsonEditorTheme.ts uses so the docs viewer matches the editor.
const CLASS_TO_VAR: Record<string, string> = {
    [TOK_KEYWORD]: 'var(--rokdock-json-key)',
    [TOK_STRING]: 'var(--rokdock-json-string)',
    [TOK_NUMBER]: 'var(--rokdock-json-number)',
    [TOK_BOOL]: 'var(--rokdock-json-boolean)',
    [TOK_NULL]: 'var(--rokdock-json-null)',
    [TOK_COMMENT]: 'var(--rokdock-text-dim)',
    [TOK_PROPERTY]: 'var(--rokdock-json-key)',
    [TOK_PUNCTUATION]: 'var(--rokdock-json-punctuation)',
    [TOK_OPERATOR]: 'var(--rokdock-json-punctuation)',
    [TOK_TYPE]: 'var(--rokdock-json-key)',
    // Function calls/definitions: the boolean/null color slot, which is otherwise
    // unused for BrightScript (true/false/invalid are keywords), so callables read
    // distinctly from keywords.
    [TOK_FUNCTION]: 'var(--rokdock-json-boolean)',
}

// A single shared HighlightStyle instance with explicit class names so that
// highlightTree's callback receives the sentinel class directly.
const HIGHLIGHT_STYLE = HighlightStyle.define([
    { tag: tags.keyword, class: TOK_KEYWORD },
    { tag: tags.string, class: TOK_STRING },
    { tag: [tags.regexp, tags.escape], class: TOK_STRING },
    { tag: tags.number, class: TOK_NUMBER },
    { tag: tags.integer, class: TOK_NUMBER },
    { tag: tags.float, class: TOK_NUMBER },
    { tag: tags.bool, class: TOK_BOOL },
    { tag: tags.null, class: TOK_NULL },
    { tag: tags.comment, class: TOK_COMMENT },
    { tag: tags.lineComment, class: TOK_COMMENT },
    { tag: tags.blockComment, class: TOK_COMMENT },
    { tag: tags.docComment, class: TOK_COMMENT },
    { tag: tags.propertyName, class: TOK_PROPERTY },
    { tag: tags.attributeName, class: TOK_PROPERTY },
    { tag: [tags.separator, tags.punctuation, tags.squareBracket, tags.brace, tags.paren, tags.angleBracket], class: TOK_PUNCTUATION },
    { tag: [tags.operator, tags.compareOperator, tags.logicOperator, tags.arithmeticOperator, tags.bitwiseOperator], class: TOK_OPERATOR },
    { tag: [tags.typeName, tags.className, tags.namespace], class: TOK_TYPE },
    { tag: tags.function(tags.variableName), class: TOK_FUNCTION },
    { tag: tags.tagName, class: TOK_KEYWORD },
    { tag: tags.attributeValue, class: TOK_STRING },
])

// Lazily-constructed Language singletons. Each is constructed at most once
// regardless of how many times languageFor() is called.
let xmlLanguage: Language | null = null
let yamlLanguage: Language | null = null

function getXmlLanguage(): Language {
    if (!xmlLanguage) {
        xmlLanguage = xml().language
    }
    return xmlLanguage
}

function getYamlLanguage(): Language {
    if (!yamlLanguage) {
        yamlLanguage = yaml().language
    }
    return yamlLanguage
}

// StreamLanguage-backed languages (legacy modes plus the hand-authored
// BrightScript parser) share one memoized cache so each parser is wrapped at
// most once. The lang-package languages above use a different accessor and
// stay separate.
const streamLanguageCache = new Map<StreamParser<unknown>, Language>()

function streamLanguageFor<S>(parser: StreamParser<S>): Language {
    const key = parser as StreamParser<unknown>
    let language = streamLanguageCache.get(key)
    if (!language) {
        language = StreamLanguage.define(parser)
        streamLanguageCache.set(key, language)
    }
    return language
}

/**
 * Returns the CodeMirror Language for the given language identifier, or null
 * if the identifier is not recognized. The caller should render plain escaped
 * text when null is returned.
 */
export function languageFor(lang: string): Language | null {
    switch (lang.toLowerCase()) {
        case 'json':
            return jsonLanguage
        case 'xml':
        case 'html':
            return getXmlLanguage()
        case 'yaml':
        case 'yml':
            return getYamlLanguage()
        case 'ini':
        case 'properties':
            return streamLanguageFor(properties)
        case 'brightscript':
        case 'brs':
        case 'bs':
            return streamLanguageFor(brightscriptStreamParser)
        case 'bash':
        case 'sh':
        case 'shell':
            return streamLanguageFor(shell)
        case 'c':
            return streamLanguageFor(c)
        case 'javascript':
        case 'js':
            return streamLanguageFor(javascript)
        case 'python':
        case 'py':
            return streamLanguageFor(python)
        default:
            return null
    }
}

/**
 * Highlights `code` using the named language and returns an HTML string.
 *
 * - If the language is unknown, returns fully-escaped plain text (no spans).
 * - All text content is HTML-escaped regardless of whether a span is emitted.
 * - Colored tokens are wrapped in <span style="color: var(--rokdock-...)">
 *   so the output stays reactive to the live app theme.
 */
export function highlightToHtml(code: string, lang: string): string {
    const language = languageFor(lang)

    if (!language) {
        return escapeHtml(code)
    }

    const tree = language.parser.parse(code)
    const parts: string[] = []
    let cursor = 0

    highlightTree(tree, HIGHLIGHT_STYLE, (from, to, cls) => {
        // Emit any plain text between the previous span and this one.
        if (from > cursor) {
            parts.push(escapeHtml(code.slice(cursor, from)))
        }

        const colorVar = CLASS_TO_VAR[cls]
        const escapedToken = escapeHtml(code.slice(from, to))

        if (colorVar) {
            parts.push(`<span style="color: ${colorVar}">${escapedToken}</span>`)
        } else {
            // Unknown sentinel - emit plain escaped text.
            parts.push(escapedToken)
        }

        cursor = to
    })

    // Emit any trailing plain text after the last span.
    if (cursor < code.length) {
        parts.push(escapeHtml(code.slice(cursor)))
    }

    return parts.join('')
}
