/**
 * Parses the process argv (or a forwarded second-instance argv) into a tool
 * launch request. Pure: no Electron imports, fully unit-testable.
 *
 * Grammar: `--tool <name> [path]` or `--tool=<name> [path]`. A relative path is
 * resolved against `cwd`. A bare launch, an unknown tool key, or a missing tool
 * value all return null (the caller falls back to the normal dock launch).
 */
import path from 'path'

export type ToolKey = 'json' | 'svg' | 'ninepatch' | 'script' | 'docs'

export interface LaunchRequest {
    tool: ToolKey
    filePath?: string
}

export const TOOL_KEYS: readonly ToolKey[] = ['json', 'svg', 'ninepatch', 'script', 'docs']

function isToolKey(value: string): value is ToolKey {
    return (TOOL_KEYS as readonly string[]).includes(value)
}

/**
 * Maps a file path to the tool that should open it, by extension (case-insensitive).
 * Returns null for an unowned extension. A legacy `*.rscript.json` ends in `.json`,
 * so it intentionally resolves to the JSON editor (those internal library files are
 * not an association target). `.png`/`.9.png` are intentionally unmapped: 9-Patch is
 * reached only via the explicit `--tool ninepatch` form. `.yaml`/`.yml` are
 * intentionally not mapped here (too generic to claim). The Script Editor treats them
 * as RASP only when reached via an explicit `--tool script` launch.
 */
export function toolForFile(filePath: string): ToolKey | null {
    const lower = filePath.toLowerCase()
    if (lower.endsWith('.json')) return 'json'
    if (lower.endsWith('.svg')) return 'svg'
    if (lower.endsWith('.rasp')) return 'script'
    if (lower.endsWith('.rscript')) return 'script'
    return null
}

/**
 * Falls back to mapping a bare file-path argument (an OS file-open on Windows/Linux,
 * or a bare CLI invocation) to a launch request. Scans argv left to right, skipping
 * flags, and returns the first arg whose extension maps to a tool. Left to right
 * matches the --tool scan and means the first recognized file wins on a multi-file open.
 */
function fileLaunchFromArgv(argv: string[], cwd: string): LaunchRequest | null {
    for (const arg of argv) {
        if (!arg || arg.startsWith('-')) continue
        const tool = toolForFile(arg)
        if (tool) return { tool, filePath: path.isAbsolute(arg) ? arg : path.resolve(cwd, arg) }
    }
    return null
}

export function parseLaunchRequest(argv: string[], cwd: string): LaunchRequest | null {
    // Find the --tool token wherever it sits (electron's own leading argv
    // entries differ between dev and packaged builds, so scan rather than index).
    let tool: string | undefined
    // -1 until a --tool token is found, then the index of its value (so it doubles
    // as the "was a --tool token present" flag).
    let afterToolIndex = -1
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '--tool') {
            tool = argv[i + 1]
            afterToolIndex = i + 2
            break
        }
        if (arg.startsWith('--tool=')) {
            tool = arg.slice('--tool='.length)
            afterToolIndex = i + 1
            break
        }
    }

    // No --tool token at all: treat a bare file-path argument as an OS file-open.
    if (afterToolIndex === -1) return fileLaunchFromArgv(argv, cwd)
    // A --tool token was present but its value is not a known tool: fall back to the
    // dock (the documented contract), rather than bare-path-scanning a stray file arg.
    if (!tool || !isToolKey(tool)) return null

    // The optional file path is the next arg after the tool, if it is not a flag.
    const next = afterToolIndex >= 0 ? argv[afterToolIndex] : undefined
    if (next && !next.startsWith('-')) {
        return { tool, filePath: path.isAbsolute(next) ? next : path.resolve(cwd, next) }
    }
    return { tool }
}
