/**
 * Dialog for manually adding a Roku device by IP address.
 *
 * Used when a device is not auto-discovered via SSDP (e.g., it is on a
 * different subnet or SSDP multicast is blocked). The user supplies an IP,
 * an optional display name, and optional developer credentials.
 *
 * On submit, calls window.rokdock.discovery.addManual() which adds the entry
 * to the persisted manual-device list in the main process store and triggers
 * an immediate ECP fetch to populate device details.
 *
 * Validates that the IP field is non-empty before submitting; all other fields
 * are optional. The dialog closes itself on success.
 */
import React, { useState } from 'react'
import type { CSSProperties } from 'react'
import { useAppStore } from '../store/appStore'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark } from '@fortawesome/free-solid-svg-icons'
import DialogFrame from './common/dialogFrame'

const DIALOG_CLOSE_BUTTON: CSSProperties = {
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

const FORM_STYLE: CSSProperties = {
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 14
}

const FIELD_STYLE: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 4
}

const ERROR_TEXT_STYLE: CSSProperties = {
    color: 'var(--rokdock-error-text)',
    fontSize: 'var(--rokdock-font-xs)'
}

/**
 * Renders a dialog for manually adding a Roku device by IPv4 address.
 * Validates the IP format and optional credential fields before calling
 * the main-process addManual API. Closes itself from the app store on success.
 */
export default function AddDeviceDialog() {
    const [ip, setIp] = useState('')
    const [name, setName] = useState('')
    const [username, setUsername] = useState('rokudev')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const setAddDeviceDialogOpen = useAppStore(state => state.setAddDeviceDialogOpen)

    /**
     * Validates the form fields and, if valid, registers the device via the
     * main-process discovery API and stores any provided developer credentials.
     */
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        const trimmedIp = ip.trim()
        if (!trimmedIp) {
            setError('IP address is required.')
            return
        }

        const octets = trimmedIp.split('.')
        if (octets.length !== 4 || octets.some(octet => !/^\d{1,3}$/.test(octet) || Number(octet) > 255)) {
            setError('Enter a valid IPv4 address (example: 192.168.1.100).')
            return
        }

        if (password.trim() && !username.trim()) {
            setError('Username is required when password is set.')
            return
        }

        setError('')
        const hasAuth = !!password.trim()
        await window.rokdock.discovery.addManual(trimmedIp, name.trim() || undefined, hasAuth ? true : undefined)
        if (hasAuth) {
            await window.rokdock.store.setDeviceAuth(trimmedIp, username.trim(), password.trim())
        }
        setAddDeviceDialogOpen(false)
    }

    return (
        <DialogFrame open onClose={() => setAddDeviceDialogOpen(false)} dialogStyle={{ width: 380 }}>
                <div className="rokdock-dialog-header">
                    <span className="rokdock-title">Add Device</span>
                    <button style={DIALOG_CLOSE_BUTTON} onClick={() => setAddDeviceDialogOpen(false)}><FontAwesomeIcon icon={faXmark} /></button>
                </div>
                <form id="add-device-form" onSubmit={handleSubmit} style={FORM_STYLE}>
                    <div style={FIELD_STYLE}>
                        <label className="rokdock-label">IP Address</label>
                        <input
                            className="rokdock-input rokdock-input-mono"
                            type="text"
                            value={ip}
                            onChange={e => { setIp(e.target.value); if (error) setError('') }}
                            placeholder="192.168.1.100"
                            autoFocus
                            pattern="\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}"
                            required
                        />
                    </div>
                    <div style={FIELD_STYLE}>
                        <label className="rokdock-label">Name (optional)</label>
                        <input
                            className="rokdock-input"
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="Living Room Roku"
                        />
                    </div>
                    <div style={FIELD_STYLE}>
                        <label className="rokdock-label">Developer Username</label>
                        <input
                            className="rokdock-input"
                            type="text"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            placeholder="rokudev"
                        />
                    </div>
                    <div style={FIELD_STYLE}>
                        <label className="rokdock-label">Developer Password (optional)</label>
                        <input
                            className="rokdock-input"
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="password"
                        />
                        <span className="rokdock-hint">Required for authenticated actions like screenshots.</span>
                    </div>
                    {error && (
                        <div style={ERROR_TEXT_STYLE}>{error}</div>
                    )}
                </form>
                <div className="rokdock-dialog-actions">
                    <button
                        type="button"
                        className="rokdock-btn rokdock-btn-ghost"
                        onClick={() => setAddDeviceDialogOpen(false)}
                    >
                        Cancel
                    </button>
                    <button type="submit" form="add-device-form" className="rokdock-btn rokdock-btn-primary">
                        Add Device
                    </button>
                </div>
        </DialogFrame>
    )
}
