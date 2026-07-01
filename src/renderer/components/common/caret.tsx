import React from 'react'

interface CaretProps {
    open: boolean
    size?: number
    /** opacity for the caret icon; defaults to 1 (fully opaque). */
    opacity?: number
}

/**
 * Inline chevron caret shared by navigation tree rows and collapsible section
 * headers. Rotates to indicate open/closed state.
 *
 * FontAwesome chevron-down path (320x512 viewBox) matches the app-wide style.
 */
export function Caret({ open, size = 8, opacity }: CaretProps): React.JSX.Element {
    return (
        <svg
            viewBox="0 0 320 512"
            aria-hidden="true"
            style={{
                width: size,
                height: size,
                fill: 'currentColor',
                color: 'var(--rokdock-text-dim)',
                flexShrink: 0,
                opacity,
                transition: 'transform 0.15s ease',
                transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
            }}
        >
            <path d="M137.4 374.6c12.5 12.5 32.8 12.5 45.3 0l128-128c9.2-9.2 11.9-22.9 6.9-34.9s-16.6-19.8-29.6-19.8L32 192c-12.9 0-24.6 7.8-29.6 19.8s-2.2 25.7 6.9 34.9l128 128z" />
        </svg>
    )
}
