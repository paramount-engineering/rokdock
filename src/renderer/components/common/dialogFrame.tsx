/**
 * Base dialog shell component used by all modal dialogs in the app.
 *
 * Renders a full-screen overlay with a centered content panel. Handles:
 *  - CSS enter/exit animations via useDialogAnimation (one-frame delay for transitions)
 *  - Backdrop press-and-release to close (a press that begins inside the dialog,
 *    such as a text-selection drag released on the backdrop, does not close it)
 *  - Escape key to close (focus trap via keydown listener)
 *  - z-index configuration for stacked dialogs
 *
 * Animation props allow each dialog to customize the enter/exit transform.
 * The default is a scale + translateY spring bounce (cubic-bezier(0.34, 1.4, 0.64, 1)).
 *
 * All custom dialogs (ConfirmDialog, SettingsDialog, SideloadDialog, etc.) wrap
 * their content in DialogFrame rather than implementing their own overlay logic.
 */

import React, { useEffect, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useDialogAnimation } from '../../hooks/useDialogAnimation'

interface DialogFrameProps {
    open: boolean
    onClose: () => void
    children: ReactNode
    dialogStyle?: CSSProperties
    overlayStyle?: CSSProperties
    zIndex?: number
    overlayTransition?: string
    dialogTransition?: string
    enterTransform?: string
    exitTransform?: string
}

/**
 * Renders a full-screen overlay with a centered, animated dialog panel.
 * Handles backdrop click, Escape key, and CSS enter/exit transitions.
 * All modal dialogs in the app use this as their outer shell.
 */
export default function DialogFrame({
    open,
    onClose,
    children,
    dialogStyle,
    overlayStyle,
    zIndex,
    overlayTransition = 'opacity 0.2s ease',
    dialogTransition = 'transform 0.25s cubic-bezier(0.34, 1.4, 0.64, 1), opacity 0.2s ease',
    enterTransform = 'scale(1) translateY(0)',
    exitTransform = 'scale(0.95) translateY(8px)'
}: DialogFrameProps) {
    const visible = useDialogAnimation(open)
    const overlayRef = useRef<HTMLDivElement | null>(null)
    // True only while a press that BEGAN on the backdrop is in progress. Backdrop
    // dismissal then requires both the press and the release to land on the backdrop,
    // so a text-selection drag that starts inside the dialog and releases on the
    // backdrop (whose `click` fires on the overlay, their common ancestor) does not
    // close the dialog and discard the user's changes.
    const pressedOnBackdropRef = useRef(false)

    useEffect(() => {
        if (!open) return
        const id = window.setTimeout(() => {
            overlayRef.current?.focus()
        }, 0)
        return () => window.clearTimeout(id)
    }, [open])

    if (!open) return null

    return (
        <div
            ref={overlayRef}
            tabIndex={-1}
            className="rokdock-overlay"
            style={{
                ...(zIndex ? { zIndex } : {}),
                ...overlayStyle,
                opacity: visible ? 1 : 0,
                transition: overlayTransition
            }}
            onMouseDown={(e) => { pressedOnBackdropRef.current = e.target === e.currentTarget }}
            onMouseUp={(e) => {
                if (pressedOnBackdropRef.current && e.target === e.currentTarget) onClose()
                pressedOnBackdropRef.current = false
            }}
            onKeyDown={(e) => {
                if (e.key === 'Escape') onClose()
            }}
        >
            <div
                className="rokdock-dialog"
                style={{
                    ...dialogStyle,
                    transform: visible ? enterTransform : exitTransform,
                    opacity: visible ? 1 : 0,
                    transition: dialogTransition
                }}
            >
                {children}
            </div>
        </div>
    )
}
