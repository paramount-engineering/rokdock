/**
 * roBot terminal-output tools. Two read-only tools over the FOCUSED terminal tab's scrollback:
 * read_terminal_output tails the recent lines ("summarize the terminal output"), and
 * search_terminal_output finds a substring most-recent-first ("what was the last error?").
 *
 * The whole buffer is fetched from the dock renderer via readFocusedTerminal. Slicing and
 * scanning happen here with pure helpers so they are unit-testable without IPC. Every
 * content-bearing result is passed through redact (device-values-only) before returning,
 * which is the only place terminal text is scrubbed on its way to the model.
 */
import type { ContextProvider, ToolDef, ToolResult } from '../../../ai-core/types'
import type { FocusedTerminalPayload } from '../../../shared/terminal'

const DEFAULT_TAIL = 200
const MAX_TAIL = 1000
const DEFAULT_MAX_MATCHES = 10
const MAX_MAX_MATCHES = 30
const DEFAULT_CONTEXT_LINES = 2
const MAX_CONTEXT_LINES = 5
/**
 * Total character budget for a single tool result (about 40 KB), to keep one huge JSON-blob line
 * from blowing the token budget. At least the most recent line (tail) or match block (search) is
 * always kept, so a single line or block that alone exceeds this is returned whole rather than
 * dropped to nothing.
 */
const MAX_OUTPUT_CHARS = 40000
/** Separator between search-result blocks. Its length feeds the char-budget accounting below. */
const MATCH_SEPARATOR = '\n---\n'

interface TerminalOutputDeps {
    readFocusedTerminal: () => Promise<FocusedTerminalPayload | null>
    redact: (text: string) => Promise<string>
}

function asRecord(args: unknown): Record<string, unknown> {
    return (args ?? {}) as Record<string, unknown>
}

function clamp(value: number, min: number, max: number, fallback: number): number {
    const num = Math.floor(Number(value))
    if (!Number.isFinite(num)) return fallback
    return Math.min(max, Math.max(min, num))
}

/** Strip C0 control characters (keep tab) that could confuse the model. Lines are already newline-split. */
function stripControl(text: string): string {
    return text.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '')
}

/**
 * Keep the last `limit` lines, then drop from the front until the joined text fits MAX_OUTPUT_CHARS.
 * Always keeps at least the most recent line, so a single oversized line is returned whole rather
 * than dropped to an empty result. Returns the kept lines (most recent) and whether older lines
 * were dropped to fit.
 */
export function tailWithinBudget(lines: string[], limit: number): { kept: string[]; charTruncated: boolean } {
    let kept = lines.slice(Math.max(0, lines.length - limit))
    let charTruncated = false
    while (kept.length > 1 && kept.join('\n').length > MAX_OUTPUT_CHARS) {
        kept = kept.slice(1)
        charTruncated = true
    }
    return { kept, charTruncated }
}

/**
 * Find substring matches (case-insensitive), most-recent-first, each with contextLines of
 * surrounding lines. Stops at maxMatches or when adding the next block would exceed the char cap.
 */
export function searchWithinBudget(
    lines: string[], pattern: string, maxMatches: number, contextLines: number,
): { blocks: string[]; totalMatches: number; charTruncated: boolean } {
    const needle = pattern.toLowerCase()
    const matchIndexes: number[] = []
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].toLowerCase().includes(needle)) matchIndexes.push(i)
    }
    const totalMatches = matchIndexes.length
    const blocks: string[] = []
    let used = 0
    let charTruncated = false
    for (const index of matchIndexes) {
        if (blocks.length >= maxMatches) break
        const from = Math.max(0, index - contextLines)
        const to = Math.min(lines.length - 1, index + contextLines)
        const bodyLines = lines.slice(from, to + 1).map((text, offset) => {
            const lineNumber = from + offset + 1
            const marker = from + offset === index ? '>' : ' '
            return `${marker} ${lineNumber}: ${text}`
        })
        const block = bodyLines.join('\n')
        if (used + block.length + MATCH_SEPARATOR.length > MAX_OUTPUT_CHARS && blocks.length > 0) { charTruncated = true; break }
        blocks.push(block)
        used += block.length + MATCH_SEPARATOR.length
    }
    return { blocks, totalMatches, charTruncated }
}

const tools: ToolDef[] = [
    {
        name: 'read_terminal_output',
        description: 'Read the most recent lines of the focused terminal tab (a tail). Use for "summarize the terminal output" or "what is happening". Reads a bounded amount, not the whole buffer.',
        parameters: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: `How many recent lines to read (1-${MAX_TAIL}). Default ${DEFAULT_TAIL}.` },
            },
        },
    },
    {
        name: 'search_terminal_output',
        description: 'Search the focused terminal tab for a substring (case-insensitive), most recent match first. Use for "find X" or "what was the last error". Not a regex.',
        parameters: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: 'Substring to search for (case-insensitive).' },
                maxMatches: { type: 'number', description: `Maximum matches to return (1-${MAX_MAX_MATCHES}). Default ${DEFAULT_MAX_MATCHES}.` },
                contextLines: { type: 'number', description: `Lines of surrounding context per match (0-${MAX_CONTEXT_LINES}). Default ${DEFAULT_CONTEXT_LINES}.` },
            },
            required: ['pattern'],
        },
    },
]

/**
 * Fetch the focused terminal's control-stripped lines, or a plain message to return when no tab
 * is focused or the buffer is empty. Shared by both tools so the fetch/clean/empty checks live once.
 */
async function loadCleanedLines(
    deps: TerminalOutputDeps,
): Promise<{ label: string; cleaned: string[] } | { message: string }> {
    const payload = await deps.readFocusedTerminal()
    if (!payload) return { message: 'No terminal tab is focused.' }
    const cleaned = payload.lines.map(stripControl)
    if (cleaned.length === 0) return { message: 'The focused terminal has no output yet.' }
    return { label: payload.label, cleaned }
}

export function createTerminalOutputProvider(deps: TerminalOutputDeps): ContextProvider {
    /** Produce the raw (unredacted) tool result. callTool redacts its content in one place below. */
    async function routeTool(name: string, record: Record<string, unknown>): Promise<ToolResult> {
        if (name === 'search_terminal_output') {
            const pattern = typeof record.pattern === 'string' ? record.pattern.trim() : ''
            if (!pattern) return { content: 'search_terminal_output requires a non-empty pattern.', isError: true }
            const loaded = await loadCleanedLines(deps)
            if ('message' in loaded) return { content: loaded.message }
            const maxMatches = clamp(record.maxMatches as number, 1, MAX_MAX_MATCHES, DEFAULT_MAX_MATCHES)
            const contextLines = clamp(record.contextLines as number, 0, MAX_CONTEXT_LINES, DEFAULT_CONTEXT_LINES)
            const { blocks, totalMatches, charTruncated } = searchWithinBudget(loaded.cleaned, pattern, maxMatches, contextLines)
            const shown = blocks.length < totalMatches ? `, showing ${blocks.length}` : ''
            const omitted = charTruncated ? ' (older matches omitted to fit)' : ''
            const header = `Terminal "${loaded.label}": ${loaded.cleaned.length} total lines, ${totalMatches} match(es) for "${pattern}" (most recent first)${shown}${omitted}.`
            const body = blocks.length > 0 ? `\n${blocks.join(MATCH_SEPARATOR)}` : ''
            return { content: `${header}${body}` }
        }

        if (name === 'read_terminal_output') {
            const loaded = await loadCleanedLines(deps)
            if ('message' in loaded) return { content: loaded.message }
            const limit = clamp(record.limit as number, 1, MAX_TAIL, DEFAULT_TAIL)
            const { kept, charTruncated } = tailWithinBudget(loaded.cleaned, limit)
            const omitted = charTruncated ? ' (older lines omitted to fit)' : ''
            const header = `Terminal "${loaded.label}": ${loaded.cleaned.length} total lines, showing the last ${kept.length}${omitted}.`
            return { content: `${header}\n${kept.join('\n')}` }
        }

        return { content: `Unknown tool: ${name}`, isError: true }
    }

    // Redact every content-bearing result in one place, so no branch in routeTool can forget to.
    async function callTool(name: string, args: unknown): Promise<ToolResult> {
        const result = await routeTool(name, asRecord(args))
        return { ...result, content: await deps.redact(result.content) }
    }

    return { name: 'roku-terminal', tools: () => tools, callTool }
}
