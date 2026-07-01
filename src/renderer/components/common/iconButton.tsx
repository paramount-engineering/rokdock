/**
 * Small inline icon button with hover/press states.
 *
 * Used for toolbar actions, tab close buttons, and other compact interactive
 * icon placements. Two size variants: 'sm' (20px) and 'md' (26px, default).
 *
 * Note: for full toolbar buttons with icon + label, use the rokdock-icon-btn
 * web component instead. This component is for inline icon-only actions.
 */

import React, { useState } from 'react'

type IconButtonProps = {
    title: string
    onClick: () => void
    children: React.ReactNode
    disabled?: boolean
    size?: 'sm' | 'md'
    'data-testid'?: string
}

const sizeMap = { sm: 20, md: 26 }
const iconSizeMap = { sm: 11, md: 12 }

/**
 * Renders a compact icon-only button with hover and press visual feedback.
 * Supports 'sm' (20px) and 'md' (26px) size variants via the `size` prop.
 * The `children` are centered inside the button and should be an icon element.
 */
export default function IconButton({ title, onClick, children, disabled = false, size = 'md', 'data-testid': dataTestId }: IconButtonProps) {
    const [hovered, setHovered] = useState(false)
    const [pressed, setPressed] = useState(false)
    const dim = sizeMap[size]
    const iconDim = iconSizeMap[size]

    return (
        <button
            type="button"
            title={title}
            onClick={onClick}
            data-testid={dataTestId}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => { setHovered(false); setPressed(false) }}
            onMouseDown={e => { e.preventDefault(); setPressed(true) }}
            onMouseUp={() => setPressed(false)}
            disabled={disabled}
            style={{
                position: 'relative',
                width: dim,
                height: dim,
                border: '1px solid transparent',
                borderRadius: 'var(--rokdock-radius-sm)',
                background: hovered && !disabled
                    ? (pressed ? 'var(--rokdock-bg-active)' : 'var(--rokdock-bg-hover)')
                    : 'transparent',
                color: hovered && !disabled
                    ? (pressed ? 'var(--rokdock-text-bright)' : 'var(--rokdock-text-primary)')
                    : 'var(--rokdock-text-dim)',
                cursor: disabled ? 'default' : 'pointer',
                padding: 0,
                outline: 'none',
                userSelect: 'none',
                transition: 'background var(--rokdock-transition-fast), color var(--rokdock-transition-fast), transform var(--rokdock-transition-fast)',
                opacity: disabled ? 0.35 : 1,
                transform: pressed && !disabled ? 'scale(0.9)' : undefined,
            }}
        >
            <span style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                fontSize: iconDim,
                lineHeight: 0,
                pointerEvents: 'none',
            }}>
                {children}
            </span>
        </button>
    )
}
