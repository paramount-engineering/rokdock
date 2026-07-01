/**
 * Draggable vertical divider between the two terminal panes.
 *
 * Renders as a thin styled bar between paneA and paneB. Dragging it
 * computes the pointer X position relative to the shared container and
 * calls onResize(ratio) where ratio is a 0..1 fraction representing how
 * much width paneA should take. The parent (SplitTerminalContainer) applies
 * the ratio to the flex-basis of each pane.
 *
 * Uses document-level mousemove/mouseup listeners (with cursor override) so
 * the drag stays active even when the pointer moves outside the bar's bounds.
 */
import React, { useCallback, useRef } from 'react'

interface PaneDividerProps {
    onResize: (ratio: number) => void
    containerRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Renders a draggable vertical divider bar between two terminal panes.
 * On drag, computes the pointer position relative to `containerRef` and emits
 * a 0..1 width ratio via `onResize`. Ratio is clamped to [0.15, 0.85] so
 * neither pane can be collapsed entirely.
 */
export default function PaneDivider({ onResize, containerRef }: PaneDividerProps) {
    const dragging = useRef(false)

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        dragging.current = true
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'

        const handleMouseMove = (e: MouseEvent) => {
            if (!dragging.current || !containerRef.current) return
            const rect = containerRef.current.getBoundingClientRect()
            const ratio = Math.max(0.15, Math.min(0.85, (e.clientX - rect.left) / rect.width))
            onResize(ratio)
        }

        const handleMouseUp = () => {
            dragging.current = false
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }, [onResize, containerRef])

    return (
        <div
            onMouseDown={handleMouseDown}
            style={{
                width: 5,
                cursor: 'col-resize',
                background: 'var(--rokdock-border)',
                flexShrink: 0,
                position: 'relative',
                zIndex: 2
            }}
        >
            <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: 3,
                height: 24,
                borderRadius: 2,
                background: 'var(--rokdock-text-muted)',
                opacity: 0.4
            }} />
        </div>
    )
}
