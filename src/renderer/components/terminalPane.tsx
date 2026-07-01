/**
 * Single terminal pane containing a tab bar and the active terminal view.
 *
 * RokDock supports up to two side-by-side panes (paneA / paneB). Each pane
 * owns a set of tabs; this component manages the tab bar UI for one pane and
 * renders the currently active tab's CustomTerminalView.
 *
 * Tab bar features:
 *  - Click to activate, middle-click or X button to close
 *  - Right-click opens TabContextMenu (split, move to other pane, close)
 *  - Drag-and-drop to reorder tabs within the pane or move across panes
 *  - Label mode toggles between showing the device name and the port label
 *
 * Tokenized line chunks arrive via IPC (terminal:data) and are accumulated in
 * a ref buffer before being handed to CustomTerminalView for rendering.
 * Buffer is capped at TERMINAL_MAX_BUFFER_LINES to bound memory.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore, TabInfo, PaneId } from '../store/appStore'
import { getPortLabel } from '../../shared/ports'
import { TERMINAL_MAX_BUFFER_LINES } from '../../shared/terminal'
import CustomTerminalView, { clearTerminalCache } from './customTerminalView'
import TabContextMenu from './tabContextMenu'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark } from '@fortawesome/free-solid-svg-icons'

const STATUS_COLORS: Record<string, string> = {
    connecting: 'var(--rokdock-state-connecting)',
    connected: 'var(--rokdock-state-online)',
    disconnected: 'var(--rokdock-state-offline)',
    error: 'var(--rokdock-state-error)'
}

interface TerminalPaneProps {
    paneId: PaneId
    isFocused: boolean
    onFocus: () => void
}

/**
 * Renders a single terminal pane: a scrollable tab bar of connection tabs
 * and the CustomTerminalView for the currently active tab. Inactive tab views
 * are hidden (display:none) but kept mounted to preserve their buffer state.
 */
export default function TerminalPane({ paneId, isFocused, onFocus }: TerminalPaneProps) {
    const allTabs = useAppStore(state => state.tabs)
    const paneState = useAppStore(state => paneId === 'a' ? state.paneA : state.paneB)
    const tabLabelMode = useAppStore(state => state.tabLabelMode)
    const setActiveTab = useAppStore(state => state.setActiveTab)
    const removeTab = useAppStore(state => state.removeTab)
    const splitTab = useAppStore(state => state.splitTab)
    const moveTabToPane = useAppStore(state => state.moveTabToPane)
    const reorderTab = useAppStore(state => state.reorderTab)
    const tabListRef = useRef<HTMLDivElement>(null)
    const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)
    const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
    const [crossPaneDragOver, setCrossPaneDragOver] = useState(false)

    const tabs = allTabs.filter(tab => tab.paneId === paneId)
    const activeTabId = paneState?.activeTabId ?? null
    const isSplit = useAppStore(state => state.paneB !== null)

    /** Kills the terminal process, clears its render cache, and removes the tab from state. */
    const handleCloseTab = (e: React.MouseEvent, tabId: string) => {
        e.stopPropagation()
        window.rokdock.terminal.kill(tabId)
        clearTerminalCache(tabId)
        removeTab(tabId)
    }

    const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
        e.preventDefault()
        setCtxMenu({ x: e.clientX, y: e.clientY, tabId })
    }, [])

    /** Closes every tab in this pane except the one identified by tabId. */
    const handleCloseOthers = useCallback((tabId: string) => {
        tabs.filter(tab => tab.id !== tabId).forEach(tab => {
            window.rokdock.terminal.kill(tab.id)
            clearTerminalCache(tab.id)
            removeTab(tab.id)
        })
    }, [tabs, removeTab])

    /** Closes all tabs in this pane. */
    const handleCloseAll = useCallback(() => {
        tabs.forEach(tab => {
            window.rokdock.terminal.kill(tab.id)
            clearTerminalCache(tab.id)
            removeTab(tab.id)
        })
    }, [tabs, removeTab])

    const styles = useMemo(() => buildPaneStyles(isFocused), [isFocused])

    return (
        <div style={styles.container} onMouseDown={onFocus}>
            <div
                className="rokdock-tab-bar"
                style={{
                    borderBottom: isFocused
                        ? `2px solid var(--rokdock-brand-primary)`
                        : `1px solid var(--rokdock-border)`,
                    boxShadow: crossPaneDragOver
                        ? `inset 0 0 0 1px var(--rokdock-brand-primary)`
                        : `inset 0 -1px 0 var(--rokdock-menu-border)`,
                    opacity: isFocused ? 1 : 0.85,
                    ...(crossPaneDragOver ? { background: `linear-gradient(180deg, color-mix(in srgb, var(--rokdock-brand-primary) 8%, transparent) 0%, var(--rokdock-tab-bg) 100%)` } : {})
                }}
            >
                <div
                    ref={tabListRef}
                    className="rokdock-tab-list"
                    onWheel={(e) => {
                        if (tabListRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                            e.preventDefault()
                            tabListRef.current.scrollLeft += e.deltaY
                        }
                    }}
                    onDrop={(e) => {
                        e.preventDefault()
                        const tabId = e.dataTransfer.getData('text/plain')
                        if (!tabId) return
                        setDragOverIdx(null)
                        setCrossPaneDragOver(false)
                        const draggedTab = allTabs.find(tab => tab.id === tabId)
                        if (!draggedTab) return
                        if (draggedTab.paneId !== paneId) moveTabToPane(tabId, paneId)
                        const paneTabs = allTabs.filter(tab => tab.paneId === paneId && tab.id !== tabId)
                        const beforeTab = dragOverIdx !== null && dragOverIdx < paneTabs.length ? paneTabs[dragOverIdx] : null
                        reorderTab(tabId, beforeTab?.id ?? null)
                    }}
                    onDragOver={(e) => {
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                        // Detect cross-pane drag by checking if dragged tab belongs to other pane
                        if (isSplit && !crossPaneDragOver) setCrossPaneDragOver(true)
                    }}
                    onDragLeave={() => { setDragOverIdx(null); setCrossPaneDragOver(false) }}
                >
                    {tabs.map((tab, idx) => (
                        <React.Fragment key={tab.id}>
                            {dragOverIdx === idx && (
                                <div style={{ width: 2, flexShrink: 0, alignSelf: 'stretch', background: 'var(--rokdock-text-bright)', boxShadow: `0 0 6px var(--rokdock-white-bright)`, borderRadius: 1 }} />
                            )}
                            <PaneTab
                                tab={tab}
                                labelMode={tabLabelMode}
                                isActive={tab.id === activeTabId}
                                onSelect={() => setActiveTab(tab.id)}
                                onClose={(e) => handleCloseTab(e, tab.id)}
                                onContextMenu={(e) => handleContextMenu(e, tab.id)}
                                onTabDragOver={(e) => {
                                    e.preventDefault()
                                    const rect = e.currentTarget.getBoundingClientRect()
                                    setDragOverIdx(e.clientX < rect.left + rect.width / 2 ? idx : idx + 1)
                                }}
                            />
                        </React.Fragment>
                    ))}
                    {dragOverIdx !== null && dragOverIdx >= tabs.length && (
                        <div style={{ width: 2, flexShrink: 0, alignSelf: 'stretch', background: 'var(--rokdock-text-bright)', boxShadow: `0 0 6px var(--rokdock-white-bright)`, borderRadius: 1 }} />
                    )}
                </div>
            </div>
            <div style={styles.terminalContainer}>
                {tabs.map(tab => (
                    <div
                        key={tab.id}
                        style={{
                            ...styles.terminalWrapper,
                            display: tab.id === activeTabId ? 'flex' : 'none'
                        }}
                    >
                        <CustomTerminalView tab={tab} isActive={tab.id === activeTabId && isFocused} />
                    </div>
                ))}
            </div>
            {ctxMenu && (
                <TabContextMenu
                    x={ctxMenu.x}
                    y={ctxMenu.y}
                    tabId={ctxMenu.tabId}
                    isSplit={isSplit}
                    isOnlyTab={allTabs.length <= 1}
                    onClose={() => setCtxMenu(null)}
                    onCloseTab={(id) => { window.rokdock.terminal.kill(id); clearTerminalCache(id); removeTab(id) }}
                    onCloseOthers={handleCloseOthers}
                    onCloseAll={handleCloseAll}
                    onSplitRight={splitTab}
                    onMoveToOtherPane={(id) => moveTabToPane(id, paneId === 'a' ? 'b' : 'a')}
                />
            )}
        </div>
    )
}

/**
 * Individual tab chip rendered in the TerminalPane tab bar.
 *
 * Shows a connection-status dot, a port-color indicator bar, the tab label
 * (device name or IP depending on labelMode), a buffer-fill meter, an
 * activity pulse dot for inactive tabs with new output, and a close button.
 *
 * When the label overflows its container, hovering triggers a marquee-style
 * slide animation so the full label becomes readable.
 *
 * Supports HTML5 drag-and-drop so tabs can be reordered within the pane or
 * moved to the other pane.
 */
function PaneTab({ tab, labelMode, isActive, onSelect, onClose, onContextMenu, onTabDragOver }: {
    tab: TabInfo
    labelMode: 'displayName' | 'ip'
    isActive: boolean
    onSelect: () => void
    onClose: (e: React.MouseEvent) => void
    onContextMenu: (e: React.MouseEvent) => void
    onTabDragOver: (e: React.DragEvent) => void
}) {
    const [hovered, setHovered] = useState(false)
    const scrollRef = useRef<HTMLSpanElement>(null)
    const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const ports = useAppStore(state => state.ports)
    const bufferLines = useAppStore(state => state.terminalBufferLineCount[tab.id] ?? 0)

    useEffect(() => {
        return () => {
            if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
        }
    }, [])

    const portColor = ports.find(port => port.port === tab.port)?.color || 'var(--rokdock-text-dim)'
    const statusColor = STATUS_COLORS[tab.status] || 'var(--rokdock-state-offline)'
    const portLabel = getPortLabel(tab.port)
    const shortLabel = labelMode === 'displayName'
        ? `${tab.deviceName} (${tab.port})`
        : `${tab.deviceIp}:${tab.port}`
    const bufferPct = Math.min(100, Math.round((bufferLines / TERMINAL_MAX_BUFFER_LINES) * 100))
    const bufferFill = Math.min(1, bufferLines / TERMINAL_MAX_BUFFER_LINES)
    const bufferFillColor =
        bufferFill >= 0.95 ? 'var(--rokdock-state-error)' : bufferFill >= 0.65 ? 'var(--rokdock-state-connecting)' : 'var(--rokdock-state-online)'
    const fullTooltip =
        `${tab.deviceName} - ${portLabel} (${tab.deviceIp}:${tab.port})\n`
        + `Buffer: ${bufferLines.toLocaleString()} / ${TERMINAL_MAX_BUFFER_LINES.toLocaleString()} lines (${bufferPct}%)`

    const handleMouseEnter = () => {
        setHovered(true)
        if (scrollRef.current) {
            const label = scrollRef.current
            const overflow = label.scrollWidth - label.clientWidth
            if (overflow > 0) {
                scrollTimerRef.current = setTimeout(() => {
                    label.style.transition = `transform ${overflow * 20}ms linear`
                    label.style.transform = `translateX(-${overflow}px)`
                }, 400)
            }
        }
    }

    const handleMouseLeave = () => {
        setHovered(false)
        if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
        if (scrollRef.current) {
            scrollRef.current.style.transition = 'transform 0.15s ease'
            scrollRef.current.style.transform = 'translateX(0)'
        }
    }

    const styles = useMemo(() => buildPaneStyles(true), [])

    return (
        <div
            draggable
            className={`rokdock-tab${isActive ? ' active' : ''}`}
            onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', tab.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setDragImage(e.currentTarget, 0, 0)
            }}
            onDragOver={onTabDragOver}
            onClick={onSelect}
            onContextMenu={onContextMenu}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            title={fullTooltip}
        >
            <span style={{ ...styles.tabStatusDot, background: statusColor }} />
            <span style={{ ...styles.tabPortIndicator, background: portColor }} />
            <span className="rokdock-tab-label">
                <span ref={scrollRef} style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>{shortLabel}</span>
            </span>
            <span
                style={styles.bufferMeterTrack}
                aria-hidden
                title={`Buffer ${bufferPct}% full (${bufferLines.toLocaleString()} lines)`}
            >
                <span
                    style={{
                        ...styles.bufferMeterFill,
                        height: `${bufferFill * 100}%`,
                        background: bufferFillColor,
                        ...(bufferLines > 0 && bufferFill > 0 && bufferFill * 100 < 6 ? { minHeight: 2 } : {})
                    }}
                />
            </span>
            {!isActive && tab.hasActivity && (
                <span style={styles.activityDot} />
            )}
            <button
                className="rokdock-tab-close"
                onClick={onClose}
                title="Close connection"
            >
                <FontAwesomeIcon icon={faXmark} />
            </button>
        </div>
    )
}

/**
 * Builds inline styles for the pane container and its tab indicator elements.
 * Most tab bar and label styles are shared CSS classes (rokdock-tab, etc.); only
 * inline values that depend on theme tokens are returned here.
 */
function buildPaneStyles(isFocused: boolean): Record<string, React.CSSProperties> {
    return {
        container: {
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minWidth: 0,
            overflow: 'hidden'
        },
        /* tabBar, tabList, tab, tabActive, tabHover: shared via rokdock-tab-* CSS classes */
        tabStatusDot: {
            width: 6,
            height: 6,
            borderRadius: '50%',
            flexShrink: 0
        },
        tabPortIndicator: {
            width: 3,
            height: 14,
            borderRadius: 2,
            flexShrink: 0
        },
        /* tabLabel, tabLabelActive: shared via rokdock-tab-label CSS class */
        bufferMeterTrack: {
            width: 3,
            height: 12,
            borderRadius: 2,
            background: 'var(--rokdock-border)',
            position: 'relative' as const,
            overflow: 'hidden',
            flexShrink: 0,
            opacity: 0.92,
            alignSelf: 'center'
        },
        bufferMeterFill: {
            position: 'absolute' as const,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100%',
            borderRadius: 1,
            transition: 'height 0.12s ease, background 0.12s ease'
        },
        /* tabCloseBtn, tabCloseBtnHover: shared via rokdock-tab-close CSS class */
        terminalContainer: {
            flex: 1,
            position: 'relative' as const,
            overflow: 'hidden'
        },
        terminalWrapper: {
            position: 'absolute' as const,
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            flexDirection: 'column'
        },
        activityDot: {
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'var(--rokdock-state-connecting)',
            flexShrink: 0,
            animation: 'tabPulse 1.5s ease-in-out infinite'
        }
    }
}
