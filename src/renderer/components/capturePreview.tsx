/**
 * Inline capture preview panel that embeds a live <video> element sourced
 * from a screen-capture media stream.
 *
 * Two display modes:
 *  - 'docked': rendered inside the device panel or right panel as a
 *    CollapsibleSection. Shows capture controls (float as PiP, swap capture side,
 *    settings gear) along with the video thumbnail.
 *  - 'pip': rendered inside CaptureFloat as a compact floating overlay.
 *    Shows only the video and minimal controls.
 *
 * Stream acquisition is delegated to useCaptureStream(). When active=false or
 * captureMode is 'off', the video element is hidden and a placeholder is shown.
 *
 * Controls:
 *  - Float (PiP): toggles captureMode between 'docked' and 'pip' (togglePip).
 *  - Swap side: toggles captureDockSide between 'left' and 'right'.
 *  - Settings: opens the Settings dialog.
 *  - Mute / volume: rendered via CaptureVolumeControl.
 *  - Start/Stop capture toggle.
 */
import React from 'react'
import { useAppStore } from '../store/appStore'
import IconButton from './common/iconButton'
import CollapsibleSection from './common/collapsibleSection'
import CaptureVolumeControl from './captureVolumeControl'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
    faWindowRestore,
    faArrowRightArrowLeft,
    faGear,
    faVideo,
    faVideoSlash,
} from '@fortawesome/free-solid-svg-icons'
import { useCaptureStream } from '../hooks/useCaptureStream'

const COLLAPSE_ID = 'capture-preview'

interface CapturePreviewProps {
    mode: 'docked' | 'pip'
    active: boolean
}

/**
 * Renders the live capture video preview in either docked (CollapsibleSection)
 * or pip (bare container) mode. Stream acquisition is handled by useCaptureStream;
 * this component only manages placeholder visibility and control actions.
 */
export default function CapturePreview({ mode, active }: CapturePreviewProps) {
    const captureDeviceId = useAppStore(state => state.captureDeviceId)
    const captureMode = useAppStore(state => state.captureMode)
    const captureAvailable = useAppStore(state => state.captureAvailable)
    const captureDockSide = useAppStore(state => state.captureDockSide)
    const setCaptureMode = useAppStore(state => state.setCaptureMode)
    const setCaptureDockSide = useAppStore(state => state.setCaptureDockSide)
    const setSettingsDialogOpen = useAppStore(state => state.setSettingsDialogOpen)
    const captureAspectRatio = useAppStore(state => state.captureAspectRatio)
    const collapsedPanels = useAppStore(state => state.collapsedPanels)

    const collapsed = mode === 'docked' && collapsedPanels.includes(COLLAPSE_ID)

    const shouldStream = active && !!captureDeviceId && captureMode !== 'popout' && captureMode !== 'screenshot-preview' && !collapsed
    const shouldDetectDevices = active && !collapsed
    const { videoRef, streamActive, idlePaused, error } = useCaptureStream(shouldStream, shouldDetectDevices)

    const deviceAvailable = !!captureDeviceId

    const togglePip = () => setCaptureMode(captureMode === 'pip' ? 'docked' : 'pip')
    const swapDockSide = () => setCaptureDockSide(captureDockSide === 'left' ? 'right' : 'left')
    const openSettings = () => setSettingsDialogOpen('capture')

    // Determine which placeholder to show
    const showVideo = shouldStream && streamActive && !error
    const showNoDevice = !captureDeviceId
    const showNoDeviceDetected = !showNoDevice && !captureAvailable
    const showDisconnected = !showNoDevice && captureAvailable && !!error
    const showIdlePaused = !showNoDevice && !showNoDeviceDetected && !showDisconnected && idlePaused

    const dockedActions = (
        <>
            <CaptureVolumeControl disabled={!deviceAvailable} />
            <IconButton
                size="sm"
                title={captureDockSide === 'left' ? 'Move to right panel' : 'Move to left panel'}
                onClick={swapDockSide}
            >
                <FontAwesomeIcon icon={faArrowRightArrowLeft} />
            </IconButton>
            <IconButton
                size="sm"
                title="Float capture (PiP)"
                onClick={togglePip}
                disabled={!deviceAvailable}
            >
                <FontAwesomeIcon icon={faWindowRestore} />
            </IconButton>
            <IconButton
                size="sm"
                title="Capture settings"
                onClick={openSettings}
            >
                <FontAwesomeIcon icon={faGear} />
            </IconButton>
        </>
    )

    const videoContent = (
        <div style={styles.videoContainer}>
            {/* Single video element - always mounted so srcObject survives re-renders */}
            <video
                ref={videoRef}
                autoPlay
                playsInline
                style={showVideo
                    ? {
                        ...styles.video,
                        ...(mode === 'pip' ? { height: '100%' } : {}),
                        ...(captureAspectRatio !== 'auto'
                            ? { aspectRatio: captureAspectRatio.replace(':', ' / '), objectFit: 'fill' as const }
                            : {}),
                    }
                    : { ...styles.video, display: 'none' }}
            />
            {!showVideo && (
                <div style={styles.placeholder}>
                    {showNoDevice && (
                        <>
                            <FontAwesomeIcon icon={faVideo} style={styles.placeholderIcon as never} />
                            <span style={styles.placeholderText}>Select a capture device in Settings</span>
                        </>
                    )}
                    {showNoDeviceDetected && (
                        <>
                            <FontAwesomeIcon icon={faVideoSlash} style={styles.placeholderIcon as never} />
                            <span style={styles.placeholderText}>No capture device detected</span>
                        </>
                    )}
                    {showDisconnected && (
                        <>
                            <FontAwesomeIcon icon={faVideoSlash} style={styles.placeholderIcon as never} />
                            <span style={styles.placeholderText}>Capture device disconnected</span>
                        </>
                    )}
                    {showIdlePaused && (
                        <>
                            <FontAwesomeIcon icon={faVideoSlash} style={styles.placeholderIcon as never} />
                            <span style={styles.placeholderText}>Paused due to inactivity</span>
                        </>
                    )}
                    {!showNoDevice && !showNoDeviceDetected && !showDisconnected && !showIdlePaused && (
                        <>
                            <FontAwesomeIcon icon={faVideo} style={styles.placeholderIcon as never} />
                            <span style={styles.placeholderText}>Starting capture...</span>
                        </>
                    )}
                </div>
            )}
        </div>
    )

    if (mode === 'pip') {
        return (
            <div style={styles.root}>
                {videoContent}
            </div>
        )
    }

    return (
        <div style={{ borderTop: '1px solid var(--rokdock-border)' }}>
            <CollapsibleSection
                title="Capture"
                id={COLLAPSE_ID}
                actions={dockedActions}
            >
                {/* Empty - we render video outside to keep it mounted */}
                <></>
            </CollapsibleSection>
            <div style={{ display: collapsed ? 'none' : undefined }}>
                {videoContent}
            </div>
        </div>
    )
}

const styles: Record<string, React.CSSProperties> = {
    root: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        fontFamily: 'var(--rokdock-font-ui)',
    },
    videoContainer: {
        width: '100%',
        background: '#000',
        flexShrink: 0,
        overflow: 'hidden',
    },
    video: {
        objectFit: 'contain',
        width: '100%',
        display: 'block',
    },
    placeholder: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '24px 16px',
        background: 'var(--rokdock-bg-panel)',
        aspectRatio: '16 / 9',
    },
    placeholderIcon: {
        fontSize: 20,
        color: 'var(--rokdock-text-muted)',
        opacity: 0.5,
    },
    placeholderText: {
        fontSize: 'var(--rokdock-font-xs)',
        color: 'var(--rokdock-text-muted)',
        textAlign: 'center' as const,
        lineHeight: 1.4,
    },
}
