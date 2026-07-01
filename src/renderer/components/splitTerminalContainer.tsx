/**
 * Top-level terminal area that renders one or two TerminalPane instances.
 *
 * When only paneA is active this is a single full-width terminal. When a tab
 * is split (via the split button or tab context menu), paneB becomes visible
 * and a PaneDivider drag handle appears between them. The split ratio is
 * stored in appStore so it persists across re-renders.
 *
 * The toolbar at the top right exposes:
 *  - Split pane toggle (faTableColumns)
 *  - Settings (faGear)
 *
 * A drop zone overlay appears when a tab is dragged over the container edge,
 * allowing cross-pane drops.
 */
import React, { useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'
import TerminalPane from './terminalPane'
import PaneDivider from './paneDivider'
import IconButton from './common/iconButton'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faGear, faHexagon, faTableColumns } from '@fortawesome/free-solid-svg-icons'

const CONTAINER_STYLE: React.CSSProperties = { display: 'flex', height: '100%', overflow: 'hidden', position: 'relative' }
const TOOLBAR_WRAP_STYLE: React.CSSProperties = {
    position: 'absolute', top: 0, right: 0, zIndex: 4,
    display: 'flex', alignItems: 'center', height: 30, paddingRight: 6, gap: 2
}

/**
 * Renders the terminal work area: one or two TerminalPane instances separated
 * by a PaneDivider when split mode is active. When no tabs exist, shows a
 * branded empty-state placeholder instead.
 *
 * Handles cross-pane tab drops: dragging a tab to the right 20% edge of the
 * container triggers a split-drop zone that creates a new pane.
 */
export default function SplitTerminalContainer() {
    const tabs = useAppStore(state => state.tabs)
    const paneB = useAppStore(state => state.paneB)
    const focusedPaneId = useAppStore(state => state.focusedPaneId)
    const focusedActiveTabId = useAppStore(state => {
        const pane = state.focusedPaneId === 'a' ? state.paneA : state.paneB
        return pane?.activeTabId ?? null
    })
    const splitRatio = useAppStore(state => state.splitRatio)
    const setFocusedPane = useAppStore(state => state.setFocusedPane)
    const setSplitRatio = useAppStore(state => state.setSplitRatio)
    const splitTab = useAppStore(state => state.splitTab)
    const setSettingsDialogOpen = useAppStore(state => state.setSettingsDialogOpen)
    const containerRef = useRef<HTMLDivElement>(null)
    const [splitDropActive, setSplitDropActive] = useState(false)

    if (tabs.length === 0) {
        return (
            <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', height: '100%', opacity: 0.5, gap: 16
            }}>
                <div style={{ fontSize: 56, color: 'var(--rokdock-brand-primary-light)', textShadow: `0 0 40px var(--rokdock-tab-glow)` }}>
                    <FontAwesomeIcon icon={faHexagon} />
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--rokdock-text-dim)', letterSpacing: '0.3px' }}>
                    No Active Connections
                </div>
                <div style={{ fontSize: 13, color: 'var(--rokdock-text-muted)', textAlign: 'center', maxWidth: 300, lineHeight: 1.5 }}>
                    Select a device from the left panel and choose a port to connect
                </div>
            </div>
        )
    }

    const isSplit = paneB !== null

    return (
        <div
            ref={containerRef}
            style={CONTAINER_STYLE}
            onDragOver={(e) => {
                if (isSplit) { setSplitDropActive(false); return }
                const rect = containerRef.current?.getBoundingClientRect()
                if (!rect) return
                const inSplitZone = e.clientX > rect.right - rect.width * 0.2
                if (inSplitZone !== splitDropActive) setSplitDropActive(inSplitZone)
                if (inSplitZone) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }
            }}
            onDrop={(e) => {
                if (!splitDropActive) return
                e.preventDefault()
                const tabId = e.dataTransfer.getData('text/plain')
                if (tabId) splitTab(tabId)
                setSplitDropActive(false)
            }}
            onDragLeave={(e) => {
                if (!containerRef.current?.contains(e.relatedTarget as Node)) setSplitDropActive(false)
            }}
        >
            <div style={{ flex: isSplit ? `0 0 ${splitRatio * 100}%` : 1, display: 'flex', minWidth: isSplit ? 200 : undefined, overflow: 'hidden' }}>
                <TerminalPane
                    paneId="a"
                    isFocused={focusedPaneId === 'a'}
                    onFocus={() => setFocusedPane('a')}
                />
            </div>
            {isSplit && (
                <>
                    <PaneDivider onResize={setSplitRatio} containerRef={containerRef} />
                    <div style={{ flex: 1, display: 'flex', minWidth: 200, overflow: 'hidden' }}>
                        <TerminalPane
                            paneId="b"
                            isFocused={focusedPaneId === 'b'}
                            onFocus={() => setFocusedPane('b')}
                        />
                    </div>
                </>
            )}
            {tabs.length > 0 && (
                <div style={TOOLBAR_WRAP_STYLE}>
                    {!isSplit && tabs.length >= 2 && (
                        <IconButton
                            title="Split terminal"
                            onClick={() => { if (focusedActiveTabId) splitTab(focusedActiveTabId) }}
                        >
                            <FontAwesomeIcon icon={faTableColumns} />
                        </IconButton>
                    )}
                    <IconButton
                        title="Terminal settings"
                        onClick={() => setSettingsDialogOpen('appearance', 'terminal')}
                    >
                        <FontAwesomeIcon icon={faGear} />
                    </IconButton>
                </div>
            )}
            {splitDropActive && (
                <div style={{
                    position: 'absolute', right: 0, top: 0, bottom: 0, width: '20%',
                    background: `color-mix(in srgb, var(--rokdock-brand-primary) 9%, transparent)`,
                    borderLeft: `2px solid var(--rokdock-brand-primary)`,
                    pointerEvents: 'none', zIndex: 3
                }} />
            )}
        </div>
    )
}
