/**
 * Compiles the optional regular expression the user enters before the terminal
 * Save-output and Stream-to-file actions. An empty pattern means "no filter" (write
 * every line). Pure and dependency-free. The actual matching runs in the regex Web
 * Worker (see regexMatchClient), so this module only compiles and reports validity.
 */

/** The result of compiling a user-entered line-filter pattern. */
export interface CompiledLineFilter {
    /** The compiled matcher, or null when the pattern is empty (no filter). */
    regex: RegExp | null
    /** A human-readable error when the pattern is not a valid regex, else null. */
    error: string | null
}

/**
 * Compiles a user-entered filter pattern.
 *
 * @param pattern - The raw pattern text. An empty string means no filter.
 * @returns The compiled regex (or null for no filter) and any compile error.
 */
export function compileLineFilter(pattern: string): CompiledLineFilter {
    if (pattern === '') return { regex: null, error: null }
    try {
        // No flags: a non-global regex keeps `test` stateless across lines.
        return { regex: new RegExp(pattern), error: null }
    } catch (error) {
        return { regex: null, error: (error as Error).message }
    }
}
