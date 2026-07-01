/**
 * Panel listing saved deeplink shortcuts for quick launch to the target device.
 *
 * Deeplinks are ECP commands that launch a Roku channel directly to a specific
 * content item. Two ECP variants are supported:
 *  - 'launch': sends an ECP launch command with contentId, mediaType, and any
 *    extra parameters to the target device's remoteTargetIp.
 *  - 'input': sends an ECP input command instead of launch (used for channels
 *    already running that accept input parameters).
 *
 * Each row shows the deeplink name and a launch button. Clicking launch calls
 * window.rokdock.ecp.deeplink() with the assembled parameter map.
 *
 * A gear icon at the top opens the Settings dialog on the Deeplinks tab,
 * where entries can be created, edited, and deleted. This panel is read-only;
 * it is a quick-access launcher, not an editor.
 */
import React, { useState, useCallback } from 'react'
import { useAppStore, DeeplinkConfig } from '../store/appStore'
import CollapsibleSection from './common/collapsibleSection'
import IconButton from './common/iconButton'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faGear, faRocket, faSatelliteDish } from '@fortawesome/free-solid-svg-icons'
import type { CSSProperties } from 'react'

/**
 * Renders the Deeplinks panel listing all configured deeplink shortcuts.
 * Each entry has a launch button that fires an ECP launch or input command
 * to the currently selected remote target device. Shows an empty state with a
 * settings link when no deeplinks are configured.
 */
export default function DeeplinksPanel() {
    const deeplinks = useAppStore(state => state.deeplinks)
    const setSettingsDialogOpen = useAppStore(state => state.setSettingsDialogOpen)
    const deviceIp = useAppStore(state => state.remoteTargetIp)

    /**
     * Assembles the ECP parameter map for the given deeplink and dispatches
     * either a launchDeeplink or sendInput call to the current remote target.
     */
    const handleLaunch = useCallback(async (dl: DeeplinkConfig) => {
        if (!deviceIp) return
        const params: Record<string, string> = {}
        if (dl.mediaType) params.mediaType = dl.mediaType
        if (dl.contentId) params.contentId = dl.contentId
        for (const extraParam of dl.extraParams) {
            if (extraParam.key) params[extraParam.key] = extraParam.value
        }
        try {
            if (dl.type === 'input') {
                await window.rokdock.ecp.sendInput(deviceIp, params)
            } else {
                await window.rokdock.ecp.launchDeeplink(deviceIp, dl.appId || 'dev', params)
            }
        } catch (e) {
            console.error('Deeplink error:', e)
        }
    }, [deviceIp])

    const styles = buildStyles()

    const gearAction = (
        <IconButton size="sm" onClick={() => setSettingsDialogOpen('deeplinks')} title="Configure deeplinks">
            <FontAwesomeIcon icon={faGear} />
        </IconButton>
    )

    return (
        <CollapsibleSection title="Deeplinks" id="deeplinks" actions={gearAction}>
            {deeplinks.length === 0 ? (
                <div className="rokdock-empty-state" style={styles.empty}>
                    <span style={{ fontSize: 12, color: 'var(--rokdock-text-dim)' }}>No deeplinks configured</span>
                    <button className="rokdock-btn rokdock-btn-ghost" onClick={() => setSettingsDialogOpen('deeplinks')}>
                        Configure in Settings
                    </button>
                </div>
            ) : (
                <div style={styles.list}>
                    {deeplinks.map((dl) => (
                        <DeeplinkButton
                            key={dl.id}
                            deeplink={dl}
                            disabled={!deviceIp}
                            onLaunch={() => handleLaunch(dl)}
                            styles={styles}
                        />
                    ))}
                </div>
            )}
        </CollapsibleSection>
    )
}

/**
 * Renders a single deeplink row button with hover and press feedback.
 * Displays the deeplink name and a short meta line showing the ECP variant
 * (launch/input), app ID, and content ID. Disabled when no device is selected.
 */
function DeeplinkButton({ deeplink, disabled, onLaunch, styles }: {
    deeplink: DeeplinkConfig
    disabled: boolean
    onLaunch: () => void
    styles: Record<string, React.CSSProperties>
}) {
    const [hovered, setHovered] = useState(false)
    const [pressed, setPressed] = useState(false)

    return (
        <button
            type="button"
            style={{
                ...styles.deeplinkBtn,
                opacity: disabled ? 0.4 : 1,
                ...(hovered && !disabled ? styles.deeplinkBtnHover : {}),
                ...(pressed && !disabled ? styles.deeplinkBtnPressed : {})
            }}
            onClick={onLaunch}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => { setHovered(false); setPressed(false) }}
            onMouseDown={(e) => { e.preventDefault(); setPressed(true) }}
            onMouseUp={() => setPressed(false)}
            disabled={disabled}
            title={disabled ? 'Connect to a device first' : `${deeplink.type === 'input' ? 'Input' : 'Launch'}: ${deeplink.name}`}
        >
            <span style={styles.rocketIcon}>
                <FontAwesomeIcon icon={deeplink.type === 'input' ? faSatelliteDish : faRocket} />
            </span>
            <div style={styles.deeplinkInfo}>
                <span style={styles.deeplinkName}>{deeplink.name || 'Untitled'}</span>
                <span style={styles.deeplinkMeta}>
                    {deeplink.type === 'input' ? 'input' : `launch/${deeplink.appId || 'dev'}`}
                    {deeplink.contentId ? ` | ${deeplink.contentId}` : ''}
                </span>
            </div>
        </button>
    )
}

/** Returns static style objects used by DeeplinksPanel and DeeplinkButton. */
function buildStyles(): Record<string, React.CSSProperties> {
    return {
        list: {
            padding: '4px 6px 6px',
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            overflowY: 'auto',
            minHeight: 0,
            flex: 1
        },
        deeplinkBtn: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '5px 7px',
            border: '1px solid var(--rokdock-border-light)',
            borderRadius: 'var(--rokdock-radius-lg)',
            background: 'linear-gradient(180deg, var(--rokdock-bg-panel) 0%, var(--rokdock-bg-surface) 100%)',
            color: 'var(--rokdock-text-primary)',
            fontSize: 'var(--rokdock-font-sm)',
            cursor: 'pointer',
            textAlign: 'left' as const,
            boxShadow: '0 1px 3px var(--rokdock-shadow-subtle)',
            transition: 'all 0.18s ease',
            overflow: 'hidden'
        },
        deeplinkBtnHover: {
            border: '1px solid var(--rokdock-brand-primary-faded)',
            background: 'linear-gradient(180deg, var(--rokdock-bg-hover) 0%, var(--rokdock-bg-surface) 100%)',
            boxShadow: '0 4px 12px var(--rokdock-shadow-strong), 0 0 0 1px var(--rokdock-brand-primary-faded)'
        },
        deeplinkBtnPressed: {
            boxShadow: '0 1px 3px var(--rokdock-shadow-subtle)'
        },
        rocketIcon: {
            fontSize: 'var(--rokdock-font-md)',
            flexShrink: 0
        },
        deeplinkInfo: {
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            flex: 1
        },
        deeplinkName: {
            fontWeight: 550,
            fontSize: 'var(--rokdock-font-sm)',
            color: 'var(--rokdock-text-bright)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
        },
        deeplinkMeta: {
            fontSize: 'var(--rokdock-font-xxs)',
            color: 'var(--rokdock-text-primary)',
            fontFamily: 'var(--rokdock-font-mono)',
            lineHeight: 1.25,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
        },
        empty: {
            padding: '12px 10px',
            flex: 1,
            minHeight: 0
        }
    }
}
