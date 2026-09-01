/**
 * Recognized CLI failure signatures, mapped to a clearer explanation prepended above
 * the raw error. The raw message always follows unchanged, so nothing observable is
 * ever hidden. Extend the per-kind hint list as new failure classes are observed;
 * an unmatched message (or a CLI kind with no registered hints) passes through as-is.
 */
import type { CliKind } from '../types'

interface CliErrorHint {
    pattern: RegExp
    describe: (match: RegExpMatchArray) => string
}

const CLAUDE_HINTS: CliErrorHint[] = [
    {
        // RokDock's --disallowedTools/--allowedTools flags list every Claude Code
        // built-in tool by name (CLAUDE_DENYLIST in cliRegistry.ts). The claude CLI
        // validates that list against its own tool registry at startup and rejects any
        // name it does not recognize, which happens when the installed CLI version
        // predates (or has renamed) that tool.
        pattern: /Permission (?:deny|allow) rule "([^"]+)" matches no known tool/i,
        describe: (match) =>
            `RokDock's built-in-tools list for Claude Code includes "${match[1]}", which your installed `
            + 'Claude Code CLI does not recognize. This usually means the CLI is out of date for this '
            + 'feature: run "claude --version", update it, then test again.',
    },
]

const HINTS_BY_KIND: Partial<Record<CliKind, CliErrorHint[]>> = {
    claude: CLAUDE_HINTS,
}

/**
 * Prepends a clearer explanation above a raw CLI failure message when it matches a
 * known failure signature for the given CLI kind.
 *
 * @param cliKind - Which recognized CLI produced the error.
 * @param message - The raw error message (e.g. from the subprocess adapter).
 * @returns The enriched message, or `message` unchanged if nothing matched.
 */
export function enrichCliError(cliKind: CliKind, message: string): string {
    for (const hint of HINTS_BY_KIND[cliKind] ?? []) {
        const match = message.match(hint.pattern)
        if (match) return `${hint.describe(match)}\n\nRaw error: ${message}`
    }
    return message
}
