/**
 * Shared types for the app update-check flow, used by the main process, the preload
 * bridge, and the renderer dialog.
 */

/**
 * The result the main process returns from an update check. The renderer shows a
 * "checking" state while the check promise is in flight (a null result), so there is
 * no 'checking' status on the wire.
 */
export type UpdateStatus = 'available' | 'up-to-date' | 'error'

export interface UpdateCheckResult {
    status: UpdateStatus
    /** Available version when status is 'available', otherwise the current app version. */
    version?: string
    /** Release notes text, best-effort, when available. */
    notes?: string
}
