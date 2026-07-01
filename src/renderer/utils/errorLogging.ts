/**
 * Shared helpers for forwarding renderer errors to the main-process log file.
 *
 * Used by the global window error/unhandledrejection listeners (index.tsx) and
 * the React error boundary (errorBoundary.tsx) so error formatting and the
 * guarded IPC call live in one place.
 */

/** Format any caught value as a log-friendly string, preferring the stack trace. */
export function formatError(err: unknown): string {
    return err instanceof Error ? (err.stack ?? err.message) : String(err)
}

/**
 * Forward a renderer error to the main-process log via the preload bridge.
 * Guarded so it never throws (the preload API may be absent if an error fires
 * before initialization); falls back to console.error.
 *
 * @param context - Short label identifying where the error originated.
 * @param detail - The formatted error detail to log.
 */
export function reportRendererError(context: string, detail: string): void {
    try {
        window.rokdock?.app?.logError?.(context, detail)
    } catch {
        console.error(`[${context}]`, detail)
    }
}
