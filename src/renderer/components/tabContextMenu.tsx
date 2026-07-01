/**
 * Right-click context menu for terminal tabs.
 *
 * Positioned absolutely at the pointer coordinates (x, y) and rendered
 * as a fixed overlay. Provides actions:
 *  - Close Tab
 *  - Close Other Tabs (hidden when this is the only tab)
 *  - Close All Tabs
 *  - Split Right (hidden when already split)
 *  - Move to Other Pane (hidden when not split)
 *
 * Closes itself when the user clicks outside via a mousedown listener
 * attached in the parent (TerminalPane passes onClose).
 */
import React from 'react'

const ITEM_BASE: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    padding: '5px 14px',
    cursor: 'pointer',
    color: 'var(--rokdock-text-primary)',
    border: 'none',
    width: '100%',
    textAlign: 'left',
    fontSize: 'var(--rokdock-font-sm)'
}

const SEP_STYLE: React.CSSProperties = {
    height: 1,
    margin: '4px 8px',
    background: 'var(--rokdock-border)'
}

/** A single menu row button; dims and disables interaction when `disabled` is true. */
function Item({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
    return (
        <button
            className="tab-context-menu-item"
            style={{ ...ITEM_BASE, ...(disabled ? { opacity: 0.35, cursor: 'not-allowed' } : {}) }}
            disabled={disabled}
            onClick={onClick}
        >
            {label}
        </button>
    )
}

interface TabContextMenuProps {
    x: number
    y: number
    tabId: string
    isSplit: boolean
    isOnlyTab: boolean
    onClose: () => void
    onCloseTab: (tabId: string) => void
    onCloseOthers: (tabId: string) => void
    onCloseAll: () => void
    onSplitRight: (tabId: string) => void
    onMoveToOtherPane: (tabId: string) => void
}

/**
 * Renders a fixed-position right-click context menu for a terminal tab.
 * Positions itself at (x, y), clamped to the viewport edges. A transparent
 * full-screen backdrop intercepts outside clicks and calls `onClose`.
 */
export default function TabContextMenu({
    x, y, tabId, isSplit, isOnlyTab,
    onClose, onCloseTab, onCloseOthers, onCloseAll,
    onSplitRight, onMoveToOtherPane
}: TabContextMenuProps) {
    const menuStyle: React.CSSProperties = {
        position: 'fixed',
        left: Math.min(x, window.innerWidth - 180),
        top: Math.min(y, window.innerHeight - 160),
        zIndex: 1000,
        minWidth: 160,
        padding: '4px 0',
        borderRadius: 'var(--rokdock-radius-md)',
        background: 'var(--rokdock-bg-surface)',
        border: '1px solid var(--rokdock-border)',
        boxShadow: '0 6px 24px var(--rokdock-black-medium)',
        fontSize: 'var(--rokdock-font-sm)'
    }

    return (
        <>
            <div
                style={{ position: 'fixed', inset: 0, zIndex: 999 }}
                onClick={onClose}
                onContextMenu={(e) => { e.preventDefault(); onClose() }}
            />
            <div style={menuStyle}>
                <Item label="Close" onClick={() => { onCloseTab(tabId); onClose() }} />
                <Item label="Close Others" onClick={() => { onCloseOthers(tabId); onClose() }} />
                <Item label="Close All" onClick={() => { onCloseAll(); onClose() }} />
                <div style={SEP_STYLE} />
                {isSplit ? (
                    <Item label="Move to Other Pane" onClick={() => { onMoveToOtherPane(tabId); onClose() }} />
                ) : (
                    <Item label="Split Right" disabled={isOnlyTab} onClick={() => { if (!isOnlyTab) { onSplitRight(tabId); onClose() } }} />
                )}
            </div>
        </>
    )
}
