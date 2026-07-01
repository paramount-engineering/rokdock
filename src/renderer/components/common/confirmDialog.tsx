/**
 * Generic confirmation dialog with cancel and confirm actions.
 *
 * Used throughout the app for destructive operation confirmation (delete script,
 * remove device, reset settings, etc.). The `destructive` prop makes the confirm
 * button render in the danger/red style.
 *
 * Accepts optional children rendered between the message text and the action
 * buttons, for cases where additional context or a custom warning is needed.
 */

import React from 'react'
import type { CSSProperties } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark } from '@fortawesome/free-solid-svg-icons'
import DialogFrame from './dialogFrame'

const DIALOG_CLOSE_BTN: CSSProperties = {
    width: 24,
    height: 24,
    border: 'none',
    borderRadius: 'var(--rokdock-radius-sm)',
    background: 'transparent',
    color: 'var(--rokdock-text-dim)',
    fontSize: 13,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
}

interface ConfirmDialogProps {
    open: boolean
    title: string
    message: string
    confirmLabel?: string
    cancelLabel?: string
    destructive?: boolean
    width?: number
    children?: React.ReactNode
    onConfirm: () => void
    onCancel: () => void
}

/**
 * Renders a modal confirmation dialog with cancel and confirm buttons.
 * Pass `destructive={true}` to render the confirm button in the danger style.
 * Optional `children` are rendered between the message and the action buttons.
 */
export default function ConfirmDialog({
    open,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    destructive = false,
    width = 420,
    children,
    onConfirm,
    onCancel
}: ConfirmDialogProps) {
    return (
        <DialogFrame
            open={open}
            onClose={onCancel}
            zIndex={3000}
            overlayTransition="opacity 0.15s ease"
            dialogTransition="transform 0.2s ease, opacity 0.15s ease"
            enterTransform="scale(1) translateY(0)"
            exitTransform="scale(0.96) translateY(6px)"
            dialogStyle={{ width }}
        >
            <div className="rokdock-dialog-header">
                <span className="rokdock-title">{title}</span>
                <button style={DIALOG_CLOSE_BTN} onClick={onCancel}><FontAwesomeIcon icon={faXmark} /></button>
            </div>
            <div className="rokdock-dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ margin: 0, color: 'var(--rokdock-text-primary)', fontSize: 'var(--rokdock-font-base)', lineHeight: 1.45 }}>
                    {message}
                </p>
                {children}
            </div>
            <div className="rokdock-dialog-actions">
                <button className="rokdock-btn rokdock-btn-ghost" onClick={onCancel}>{cancelLabel}</button>
                <button
                    className={destructive ? 'rokdock-btn rokdock-btn-danger' : 'rokdock-btn rokdock-btn-primary'}
                    onClick={onConfirm}
                >
                    {confirmLabel}
                </button>
                </div>
        </DialogFrame>
    )
}

