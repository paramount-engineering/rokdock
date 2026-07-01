/**
 * App update dialog. Shows the four update states (checking / up-to-date /
 * available / error). When an update is available the user can download and
 * install it: electron-updater downloads in the background (progress shown here)
 * and the app quits and installs once the download completes.
 *
 * `result` is null while a check is in flight (the checking state).
 */
import React, { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark } from '@fortawesome/free-solid-svg-icons'
import DialogFrame from './common/dialogFrame'
import type { UpdateCheckResult } from '@shared/updates'
import type { IpcResult } from '@shared/types'

const DIALOG_CLOSE_BTN: CSSProperties = {
    width: 24,
    height: 24,
    border: 'none',
    borderRadius: 'var(--rokdock-radius-sm)',
    background: 'transparent',
    color: 'var(--rokdock-text-dim)',
    fontSize: 13,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
}

const MESSAGE_STYLE: CSSProperties = {
    margin: 0,
    color: 'var(--rokdock-text-primary)',
    fontSize: 'var(--rokdock-font-base)',
    lineHeight: 1.45,
}

const SUBTLE_STYLE: CSSProperties = {
    margin: 0,
    color: 'var(--rokdock-text-dim)',
    fontSize: 'var(--rokdock-font-sm)',
    fontFamily: 'var(--rokdock-font-mono)',
}

const NOTES_STYLE: CSSProperties = {
    margin: 0,
    maxHeight: 160,
    overflowY: 'auto',
    whiteSpace: 'pre-wrap',
    color: 'var(--rokdock-text-dim)',
    fontSize: 'var(--rokdock-font-sm)',
    lineHeight: 1.45,
}

const PROGRESS_TRACK_STYLE: CSSProperties = {
    width: '100%',
    height: 6,
    borderRadius: 3,
    background: 'var(--rokdock-border)',
    overflow: 'hidden',
}

const DETAILS_TOGGLE_STYLE: CSSProperties = {
    alignSelf: 'flex-start',
    padding: 0,
    border: 'none',
    background: 'transparent',
    color: 'var(--rokdock-text-dim)',
    fontSize: 'var(--rokdock-font-sm)',
    textDecoration: 'underline',
    cursor: 'pointer',
}

const DETAILS_BOX_STYLE: CSSProperties = {
    margin: 0,
    maxHeight: 160,
    overflowY: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    color: 'var(--rokdock-text-dim)',
    fontSize: 'var(--rokdock-font-sm)',
    fontFamily: 'var(--rokdock-font-mono)',
}

/** Raw update-check/download errors can be long HTTP-layer dumps; hide them
 *  behind a toggle instead of always showing them under the friendly message. */
function ErrorDetails({ error }: { error: string }) {
    const [open, setOpen] = useState(false)
    return (
        <>
            <button style={DETAILS_TOGGLE_STYLE} onClick={() => setOpen(prev => !prev)}>
                {open ? 'Hide details' : 'Show details'}
            </button>
            {open && <p style={DETAILS_BOX_STYLE}>{error}</p>}
        </>
    )
}

export default function UpdatesDialog({ result, onClose, onRetry }: {
    result: UpdateCheckResult | null
    onClose: () => void
    onRetry: () => void
}) {
    const [downloading, setDownloading] = useState(false)
    const [percent, setPercent] = useState(0)
    const [downloadError, setDownloadError] = useState<string | null>(null)

    useEffect(() => window.rokdock.updates.onDownloadProgress(setPercent), [])

    const startDownload = (): void => {
        setDownloading(true)
        setDownloadError(null)
        setPercent(0)
        void window.rokdock.updates.download()
            .then((res: IpcResult) => {
                // On success the main process quits and installs once the download
                // finishes, so the dialog just shows progress until the app exits.
                if (!res.ok) {
                    setDownloading(false)
                    setDownloadError(res.error ?? 'Download failed.')
                }
            })
            .catch((err: unknown) => {
                setDownloading(false)
                setDownloadError(err instanceof Error ? err.message : String(err))
            })
    }

    let body: React.ReactNode
    let actions: React.ReactNode

    if (downloading) {
        body = (
            <>
                <p style={MESSAGE_STYLE}>Downloading update...</p>
                <div style={PROGRESS_TRACK_STYLE}>
                    <div style={{ width: `${percent}%`, height: '100%', background: 'var(--rokdock-brand-primary)', transition: 'width 0.2s ease' }} />
                </div>
                <p style={SUBTLE_STYLE}>{percent}%. RokDock will restart to install when the download completes.</p>
            </>
        )
        actions = <button className="rokdock-btn rokdock-btn-ghost" disabled>Downloading...</button>
    } else if (downloadError) {
        body = (
            <>
                <p style={MESSAGE_STYLE}>The update could not be downloaded.</p>
                <ErrorDetails error={downloadError} />
            </>
        )
        actions = (
            <>
                <button className="rokdock-btn rokdock-btn-ghost" onClick={onClose}>Close</button>
                <button className="rokdock-btn rokdock-btn-primary" onClick={startDownload}>Try Again</button>
            </>
        )
    } else if (result === null) {
        body = <p style={MESSAGE_STYLE}>Checking for updates...</p>
        actions = <button className="rokdock-btn rokdock-btn-ghost" onClick={onClose}>Close</button>
    } else if (result.status === 'available') {
        body = (
            <>
                <p style={MESSAGE_STYLE}>A new version of RokDock is available.</p>
                {result.version && <p style={SUBTLE_STYLE}>Version {result.version}</p>}
                {result.notes && <p style={NOTES_STYLE}>{result.notes}</p>}
            </>
        )
        actions = (
            <>
                <button className="rokdock-btn rokdock-btn-ghost" onClick={onClose}>Later</button>
                <button className="rokdock-btn rokdock-btn-primary" onClick={startDownload}>Download & Install</button>
            </>
        )
    } else if (result.status === 'error') {
        body = (
            <>
                <p style={MESSAGE_STYLE}>Could not check for updates.</p>
                {result.error && <ErrorDetails error={result.error} />}
            </>
        )
        actions = (
            <>
                <button className="rokdock-btn rokdock-btn-ghost" onClick={onClose}>Close</button>
                <button className="rokdock-btn rokdock-btn-primary" onClick={onRetry}>Retry</button>
            </>
        )
    } else {
        body = (
            <>
                <p style={MESSAGE_STYLE}>RokDock is up to date.</p>
                {result.version && <p style={SUBTLE_STYLE}>Version {result.version}</p>}
            </>
        )
        actions = <button className="rokdock-btn rokdock-btn-primary" onClick={onClose}>OK</button>
    }

    return (
        <DialogFrame
            open
            onClose={onClose}
            zIndex={2000}
            overlayTransition="opacity 0.15s ease"
            dialogTransition="transform 0.2s ease, opacity 0.15s ease"
            enterTransform="scale(1) translateY(0)"
            exitTransform="scale(0.96) translateY(6px)"
            dialogStyle={{ width: 420 }}
        >
            <div className="rokdock-dialog-header">
                <span className="rokdock-title">Software Update</span>
                <button style={DIALOG_CLOSE_BTN} onClick={onClose} aria-label="Close"><FontAwesomeIcon icon={faXmark} /></button>
            </div>
            <div className="rokdock-dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {body}
            </div>
            <div className="rokdock-dialog-actions">
                {actions}
            </div>
        </DialogFrame>
    )
}
