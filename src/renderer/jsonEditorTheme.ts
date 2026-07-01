/**
 * CodeMirror 6 theme and syntax highlighting for the JSON Editor renderer entry.
 *
 * Builds two extensions from the RokDock design tokens: an EditorView.theme()
 * for the editor chrome (background, gutters, cursor, selection, scrollbars,
 * fold markers, the search panel, and lint tooltips) and a
 * syntaxHighlighting(HighlightStyle) for the JSON syntax tokens. Both are driven
 * by --rokdock-* CSS variables so they stay reactive to the live theme, while
 * the syntax colors come from the token map the renderer resolves from the
 * persisted syntax theme (on boot via get-initial-data, and live via the
 * rokdock-appearance-applied broadcast).
 *
 * Replaces the old ACE theme generator (jsonAceTheme.ts). The fold arrows are
 * CSS triangles (no base64 PNGs), and a live theme switch is a single
 * Compartment reconfigure in the entry, not a CSS re-read hack.
 */
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'
import { faCaretDown } from '@fortawesome/free-solid-svg-icons'
import { faSvg } from '@shared/icons'

/** The six JSON syntax colors, resolved from the originating window's token map with CSS-var fallbacks. */
interface JsonTokenColors {
    key: string
    string: string
    number: string
    boolean: string
    null: string
    punctuation: string
}

/**
 * Resolves the JSON token colors from the passed-in token map, falling back to
 * the shared --rokdock-json-* variables. The map keys match the terminal's
 * syntax color names (objectKey, objectStringValue, ...) so the editor shows the
 * same colors as the terminal that launched it.
 */
function resolveTokenColors(tokenColors: Record<string, string> | null): JsonTokenColors {
    const colors = tokenColors ?? {}
    return {
        key: colors.objectKey ?? colors.keyword ?? 'var(--rokdock-json-key)',
        string: colors.objectStringValue ?? colors.string ?? 'var(--rokdock-json-string)',
        number: colors.objectNumberValue ?? colors.number ?? 'var(--rokdock-json-number)',
        boolean: colors.objectBooleanValue ?? colors.boolean ?? 'var(--rokdock-json-boolean)',
        null: colors.objectNullValue ?? colors.nullish ?? 'var(--rokdock-json-null)',
        punctuation: colors.objectPunctuation ?? 'var(--rokdock-json-punctuation)',
    }
}

/**
 * The fold-gutter marker element: the app's caret (the same FontAwesome
 * caret-down the shared collapsible sections use), styled by the theme below
 * (.cm-rokdock-fold). It points down when expanded and is rotated to point right
 * when collapsed, matching the rest of the app's collapsible affordance.
 */
const CARET_DOWN_SVG = faSvg(faCaretDown)

export function foldMarkerDOM(open: boolean): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-rokdock-fold' + (open ? '' : ' cm-rokdock-fold-closed')
    span.innerHTML = CARET_DOWN_SVG
    return span
}

/**
 * Builds the chrome theme and syntax-highlight extensions for the given theme
 * mode, token colors, and font. isDark selects CodeMirror's dark UI heuristics
 * for any surface not explicitly overridden here.
 */
export function buildJsonEditorTheme(
    isDark: boolean,
    tokenColors: Record<string, string> | null,
    fontSize: number,
    fontFamily: string,
    background: string = 'var(--rokdock-bg-base)'
): Extension {
    const colors = resolveTokenColors(tokenColors)

    const chrome = EditorView.theme(
        {
            '&': {
                height: '100%',
                color: 'var(--rokdock-text-primary)',
                backgroundColor: background,
                fontSize: `${fontSize}px`,
            },
            '.cm-scroller': {
                fontFamily,
                lineHeight: '1.45',
            },
            '.cm-content': {
                caretColor: 'var(--rokdock-brand-primary-light)',
                padding: '4px 0',
            },
            '.cm-cursor, .cm-dropCursor': {
                borderLeftColor: 'var(--rokdock-brand-primary-light)',
            },
            '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
                backgroundColor: 'var(--rokdock-selection-bg)',
            },
            '.cm-activeLine': { backgroundColor: 'var(--rokdock-bg-hover)' },
            '.cm-activeLineGutter': { backgroundColor: 'var(--rokdock-bg-hover)' },
            '.cm-gutters': {
                backgroundColor: 'var(--rokdock-bg-panel)',
                color: 'var(--rokdock-text-muted)',
                border: 'none',
                borderRight: '1px solid var(--rokdock-border-light)',
            },
            '.cm-foldGutter .cm-gutterElement': {
                cursor: 'pointer',
                padding: '0 4px',
            },
            // Fold markers reuse the app's caret (FontAwesome caret-down, the same
            // glyph the shared collapsible sections use), styled to match: 9px,
            // dim, rotated to point right when collapsed. Identical glyph for both
            // states, so expanded and collapsed markers are exactly the same size.
            '.cm-rokdock-fold': {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
            },
            '.cm-rokdock-fold svg': {
                width: '9px',
                height: '9px',
                display: 'block',
                fill: 'currentColor',
                color: 'var(--rokdock-text-dim)',
                opacity: '0.6',
                transition: 'transform 0.15s ease, opacity 0.15s ease',
            },
            '.cm-rokdock-fold-closed svg': {
                transform: 'rotate(-90deg)',
            },
            '.cm-foldGutter .cm-gutterElement:hover .cm-rokdock-fold svg': {
                opacity: '1',
            },
            // Folded-range placeholder ("...").
            '.cm-foldPlaceholder': {
                backgroundColor: 'var(--rokdock-bg-hover)',
                color: 'var(--rokdock-text-muted)',
                border: '1px solid var(--rokdock-border-light)',
                borderRadius: '3px',
                margin: '0 2px',
                padding: '0 4px',
            },
            // Native scrollbars on the scroller (matches the old 6px ACE thumbs).
            '.cm-scroller::-webkit-scrollbar': { width: '6px', height: '6px' },
            '.cm-scroller::-webkit-scrollbar-track': { background: 'transparent' },
            '.cm-scroller::-webkit-scrollbar-thumb': {
                background: 'var(--rokdock-scrollbar-thumb)',
                borderRadius: '3px',
            },
            '.cm-scroller::-webkit-scrollbar-thumb:hover': {
                background: 'var(--rokdock-scrollbar-thumb-hover)',
            },
            '.cm-scroller::-webkit-scrollbar-corner': { background: 'transparent' },
            // Search panel (Ctrl+F).
            '.cm-panels': {
                backgroundColor: 'var(--rokdock-bg-panel)',
                color: 'var(--rokdock-text-primary)',
            },
            '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--rokdock-border-light)' },
            '.cm-panel.cm-search': { padding: '6px 8px' },
            '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': {
                fontFamily: 'var(--rokdock-font-ui)',
                fontSize: 'var(--rokdock-font-base)',
            },
            '.cm-panel.cm-search input[type=text]': {
                backgroundColor: 'var(--rokdock-bg-base)',
                color: 'var(--rokdock-text-primary)',
                border: '1px solid var(--rokdock-border-light)',
                borderRadius: '4px',
                padding: '3px 6px',
                outline: 'none',
            },
            '.cm-panel.cm-search button': {
                backgroundColor: 'transparent',
                color: 'var(--rokdock-text-muted)',
                border: '1px solid var(--rokdock-border-light)',
                borderRadius: '3px',
                padding: '1px 6px',
                cursor: 'pointer',
                backgroundImage: 'none',
            },
            '.cm-panel.cm-search button:hover': {
                color: 'var(--rokdock-text-primary)',
                backgroundColor: 'var(--rokdock-selection-bg)',
            },
            '.cm-panel.cm-search .cm-button': { backgroundImage: 'none' },
            // Lint tooltip + diagnostics.
            '.cm-tooltip': {
                backgroundColor: 'var(--rokdock-bg-panel)',
                color: 'var(--rokdock-text-primary)',
                border: '1px solid var(--rokdock-border-light)',
                borderRadius: '4px',
            },
            '.cm-diagnostic': { fontFamily: 'var(--rokdock-font-ui)' },
        },
        { dark: isDark }
    )

    const highlight = syntaxHighlighting(
        HighlightStyle.define([
            { tag: tags.propertyName, color: colors.key },
            { tag: tags.string, color: colors.string },
            { tag: tags.number, color: colors.number },
            { tag: tags.bool, color: colors.boolean },
            { tag: tags.null, color: colors.null },
            { tag: [tags.separator, tags.squareBracket, tags.brace, tags.punctuation], color: colors.punctuation },
        ])
    )

    return [chrome, highlight]
}
