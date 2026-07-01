/**
 * Dialog for sideloading a Roku channel package (.zip dev build or signed .pkg) to a device.
 *
 * Opened from the device card dropdown when developerEnabled is true and
 * credentials have been configured. Accepts device as a prop (null = closed).
 *
 * Phase state machine:
 *  - idle: file picker row + disabled Install button until a package is chosen.
 *  - installing: progress bar with shimmer animation and status text while the
 *    zip is being read and POSTed to the device's /plugin_install endpoint.
 *    Subscribes to window.rokdock.sideload.onProgress for percent + status updates.
 *  - done: result panel colored green (success) or red (failure) with the
 *    Roku response message. On failure, if the error indicates missing credentials,
 *    an inline link opens Device Properties to the password field.
 *
 * Action buttons adapt to phase: idle = Install + Cancel, installing = disabled,
 * done/ok = Close, done/error = Close + Retry.
 *
 * The shimmer keyframe animation is injected into the document once via
 * ensureAnimStyles() to avoid re-injection on re-render.
 *
 * All state is reset when the device prop transitions from non-null to null
 * so the dialog is fresh the next time it opens.
 */
import React, { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark, faCheck, faUpload } from '@fortawesome/free-solid-svg-icons'
import { useAppStore, type Device } from '../store/appStore'
import DialogFrame from './common/dialogFrame'

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
    justifyContent: 'center'
}

interface SideloadDialogProps {
    device: Device | null
    onClose: () => void
}

type Phase = 'idle' | 'installing' | 'done'

const ANIM_STYLE_ID = 'sideload-anim'
/**
 * Injects the shimmer and spinner keyframe animations into the document head
 * the first time the dialog mounts. Subsequent calls are no-ops checked by ID.
 */
function ensureAnimStyles() {
    if (document.getElementById(ANIM_STYLE_ID)) return
    const el = document.createElement('style')
    el.id = ANIM_STYLE_ID
    el.textContent = `
        @keyframes sideload-shimmer {
            0%   { transform: translateX(-200%) skewX(-20deg); opacity: 0; }
            20%  { opacity: 1; }
            80%  { opacity: 1; }
            100% { transform: translateX(500%) skewX(-20deg); opacity: 0; }
        }
        @keyframes sideload-spin {
            to { transform: rotate(360deg); }
        }
    `
    document.head.appendChild(el)
}

/**
 * Renders the sideload dialog for the given device (null = hidden).
 * Manages the idle -> installing -> done phase state machine and surfaces
 * progress events from the main process as a progress bar.
 */
export default function SideloadDialog({ device, onClose }: SideloadDialogProps) {
    const deviceNicknames = useAppStore(state => state.deviceNicknames)
    const setDevicePropertiesDevice = useAppStore(state => state.setDevicePropertiesDevice)

    const [phase, setPhase] = useState<Phase>('idle')
    const [filePath, setFilePath] = useState<string | null>(null)
    const [fileName, setFileName] = useState<string | null>(null)
    const [progress, setProgress] = useState(0)
    const [status, setStatus] = useState('')
    const [result, setResult] = useState<{ ok: boolean; message?: string; error?: string } | null>(null)

    useEffect(() => { ensureAnimStyles() }, [])

    useEffect(() => {
        if (!device) {
            setPhase('idle')
            setFilePath(null)
            setFileName(null)
            setProgress(0)
            setStatus('')
            setResult(null)
        }
    }, [device])

    useEffect(() => {
        if (phase !== 'installing') return
        const unsub = window.rokdock.sideload.onProgress(({ percent, status: nextStatus }: { percent: number; status: string }) => {
            setProgress(percent)
            setStatus(nextStatus)
        })
        return unsub
    }, [phase])

    /** Opens the OS file picker filtered to .zip and .pkg packages and stores the result. */
    const handlePickFile = async () => {
        const res = await window.rokdock.sideload.pickFile()
        if (res.ok && res.filePath && res.fileName) {
            setFilePath(res.filePath)
            setFileName(res.fileName)
            setResult(null)
        }
    }

    /**
     * Starts the sideload operation: transitions to the installing phase, POSTs
     * the selected zip to the device, and sets the result when done.
     */
    const handleInstall = async () => {
        if (!device || !filePath) return
        setPhase('installing')
        setProgress(0)
        setStatus('Uploading...')
        setResult(null)
        const res = await window.rokdock.sideload.install(device.ip, filePath)
        setProgress(100)
        setPhase('done')
        setResult({ ok: res.ok, message: res.message, error: res.error })
    }

    /** Closes this dialog and opens DevicePropertiesDialog for the target device. */
    const handleOpenProperties = () => {
        if (!device) return
        onClose()
        setDevicePropertiesDevice(device)
    }

    const displayName = device ? (deviceNicknames[device.ip] || device.name) : ''
    const noCredentials = !!result?.error?.toLowerCase().includes('no credentials')

    return (
        <DialogFrame
            open={!!device}
            onClose={phase === 'installing' ? () => {} : onClose}
            zIndex={2000}
            overlayTransition="opacity 0.15s ease"
            dialogTransition="transform 0.2s ease, opacity 0.15s ease"
            enterTransform="scale(1) translateY(0)"
            exitTransform="scale(0.96) translateY(6px)"
            dialogStyle={{ width: 460 }}
        >
            {/* Header */}
            <div className="rokdock-dialog-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FontAwesomeIcon
                        icon={faUpload}
                        style={{ color: 'var(--rokdock-brand-primary-light)', fontSize: 13 }}
                    />
                    <span className="rokdock-title">Sideload App</span>
                </div>
                <button style={DIALOG_CLOSE_BTN} onClick={onClose} disabled={phase === 'installing'}>
                    <FontAwesomeIcon icon={faXmark} />
                </button>
            </div>

            {/* Body */}
            <div className="rokdock-dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Device target row */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '7px 10px',
                    background: 'var(--rokdock-bg-input)',
                    borderRadius: 'var(--rokdock-radius-md)',
                    border: '1px solid var(--rokdock-border)'
                }}>
                    <span style={{
                        fontSize: 'var(--rokdock-font-xxs)',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        color: 'var(--rokdock-text-muted)',
                        flexShrink: 0
                    }}>Target</span>
                    <span style={{
                        width: 1,
                        height: 12,
                        background: 'var(--rokdock-border)',
                        flexShrink: 0
                    }} />
                    <span style={{
                        fontSize: 'var(--rokdock-font-sm)',
                        fontWeight: 600,
                        color: 'var(--rokdock-text-bright)',
                        flexShrink: 0,
                        maxWidth: 160,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                    }}>{displayName}</span>
                    <span style={{
                        fontFamily: 'var(--rokdock-font-mono)',
                        fontSize: 'var(--rokdock-font-xs)',
                        color: 'var(--rokdock-text-muted)',
                        marginLeft: 'auto'
                    }}>{device?.ip}</span>
                </div>

                {/* File picker zone */}
                <div style={{
                    border: `1.5px ${fileName ? 'solid' : 'dashed'} ${fileName ? 'var(--rokdock-brand-primary)' : 'var(--rokdock-border)'}`,
                    borderRadius: 'var(--rokdock-radius-md)',
                    padding: '10px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    background: fileName ? 'var(--rokdock-brand-primary-faded)' : 'transparent',
                    transition: 'border-color 0.15s ease, background 0.15s ease',
                    opacity: phase === 'installing' ? 0.6 : 1
                }}>
                    <div style={{
                        width: 28,
                        height: 28,
                        borderRadius: 'var(--rokdock-radius-sm)',
                        background: fileName ? 'var(--rokdock-brand-primary-faded)' : 'var(--rokdock-bg-input)',
                        border: `1px solid ${fileName ? 'var(--rokdock-brand-primary)' : 'var(--rokdock-border)'}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        color: fileName ? 'var(--rokdock-brand-primary-light)' : 'var(--rokdock-text-muted)',
                        fontSize: 11
                    }}>
                        <FontAwesomeIcon icon={faUpload} />
                    </div>
                    <span style={{
                        flex: 1,
                        fontSize: 'var(--rokdock-font-sm)',
                        fontFamily: fileName ? 'var(--rokdock-font-mono)' : undefined,
                        color: fileName ? 'var(--rokdock-text-primary)' : 'var(--rokdock-text-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        minWidth: 0
                    }}>
                        {fileName ?? 'No package selected'}
                    </span>
                    <button
                        className="rokdock-btn rokdock-btn-ghost"
                        style={{ flexShrink: 0 }}
                        onClick={handlePickFile}
                        disabled={phase === 'installing'}
                    >
                        Choose...
                    </button>
                </div>

                {/* Progress bar */}
                {phase === 'installing' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <span style={{
                                fontSize: 'var(--rokdock-font-xs)',
                                color: 'var(--rokdock-text-muted)',
                                fontFamily: 'var(--rokdock-font-mono)'
                            }}>{status}</span>
                            <span style={{
                                fontSize: 'var(--rokdock-font-xxs)',
                                color: 'var(--rokdock-brand-primary-light)',
                                fontFamily: 'var(--rokdock-font-mono)',
                                fontWeight: 600
                            }}>{progress}%</span>
                        </div>
                        <div style={{
                            height: 3,
                            borderRadius: 99,
                            background: 'var(--rokdock-border)',
                            overflow: 'hidden',
                            position: 'relative'
                        }}>
                            <div style={{
                                position: 'absolute',
                                inset: 0,
                                right: `${100 - progress}%`,
                                background: 'linear-gradient(90deg, var(--rokdock-brand-primary), var(--rokdock-brand-primary-light))',
                                borderRadius: 99,
                                transition: 'right 0.3s ease'
                            }} />
                            {progress < 100 && (
                                <div style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: `${progress}%`,
                                    height: '100%',
                                    overflow: 'hidden'
                                }}>
                                    <div style={{
                                        position: 'absolute',
                                        top: 0,
                                        width: '30%',
                                        height: '100%',
                                        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
                                        animation: 'sideload-shimmer 1.4s ease-in-out infinite'
                                    }} />
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Result panel */}
                {phase === 'done' && result && (
                    <div style={{
                        borderLeft: `3px solid ${result.ok ? 'var(--rokdock-state-online)' : 'var(--rokdock-state-error)'}`,
                        background: result.ok
                            ? 'var(--rokdock-state-online-faded)'
                            : `color-mix(in srgb, var(--rokdock-state-error) 12%, transparent)`,
                        borderRadius: '0 var(--rokdock-radius-md) var(--rokdock-radius-md) 0',
                        padding: '10px 14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <FontAwesomeIcon
                                icon={result.ok ? faCheck : faXmark}
                                style={{
                                    fontSize: 11,
                                    color: result.ok ? 'var(--rokdock-state-online)' : 'var(--rokdock-error-text)',
                                    flexShrink: 0
                                }}
                            />
                            <span style={{
                                fontSize: 'var(--rokdock-font-sm)',
                                fontWeight: 600,
                                color: result.ok ? 'var(--rokdock-state-online)' : 'var(--rokdock-error-text)'
                            }}>
                                {result.ok ? 'Installed' : 'Failed'}
                            </span>
                        </div>
                        <span style={{
                            fontSize: 'var(--rokdock-font-xs)',
                            color: 'var(--rokdock-text-dim)',
                            wordBreak: 'break-word',
                            lineHeight: 1.45,
                            paddingLeft: 17
                        }}>
                            {result.message ?? result.error}
                        </span>
                        {noCredentials && (
                            <button
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    padding: '2px 0 0 17px',
                                    cursor: 'pointer',
                                    color: 'var(--rokdock-brand-primary-light)',
                                    fontSize: 'var(--rokdock-font-xs)',
                                    textAlign: 'left',
                                    fontFamily: 'var(--rokdock-font-ui)',
                                    textDecoration: 'underline',
                                    textUnderlineOffset: 2
                                }}
                                onClick={handleOpenProperties}
                            >
                                Set credentials in Device Properties
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Actions */}
            <div className="rokdock-dialog-actions">
                <>
                    <button className="rokdock-btn rokdock-btn-ghost" onClick={onClose} disabled={phase === 'installing'}>
                        {phase === 'done' ? 'Close' : 'Cancel'}
                    </button>
                    {phase !== 'done' || !result?.ok ? (
                        <button
                            className="rokdock-btn rokdock-btn-primary"
                            onClick={handleInstall}
                            disabled={!filePath || phase === 'installing'}
                        >
                            {phase === 'installing' ? 'Installing...' : 'Install'}
                        </button>
                    ) : null}
                </>
            </div>
        </DialogFrame>
    )
}
