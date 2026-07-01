/**
 * Floating volume control for the capture audio stream.
 *
 * Rendered as a portal into document.body so it layers above the capture
 * video regardless of stacking context. Position is set inline relative to
 * the icon button that triggers it.
 *
 * The control shows a mute/unmute toggle button and a VerticalSlider
 * (TRACK_HEIGHT x TRACK_WIDTH px) for fine-grained volume adjustment.
 * Volume is stored in appStore (captureVolume) and applied to the active
 * MediaStream audio track.
 *
 * The popover auto-closes when the user clicks outside it, detected by a
 * mousedown listener on the document. The panel dismisses immediately so
 * there is no delay on quick icon clicks.
 */
import React, { useCallback, useRef, useState, useEffect } from 'react'
import ReactDOM from 'react-dom'
import { useAppStore } from '../store/appStore'
import IconButton from './common/iconButton'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faVolumeXmark, faVolumeHigh } from '@fortawesome/free-solid-svg-icons'

const TRACK_HEIGHT = 80
const TRACK_WIDTH = 4
const THUMB_SIZE = 12

interface CaptureVolumeControlProps {
    disabled?: boolean
}

/**
 * Renders a vertical range slider (0-100) using a custom pointer-capture drag
 * implementation. The track fills from the bottom, and a circular thumb
 * indicates the current position. Pointer capture keeps the drag active even
 * when the cursor leaves the track element.
 */
function VerticalSlider({ value, onChange }: { value: number; onChange: (volume: number) => void }) {
    const trackRef = useRef<HTMLDivElement>(null)
    const dragging = useRef(false)

    /** Converts a raw clientY pixel position into a 0-100 integer volume value. */
    const valueFromY = useCallback((clientY: number) => {
        const rect = trackRef.current?.getBoundingClientRect()
        if (!rect) return value
        const pct = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
        return Math.round(pct * 100)
    }, [value])

    const onPointerDown = useCallback((e: React.PointerEvent) => {
        e.preventDefault()
        e.stopPropagation()
        dragging.current = true
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        onChange(valueFromY(e.clientY))
    }, [onChange, valueFromY])

    const onPointerMove = useCallback((e: React.PointerEvent) => {
        if (!dragging.current) return
        onChange(valueFromY(e.clientY))
    }, [onChange, valueFromY])

    const onPointerUp = useCallback(() => {
        dragging.current = false
    }, [])

    const fillHeight = `${value}%`
    const thumbBottom = `calc(${value}% - ${THUMB_SIZE / 2}px)`

    return (
        <div
            ref={trackRef}
            style={{
                position: 'relative',
                width: THUMB_SIZE + 8,
                height: TRACK_HEIGHT,
                display: 'flex',
                justifyContent: 'center',
                cursor: 'pointer',
                touchAction: 'none',
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
        >
            {/* Track background */}
            <div style={{
                position: 'absolute',
                top: 0,
                width: TRACK_WIDTH,
                height: '100%',
                borderRadius: TRACK_WIDTH / 2,
                background: 'var(--rokdock-border)',
            }} />
            {/* Fill */}
            <div style={{
                position: 'absolute',
                bottom: 0,
                width: TRACK_WIDTH,
                height: fillHeight,
                borderRadius: TRACK_WIDTH / 2,
                background: 'var(--rokdock-brand-primary)',
            }} />
            {/* Thumb */}
            <div style={{
                position: 'absolute',
                bottom: thumbBottom,
                width: THUMB_SIZE,
                height: THUMB_SIZE,
                borderRadius: '50%',
                background: 'var(--rokdock-text-bright)',
                border: '2px solid var(--rokdock-brand-primary)',
            }} />
        </div>
    )
}

/**
 * Renders a volume icon button that opens a portal flyout containing a
 * VerticalSlider and a mute toggle for the capture audio stream. The flyout
 * is positioned above the trigger button and dismisses on outside click.
 * Volume state is read from and written to the app store.
 */
export default function CaptureVolumeControl({ disabled }: CaptureVolumeControlProps) {
    const captureMuted = useAppStore(state => state.captureMuted)
    const captureVolume = useAppStore(state => state.captureVolume)
    const setCaptureMuted = useAppStore(state => state.setCaptureMuted)
    const setCaptureVolume = useAppStore(state => state.setCaptureVolume)
    const [open, setOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)
    const [flyoutPos, setFlyoutPos] = useState<{ x: number; y: number } | null>(null)

    /** Toggles the muted state of the capture audio stream. */
    const toggleMute = useCallback(() => setCaptureMuted(!captureMuted), [captureMuted, setCaptureMuted])

    /**
     * Updates the capture volume in the store and automatically syncs the muted
     * state: unmutes when volume rises above 0, mutes when it reaches 0.
     */
    const handleVolumeChange = useCallback((val: number) => {
        setCaptureVolume(val)
        if (val > 0 && captureMuted) setCaptureMuted(false)
        if (val === 0 && !captureMuted) setCaptureMuted(true)
    }, [captureMuted, setCaptureMuted, setCaptureVolume])

    /** Opens the flyout, capturing the trigger button's position for portal placement. */
    const handleToggle = useCallback(() => {
        if (!open && rootRef.current) {
            const rect = rootRef.current.getBoundingClientRect()
            setFlyoutPos({
                x: rect.left + rect.width / 2,
                y: rect.top,
            })
        }
        setOpen(prev => !prev)
    }, [open])

    // Close on outside click
    useEffect(() => {
        if (!open) return
        const onDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                // Also check if click is inside the portal flyout
                const flyout = document.getElementById('capture-volume-flyout')
                if (flyout && flyout.contains(e.target as Node)) return
                setOpen(false)
            }
        }
        document.addEventListener('mousedown', onDown)
        return () => document.removeEventListener('mousedown', onDown)
    }, [open])

    const volumeIcon = captureMuted || captureVolume === 0
        ? faVolumeXmark
        : faVolumeHigh

    const displayVolume = captureMuted ? 0 : captureVolume

    return (
        <div ref={rootRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <IconButton
                size="sm"
                title={`Volume: ${displayVolume}%`}
                onClick={handleToggle}
                disabled={disabled}
            >
                <FontAwesomeIcon
                    icon={volumeIcon}
                    style={{ fontSize: 13, ...(captureMuted ? { color: 'var(--rokdock-btn-danger)' } : undefined) }}
                />
            </IconButton>
            {open && flyoutPos && ReactDOM.createPortal(
                <div
                    id="capture-volume-flyout"
                    style={{
                        position: 'fixed',
                        left: flyoutPos.x,
                        top: flyoutPos.y,
                        transform: 'translate(-50%, -100%)',
                        marginTop: -4,
                        background: 'var(--rokdock-bg-surface)',
                        border: '1px solid var(--rokdock-border)',
                        borderRadius: 'var(--rokdock-radius-md)',
                        boxShadow: 'var(--rokdock-shadow-elevated)',
                        padding: '8px 6px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 6,
                        zIndex: 1100,
                    }}
                >
                    <span style={{
                        fontSize: 'var(--rokdock-font-xs)',
                        fontFamily: 'var(--rokdock-font-mono)',
                        color: 'var(--rokdock-text-dim)',
                        userSelect: 'none',
                        lineHeight: 1,
                    }}>
                        {displayVolume}
                    </span>
                    <VerticalSlider value={displayVolume} onChange={handleVolumeChange} />
                    <IconButton
                        size="sm"
                        title={captureMuted ? 'Unmute' : 'Mute'}
                        onClick={toggleMute}
                    >
                        <FontAwesomeIcon
                            icon={captureMuted ? faVolumeXmark : faVolumeHigh}
                            style={{ fontSize: 13, ...(captureMuted ? { color: 'var(--rokdock-btn-danger)' } : undefined) }}
                        />
                    </IconButton>
                </div>,
                document.body
            )}
        </div>
    )
}
