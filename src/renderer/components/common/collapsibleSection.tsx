/**
 * Collapsible panel section used throughout the left/right sidebars.
 *
 * Renders a styled section header with an optional chevron and action slot.
 * Supports two state management modes:
 *  - With id prop: open/closed state is persisted in the app store's
 *    collapsedPanels list, surviving navigation and component remounts.
 *  - Without id: local useState (resets on unmount).
 *
 * Set collapsible={false} to render a non-interactive section header that
 * uses the same visual style but cannot be collapsed (e.g. the Devices header).
 */

import React, { useState } from 'react'
import { useAppStore } from '../../store/appStore'

interface CollapsibleSectionProps {
    title: React.ReactNode
    actions?: React.ReactNode
    defaultOpen?: boolean
    collapsible?: boolean
    id?: string
    className?: string
    style?: React.CSSProperties
    open?: boolean
    onToggle?: () => void
    bodyStyle?: React.CSSProperties
    headerTestId?: string
    children: React.ReactNode
}

/**
 * Renders a section header and collapsible content area.
 * When an `id` is provided, open/closed state is persisted in the app store;
 * otherwise local component state is used. Pass `collapsible={false}` for a
 * non-interactive header that shares the same visual style.
 */
export default function CollapsibleSection({
    title,
    actions,
    defaultOpen = true,
    collapsible = true,
    id,
    className,
    style,
    open: controlledOpen,
    onToggle,
    bodyStyle,
    headerTestId,
    children
}: CollapsibleSectionProps) {
    const collapsedPanels = useAppStore(state => state.collapsedPanels)
    const toggleCollapsedPanel = useAppStore(state => state.toggleCollapsedPanel)
    const expandedPanels = useAppStore(state => state.expandedPanels)
    const toggleExpandedPanel = useAppStore(state => state.toggleExpandedPanel)

    // When id is provided, open/closed persists in the store, otherwise use local
    // state. An open-by-default section (defaultOpen) persists via collapsedPanels
    // (remembering what the user collapsed). A collapsed-by-default section persists
    // via expandedPanels (remembering what the user expanded). controlledOpen, when
    // provided, takes precedence over both.
    const [localOpen, setLocalOpen] = useState(defaultOpen)
    const persistedOpen = defaultOpen
        ? !collapsedPanels.includes(id ?? '')
        : expandedPanels.includes(id ?? '')
    const open = controlledOpen !== undefined
        ? controlledOpen
        : (id ? persistedOpen : localOpen)

    const handleToggle = () => {
        if (controlledOpen !== undefined) {
            onToggle?.()
        } else if (id) {
            if (defaultOpen) toggleCollapsedPanel(id)
            else toggleExpandedPanel(id)
        } else {
            setLocalOpen(prev => !prev)
        }
    }

    return (
        <div className={className} style={{ display: 'flex', flexDirection: 'column', ...style }}>
            <div
                className="rokdock-section-header"
                data-testid={headerTestId}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    height: 28,
                    padding: '0 8px',
                    borderTop: '1px solid var(--rokdock-border)',
                    cursor: collapsible ? 'pointer' : 'default',
                    userSelect: 'none',
                }}
                onClick={collapsible ? handleToggle : undefined}
            >
                {collapsible && (
                    <svg
                        viewBox="0 0 320 512"
                        style={{
                            width: 9,
                            height: 9,
                            fill: 'currentColor',
                            opacity: 0.6,
                            flexShrink: 0,
                            color: 'var(--rokdock-text-dim)',
                            transition: 'transform 0.15s ease',
                            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
                        }}
                    >
                        <path d="M137.4 374.6c12.5 12.5 32.8 12.5 45.3 0l128-128c9.2-9.2 11.9-22.9 6.9-34.9s-16.6-19.8-29.6-19.8L32 192c-12.9 0-24.6 7.8-29.6 19.8s-2.2 25.7 6.9 34.9l128 128z" />
                    </svg>
                )}
                <span style={{
                    fontSize: 'var(--rokdock-font-sm)',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: 'var(--rokdock-section-header-color)',
                    flex: 1,
                }}>
                    {title}
                </span>
                {actions && (
                    <div
                        style={{ display: 'flex', alignItems: 'center', gap: 0 }}
                        onClick={e => e.stopPropagation()}
                    >
                        {actions}
                    </div>
                )}
            </div>
            {open && (
                <div style={bodyStyle}>
                    {children}
                </div>
            )}
        </div>
    )
}
