/**
 * Error reporting utilities for the main process.
 *
 * Provides two exports:
 *   - logError: appends a timestamped entry to a log file on disk and calls console.error.
 *   - installGlobalErrorHandlers: registers process-level uncaughtException and
 *     unhandledRejection handlers that log and show a friendly dialog.
 *
 * The dialog is rate-limited so an error storm never spams the user. The app is
 * never force-quit because the errors this catches are typically non-fatal
 * event-handler exceptions; killing the process would be worse than continuing.
 */

import fs from 'fs'
import path from 'path'
import { app, dialog, ipcMain } from 'electron'

// ---- log file path --------------------------------------------------------

/**
 * Resolves the log file path. Tries app.getPath('logs') first and falls back to
 * app.getPath('userData') if the logs path throws (e.g. before app is ready).
 */
function resolveLogDir(): string {
    try {
        return app.getPath('logs')
    } catch {
        return app.getPath('userData')
    }
}

let resolvedLogPath: string | null = null

/**
 * Returns the absolute path to the error log file, resolving it once on first
 * call. Safe to call after app emits 'ready'.
 */
function getLogPath(): string {
    if (resolvedLogPath) return resolvedLogPath
    const dir = resolveLogDir()
    resolvedLogPath = path.join(dir, 'rokdock-errors.log')
    return resolvedLogPath
}

// ---- logError -------------------------------------------------------------

/**
 * Appends a timestamped error entry to the error log file and calls
 * console.error. Best-effort: all fs operations are wrapped in try/catch so
 * this function never throws.
 *
 * @param context - A short label identifying where the error originated.
 * @param error - The caught value (any type). stack is used when available,
 *   otherwise falls back to String(error).
 */
export function logError(context: string, error: unknown): void {
    const timestamp = new Date().toISOString()
    const detail =
        error instanceof Error
            ? (error.stack ?? error.message)
            : String(error)
    const entry = `[${timestamp}] [${context}]\n${detail}\n\n`

    console.error(`[RokDock error] ${context}:`, error)

    try {
        const logPath = getLogPath()
        try {
            fs.mkdirSync(path.dirname(logPath), { recursive: true })
        } catch {
            // directory already exists or cannot be created; proceed anyway
        }
        fs.appendFileSync(logPath, entry, 'utf8')
    } catch {
        // logging is best-effort; do not propagate
    }
}

// ---- dialog rate limit ----------------------------------------------------

/** Timestamp (ms) of the last error dialog shown. 0 means none shown yet. */
let lastDialogMs = 0
const DIALOG_RATE_LIMIT_MS = 5000

// ---- installGlobalErrorHandlers -------------------------------------------

/**
 * Registers process-level uncaughtException and unhandledRejection handlers.
 * Touches only `process`, so it is safe to call at the very top of main.ts
 * before the electron app is ready (it catches startup errors too).
 *
 * The renderer-to-main IPC bridge is registered separately by
 * registerRendererErrorBridge() once the app is ready.
 */
export function installGlobalErrorHandlers(): void {
    process.on('uncaughtException', (err: Error) => {
        logError('uncaughtException', err)
        showErrorDialog(err.message)
    })

    process.on('unhandledRejection', (reason: unknown) => {
        logError('unhandledRejection', reason)
        const message =
            reason instanceof Error ? reason.message : String(reason)
        showErrorDialog(message)
    })
}

/**
 * Registers the renderer-to-main error-logging IPC channel so renderer errors
 * reach the same log file. Call this after the app is ready (alongside the other
 * IPC handlers), not at module load, since ipcMain is part of the electron API
 * that should be wired during normal startup rather than at module evaluation.
 */
export function registerRendererErrorBridge(): void {
    ipcMain.on('app:log-error', (_event, context: unknown, message: unknown) => {
        logError(String(context), String(message))
    })
}

/**
 * Shows a friendly error dialog when the app is ready and the rate limit has
 * not been exceeded. Silently skips if the app is not yet ready or if a dialog
 * was shown within the last 5 s.
 *
 * @param message - A short description of the error to display.
 */
function showErrorDialog(message: string): void {
    if (!app.isReady()) return

    const now = Date.now()
    if (now - lastDialogMs < DIALOG_RATE_LIMIT_MS) return
    lastDialogMs = now

    let logPath = '(unavailable)'
    try {
        logPath = getLogPath()
    } catch {
        // ignore
    }

    void dialog.showMessageBox({
        type: 'error',
        title: 'RokDock',
        message: 'An unexpected error occurred.',
        detail:
            `RokDock encountered an error and tried to continue running.\n\n` +
            `Error: ${message}\n\n` +
            `Details have been written to:\n${logPath}\n\n` +
            `If things behave oddly, try restarting RokDock.`,
        buttons: ['OK']
    })
}
