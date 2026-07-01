/**
 * Hover-reveal edge strip for collapsing and expanding side panels.
 *
 * Rendered as a narrow vertical strip (EDGE_TRIGGER_COLLAPSED_WIDTH px) on
 * the left or right edge of the window. When hovered for EDGE_TRIGGER_HOVER_MS
 * milliseconds the strip expands to EDGE_TRIGGER_EXPANDED_WIDTH px and shows
 * a rotated panel label as a visual affordance.
 *
 * Two modes:
 *  - 'collapse': the panel is currently visible; clicking hides it.
 *  - 'show': the panel is hidden; clicking reveals it.
 *
 * overlay=true positions the trigger over the panel instead of beside it,
 * used when the panel is in overlay/slide-over mode rather than push mode.
 *
 * onHoverChange fires when the expanded/collapsed visual state changes so
 * the parent can react (e.g., to temporarily reveal the panel on hover).
 */
import React, { useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons'

const EDGE_TRIGGER_HOVER_MS = 300
export const EDGE_TRIGGER_COLLAPSED_WIDTH = 7
export const EDGE_TRIGGER_EXPANDED_WIDTH = 24

interface EdgeTriggerProps {
    side: 'left' | 'right'
    onClick: () => void
    panelLabel: string
    mode: 'collapse' | 'show'
    overlay?: boolean
    onHoverChange?: (open: boolean) => void
}

/**
 * Renders a narrow edge strip on the left or right side of the window that
 * expands on hover after a short delay (EDGE_TRIGGER_HOVER_MS) to reveal a
 * panel label and directional arrow. Clicking calls `onClick` to toggle the
 * adjacent panel. Set `overlay={true}` when the panel slides over content
 * rather than pushing it.
 */
export default function EdgeTrigger({
    side,
    onClick,
    panelLabel,
    mode,
    overlay = false,
    onHoverChange
}: EdgeTriggerProps) {
    const [hovered, setHovered] = useState(false)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const edgeRef = useRef<HTMLDivElement | null>(null)
    const hoverLabel = mode === 'collapse' ? 'Collapse' : panelLabel
    const title = `${mode === 'collapse' ? 'Collapse' : 'Show'} ${panelLabel} panel`
    const arrowIcon = side === 'right' ? faChevronLeft : faChevronRight

    /** Starts the hover-expand timer on mouseenter; fires after EDGE_TRIGGER_HOVER_MS. */
    const handleEnter = () => {
        timerRef.current = setTimeout(() => setHovered(true), EDGE_TRIGGER_HOVER_MS)
    }
    /** Cancels a pending hover timer and collapses the strip immediately on mouseleave. */
    const handleLeave = () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current)
            timerRef.current = null
        }
        setHovered(false)
    }

    useEffect(() => {
        onHoverChange?.(hovered)
    }, [hovered, onHoverChange])

    useEffect(() => {
        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current)
                timerRef.current = null
            }
        }
    }, [])

    useEffect(() => {
        if (!hovered) return
        const onWindowMouseMove = (event: MouseEvent) => {
            const rect = edgeRef.current?.getBoundingClientRect()
            if (!rect) return
            const inside = event.clientX >= rect.left
                && event.clientX <= rect.right
                && event.clientY >= rect.top
                && event.clientY <= rect.bottom
            if (!inside) {
                if (timerRef.current) {
                    clearTimeout(timerRef.current)
                    timerRef.current = null
                }
                setHovered(false)
            }
        }
        window.addEventListener('mousemove', onWindowMouseMove)
        return () => window.removeEventListener('mousemove', onWindowMouseMove)
    }, [hovered])

    return (
        <div
            ref={edgeRef}
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
            onClick={onClick}
            title={title}
            style={{
                width: hovered ? EDGE_TRIGGER_EXPANDED_WIDTH : EDGE_TRIGGER_COLLAPSED_WIDTH,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                position: overlay ? 'absolute' : 'relative',
                top: overlay ? 0 : undefined,
                bottom: overlay ? 0 : undefined,
                right: overlay && side === 'right' ? 0 : undefined,
                left: overlay && side === 'left' ? 0 : undefined,
                zIndex: overlay ? 3 : 1,
                background: hovered
                    ? `linear-gradient(180deg, var(--rokdock-bg-hover) 0%, var(--rokdock-bg-surface) 100%)`
                    : 'var(--rokdock-bg-panel)',
                borderLeft: side === 'right' ? `1px solid var(--rokdock-border)` : 'none',
                borderRight: side === 'left' ? `1px solid var(--rokdock-border)` : 'none',
                boxShadow: hovered ? `inset 0 0 0 1px var(--rokdock-brand-primary-faded)` : 'none',
                transition: 'width 0.15s ease, background 0.15s ease, box-shadow 0.15s ease',
                overflow: 'hidden'
            }}
        >
            {!hovered && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none' }}>
                    <span style={{
                        width: 2,
                        height: 32,
                        borderRadius: 1,
                        background: `linear-gradient(180deg, transparent 0%, var(--rokdock-brand-primary-light) 30%, var(--rokdock-brand-primary-light) 70%, transparent 100%)`,
                        opacity: 0.5
                    }} />
                </div>
            )}
            {hovered && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--rokdock-brand-primary-light)', userSelect: 'none' }}>
                    <span style={{ fontSize: 'var(--rokdock-font-xxs)', lineHeight: 1, opacity: 0.72 }}><FontAwesomeIcon icon={arrowIcon} /></span>
                    <span style={{ writingMode: 'vertical-rl', transform: side === 'left' ? 'rotate(180deg)' : 'none', fontSize: 'var(--rokdock-font-xxs)', fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{hoverLabel}</span>
                    <span style={{ fontSize: 'var(--rokdock-font-xxs)', lineHeight: 1, opacity: 0.72 }}><FontAwesomeIcon icon={arrowIcon} /></span>
                </div>
            )}
        </div>
    )
}
