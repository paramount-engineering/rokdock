/**
 * Individual device card rendered in the left device panel.
 *
 * Displays a Roku device's status, name, model, active app, and configured
 * debug ports as colored dots. Clicking a port dot opens a terminal tab for
 * that device/port combination.
 *
 * Dropdown menu (three-dot / hover):
 *  - Screenshot viewer
 *  - Capture (start/stop stream)
 *  - Sideload App (opens SideloadDialog)
 *  - Device Properties
 *  - Remove device (with confirmation)
 *
 * Status dot colors: green (with glow) = online and reachable, gray = offline.
 * A stale device (last seen >45s ago, outside an active scan) renders as offline
 * (gray, no glow).
 *
 * Sideload is dimmed (not clickable) when developerEnabled is explicitly false,
 * since the /plugin_install endpoint requires developer mode.
 */

import React, { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronRight, faLock, faUnlock } from '@fortawesome/free-solid-svg-icons'
import { useAppStore, createTabInfo, type Device } from '../../store/appStore'
import { resolveThemeMode } from '../../styles/theme'
import ConfirmDialog from '../common/confirmDialog'
import SideloadDialog from '../sideloadDialog'
import { hexToRgb } from '../../utils/color'

const DEVICE_STALE_MS = 45000

/**
 * Returns inline styles for a port badge label that adapt to the current theme
 * mode. In light mode the badge uses a tinted background with high-contrast
 * text; in dark mode it uses a semi-transparent tint with the port color as
 * the text color.
 */
function buildPortBadgeStyle(color: string, mode: 'dark' | 'light'): React.CSSProperties {
    const rgb = hexToRgb(color)
    if (!rgb) {
        return { color: mode === 'light' ? 'var(--rokdock-text-bright)' : color }
    }
    if (mode === 'light') {
        return {
            color: 'var(--rokdock-text-bright)',
            background: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.28)`,
            boxShadow: `inset 0 0 0 1px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.72)`,
            borderRadius: 4,
            padding: '1px 3px'
        }
    }
    return {
        color,
        background: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)`,
        boxShadow: `inset 0 0 0 1px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.45)`,
        borderRadius: 4,
        padding: '1px 3px'
    }
}

/**
 * A plain button that merges an optional `hoverStyle` onto the base `style`
 * while the pointer is inside the element. Used for the dropdown action rows
 * inside the expanded DeviceCard.
 */
function HoverActionButton({
    children,
    style,
    hoverStyle,
    onClick,
    title
}: {
    children: React.ReactNode
    style?: React.CSSProperties
    hoverStyle?: React.CSSProperties
    onClick: () => void
    title?: string
}) {
    const [hovered, setHovered] = useState(false)
    return (
        <button
            style={{ ...style, ...(hovered ? hoverStyle : {}) }}
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            title={title}
        >
            {children}
        </button>
    )
}

interface DeviceCardProps {
    device: Device
    dragged: boolean
    dragOffsetY: number
    shiftOffset: number
    expanded: boolean
    styles: Record<string, React.CSSProperties>
    onToggleExpand: () => void
    onPointerDragStart: (ip: string, event: React.PointerEvent<HTMLDivElement>) => void
    onPointerDragMove: (event: React.PointerEvent<HTMLDivElement>) => boolean
    onPointerDragEnd: (event: React.PointerEvent<HTMLDivElement>) => boolean
}

/**
 * Renders a single Roku device entry in the left device panel.
 * Clicking the header row toggles an expanded dropdown showing port connect
 * buttons, sideload, properties, and (for manual devices) a remove action.
 * Supports pointer-based drag-to-reorder via the onPointerDragStart/Move/End
 * callbacks provided by the parent DevicePanel.
 */
export default function DeviceCard({
    device,
    dragged,
    dragOffsetY,
    shiftOffset,
    expanded,
    styles,
    onToggleExpand,
    onPointerDragStart,
    onPointerDragMove,
    onPointerDragEnd
}: DeviceCardProps) {
    const themeMode = resolveThemeMode(useAppStore((state) => state.themeMode))
    const [hovered, setHovered] = useState(false)
    const [showRemoveConfirm, setShowRemoveConfirm] = useState(false)
    const [sideloadOpen, setSideloadOpen] = useState(false)
    const addTab = useAppStore((state) => state.addTab)
    const remoteTargetIp = useAppStore((state) => state.remoteTargetIp)
    const setRemoteTargetIp = useAppStore((state) => state.setRemoteTargetIp)
    const setRightPanel = useAppStore((state) => state.setRightPanel)
    const ports = useAppStore((state) => state.ports)
    const terminalAutoScroll = useAppStore((state) => state.terminalAutoScroll)
    const terminalWordWrap = useAppStore((state) => state.terminalWordWrap)
    const deviceNicknames = useAppStore((state) => state.deviceNicknames)
    const setDevicePropertiesDevice = useAppStore((state) => state.setDevicePropertiesDevice)
    const recordConnection = useAppStore((state) => state.recordConnection)
    const lastScanAt = useAppStore((state) => state.lastScanAt)
    const discoveryRequestTimeoutMs = useAppStore((state) => state.discoveryRequestTimeoutMs)
    const deviceHasAuth = useAppStore((state) => state.deviceHasAuth)

    const displayName = deviceNicknames[device.ip] || device.name
    // Removable when the store persists this device as a manual entry. Keyed on the
    // persisted `configured` flag, not the transient `manual` flag, so the option
    // does not vanish once SSDP discovers a manually-added device.
    const canRemoveCustom = !!device.configured
    const now = Date.now()
    const scanWindowMs = discoveryRequestTimeoutMs + 2000
    const isScanActive = now - lastScanAt < scanWindowMs
    const isStale = !isScanActive && now - device.lastSeen > DEVICE_STALE_MS
    const isRemoteTarget = remoteTargetIp === device.ip
    const devHasAuth = deviceHasAuth[device.ip]
    const canSideload = device.developerEnabled !== false && !!deviceHasAuth[device.ip]

    /** Opens a new terminal tab connected to this device on the given port. */
    const handleConnect = async (port: number) => {
        try {
            const sessionId = await window.rokdock.terminal.createSession(device.ip, device.name, port)
            const tab = createTabInfo(sessionId, device.ip, displayName, port, {
                autoScroll: terminalAutoScroll,
                wordWrap: terminalWordWrap
            })
            addTab(tab)
            recordConnection(device.ip)
            setRemoteTargetIp(device.ip)
        } catch (e) {
            console.error('Failed to create session:', e)
        }
    }

    /** Sets this device as the remote target and opens the right panel, then focuses it. */
    const handleOpenRemote = () => {
        setRemoteTargetIp(device.ip)
        setRightPanel(true)
        window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent('rokdock:focus-remote-panel'))
        }, 0)
    }

    /** Removes this manually-added device from the persisted device list via the main process. */
    const handleRemoveManualDevice = async () => {
        if (!canRemoveCustom) return
        try {
            await window.rokdock.discovery.removeDevice(device.id)
            setShowRemoveConfirm(false)
        } catch (e) {
            console.error('Failed to remove manual device:', e)
        }
    }

    const enabledPorts = ports.filter((portConfig) => portConfig.enabled)
    const modelLabel = (() => {
        if (device.model !== 'Manual') return device.model
        if (device.hasAuth) return 'Authenticated'
        return 'Manual'
    })()

    return (
        <>
            <div
                data-device-ip={device.ip}
                style={{
                    ...styles.card,
                    ...(dragged ? styles.cardDragging : {}),
                    ...(expanded ? styles.cardExpanded : {}),
                    ...(hovered && !expanded ? styles.cardHover : {}),
                    ...(isRemoteTarget ? styles.cardSelected : {}),
                    transform: dragged ? `translateY(${Math.round(dragOffsetY)}px) scale(1.01)` : (shiftOffset ? `translateY(${shiftOffset}px)` : 'none'),
                    zIndex: dragged ? 3 : 1
                }}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
            >
                <div
                    style={styles.cardHeader}
                    onPointerDown={(event) => {
                        onPointerDragStart(device.ip, event)
                        event.currentTarget.setPointerCapture(event.pointerId)
                    }}
                    onPointerMove={(event) => {
                        const dragging = onPointerDragMove(event)
                        if (dragging) event.preventDefault()
                    }}
                    onPointerUp={(event) => {
                        const wasDragging = onPointerDragEnd(event)
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                            event.currentTarget.releasePointerCapture(event.pointerId)
                        }
                        if (!wasDragging) onToggleExpand()
                    }}
                    onPointerCancel={(event) => {
                        void onPointerDragEnd(event)
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                            event.currentTarget.releasePointerCapture(event.pointerId)
                        }
                    }}
                >
                    <div style={styles.deviceInfo}>
                        <span style={{ ...styles.statusDot, background: (device.reachable && !isStale) ? 'var(--rokdock-state-online)' : 'var(--rokdock-state-offline)', boxShadow: (device.reachable && !isStale) ? 'var(--rokdock-glow-online)' : 'none' }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ ...styles.deviceName, ...(expanded ? styles.deviceTextShadow : {}) }}>{displayName}</div>
                            <div style={{ ...styles.deviceModel, ...(expanded ? styles.deviceTextShadow : {}) }}>{modelLabel}</div>
                            <div style={{ ...styles.deviceIp, ...(expanded ? styles.deviceTextShadow : {}) }}>{device.ip}</div>
                        </div>
                    </div>
                    <div style={{ ...styles.headerRight, alignSelf: 'stretch', flexDirection: 'column', justifyContent: 'flex-start', paddingBottom: expanded ? 2 : 3 }}>
                        <span style={{ ...styles.chevron, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}><FontAwesomeIcon icon={faChevronRight} /></span>
                        {device.developerEnabled === true && (
                            <span
                                title={devHasAuth ? 'Developer mode enabled' : 'Developer mode enabled - no credentials set'}
                                style={{ lineHeight: 1, fontSize: 10, marginTop: 'auto' }}
                            >
                                <FontAwesomeIcon icon={devHasAuth ? faUnlock : faLock} style={{ color: devHasAuth ? 'var(--rokdock-state-online)' : 'var(--rokdock-text-muted)', display: 'block', filter: devHasAuth ? 'drop-shadow(0 0 2px var(--rokdock-state-online-glow-dim))' : 'none' }} />
                            </span>
                        )}
                    </div>
                </div>
                {expanded && (
                    <div style={styles.dropdown}>
                        {enabledPorts.map(({ port, label, color }) => (
                            <HoverActionButton key={port} style={styles.dropdownItem} hoverStyle={styles.dropdownItemHover} onClick={() => handleConnect(port)}>
                                <span style={{ ...styles.portDot, background: color }} />
                                <span style={styles.portLabel}>{label}</span>
                                <span style={{ ...styles.portNumber, ...buildPortBadgeStyle(color, themeMode) }}>{port}</span>
                            </HoverActionButton>
                        ))}
                        <div style={styles.dropdownDivider} />
                        <HoverActionButton style={styles.dropdownItem} hoverStyle={styles.dropdownItemHover} onClick={handleOpenRemote}>
                            <span style={{ ...styles.portDot, background: 'var(--rokdock-brand-primary-light)' }} />
                            <span style={styles.portLabel}>Connect Remote Panel</span>
                        </HoverActionButton>
                        <HoverActionButton
                            style={{ ...styles.dropdownItem, ...(!canSideload ? { opacity: 0.45, cursor: 'default' } : {}) }}
                            hoverStyle={canSideload ? styles.dropdownItemHover : {}}
                            onClick={canSideload ? () => setSideloadOpen(true) : () => { }}
                            title={canSideload ? undefined : !deviceHasAuth[device.ip] ? 'No credentials set - configure in Device Properties' : 'Developer mode not detected on this device'}
                        >
                            <span style={{ ...styles.portDot, background: 'var(--rokdock-brand-primary-light)' }} />
                            <span style={styles.portLabel}>Sideload App...</span>
                        </HoverActionButton>
                        <HoverActionButton style={styles.dropdownItem} hoverStyle={styles.dropdownItemHover} onClick={() => setDevicePropertiesDevice(device)}>
                            <span style={{ ...styles.portDot, background: 'var(--rokdock-text-muted)' }} />
                            <span style={styles.portLabel}>Properties...</span>
                        </HoverActionButton>
                        {canRemoveCustom && (
                            <>
                                <div style={styles.dropdownDivider} />
                                <HoverActionButton style={{ ...styles.dropdownItem, color: 'var(--rokdock-state-error)' }} hoverStyle={styles.dropdownItemHover} onClick={() => setShowRemoveConfirm(true)} title="Remove custom device">
                                    <span style={{ ...styles.portDot, background: 'var(--rokdock-state-error)' }} />
                                    <span style={styles.portLabel}>Remove Custom Device...</span>
                                </HoverActionButton>
                            </>
                        )}
                    </div>
                )}
            </div>
            <ConfirmDialog
                open={showRemoveConfirm}
                title="Remove Custom Device"
                message={`Remove custom device "${displayName}" (${device.ip})?`}
                confirmLabel="Remove"
                destructive
                onCancel={() => setShowRemoveConfirm(false)}
                onConfirm={() => { void handleRemoveManualDevice() }}
            />
            <SideloadDialog device={sideloadOpen ? device : null} onClose={() => setSideloadOpen(false)} />
        </>
    )
}
