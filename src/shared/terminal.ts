/**
 * Shared types for the terminal output tokenization and overlay system.
 *
 * The terminal pipeline works in two layers:
 *  1. Token layer (TerminalTokenSpan): syntax highlighting spans produced by
 *     the main-process tokenizer (terminal-tokenizer.ts). Each span marks a
 *     character range with a semantic kind (filePath, url, logTag, etc.).
 *  2. Overlay layer (TerminalOverlaySpan): interactive spans rendered by the
 *     renderer as clickable links or JSON expansion handles. Overlays can span
 *     multiple tokens and may extend beyond a single syntax category.
 *
 * Both span types use absolute character offsets within the line text string.
 * TerminalLineChunk is the final bundled unit sent from the main process to the
 * renderer for each line of terminal output.
 */

export type TerminalTokenKind =
    | 'plain'
    | 'prompt'
    | 'brightscriptDebuggerPrompt'
    | 'comment'
    | 'separator'
    | 'debuggerBanner'
    | 'sectionHeader'
    | 'threadRow'
    | 'stackFrame'
    | 'sourceLineNumber'
    | 'selectedMarker'
    | 'logTag'
    | 'beaconMetric'
    | 'filePath'
    | 'referenceMeta'
    | 'rokuType'
    | 'functionName'
    | 'objectKey'
    | 'objectPunctuation'
    | 'objectStringValue'
    | 'objectNumberValue'
    | 'objectBooleanValue'
    | 'objectNullValue'
    | 'string'
    | 'number'
    | 'boolean'
    | 'nullish'
    | 'error'
    | 'warning'
    | 'info'
    | 'debug'
    | 'trace'
    | 'rokuSymbol'
    | 'keyword'
    | 'dateTime'
    | 'bracketContent'
    | 'pathLike'
    | 'url'
    | 'queryKey'
    | 'queryValue'

export interface TerminalTokenSpan {
    start: number
    end: number
    kind: TerminalTokenKind
}

export interface TerminalOverlaySpan {
    start: number
    end: number
    kind: 'url' | 'json'
    value: string
}

export interface TerminalLineChunk {
    /** Stable row id assigned in the renderer for list keys and JSON-fallback caching. */
    id?: number
    text: string
    tokens: TerminalTokenSpan[]
    overlays: TerminalOverlaySpan[]
}

/** Max scrollback lines kept per terminal session (renderer buffer cap). */
export const TERMINAL_MAX_BUFFER_LINES = 5000
