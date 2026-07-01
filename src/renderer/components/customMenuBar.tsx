/**
 * Custom frameless menu bar rendered in the renderer process.
 *
 * Because RokDock uses a frameless Electron window on Windows, the native OS
 * menu bar is hidden. This component re-implements it as a React component
 * that reads APP_MENU (the shared menu definition) and maps item IDs to
 * handler functions via menuActions.
 *
 * Behavior:
 *  - Clicking a top-level menu label opens its dropdown; clicking outside or
 *    pressing Escape closes it.
 *  - Menu items with checkmarks (screenshot, theme) reflect live appStore state
 *    and are re-evaluated on each render.
 *  - Accelerator hints (e.g. Ctrl+K) are derived from the menu definition via
 *    acceleratorToHint() and displayed on the right side of each item.
 *  - Items not mapped in menuActions are skipped (no-ops), keeping the
 *    renderer-side menu in sync with native menu intent without duplicating
 *    all handlers.
 *
 * On macOS the native menu bar is used and this component is not rendered
 * (controlled by the parent via platform detection).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { resolveThemeMode } from '../styles/theme'
import { setAppZoomLevel, stepAppZoom } from '../utils/appZoom'
import { APP_MENU, isMenuItem, acceleratorToHint, type AppMenuGroup } from '../../shared/appMenu'

/**
 * Frameless menu bar for Windows (and Linux) where the native OS menu is hidden.
 *
 * Renders the APP_MENU structure as a row of dropdown buttons on the left and
 * panel-toggle / theme-toggle controls on the right. The onOpenAbout callback
 * is invoked when the Help > About item is selected.
 */
export default function CustomMenuBar({ onOpenAbout, onCheckForUpdates }: { onOpenAbout: () => void; onCheckForUpdates: () => void }) {
    const storedThemeMode = useAppStore(state => state.themeMode)
    // Tool windows and the bar styling need a concrete palette; resolve 'system'.
    const themeMode = resolveThemeMode(storedThemeMode)
    const [openMenu, setOpenMenu] = useState<string | null>(null)
    // Left offset (px) of the currently open dropdown, measured from leftGroup.
    const [dropdownLeft, setDropdownLeft] = useState(0)
    const containerRef = useRef<HTMLDivElement | null>(null)
    // Ref to the leftGroup div, which is position:relative and is the dropdown's offsetParent.
    const leftGroupRef = useRef<HTMLDivElement | null>(null)
    // One ref per top-level menu button, keyed by group id.
    const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

    const leftPanelOpen = useAppStore(state => state.leftPanelOpen)
    const rightPanelOpen = useAppStore(state => state.rightPanelOpen)
    const toggleLeftPanel = useAppStore(state => state.toggleLeftPanel)
    const toggleRightPanel = useAppStore(state => state.toggleRightPanel)
    const setLeftPanel = useAppStore(state => state.setLeftPanel)
    const setSettingsDialogOpen = useAppStore(state => state.setSettingsDialogOpen)
    const setThemeMode = useAppStore(state => state.setThemeMode)
    const toolsScreenshotEnabled = useAppStore(state => state.toolsScreenshotEnabled)

    // Action handlers keyed by menu item id.
    // If an id has no entry here, the item is skipped in the custom menu.
    const menuActions: Record<string, () => void> = useMemo(() => ({
        // File
        'new-connection': () => setLeftPanel(true),
        'open-settings': () => setSettingsDialogOpen('appearance'),
        'exit': () => { void window.rokdock.app.quit().catch(() => window.close()) },
        // Edit
        'undo': () => document.execCommand('undo'),
        'redo': () => document.execCommand('redo'),
        'cut': () => { void window.rokdock.edit.cut() },
        'copy': () => { void window.rokdock.edit.copy() },
        'paste': () => { void window.rokdock.edit.paste() },
        'select-all': () => { void window.rokdock.edit.selectAll() },
        // View
        'toggle-device-panel': toggleLeftPanel,
        'toggle-remote-panel': toggleRightPanel,
        'zoom-in': () => stepAppZoom(0.5),
        'zoom-out': () => stepAppZoom(-0.5),
        'reset-zoom': () => setAppZoomLevel(0),
        // Tools
        'screenshot': () => window.dispatchEvent(new CustomEvent('rokdock:tools-screenshot')),
        'ninepatch': () => window.rokdock.ninepatch.openEditor(themeMode),
        'svg-exporter': () => window.rokdock.svgExporter.openEditor(themeMode),
        'script-editor': () => window.rokdock.scriptEditor.open({ themeMode }),
        'json-editor': () => window.rokdock.json.openEditor(),
        'docs': () => window.rokdock.docs.open(themeMode),
        // Help
        'check-for-updates': onCheckForUpdates,
        'about': onOpenAbout,
    }), [toggleLeftPanel, toggleRightPanel, setLeftPanel, setSettingsDialogOpen, themeMode, onCheckForUpdates, onOpenAbout])

    const disabledIds = useMemo(() => {
        const ids = new Set<string>()
        if (!toolsScreenshotEnabled) ids.add('screenshot')
        return ids
    }, [toolsScreenshotEnabled])

    useEffect(() => {
        const onWindowMouseDown = (event: MouseEvent) => {
            const target = event.target as Node | null
            if (!containerRef.current || !target) return
            if (!containerRef.current.contains(target)) {
                setOpenMenu(null)
            }
        }
        const onWindowKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpenMenu(null)
        }

        window.addEventListener('mousedown', onWindowMouseDown)
        window.addEventListener('keydown', onWindowKeyDown)
        return () => {
            window.removeEventListener('mousedown', onWindowMouseDown)
            window.removeEventListener('keydown', onWindowKeyDown)
        }
    }, [])

    /**
     * Measures the button's left edge relative to leftGroup and opens its menu.
     *
     * The dropdown div is rendered with position:absolute inside leftGroup
     * (position:relative), so its left offset resolves against leftGroup, not
     * the bar. Measuring against leftGroup keeps the dropdown aligned with its
     * opening button regardless of bar padding or zoom level. Reading the live
     * geometry on every open ensures correctness after zoom or window resize
     * without any resize-observer overhead.
     */
    const openMenuAt = useCallback((groupId: string) => {
        const button = buttonRefs.current.get(groupId)
        const leftGroup = leftGroupRef.current
        if (button && leftGroup) {
            const buttonRect = button.getBoundingClientRect()
            const leftGroupRect = leftGroup.getBoundingClientRect()
            setDropdownLeft(buttonRect.left - leftGroupRect.left)
        }
        setOpenMenu(groupId)
    }, [])

    /** Closes the open dropdown and executes the selected menu item action. */
    const runAction = useCallback((action: () => void) => {
        setOpenMenu(null)
        action()
    }, [])

    const styles = useMemo(() => buildStyles(themeMode), [themeMode])

    return (
        <div ref={containerRef} style={styles.bar}>
            <div ref={leftGroupRef} style={styles.leftGroup}>
                {APP_MENU.map(group => (
                    <React.Fragment key={group.id}>
                        <MenuButton
                            label={group.label}
                            open={openMenu === group.id}
                            buttonRef={element => {
                                if (element) buttonRefs.current.set(group.id, element)
                                else buttonRefs.current.delete(group.id)
                            }}
                            onClick={() => {
                                if (openMenu === group.id) setOpenMenu(null)
                                else openMenuAt(group.id)
                            }}
                            onMouseEnter={() => {
                                if (openMenu && openMenu !== group.id) openMenuAt(group.id)
                            }}
                            styles={styles}
                        />
                        {openMenu === group.id && (
                            <div style={{ ...styles.menu, left: dropdownLeft }}>
                                {renderMenuItems(group, menuActions, disabledIds, runAction, styles)}
                            </div>
                        )}
                    </React.Fragment>
                ))}
            </div>
            <div style={styles.rightGroup}>
                <button
                    type="button"
                    title={`Switch to ${themeMode === 'light' ? 'dark' : 'light'} mode`}
                    aria-label="Toggle light and dark mode"
                    style={styles.themeToggle}
                    onClick={() => setThemeMode(themeMode === 'light' ? 'dark' : 'light')}
                >
                    <span
                        style={{
                            ...styles.themeToggleTrack,
                            ...(themeMode === 'light' ? styles.themeToggleTrackLight : styles.themeToggleTrackDark)
                        }}
                    >
                        <span
                            style={{
                                ...styles.themeToggleThumb,
                                ...(themeMode === 'light' ? styles.themeToggleThumbLight : styles.themeToggleThumbDark)
                            }}
                        >
                            <svg viewBox="0 0 16 16" width="8" height="8" style={styles.themeToggleIcon} aria-hidden="true">
                                <circle cx="8" cy="8" r="3.8" fill={themeMode === 'light' ? '#ffffff' : '#000000'} />
                            </svg>
                        </span>
                    </span>
                </button>
                <button
                    type="button"
                    title="Toggle Device Panel (Ctrl+Shift+D)"
                    style={{ ...styles.panelToggleButton, ...(leftPanelOpen ? styles.panelToggleButtonActive : {}) }}
                    onClick={toggleLeftPanel}
                >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <rect x="1" y="2" width="4" height="12" rx="1" opacity={leftPanelOpen ? 1 : 0.45} />
                        <rect x="6" y="2" width="9" height="12" rx="1" opacity="0.3" />
                    </svg>
                </button>
                <button
                    type="button"
                    title="Toggle Remote Panel (Ctrl+Shift+R)"
                    style={{ ...styles.panelToggleButton, ...(rightPanelOpen ? styles.panelToggleButtonActive : {}) }}
                    onClick={toggleRightPanel}
                >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <rect x="1" y="2" width="9" height="12" rx="1" opacity="0.3" />
                        <rect x="11" y="2" width="4" height="12" rx="1" opacity={rightPanelOpen ? 1 : 0.45} />
                    </svg>
                </button>
            </div>
        </div>
    )
}

/**
 * Renders the list of MenuItem and MenuDivider elements for one menu group.
 *
 * Filters out nativeOnly items and items with no mapped action, then strips
 * leading, trailing, and consecutive separators so the dropdown never starts
 * or ends with a divider.
 */
function renderMenuItems(
    group: AppMenuGroup,
    actions: Record<string, () => void>,
    disabledIds: Set<string>,
    runAction: (action: () => void) => void,
    styles: Record<string, React.CSSProperties>
) {
    const visible = group.items.filter(entry => {
        if (!isMenuItem(entry)) return true
        if (entry.nativeOnly) return false
        return entry.id in actions
    })
    // Strip leading/trailing/consecutive separators
    const cleaned: typeof visible = []
    for (const entry of visible) {
        const isSep = !isMenuItem(entry)
        if (isSep && (cleaned.length === 0 || !isMenuItem(cleaned[cleaned.length - 1]))) continue
        cleaned.push(entry)
    }
    while (cleaned.length > 0 && !isMenuItem(cleaned[cleaned.length - 1])) cleaned.pop()

    return cleaned.map((entry, i) => {
        if (!isMenuItem(entry)) return <MenuDivider key={`sep-${i}`} />
        const disabled = disabledIds.has(entry.id)
        return (
            <MenuItem
                key={entry.id}
                label={entry.label}
                hint={entry.accelerator ? acceleratorToHint(entry.accelerator) : undefined}
                disabled={disabled}
                onClick={() => runAction(actions[entry.id])}
                styles={styles}
            />
        )
    })
}

/**
 * Top-level menu label button that toggles its dropdown open/closed.
 * Receives an onMouseEnter handler so hovering while another menu is open
 * switches to this group without requiring an extra click.
 */
function MenuButton({
    label,
    open,
    buttonRef,
    onClick,
    onMouseEnter,
    styles
}: {
    label: string
    open: boolean
    buttonRef: React.RefCallback<HTMLButtonElement>
    onClick: () => void
    onMouseEnter?: () => void
    styles: Record<string, React.CSSProperties>
}) {
    return (
        <button
            ref={buttonRef}
            type="button"
            style={{ ...styles.menuButton, ...(open ? styles.menuButtonOpen : {}) }}
            onClick={onClick}
            onMouseEnter={onMouseEnter}
        >
            {label}
        </button>
    )
}

/**
 * Single clickable row inside a dropdown menu. Renders the item label on the
 * left and an optional keyboard accelerator hint on the right. Applies hover
 * and disabled visual states without external CSS classes.
 */
function MenuItem({ label, hint, disabled, onClick, styles }: {
    label: string
    hint?: string
    disabled?: boolean
    onClick: () => void
    styles: Record<string, React.CSSProperties>
}) {
    const [hovered, setHovered] = useState(false)
    const dimmed = !!disabled
    return (
        <button
            type="button"
            disabled={dimmed}
            style={{
                ...styles.menuItem,
                ...(dimmed ? styles.menuItemDisabled : {}),
                ...(hovered && !dimmed ? styles.menuItemHover : {})
            }}
            onClick={() => { if (!dimmed) onClick() }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <span style={styles.menuLabel}>{label}</span>
            {hint && <span style={styles.menuHint}>{hint}</span>}
        </button>
    )
}

/** Thin horizontal rule used to visually separate groups of items within a dropdown. */
function MenuDivider() {
    return <div style={{ height: 1, margin: '3px 6px', background: 'var(--rokdock-border)' }} />
}

/**
 * Builds the inline style map for CustomMenuBar and its sub-components.
 * Bar height and content offsets differ slightly between dark and light mode
 * to maintain optical alignment with the window chrome.
 */
function buildStyles(themeMode: 'dark' | 'light'): Record<string, React.CSSProperties> {
    const barHeight = themeMode === 'light' ? 26 : 24
    const contentOffsetY = themeMode === 'light' ? -1 : 0

    return {
        bar: {
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: barHeight,
            minHeight: barHeight,
            maxHeight: barHeight,
            flexShrink: 0,
            boxSizing: 'border-box',
            marginBottom: themeMode === 'light' ? -2 : 0,
            padding: '0 6px',
            borderBottom: `1px solid var(--rokdock-border)`,
            background: `linear-gradient(180deg, var(--rokdock-brand-primary) 0%, var(--rokdock-brand-primary-dark) 100%)`,
            boxShadow: `inset 0 1px 0 var(--rokdock-white-subtle), 0 1px 4px var(--rokdock-black-medium)`,
            zIndex: 50
        },
        leftGroup: {
            display: 'flex',
            alignItems: 'stretch',
            position: 'relative',
            transform: `translateY(${contentOffsetY}px)`
        },
        rightGroup: {
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            transform: `translateY(${contentOffsetY}px)`
        },
        themeToggle: {
            height: 18,
            border: 'none',
            borderRadius: 'var(--rokdock-radius-sm)',
            background: 'transparent',
            color: 'var(--rokdock-text-bright)',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            cursor: 'pointer',
            fontSize: 'var(--rokdock-font-xxs)'
        },
        themeToggleTrack: {
            width: 34,
            height: 18,
            borderRadius: 999,
            position: 'relative'
        },
        themeToggleTrackDark: {
            background: 'var(--rokdock-bg-surface)',
            boxShadow: `inset 0 0 0 1px var(--rokdock-white-medium)`
        },
        themeToggleTrackLight: {
            background: 'var(--rokdock-bg-surface)',
            boxShadow: `inset 0 0 0 1px var(--rokdock-black-medium)`
        },
        themeToggleThumb: {
            position: 'absolute',
            top: 2,
            left: 2,
            width: 14,
            height: 14,
            borderRadius: 999,
            display: 'grid',
            placeItems: 'center',
            transition: 'transform 0.14s ease',
            boxSizing: 'border-box'
        },
        themeToggleThumbDark: {
            background: 'var(--rokdock-brand-primary)',
            transform: 'translateX(16px)',
            boxShadow: `0 1px 2px var(--rokdock-black-medium), inset 0 0 0 1px var(--rokdock-white-medium)`
        },
        themeToggleThumbLight: {
            background: 'var(--rokdock-brand-primary-light)',
            transform: 'translateX(0)',
            boxShadow: `0 1px 2px var(--rokdock-black-subtle), inset 0 0 0 1px var(--rokdock-white-medium)`
        },
        themeToggleIcon: {
            display: 'block',
            flexShrink: 0,
            transform: 'translateZ(0)'
        },
        themeToggleIconDark: {
            color: 'var(--rokdock-text-bright)'
        },
        themeToggleIconLight: {
            color: 'var(--rokdock-text-bright)'
        },
        menuButton: {
            height: 22,
            padding: '0 8px',
            border: 'none',
            borderRadius: 'var(--rokdock-radius-sm)',
            background: 'transparent',
            color: 'var(--rokdock-menu-text-primary)',
            fontSize: 'var(--rokdock-font-sm)',
            cursor: 'pointer'
        },
        menuButtonOpen: {
            background: 'var(--rokdock-menu-border)',
            color: 'var(--rokdock-menu-text-primary)'
        },
        menu: {
            position: 'absolute',
            top: barHeight - 1 - contentOffsetY,
            left: 0,
            minWidth: 250,
            padding: '4px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            borderRadius: 'var(--rokdock-radius-md)',
            border: `1px solid var(--rokdock-border-light)`,
            background: `linear-gradient(180deg, var(--rokdock-bg-panel) 0%, var(--rokdock-bg-surface) 100%)`,
            boxShadow: 'var(--rokdock-shadow-elevated)'
        },
        menuItem: {
            height: 26,
            width: '100%',
            border: 'none',
            borderRadius: 'var(--rokdock-radius-sm)',
            background: 'transparent',
            color: 'var(--rokdock-text-primary)',
            fontSize: 'var(--rokdock-font-sm)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 18,
            padding: '0 8px'
        },
        menuItemDisabled: {
            opacity: 0.45,
            cursor: 'not-allowed',
            pointerEvents: 'none' as const
        },
        menuLabel: {
            flex: 1,
            textAlign: 'left' as const,
            minWidth: 0,
            whiteSpace: 'nowrap' as const
        },
        menuItemHover: {
            background: themeMode === 'light'
                ? `linear-gradient(90deg, var(--rokdock-brand-primary-faded) 0%, var(--rokdock-brand-primary-faded) 72%, transparent 100%)`
                : `linear-gradient(90deg, var(--rokdock-bg-hover) 0%, transparent 100%)`,
            boxShadow: themeMode === 'light'
                ? `inset 0 0 0 1px var(--rokdock-brand-primary-faded)`
                : undefined
        },
        menuHint: {
            fontSize: 'var(--rokdock-font-xs)',
            color: 'var(--rokdock-text-muted)',
            fontFamily: 'var(--rokdock-font-mono)',
            minWidth: 96,
            textAlign: 'right' as const,
            letterSpacing: '0.2px',
            whiteSpace: 'nowrap' as const
        },
        panelToggleButton: {
            width: 22,
            height: 18,
            border: 'none',
            borderRadius: 'var(--rokdock-radius-sm)',
            background: 'transparent',
            color: 'var(--rokdock-menu-text-dim)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer'
        },
        panelToggleButtonActive: {
            color: 'var(--rokdock-menu-text-primary)',
            background: 'var(--rokdock-menu-active-bg)',
            boxShadow: `inset 0 0 0 1px var(--rokdock-menu-active-bg)`
        }
    }
}
