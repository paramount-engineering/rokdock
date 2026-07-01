/**
 * Lightweight JSON structure utilities used by the terminal overlay system.
 *
 * These helpers operate on raw strings rather than parsed JSON objects so they
 * can work on partial/incomplete JSON fragments that appear in terminal output.
 */

/**
 * Given a position of an opening brace or bracket in a string, returns the
 * index of its matching closing counterpart, accounting for nested structures
 * and string literals. Returns -1 if no matching close is found.
 *
 * Used by the terminal tokenizer to detect JSON objects/arrays in log output
 * so they can be highlighted and made expandable by the renderer.
 */
export function findMatchingBracket(text: string, start: number): number {
    const open = text[start]
    const close = open === '{' ? '}' : open === '[' ? ']' : ''
    if (!close) return -1
    let depth = 0
    let inString = false
    let escape = false
    for (let i = start; i < text.length; i++) {
        const ch = text[i]
        if (escape) {
            escape = false
            continue
        }
        if (ch === '\\' && inString) {
            escape = true
            continue
        }
        if (ch === '"') {
            inString = !inString
            continue
        }
        if (inString) continue
        if (ch === open) depth += 1
        if (ch === close) {
            depth -= 1
            if (depth === 0) return i
        }
    }
    return -1
}
