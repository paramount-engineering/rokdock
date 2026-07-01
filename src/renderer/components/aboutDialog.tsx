/**
 * About dialog displaying RokDock version and feature highlights.
 *
 * Fetches the running app version from the main process via
 * window.rokdock.app.getVersion() on mount and displays it alongside a
 * brief feature overview. Pure display - no user-editable state.
 */
import React, { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { faHexagon, faKeyboard, faGamepad, faXmark, faVideo, faBookOpen, faWandMagicSparkles } from '@fortawesome/free-solid-svg-icons'
import type { CSSProperties } from 'react'
import DialogFrame from './common/dialogFrame'

const OVERLAY_STYLE: CSSProperties = {
    zIndex: 2000,
    transition: 'opacity 0.2s ease',
}

const DIALOG_STYLE: CSSProperties = {
    position: 'relative',
    width: 360,
    maxHeight: 'none',
    overflow: 'hidden',
    boxShadow: `var(--rokdock-shadow-elevated), 0 0 0 1px var(--rokdock-brand-primary-faded)`,
    transition: 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease',
}

const GRADIENT_STRIP_STYLE: CSSProperties = {
    height: 3,
    background: `linear-gradient(90deg, var(--rokdock-brand-primary), var(--rokdock-brand-primary-light), #4fc3f7, #81c784, #ffb74d, var(--rokdock-brand-primary-light), var(--rokdock-brand-primary))`,
    backgroundSize: '200% 100%',
    animation: 'aboutGradient 4s ease infinite',
}

const BODY_STYLE: CSSProperties = {
    padding: '18px 24px 16px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
}

const LOGO_SECTION_STYLE: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
}

const LOGO_CONTAINER_STYLE: CSSProperties = {
    width: 72,
    height: 72,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
}

const TITLE_GROUP_STYLE: CSSProperties = {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
}

const APP_NAME_STYLE: CSSProperties = {
    fontSize: 24,
    fontWeight: 700,
    color: 'var(--rokdock-text-bright)',
    letterSpacing: '0.5px',
}

const VERSION_STYLE: CSSProperties = {
    fontSize: 'var(--rokdock-font-base)',
    fontWeight: 500,
    color: 'var(--rokdock-brand-primary-light)',
    fontFamily: 'var(--rokdock-font-mono)',
}

const DESCRIPTION_STYLE: CSSProperties = {
    fontSize: 'var(--rokdock-font-base)',
    color: 'var(--rokdock-text-dim)',
    textAlign: 'center',
    margin: '14px 0 0',
    lineHeight: 1.5,
}

const DIVIDER_STYLE: CSSProperties = {
    width: '100%',
    height: 1,
    background: 'var(--rokdock-border)',
    margin: '16px 0',
}

const BADGE_ROW_STYLE: CSSProperties = {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'center',
}

const FEATURES_STYLE: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginTop: 16,
    width: '100%',
}

const CLOSE_BTN_STYLE: CSSProperties = {
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
    justifyContent: 'center',
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 1,
}

/**
 * Renders the About dialog showing the app logo, version, tech stack badges,
 * and feature highlights. The version string is fetched asynchronously from
 * the main process on mount and displayed as "v{version}".
 */
export default function AboutDialog({ onClose }: { onClose: () => void }) {
    const [version, setVersion] = useState<string>('...')

    useEffect(() => {
        let mounted = true
        void window.rokdock.app.getVersion()
            .then((resolvedVersion: string) => {
                if (mounted && resolvedVersion) setVersion(resolvedVersion)
            })
            .catch(() => {
                if (mounted) setVersion('unknown')
            })
        return () => {
            mounted = false
        }
    }, [])

    return (
        <DialogFrame
            open
            onClose={onClose}
            zIndex={2000}
            overlayTransition="opacity 0.2s ease"
            dialogTransition="transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease"
            enterTransform="scale(1)"
            exitTransform="scale(0.92)"
            overlayStyle={OVERLAY_STYLE}
            dialogStyle={DIALOG_STYLE}
        >
                <div style={GRADIENT_STRIP_STYLE} />

                <div style={BODY_STYLE}>
                    <div style={LOGO_SECTION_STYLE}>
                        <div style={LOGO_CONTAINER_STYLE}>
                            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                                <defs>
                                    <linearGradient id="aboutHexGrad" x1="0" y1="0" x2="64" y2="64">
                                        <stop offset="0%" stopColor="var(--rokdock-brand-primary-light)" />
                                        <stop offset="100%" stopColor="var(--rokdock-brand-primary)" />
                                    </linearGradient>
                                    <filter id="aboutGlow">
                                        <feGaussianBlur stdDeviation="3" result="blur" />
                                        <feMerge>
                                            <feMergeNode in="blur" />
                                            <feMergeNode in="SourceGraphic" />
                                        </feMerge>
                                    </filter>
                                </defs>
                                <path
                                    d="M32 4 L56 18 L56 46 L32 60 L8 46 L8 18 Z"
                                    fill="url(#aboutHexGrad)"
                                    stroke="var(--rokdock-brand-primary-light)"
                                    strokeWidth="1.5"
                                    filter="url(#aboutGlow)"
                                />
                                <text
                                    x="32"
                                    y="38"
                                    textAnchor="middle"
                                    fontSize="22"
                                    fontFamily="var(--rokdock-font-mono)"
                                    fontWeight="bold"
                                    fill="var(--rokdock-text-bright)"
                                >
                                    {'>_'}
                                </text>
                            </svg>
                        </div>
                        <div style={TITLE_GROUP_STYLE}>
                            <span style={APP_NAME_STYLE}>RokDock</span>
                            <span style={VERSION_STYLE}>v{version}</span>
                        </div>
                    </div>

                    <p style={DESCRIPTION_STYLE}>
                        A desktop workbench for Roku development: discovery, debugging, remote
                        control, sideloading, screenshots, automation, asset tools, and in-app docs.
                    </p>

                    <div style={DIVIDER_STYLE} />

                    <div style={BADGE_ROW_STYLE}>
                        <Badge label="Electron" />
                        <Badge label="React" />
                        <Badge label="TypeScript" />
                        <Badge label="Custom Telnet Terminal" />
                        <Badge label="CodeMirror" />
                    </div>

                    <div style={FEATURES_STYLE}>
                        <Feature icon={faHexagon} text="SSDP device discovery" />
                        <Feature icon={faKeyboard} text="BrightScript debug terminal" />
                        <Feature icon={faGamepad} text="ECP virtual remote & sideloading" />
                        <Feature icon={faVideo} text="Screenshots & live HDMI capture" />
                        <Feature icon={faBookOpen} text="In-app Roku developer docs" />
                        <Feature icon={faWandMagicSparkles} text="AI assistant (Beta)" />
                    </div>

                </div>

                <button style={CLOSE_BTN_STYLE} onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>

            <style>{`
                @keyframes aboutGradient {
                    0% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                    100% { background-position: 0% 50%; }
                }
            `}</style>
        </DialogFrame>
    )
}

/** Renders a pill-shaped technology label in the About dialog badge row. */
function Badge({ label }: { label: string }) {
    return (
        <span style={{
            padding: '3px 10px',
            borderRadius: 20,
            background: 'var(--rokdock-brand-primary-faded)',
            border: '1px solid var(--rokdock-brand-primary-faded)',
            color: 'var(--rokdock-brand-primary-light)',
            fontSize: 'var(--rokdock-font-xs)',
            fontWeight: 500,
            letterSpacing: '0.3px',
        }}>{label}</span>
    )
}

/** Renders a single feature row with a FontAwesome icon and descriptive text. */
function Feature({ icon, text }: { icon: IconDefinition; text: string }) {
    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '4px 8px',
            borderRadius: 'var(--rokdock-radius-md)',
        }}>
            <span style={{ fontSize: 'var(--rokdock-font-md)', width: 22, textAlign: 'center', flexShrink: 0 }}>
                <FontAwesomeIcon icon={icon} />
            </span>
            <span style={{ fontSize: 'var(--rokdock-font-sm)', color: 'var(--rokdock-text-primary)' }}>{text}</span>
        </div>
    )
}
