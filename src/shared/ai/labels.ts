/**
 * User-facing AI labels, centralized so the assistant name is a single-file edit.
 * The assistant is named "roBot" (always lowercase r, capital B: it echoes the ro*
 * prefix of BrightScript components and reads as "robot"). Keep that casing exact.
 * Plain strings only, safe to import from both the main process and the renderer.
 * Internal identifiers, IPC channel names, and test IDs do NOT use these.
 */
export const AI_BETA_SUFFIX = '(Beta)'
export const AI_CHAT_TITLE = 'roBot'
export const AI_EXPLAIN_ACTION = 'Ask roBot'

/** Append the "(Beta)" suffix to a user-facing AI label. */
export function withBeta(label: string): string {
    return `${label} ${AI_BETA_SUFFIX}`
}
