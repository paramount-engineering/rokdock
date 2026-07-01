/**
 * Dialog for filling in ${variable} token values before running a script.
 *
 * When a script contains text steps with ${name} tokens, the script editor
 * shows this dialog before playback to collect values for each token.
 * Each variable gets a labeled text input; values default to empty strings.
 * On confirm, the values map is passed back to the playback caller for substitution.
 */

import React, { useState, useEffect, useRef } from 'react'
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

interface VariablesDialogProps {
    open: boolean
    scriptName: string
    variables: Record<string, string>
    onConfirm: (values: Record<string, string>) => void
    onCancel: () => void
}

/**
 * Renders a dialog collecting user values for each `${variable}` token found
 * in a script before playback begins. The first input is auto-focused on open.
 * The Run button is disabled until all fields contain non-empty values.
 */
export default function VariablesDialog({
    open,
    scriptName,
    variables,
    onConfirm,
    onCancel
}: VariablesDialogProps) {
    const [values, setValues] = useState<Record<string, string>>({})
    const firstInputRef = useRef<HTMLInputElement | null>(null)

    useEffect(() => {
        if (open) {
            setValues({ ...variables })
            setTimeout(() => firstInputRef.current?.focus(), 50)
        }
    }, [open, variables])

    const keys = Object.keys(variables)

    /** Updates the value for a single variable key in local state. */
    const handleChange = (key: string, val: string) => {
        setValues(prev => ({ ...prev, [key]: val }))
    }

    const allFilled = keys.every(k => values[k]?.trim())

    /** Calls onConfirm with the current values map if all fields are filled. */
    const handleSubmit = () => {
        if (allFilled) onConfirm(values)
    }

    return (
        <DialogFrame
            open={open}
            onClose={onCancel}
            zIndex={3000}
            overlayTransition="opacity 0.15s ease"
            dialogTransition="transform 0.2s ease, opacity 0.15s ease"
            enterTransform="scale(1) translateY(0)"
            exitTransform="scale(0.96) translateY(6px)"
            dialogStyle={{ width: 420 }}
        >
            <div className="rokdock-dialog-header">
                <span className="rokdock-title">Script Variables</span>
                <button style={DIALOG_CLOSE_BTN} onClick={onCancel}><FontAwesomeIcon icon={faXmark} /></button>
            </div>
            <div className="rokdock-dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ margin: 0, color: 'var(--rokdock-text-muted)', fontSize: 'var(--rokdock-font-sm)', lineHeight: 1.4 }}>
                    Set variable values for &quot;{scriptName}&quot;
                </p>
                {keys.map((key, i) => (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <label style={{
                            minWidth: 80,
                            fontSize: 'var(--rokdock-font-sm)',
                            fontFamily: 'var(--rokdock-font-mono)',
                            color: 'var(--rokdock-text-dim)',
                            textAlign: 'right',
                            flexShrink: 0
                        }}>
                            {'${' + key + '}'}
                        </label>
                        <input
                            ref={i === 0 ? firstInputRef : undefined}
                            type="text"
                            value={values[key] ?? ''}
                            onChange={e => handleChange(key, e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
                            style={{
                                flex: 1,
                                height: 28,
                                padding: '0 8px',
                                fontSize: 'var(--rokdock-font-sm)',
                                fontFamily: 'var(--rokdock-font-mono)',
                                background: 'var(--rokdock-bg-input)',
                                border: '1px solid var(--rokdock-border)',
                                borderRadius: 'var(--rokdock-radius-sm)',
                                color: 'var(--rokdock-text-primary)',
                                outline: 'none'
                            }}
                        />
                    </div>
                ))}
            </div>
            <div className="rokdock-dialog-actions">
                <button className="rokdock-btn rokdock-btn-ghost" onClick={onCancel}>Cancel</button>
                <button
                    className="rokdock-btn rokdock-btn-primary"
                    disabled={!allFilled}
                    onClick={handleSubmit}
                >
                    Run
                </button>
            </div>
        </DialogFrame>
    )
}
