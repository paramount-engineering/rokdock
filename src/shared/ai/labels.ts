/**
 * User-facing AI labels, centralized so a future assistant name (e.g. switching
 * "Explain this" to "Ask <Name>" and retitling the panel) is a single-file edit.
 * Plain strings only, safe to import from both the main process and the renderer.
 * Internal identifiers, IPC channel names, and test IDs do NOT use these.
 */
export const AI_BETA_SUFFIX = '(Beta)'
export const AI_CHAT_TITLE = 'AI Chat'
export const AI_EXPLAIN_ACTION = 'Explain this'

/** Append the "(Beta)" suffix to a user-facing AI label. */
export function withBeta(label: string): string {
    return `${label} ${AI_BETA_SUFFIX}`
}
