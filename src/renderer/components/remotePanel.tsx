/**
 * Right-side panel containing the Roku on-screen remote, device selector,
 * deeplinks, scripts, and the docked capture preview.
 *
 * Structure (top to bottom):
 *  - Device selector: dropdown showing all known devices; selecting one sets
 *    remoteTargetIp so ECP commands are sent to the right device.
 *  - Inline capture preview strip (when captureDockSide === 'right') showing
 *    a live thumbnail of the active app via useCaptureStream.
 *  - rokdock-remote web component: renders the Roku remote image with hotspot
 *    hit-testing; emits keypress/text events that are forwarded to ecp:key/text.
 *  - Screenshot button: triggers a one-shot screenshot and shows a brief toast.
 *  - CollapsibleSection for Deeplinks (DeeplinksPanel).
 *  - CollapsibleSection for Scripts (ScriptsPanel).
 *  - Settings and Device Properties shortcut icons at the bottom.
 *
 * The panel listens for the 'rokdock:focus-remote-panel' custom event (fired
 * when a device card's "Connect Remote Panel" item is clicked) and moves focus
 * to the device selector so keyboard interaction starts immediately.
 */
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import { resolveThemeMode } from '../styles/theme'
import DeeplinksPanel from './deeplinksPanel'
import ScriptsPanel from './scriptsPanel'
import CollapsibleSection from './common/collapsibleSection'
import IconButton from './common/iconButton'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCamera, faCircleInfo, faGear, faSpinner } from '@fortawesome/free-solid-svg-icons'
import CapturePreview from './capturePreview'
import { REMOTE_CAPTURE_TOAST_DURATION_MS } from '../constants/ui'
import remoteImageUrl from '../../../resources/remote.png'


interface RemotePanelProps {
    extraSection?: React.ReactNode
}

export default function RemotePanel({ extraSection }: RemotePanelProps = {}) {
    const themeMode = resolveThemeMode(useAppStore(state => state.themeMode))
    const devices = useAppStore(state => state.devices)
    const remoteTargetIp = useAppStore(state => state.remoteTargetIp)
    const setRemoteTargetIp = useAppStore(state => state.setRemoteTargetIp)
    const setSettingsDialogOpen = useAppStore(state => state.setSettingsDialogOpen)
    const setDevicePropertiesDevice = useAppStore(state => state.setDevicePropertiesDevice)
    const setDevicePropertiesFocusField = useAppStore(state => state.setDevicePropertiesFocusField)
    const setToolsScreenshotEnabled = useAppStore(state => state.setToolsScreenshotEnabled)
    const captureDockSide = useAppStore(state => state.captureDockSide)
    const captureMode = useAppStore(state => state.captureMode)
    const deviceNicknames = useAppStore(state => state.deviceNicknames)
    const remoteKeyBindings = useAppStore(state => state.remoteKeyBindings)
    const devAppPollIntervalMs = useAppStore(state => state.devAppPollIntervalMs)
    const panelRef = useRef<HTMLDivElement | null>(null)
    const remoteComponentRef = useRef<HTMLElement | null>(null)
    const [keyboardFocused, setKeyboardFocused] = useState(false)
    const [activeAppId, setActiveAppId] = useState('')
    const [hasStoredAuth, setHasStoredAuth] = useState(false)
    const [capturePending, setCapturePending] = useState(false)
    const [captureToast, setCaptureToast] = useState<{ message: string; showConfigShortcut: boolean; showOpenScreenshot: boolean } | null>(null)
    const focusPulseTimerRef = useRef<number | null>(null)
    const [focusPulse, setFocusPulse] = useState(false)
    const deviceIp = remoteTargetIp

    const selectedDevice = devices.find(device => device.ip === deviceIp)
    const selectTitle = selectedDevice
        ? `${deviceNicknames[selectedDevice.ip] || selectedDevice.name} (${selectedDevice.ip})`
        : 'Select device...'
    const authConfigured = !!selectedDevice && (selectedDevice.hasAuth || hasStoredAuth)
    const isDevAppActive = activeAppId.trim().toLowerCase() === 'dev'
    const canCaptureScreenshot = !!selectedDevice

    // Sync key bindings and listen for focus changes from the component
    useEffect(() => {
        const remoteComponent = remoteComponentRef.current as HTMLElement & { keyBindings?: Record<string, string> } | null
        if (!remoteComponent) return
        remoteComponent.keyBindings = remoteKeyBindings
    }, [remoteKeyBindings])

    useEffect(() => {
        const remoteComponent = remoteComponentRef.current
        if (!remoteComponent) return
        const onFocusChanged = (e: Event) => {
            const active = (e as CustomEvent).detail?.keysActive
            setKeyboardFocused(!!active)
        }
        remoteComponent.addEventListener('remote-focus-changed', onFocusChanged)
        return () => remoteComponent.removeEventListener('remote-focus-changed', onFocusChanged)
    }, [])

    useEffect(() => {
        const onFocusRemotePanel = () => {
            setKeyboardFocused(true)
            panelRef.current?.focus()
            setFocusPulse(true)
            if (focusPulseTimerRef.current) window.clearTimeout(focusPulseTimerRef.current)
            focusPulseTimerRef.current = window.setTimeout(() => {
                setFocusPulse(false)
                focusPulseTimerRef.current = null
            }, 1300)
        }
        window.addEventListener('rokdock:focus-remote-panel', onFocusRemotePanel)
        return () => window.removeEventListener('rokdock:focus-remote-panel', onFocusRemotePanel)
    }, [])

    useEffect(() => {
        return () => {
            if (focusPulseTimerRef.current) {
                window.clearTimeout(focusPulseTimerRef.current)
            }
        }
    }, [])

    useEffect(() => {
        if (!deviceIp) {
            setKeyboardFocused(false)
            setFocusPulse(false)
        }
    }, [deviceIp])

    useEffect(() => {
        setActiveAppId(selectedDevice?.activeAppId ?? '')
    }, [selectedDevice?.activeAppId, selectedDevice?.ip])

    useEffect(() => {
        if (!captureToast) return
        const timer = window.setTimeout(() => setCaptureToast(null), REMOTE_CAPTURE_TOAST_DURATION_MS)
        return () => window.clearTimeout(timer)
    }, [captureToast])

    useEffect(() => {
        if (!deviceIp) {
            setActiveAppId('')
            return
        }
        let cancelled = false
        const poll = async () => {
            try {
                const active = await window.rokdock.device.getActiveApp(deviceIp)
                if (!cancelled) {
                    setActiveAppId((active.id || '').trim())
                }
            } catch {
                // Keep previous known app id on transient polling errors.
            }
        }
        void poll()
        const timer = window.setInterval(() => { void poll() }, devAppPollIntervalMs)
        return () => {
            cancelled = true
            window.clearInterval(timer)
        }
    }, [deviceIp, devAppPollIntervalMs])

    useEffect(() => {
        if (!deviceIp) {
            setHasStoredAuth(false)
            return
        }
        let cancelled = false
        const loadAuth = async () => {
            try {
                const auth = await window.rokdock.store.getDeviceAuth(deviceIp)
                if (!cancelled) {
                    setHasStoredAuth(!!(auth?.username && auth?.password))
                }
            } catch {
                if (!cancelled) {
                    setHasStoredAuth(false)
                }
            }
        }
        void loadAuth()
        return () => {
            cancelled = true
        }
    }, [deviceIp, selectedDevice?.hasAuth])

    const disabled = !deviceIp

    // Sync device and disabled attributes imperatively (React doesn't reliably toggle attributes on custom elements)
    useEffect(() => {
        const remoteComponent = remoteComponentRef.current
        if (!remoteComponent) return
        if (deviceIp) {
            remoteComponent.setAttribute('device', deviceIp)
            remoteComponent.removeAttribute('disabled')
        } else {
            remoteComponent.removeAttribute('device')
            remoteComponent.setAttribute('disabled', '')
        }
    }, [deviceIp])

    const keysActive = !disabled && (keyboardFocused || focusPulse)
    const styles = useMemo(() => buildStyles(themeMode), [themeMode])

    /**
     * Builds the toast descriptor for a failed screenshot capture. Sets
     * showConfigShortcut=true when the error message indicates missing or
     * invalid credentials so the "Set credentials" quick-action is shown.
     */
    const buildCaptureToast = useCallback((error: string) => {
        const lower = error.toLowerCase()
        const showConfigShortcut = lower.includes('no device credentials found')
            || lower.includes('authorization failed')
            || lower.includes('check roku developer credentials')
        return {
            message: error,
            showConfigShortcut,
            showOpenScreenshot: true
        }
    }, [])

    const handleCaptureScreenshot = useCallback(async () => {
        if (!deviceIp || capturePending) return
        setCapturePending(true)
        try {
            const result = await window.rokdock.device.captureScreenshot(deviceIp, themeMode)
            if (!result.ok) {
                setCaptureToast(buildCaptureToast(result.error ?? 'Screenshot failed.'))
                return
            }
        } finally {
            setCapturePending(false)
        }
    }, [deviceIp, capturePending, buildCaptureToast, themeMode])

    useEffect(() => {
        const enabled = !!selectedDevice && !capturePending
        setToolsScreenshotEnabled(enabled)
        window.rokdock.menu.setToolsScreenshotEnabled(enabled)
    }, [selectedDevice, capturePending, setToolsScreenshotEnabled])

    useEffect(() => () => {
        setToolsScreenshotEnabled(false)
        window.rokdock.menu.setToolsScreenshotEnabled(false)
    }, [setToolsScreenshotEnabled])

    useEffect(() => {
        const onToolsScreenshot = () => {
            if (deviceIp) void window.rokdock.device.openScreenshotWindow(deviceIp, themeMode)
        }
        window.addEventListener('rokdock:tools-screenshot', onToolsScreenshot)
        return () => window.removeEventListener('rokdock:tools-screenshot', onToolsScreenshot)
    }, [deviceIp, themeMode])

    return (
        <div
            ref={panelRef}
            tabIndex={-1}
            style={styles.container}
        >
            <div style={styles.ipBar}>
                <select
                    style={styles.ipSelect}
                    value={deviceIp || ''}
                    title={selectTitle}
                    onChange={e => setRemoteTargetIp(e.target.value || null)}
                >
                    <option value="">Select device...</option>
                    {devices.map(device => (
                        <option key={device.ip} value={device.ip}>
                            {deviceNicknames[device.ip] || device.name} ({device.ip})
                        </option>
                    ))}
                </select>
            </div>
            <div style={styles.scrollArea}>
                {/* Dim the device-dependent sections when no device is selected. Visual only:
                    the remote itself is already inert via its own `disabled` attribute, and
                    the section config gears (e.g. Configure deeplinks) must stay clickable
                    since they are device-independent. */}
                <div style={disabled ? { opacity: 0.45 } : undefined}>
                <CollapsibleSection
                    title="Remote"
                    id="remote"
                    actions={<div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span
                            style={styles.keyStatus}
                            title={deviceIp
                                ? (keysActive ? 'Keyboard shortcuts active' : 'Click remote panel to activate keyboard shortcuts')
                                : 'Select a device to enable keyboard shortcuts'}
                        >
                            <span style={{
                                ...styles.keyStatusDot,
                                ...(keysActive ? styles.keyStatusDotOn : {})
                            }} />
                            <span style={{ position: 'relative', top: 1 }}>{!deviceIp ? 'No device' : keysActive ? 'Keys on' : 'Keys off'}</span>
                        </span>
                        <IconButton
                            size="sm"
                            title={canCaptureScreenshot
                                ? (isDevAppActive
                                    ? 'Capture screenshot (active dev app). In the preview: first copy icon = image only; second icon or Ctrl/Cmd+Shift+C = with comparison overlay.'
                                    : (authConfigured
                                        ? `Capture screenshot (active app: ${activeAppId || 'unknown'})`
                                        : 'Capture screenshot (credentials required)'))
                                : 'Select a device first'}
                            onClick={() => { void handleCaptureScreenshot() }}
                            disabled={!canCaptureScreenshot || capturePending}
                        >
                            <FontAwesomeIcon icon={capturePending ? faSpinner : faCamera} spin={capturePending} />
                        </IconButton>
                        <IconButton
                            size="sm"
                            title="Remote key bindings"
                            onClick={() => setSettingsDialogOpen('remote')}
                        >
                            <FontAwesomeIcon icon={faGear} />
                        </IconButton>
                    </div>}
                >
                    {!!captureToast && (
                        <div
                            style={{
                                ...styles.captureToast,
                                ...(captureToast.showConfigShortcut ? styles.captureToastConfig : styles.captureToastInfo)
                            }}
                        >
                            <div style={styles.captureToastTopRow}>
                                <span style={styles.captureToastIcon}>
                                    <FontAwesomeIcon icon={faCircleInfo} />
                                </span>
                                <span style={styles.captureToastText}>{captureToast.message}</span>
                            </div>
                            {(captureToast.showConfigShortcut || captureToast.showOpenScreenshot) && deviceIp && (
                                <div style={styles.captureToastActions}>
                                    {captureToast.showConfigShortcut && selectedDevice && (
                                    <button
                                        style={styles.captureToastAction}
                                        onClick={() => {
                                            setCaptureToast(null)
                                            setDevicePropertiesFocusField('password')
                                            setDevicePropertiesDevice(selectedDevice)
                                        }}
                                    >
                                        Set credentials
                                    </button>
                                    )}
                                    {captureToast.showOpenScreenshot && (
                                    <button
                                        style={styles.captureToastAction}
                                        onClick={() => {
                                            setCaptureToast(null)
                                            void window.rokdock.device.openScreenshotWindow(deviceIp, themeMode)
                                        }}
                                    >
                                        Open screenshot window
                                    </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    {React.createElement('rokdock-remote', {
                        ref: remoteComponentRef,
                        style: { padding: 'var(--rokdock-space-sm) var(--rokdock-space-sm) var(--rokdock-space-md)' }
                    }, React.createElement('img', { slot: 'image', src: remoteImageUrl, alt: 'Roku Remote', draggable: false }))}
                </CollapsibleSection>

                <ScriptsPanel />

                <DeeplinksPanel />
                </div>

                {extraSection}
            </div>
            {!deviceIp && (
                <div style={styles.noDevice}>
                    Select a device above, or connect to a device terminal, to use the remote and deeplinks.
                </div>
            )}
            {captureDockSide === 'right' && captureMode === 'docked' && (
                <CapturePreview mode="docked" active={true} />
            )}
        </div>
    )
}

/**
 * Builds the inline style map for RemotePanel. Receives the theme mode so
 * mode-conditional values can be resolved to the correct CSS var or literal.
 */
function buildStyles(themeMode: 'dark' | 'light'): Record<string, React.CSSProperties> {
    const isLight = themeMode === 'light'
    return {
        container: {
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
            overflow: 'hidden'
        },
        ipBar: {
            flexShrink: 0
        },
        keyStatus: {
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            height: 20,
            fontSize: 'var(--rokdock-font-xs)',
            color: 'var(--rokdock-text-muted)',
            whiteSpace: 'nowrap',
            marginRight: 6
        },
        keyStatusDot: {
            width: 7,
            height: 7,
            borderRadius: 'var(--rokdock-radius-round)',
            background: 'var(--rokdock-state-offline)',
            boxShadow: 'none'
        },
        keyStatusDotOn: {
            background: 'var(--rokdock-state-online)',
            boxShadow: '0 0 6px var(--rokdock-state-online)'
        },
        ipSelect: {
            display: 'block',
            width: '100%',
            minWidth: 0,
            boxSizing: 'border-box',
            background: 'var(--rokdock-bg-input)',
            border: 'none',
            borderBottom: '1px solid var(--rokdock-border)',
            color: 'var(--rokdock-text-dim)',
            fontSize: 'var(--rokdock-font-sm)',
            padding: '3px 6px',
            outline: 'none',
            cursor: 'pointer',
            fontFamily: 'var(--rokdock-font-ui)'
        },
        scrollArea: {
            flex: 1,
            minHeight: 0,
            overflowX: 'hidden',
            overflowY: 'auto'
        },
        noDevice: {
            padding: '10px 12px',
            textAlign: 'center' as const,
            fontSize: 'var(--rokdock-font-sm)',
            color: 'var(--rokdock-text-muted)',
            lineHeight: 1.5,
            flexShrink: 0,
            opacity: 0.35
        },
        captureToast: {
            margin: '6px 10px 2px',
            padding: '7px 8px',
            borderRadius: 'var(--rokdock-radius-sm)',
            color: 'var(--rokdock-text-primary)',
            fontSize: 'var(--rokdock-font-xs)',
            border: '1px solid var(--rokdock-border)'
        },
        captureToastInfo: {
            background: 'var(--rokdock-bg-surface)'
        },
        captureToastConfig: {
            background: isLight ? 'color-mix(in srgb, var(--rokdock-brand-primary) 8%, transparent)' : 'color-mix(in srgb, var(--rokdock-brand-primary) 18%, transparent)',
            borderColor: 'var(--rokdock-brand-primary-faded)'
        },
        captureToastIcon: {
            color: 'var(--rokdock-brand-primary-light)',
            marginTop: 1,
            flexShrink: 0
        },
        captureToastTopRow: {
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8
        },
        captureToastText: {
            flex: 1,
            lineHeight: 1.35
        },
        captureToastActions: {
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            justifyContent: 'flex-end',
            marginTop: 6
        },
        captureToastAction: {
            border: '1px solid var(--rokdock-brand-primary-faded)',
            background: isLight ? 'color-mix(in srgb, var(--rokdock-bg-panel) 75%, transparent)' : 'color-mix(in srgb, var(--rokdock-bg-panel) 55%, transparent)',
            color: 'var(--rokdock-brand-primary-light)',
            borderRadius: 'var(--rokdock-radius-sm)',
            padding: '3px 8px',
            fontSize: 'var(--rokdock-font-xxs)',
            fontWeight: 600,
            cursor: 'pointer',
            flexShrink: 0
        }
    }
}

