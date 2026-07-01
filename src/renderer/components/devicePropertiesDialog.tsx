/**
 * Dialog for viewing and editing properties of a single Roku device.
 *
 * Opened when the user selects "Properties..." from a device card dropdown or
 * clicks the device-properties link in error messages. The device being edited
 * is held in appStore as devicePropertiesDevice (null = closed).
 *
 * Editable fields:
 *  - Nickname: an optional display name that overrides the device's reported name
 *    throughout the UI (stored in deviceNicknames map in appStore/persisted settings).
 *  - Developer credentials (username + password): stored encrypted via
 *    window.rokdock.store.setDeviceAuth; used for Digest auth on /plugin_* endpoints.
 *    The password field supports reveal/hide toggling.
 *
 * Read-only info shown: device IP, model, firmware version, developer mode status.
 *
 * devicePropertiesFocusField allows callers to request that a specific field
 * receives initial focus (e.g., the password field when opened from the
 * "No credentials set" sideload error hint).
 */
import React, { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faEye, faXmark } from '@fortawesome/free-solid-svg-icons'
import type { CSSProperties } from 'react'
import DialogFrame from './common/dialogFrame'
import { CollapsibleSettingsSection } from './rokdock/wrappers'

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

const DIALOG_STYLE: CSSProperties = {
    width: 420,
    maxHeight: 'calc(100vh - 80px)',
    display: 'flex',
    flexDirection: 'column'
}

const BODY_STYLE: CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: 'var(--rokdock-space-lg)',
    display: 'flex',
    flexDirection: 'column',
    gap: 10
}

const FIELD_STYLE: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 4
}

const COLLAPSIBLE_BADGE_STYLE: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 'var(--rokdock-font-xxs)',
    fontWeight: 500,
    lineHeight: 1
}

const ERROR_TEXT_STYLE: CSSProperties = {
    color: 'var(--rokdock-error-text)',
    fontSize: 'var(--rokdock-font-xs)'
}

const PASSWORD_ROW_STYLE: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8
}

const REVEAL_BTN_STYLE: CSSProperties = {
    width: 28,
    height: 28,
    borderRadius: 'var(--rokdock-radius-sm)',
    border: '1px solid var(--rokdock-border)',
    background: 'var(--rokdock-bg-input)',
    color: 'var(--rokdock-text-primary)',
    cursor: 'pointer',
    flexShrink: 0
}

const PROP_ROW_STYLE: CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    borderBottom: '1px solid var(--rokdock-border)'
}

const PROP_LABEL_STYLE: CSSProperties = {
    fontSize: 'var(--rokdock-font-xs)',
    color: 'var(--rokdock-text-dim)',
    flexShrink: 0
}

const PROP_VALUE_STYLE: CSSProperties = {
    fontSize: 'var(--rokdock-font-xxs)',
    color: 'var(--rokdock-text-primary)',
    fontFamily: 'var(--rokdock-font-mono)',
    textAlign: 'right',
    wordBreak: 'break-all'
}

const PROP_LINK_STYLE: CSSProperties = {
    fontSize: 'var(--rokdock-font-xxs)',
    color: 'var(--rokdock-brand-primary-light)',
    fontFamily: 'var(--rokdock-font-mono)',
    textAlign: 'right' as const,
    wordBreak: 'break-all',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    textDecoration: 'underline',
    padding: 0
}

/**
 * Dialog for viewing and editing a device's friendly name and developer
 * credentials. Rendered whenever devicePropertiesDevice is non-null in
 * appStore; returns null otherwise to avoid mounting cost.
 */
export default function DevicePropertiesDialog() {
    const device = useAppStore(state => state.devicePropertiesDevice)
    const deviceNicknames = useAppStore(state => state.deviceNicknames)
    const deviceHasAuth = useAppStore(state => state.deviceHasAuth)
    const setDeviceNickname = useAppStore(state => state.setDeviceNickname)
    const setDevicePropertiesDevice = useAppStore(state => state.setDevicePropertiesDevice)
    const devicePropertiesFocusField = useAppStore(state => state.devicePropertiesFocusField)
    const setDevicePropertiesFocusField = useAppStore(state => state.setDevicePropertiesFocusField)

    const [nickname, setNickname] = useState(device ? (deviceNicknames[device.ip] || '') : '')
    const [username, setUsername] = useState('rokudev')
    const [password, setPassword] = useState('')
    const [revealPassword, setRevealPassword] = useState(false)
    const [error, setError] = useState('')
    const nicknameInputRef = useRef<HTMLInputElement | null>(null)
    const passwordInputRef = useRef<HTMLInputElement | null>(null)

    useEffect(() => {
        if (!device) return
        window.rokdock.store.getDeviceAuth(device.ip).then((auth: { username: string; password: string } | null) => {
            setUsername(auth?.username || 'rokudev')
            setPassword(auth?.password ?? '')
            setError('')
        }).catch(() => {
            setUsername('rokudev')
            setPassword('')
            setError('')
        })
    }, [device])

    useEffect(() => {
        if (!device) return
        const timer = window.setTimeout(() => {
            if (devicePropertiesFocusField === 'password') {
                passwordInputRef.current?.focus()
                passwordInputRef.current?.select()
            } else {
                nicknameInputRef.current?.focus()
            }
            setDevicePropertiesFocusField('nickname')
        }, 0)
        return () => window.clearTimeout(timer)
    }, [device, devicePropertiesFocusField, setDevicePropertiesFocusField])

    if (!device) return null

    /**
     * Validates the form, persists the nickname and developer credentials via
     * IPC, dispatches 'rokdock:device-auth-updated' so dependent components
     * refresh, and closes the dialog.
     */
    const handleSave = async () => {
        if (password.trim() && !username.trim()) {
            setError('Username is required when password is set.')
            return
        }
        setError('')
        setDeviceNickname(device.ip, nickname)
        await window.rokdock.store.setDeviceAuth(device.ip, username.trim(), password.trim())
        window.dispatchEvent(new CustomEvent('rokdock:device-auth-updated', { detail: { ip: device.ip } }))
        setDevicePropertiesDevice(null)
    }

    const hasAuth = !!deviceHasAuth[device.ip]
    const devEnabled = device.developerEnabled

    const rows = [
        { label: 'Name', value: device.name },
        { label: 'Model', value: device.model },
        { label: 'Model Number', value: device.modelNumber },
        { label: 'Code name', value: device.codename },
        { label: 'Serial Number', value: device.serialNumber },
        { label: 'Software Version', value: device.softwareVersion },
        { label: 'IP Address', value: device.ip },
        { label: 'Location', value: device.location, isLink: true },
    ]

    return (
        <DialogFrame
            open={!!device}
            onClose={() => setDevicePropertiesDevice(null)}
            dialogStyle={DIALOG_STYLE}
        >
            <div className="rokdock-dialog-header">
                <span className="rokdock-title">Device Properties</span>
                <button style={DIALOG_CLOSE_BTN} onClick={() => setDevicePropertiesDevice(null)}>
                    <FontAwesomeIcon icon={faXmark} />
                </button>
            </div>

            <div style={BODY_STYLE}>
                <div style={FIELD_STYLE}>
                    <label className="rokdock-label">Friendly Name</label>
                    <input
                        ref={nicknameInputRef}
                        className="rokdock-input"
                        type="text"
                        value={nickname}
                        onChange={e => setNickname(e.target.value)}
                        placeholder={device.name}
                    />
                    <span className="rokdock-hint">Leave blank to use device name</span>
                </div>

                <CollapsibleSettingsSection
                    label="Developer Credentials"
                    defaultOpen={devEnabled !== false}
                    padding="10px 12px 2px 14px"
                    badge={devEnabled !== undefined ? (
                        <span style={COLLAPSIBLE_BADGE_STYLE}>
                            <span style={{ color: devEnabled ? 'var(--rokdock-state-online)' : 'var(--rokdock-error-text)' }}>
                                {devEnabled ? 'Enabled' : 'Disabled'}
                            </span>
                            {devEnabled && (
                                <>
                                    <span style={{ color: 'var(--rokdock-text-muted)' }}> | </span>
                                    <span style={{ color: hasAuth ? 'var(--rokdock-state-online)' : 'var(--rokdock-text-muted)' }}>
                                        {hasAuth ? 'Creds set' : 'No creds'}
                                    </span>
                                </>
                            )}
                        </span>
                    ) : undefined}
                >
                    <div style={FIELD_STYLE}>
                        <label className="rokdock-label">Username</label>
                        <input
                            className="rokdock-input"
                            type="text"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            placeholder="rokudev"
                        />
                    </div>
                    <div style={FIELD_STYLE}>
                        <label className="rokdock-label">Password</label>
                        <div style={PASSWORD_ROW_STYLE}>
                            <input
                                ref={passwordInputRef}
                                className="rokdock-input rokdock-input-hint"
                                style={{ flex: 1 }}
                                type={revealPassword ? 'text' : 'password'}
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="(not set)"
                            />
                            <button
                                type="button"
                                style={REVEAL_BTN_STYLE}
                                title="Hold to reveal"
                                onMouseDown={() => setRevealPassword(true)}
                                onMouseUp={() => setRevealPassword(false)}
                                onMouseLeave={() => setRevealPassword(false)}
                            >
                                <FontAwesomeIcon icon={faEye} />
                            </button>
                        </div>
                        <span className="rokdock-hint">Both fields required for authenticated features.</span>
                    </div>
                    {error && <div style={ERROR_TEXT_STYLE}>{error}</div>}
                </CollapsibleSettingsSection>

                <CollapsibleSettingsSection label="Device Info" gap={5} padding="6px 12px 2px 14px">
                    {rows.map((row) => (
                        <React.Fragment key={row.label}>
                            <div style={PROP_ROW_STYLE}>
                                <span style={PROP_LABEL_STYLE}>{row.label}</span>
                                {row.isLink && row.value ? (
                                    <button
                                        style={PROP_LINK_STYLE}
                                        onClick={() => { void window.rokdock.external.openUrl(row.value) }}
                                        title={row.value}
                                    >
                                        {row.value}
                                    </button>
                                ) : (
                                    <span style={PROP_VALUE_STYLE}>{row.value || ' - '}</span>
                                )}
                            </div>
                        </React.Fragment>
                    ))}
                </CollapsibleSettingsSection>
            </div>

            <div className="rokdock-dialog-actions">
                <button
                    className="rokdock-btn rokdock-btn-ghost"
                    onClick={() => setDevicePropertiesDevice(null)}
                >
                    Cancel
                </button>
                <button className="rokdock-btn rokdock-btn-primary" onClick={handleSave}>
                    Save
                </button>
            </div>
        </DialogFrame>
    )
}
