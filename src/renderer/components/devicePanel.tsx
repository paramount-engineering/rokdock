/**
 * Left panel containing the discovered device list.
 *
 * Renders a scrollable list of DeviceCard components, one per discovered Roku device.
 * Devices are sorted by the user's saved order (drag-to-reorder) with new devices
 * appended after last-connected devices.
 *
 * Features:
 *  - Drag-to-reorder: native drag events shift cards left/right during drag,
 *    the dropped order is persisted to the store and main process.
 *  - Active connections banner: shows a colored bar listing devices with open
 *    terminal tabs.
 *  - Header actions: refresh scan, open Settings (gear icon).
 *
 * The docked CapturePreview is rendered by LeftColumn (the parent) so it stacks
 * as a peer section alongside this panel and the AI Chat panel.
 */

import React, { useState, useCallback, useMemo, useRef } from 'react'
import { useAppStore, type Device } from '../store/appStore'
import { resolveThemeMode } from '../styles/theme'
import CollapsibleSection from './common/collapsibleSection'
import IconButton from './common/iconButton'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faGear, faPlus, faRotateRight } from '@fortawesome/free-solid-svg-icons'
import DeviceCard from './devicePanel/deviceCard'

/**
 * Computes the horizontal pixel offset a device card should shift during a drag
 * operation to preview the reorder visually before the drop is committed.
 *
 * Returns -10 when the card needs to shift left (make room for the dragged item
 * coming from the left), +10 when it needs to shift right, and 0 otherwise.
 */
function computeShiftOffset(
    draggedIp: string | null,
    dropTargetIp: string | null,
    currentIp: string,
    indexByIp: Map<string, number>
): number {
    if (!draggedIp || !dropTargetIp || draggedIp === dropTargetIp) return 0
    const from = indexByIp.get(draggedIp)
    const to = indexByIp.get(dropTargetIp)
    const idx = indexByIp.get(currentIp)
    if (from == null || to == null || idx == null) return 0
    if (idx === from) return 0
    if (from < to && idx > from && idx <= to) return -10
    if (from > to && idx >= to && idx < from) return 10
    return 0
}

export default function DevicePanel() {
    const devices = useAppStore(state => state.devices)
    const tabs = useAppStore(state => state.tabs)
    const deviceOrder = useAppStore(state => state.deviceOrder)
    const setDeviceOrder = useAppStore(state => state.setDeviceOrder)
    const setAddDeviceDialogOpen = useAppStore(state => state.setAddDeviceDialogOpen)
    const setSettingsDialogOpen = useAppStore(state => state.setSettingsDialogOpen)
    const [expandedDeviceId, setExpandedDeviceId] = useState<string | null>(null)
    const [draggedIp, setDraggedIp] = useState<string | null>(null)
    const [dropTargetIp, setDropTargetIp] = useState<string | null>(null)
    const [dragOffsetY, setDragOffsetY] = useState(0)
    const listRef = useRef<HTMLDivElement | null>(null)
    const dragRef = useRef<{
        pointerId: number
        ip: string
        startX: number
        startY: number
        started: boolean
    } | null>(null)
    const dropTargetIpRef = useRef<string | null>(null)
    const connectedCount = tabs.filter(tab => tab.status === 'connected').length

    const handleRefresh = useCallback(() => {
        window.rokdock.discovery.refresh()
    }, [])

    const sortedDevices = useMemo(() => {
        const orderIndex = new Map(deviceOrder.map((ip, idx) => [ip, idx]))
        const devTier = (device: Device) => device.developerEnabled === false ? 1 : 0
        return [...devices].sort((deviceA, deviceB) => {
            const tierDiff = devTier(deviceA) - devTier(deviceB)
            if (tierDiff !== 0) return tierDiff
            const aOrder = orderIndex.get(deviceA.ip) ?? Number.MAX_SAFE_INTEGER
            const bOrder = orderIndex.get(deviceB.ip) ?? Number.MAX_SAFE_INTEGER
            if (aOrder !== bOrder) return aOrder - bOrder
            return deviceA.name.localeCompare(deviceB.name)
        })
    }, [devices, deviceOrder])

    const reorderDevices = useCallback((sourceIp: string, targetIp: string) => {
        if (!sourceIp || !targetIp || sourceIp === targetIp) return
        const order = sortedDevices.map(device => device.ip)
        const from = order.indexOf(sourceIp)
        const to = order.indexOf(targetIp)
        if (from < 0 || to < 0) return
        const next = [...order]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        setDeviceOrder(next)
        void window.rokdock.store.setDeviceOrder(next)
    }, [sortedDevices, setDeviceOrder])

    const setDropTarget = useCallback((ip: string | null) => {
        dropTargetIpRef.current = ip
        setDropTargetIp(ip)
    }, [])

    const startPointerDrag = useCallback((ip: string, event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return
        dragRef.current = {
            pointerId: event.pointerId,
            ip,
            startX: event.clientX,
            startY: event.clientY,
            started: false
        }
        setDragOffsetY(0)
        setDropTarget(ip)
    }, [setDropTarget])

    const movePointerDrag = useCallback((event: React.PointerEvent<HTMLDivElement>): boolean => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return false

        if (!drag.started) {
            const dx = event.clientX - drag.startX
            const dy = event.clientY - drag.startY
            if (Math.hypot(dx, dy) < 4) {
                return false
            }
            drag.started = true
            setDraggedIp(drag.ip)
        }

        setDragOffsetY(event.clientY - drag.startY)

        const listBounds = listRef.current?.getBoundingClientRect()
        if (!listBounds || event.clientX < listBounds.left || event.clientX > listBounds.right) {
            setDropTarget(null)
            return true
        }

        const cardEls = [...(listRef.current?.querySelectorAll('[data-device-ip]') ?? [])] as HTMLElement[]
        const candidates = cardEls
            .map((element) => ({
                ip: element.dataset.deviceIp || '',
                centerY: element.getBoundingClientRect().top + (element.getBoundingClientRect().height / 2)
            }))
            .filter(({ ip }) => !!ip && ip !== drag.ip)

        if (candidates.length === 0) {
            setDropTarget(drag.ip)
            return true
        }

        let nearest = candidates[0]
        let nearestDist = Math.abs(event.clientY - nearest.centerY)
        for (let i = 1; i < candidates.length; i++) {
            const dist = Math.abs(event.clientY - candidates[i].centerY)
            if (dist < nearestDist) {
                nearest = candidates[i]
                nearestDist = dist
            }
        }
        setDropTarget(nearest.ip)
        return true
    }, [setDropTarget])

    const endPointerDrag = useCallback((event: React.PointerEvent<HTMLDivElement>): boolean => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return false
        dragRef.current = null
        const wasDragging = drag.started
        const targetIp = dropTargetIpRef.current
        setDraggedIp(null)
        setDragOffsetY(0)
        setDropTarget(null)
        if (wasDragging && targetIp && targetIp !== drag.ip) {
            reorderDevices(drag.ip, targetIp)
        }
        return wasDragging
    }, [reorderDevices, setDropTarget])

    const indexByIp = useMemo(() => {
        const map = new Map<string, number>()
        sortedDevices.forEach((device, i) => map.set(device.ip, i))
        return map
    }, [sortedDevices])

    const collapsedPanels = useAppStore(state => state.collapsedPanels)
    const devicesOpen = !collapsedPanels.includes('left-devices')
    const themeMode = resolveThemeMode(useAppStore(state => state.themeMode))
    const styles = useMemo(() => buildStyles(themeMode), [themeMode])

    return (
        <div style={styles.container}>
            <CollapsibleSection
                title="Devices"
                collapsible
                id="left-devices"
                actions={<>
                    <IconButton size="sm" onClick={handleRefresh} title="Refresh Discovery"><FontAwesomeIcon icon={faRotateRight} /></IconButton>
                    <IconButton size="sm" onClick={() => setAddDeviceDialogOpen(true)} title="Add Device Manually"><FontAwesomeIcon icon={faPlus} /></IconButton>
                    <IconButton size="sm" onClick={() => setSettingsDialogOpen('devices')} title="Settings"><FontAwesomeIcon icon={faGear} /></IconButton>
                </>}
            >
                <div />
            </CollapsibleSection>
            {devicesOpen && (
                <>
                    <div style={styles.connectionsAccent}>
                        <span style={styles.connectionsAccentText}>
                            {connectedCount} active connection{connectedCount !== 1 ? 's' : ''}
                        </span>
                    </div>
                    <div ref={listRef} style={styles.deviceList}>
                        {devices.length === 0 ? (
                            <div style={styles.empty}>
                                <p style={{ fontSize: 12, color: 'var(--rokdock-text-dim)' }}>No devices found</p>
                                <p style={{ fontSize: 11, color: 'var(--rokdock-text-muted)', opacity: 0.25 }}>Searching network...</p>
                                <button
                                    className="rokdock-btn rokdock-btn-ghost"
                                    onClick={() => setAddDeviceDialogOpen(true)}
                                >
                                    Add Device Manually
                                </button>
                            </div>
                        ) : (
                            sortedDevices.map((device) => (
                                <DeviceCard
                                    key={device.id}
                                    device={device}
                                    dragged={draggedIp === device.ip}
                                    dragOffsetY={dragOffsetY}
                                    shiftOffset={computeShiftOffset(draggedIp, dropTargetIp, device.ip, indexByIp)}
                                    expanded={expandedDeviceId === device.id}
                                    styles={styles}
                                    onToggleExpand={() => {
                                        setExpandedDeviceId(prev => (prev === device.id ? null : device.id))
                                    }}
                                    onPointerDragStart={startPointerDrag}
                                    onPointerDragMove={movePointerDrag}
                                    onPointerDragEnd={endPointerDrag}
                                />
                            ))
                        )}
                    </div>
                </>
            )}
        </div>
    )
}

/**
 * Builds the inline style map for DevicePanel and its child DeviceCard components.
 * Styles are theme-aware and regenerated whenever the theme mode changes.
 */
function buildStyles(themeMode: 'dark' | 'light'): Record<string, React.CSSProperties> {
    const isLight = themeMode === 'light'
    return {
        container: {
            display: 'flex',
            flexDirection: 'column',
            height: '100%'
        },
        deviceList: {
            flex: 1,
            overflow: 'auto',
            padding: 5
        },
        connectionsAccent: {
            height: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderBottom: `1px solid ${isLight ? 'var(--rokdock-border-light)' : 'var(--rokdock-border)'}`,
            background: isLight ? 'var(--rokdock-bg-surface)' : 'var(--rokdock-bg-terminal)'
        },
        connectionsAccentText: {
            fontSize: 'var(--rokdock-font-xxs)',
            color: isLight ? 'var(--rokdock-text-bright)' : 'var(--rokdock-brand-primary-light)',
            letterSpacing: '0.3px',
            fontWeight: 600
        },
        empty: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '40px 20px'
        },
        card: {
            position: 'relative',
            padding: 0,
            marginBottom: 3,
            borderRadius: 'var(--rokdock-radius-lg)',
            background: isLight
                ? 'linear-gradient(180deg, var(--rokdock-panel-gradient-start) 0%, var(--rokdock-bg-surface) 100%)'
                : 'linear-gradient(180deg, var(--rokdock-bg-panel) 0%, var(--rokdock-bg-surface) 100%)',
            border: `1px solid ${isLight ? 'var(--rokdock-border)' : 'var(--rokdock-border-light)'}`,
            boxShadow: '0 1px 3px var(--rokdock-shadow-subtle)',
            transition: 'all 0.18s ease, transform 120ms ease',
            overflow: 'hidden'
        },
        cardDragging: {
            opacity: 0.65,
            boxShadow: '0 8px 18px var(--rokdock-shadow-strong)',
            border: '1px dashed var(--rokdock-brand-primary-light)'
        },
        cardSelected: {
            background: isLight
                ? 'linear-gradient(90deg, color-mix(in srgb, var(--rokdock-brand-primary) 14%, transparent) 0%, transparent 100%)'
                : 'linear-gradient(90deg, color-mix(in srgb, var(--rokdock-brand-primary) 36%, transparent) 0%, transparent 100%)',
            border: `1px solid ${isLight ? 'color-mix(in srgb, var(--rokdock-brand-primary) 30%, transparent)' : 'color-mix(in srgb, var(--rokdock-brand-primary-light) 45%, transparent)'}`,
            boxShadow: `inset 3px 0 0 ${isLight ? 'var(--rokdock-brand-primary)' : 'var(--rokdock-brand-primary-light)'}, 0 1px 3px var(--rokdock-shadow-subtle)`
        },
        cardHover: {
            border: `1px solid ${isLight ? 'var(--rokdock-brand-primary)' : 'var(--rokdock-brand-primary-faded)'}`,
            background: isLight
                ? 'linear-gradient(180deg, var(--rokdock-brand-primary-faded) 0%, var(--rokdock-panel-gradient-start) 100%)'
                : 'linear-gradient(180deg, var(--rokdock-bg-hover) 0%, var(--rokdock-bg-surface) 100%)',
            boxShadow: '0 4px 16px var(--rokdock-shadow-strong), 0 0 0 1px var(--rokdock-brand-primary-faded)'
        },
        cardExpanded: {
            border: `1px solid ${isLight ? 'var(--rokdock-brand-primary)' : 'var(--rokdock-brand-primary-faded)'}`,
            background: isLight
                ? 'linear-gradient(180deg, var(--rokdock-brand-primary-faded) 0%, var(--rokdock-panel-gradient-start) 56%, var(--rokdock-bg-surface) 100%)'
                : 'linear-gradient(180deg, var(--rokdock-bg-active) 0%, var(--rokdock-bg-surface) 58%, var(--rokdock-bg-panel) 100%)',
            boxShadow: '0 6px 18px var(--rokdock-shadow-strong), 0 0 0 1px var(--rokdock-brand-primary-faded)'
        },
        deviceTextShadow: {
            textShadow: '0 1px 3px var(--rokdock-shadow-subtle)'
        },
        cardHeader: {
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            padding: '7px 6px 7px 9px',
            cursor: 'pointer',
            userSelect: 'none' as const
        },
        deviceInfo: {
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            flex: 1,
            minWidth: 0
        },
        statusDot: {
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'var(--rokdock-state-online)',
            flexShrink: 0,
            marginTop: 5
        },
        deviceName: {
            fontSize: 'var(--rokdock-font-md)',
            fontWeight: 500,
            color: 'var(--rokdock-text-bright)',
            whiteSpace: 'nowrap' as const,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            lineHeight: 1.2
        },
        deviceModel: {
            fontSize: 'var(--rokdock-font-xs)',
            color: 'var(--rokdock-text-primary)',
            marginTop: 2,
            whiteSpace: 'normal' as const,
            overflowWrap: 'anywhere' as const,
            lineHeight: 1.2
        },
        deviceIp: {
            fontSize: 'var(--rokdock-font-xs)',
            color: 'var(--rokdock-text-dim)',
            marginTop: 1,
            whiteSpace: 'normal' as const,
            overflowWrap: 'anywhere' as const,
            lineHeight: 1.2,
            letterSpacing: '0.1px',
            fontFamily: 'var(--rokdock-font-mono)'
        },
        headerRight: {
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            marginTop: 2,
            marginRight: -1
        },
        chevron: {
            fontSize: 'var(--rokdock-font-xxs)',
            color: 'var(--rokdock-text-dim)',
            transition: 'transform 0.15s ease',
            lineHeight: 1
        },
        dropdown: {
            borderTop: '1px solid var(--rokdock-border)',
            padding: '4px 6px 6px'
        },
        dropdownItem: {
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            width: '100%',
            padding: '5px 6px',
            border: 'none',
            borderRadius: 'var(--rokdock-radius-sm)',
            background: 'transparent',
            color: 'var(--rokdock-text-primary)',
            fontSize: 'var(--rokdock-font-sm)',
            cursor: 'pointer',
            textAlign: 'left' as const,
            transition: 'all var(--rokdock-transition-fast)',
            minWidth: 0
        },
        dropdownItemHover: {
            background: isLight
                ? 'linear-gradient(90deg, color-mix(in srgb, var(--rokdock-brand-primary) 28%, transparent) 0%, color-mix(in srgb, var(--rokdock-brand-primary) 22%, transparent) 76%, color-mix(in srgb, var(--rokdock-brand-primary) 6%, transparent) 100%)'
                : 'linear-gradient(90deg, var(--rokdock-brand-primary-faded) 0%, var(--rokdock-brand-primary-faded) 68%, transparent 100%)',
            boxShadow: `inset 0 0 0 1px ${isLight ? 'var(--rokdock-brand-primary)' : 'var(--rokdock-brand-primary-light)'}`
        },
        dropdownDivider: {
            height: 1,
            background: 'var(--rokdock-border)',
            margin: '4px 8px'
        },
        portDot: {
            width: 6,
            height: 6,
            borderRadius: '50%',
            flexShrink: 0
        },
        portLabel: {
            flex: 1,
            minWidth: 0,
            fontWeight: 500,
            whiteSpace: 'nowrap' as const,
            overflow: 'hidden',
            textOverflow: 'ellipsis'
        },
        portNumber: {
            color: 'var(--rokdock-text-muted)',
            fontFamily: 'var(--rokdock-font-mono)',
            fontSize: 'var(--rokdock-font-xs)',
            marginLeft: 2
        }
    }
}
