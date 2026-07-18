/**
 * Spaces per indent level for pretty-printed JSON.
 *
 * Shared so every producer of pretty JSON agrees with the JSON editor's own
 * formatting: the main-process terminal tokenizer (terminalTokenizer.ts) and the
 * renderer terminal overlay compiler (overlayCompiler.ts) both format detected
 * payloads with this width, and the editor (jsonFormat.ts INDENT_WIDTH) reuses it.
 * Keeping one source means a payload opened from the terminal is not silently
 * reindented the moment it lands in the viewer.
 */
export const JSON_INDENT_WIDTH = 2
