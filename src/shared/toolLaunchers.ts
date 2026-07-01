/**
 * The set of RokDock tools that get their own OS launcher shortcut. This manifest
 * is the single source of truth: the build scripts read the JSON to compose icons
 * and write per-platform shortcut artifacts, and the app's launch code is pinned to
 * it by toolLaunchers.test.ts. Adding a tool is one entry here plus its --tool opener.
 */
import data from './toolLaunchers.json'

export interface ToolLauncher {
    /** The --tool <key> value (must match a ToolKey in src/main/launch/launchRequest.ts). */
    key: string
    /** Shortcut label, e.g. "JSON Editor". */
    title: string
    /** Short glyph or text composited as a badge onto the base icon. */
    badge: string
}

export const TOOL_LAUNCHERS: ToolLauncher[] = data as ToolLauncher[]
