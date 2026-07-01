/**
 * Root application component and top-level layout orchestrator.
 *
 * Renders the three-column layout: left panel (devices + capture), center terminal
 * split view, and right panel (remote control). Handles panel visibility, the
 * edge trigger zones for collapsed panels, and the boot splash screen.
 *
 * Responsibilities:
 *  - Boot splash: shown while preferences are loading; hides after a minimum
 *    1 second to prevent flash, with a fallback timeout in case IPC is slow.
 *  - IPC subscriptions: sets up all renderer-side event listeners (device changes,
 *    scan events, menu clicks, theme changes, capture mode changes) in useEffect.
 *  - Global keyboard shortcuts: zoom in/out/reset (Ctrl+=/-/0).
 *  - Dialog orchestration: all top-level modal dialogs (add device, properties,
 *    settings, about) are rendered here and controlled via app store state.
 */

import React, { useEffect, useRef, useState } from 'react'
import { useAppStore } from './store/appStore'
import { useTheme, resolveThemeMode } from './styles/theme'
import LeftColumn from './components/leftColumn'
import SplitTerminalContainer from './components/splitTerminalContainer'
import RemotePanel from './components/remotePanel'
import AddDeviceDialog from './components/addDeviceDialog'
import DevicePropertiesDialog from './components/devicePropertiesDialog'
import SettingsDialog from './components/settingsDialog'
import AboutDialog from './components/aboutDialog'
import UpdatesDialog from './components/updatesDialog'
import CustomMenuBar from './components/customMenuBar'
import type { UpdateCheckResult } from '@shared/updates'
import type { AppearanceDraft } from '@shared/appearanceDraft'
import type { PanelState } from '@shared/types'
import { setAppZoomLevel, stepAppZoom } from './utils/appZoom'
import CaptureFloat from './components/captureFloat'
import AiChatPanel from './components/ai/aiChatPanel'

const BOOT_SPLASH_MIN_DURATION_MS = 1000
const BOOT_FALLBACK_TIMEOUT_MS = 1500

async function computeAiConfigured(): Promise<boolean> {
    const [list, active]: [{ id: string }[], string | null] = await Promise.all([window.rokdock.ai.listProfiles(), window.rokdock.ai.getActive()])
    return !!active && list.some(profile => profile.id === active)
}

/**
 * Root application component.
 *
 * Renders the three-column shell (left device panel, center terminal split,
 * right remote panel) together with the custom menu bar and all top-level
 * modal dialogs. Manages the boot splash lifecycle, subscribes to IPC events
 * from the main process, and wires up global keyboard and mouse-wheel zoom
 * shortcuts.
 */
export default function App() {
    const { themeMode } = useTheme()
    const leftPanelOpen = useAppStore(state => state.leftPanelOpen)
    const rightPanelOpen = useAppStore(state => state.rightPanelOpen)
    const toggleLeftPanel = useAppStore(state => state.toggleLeftPanel)
    const toggleRightPanel = useAppStore(state => state.toggleRightPanel)
    const setDevices = useAppStore(state => state.setDevices)
    const setLastScanAt = useAppStore(state => state.setLastScanAt)
    const setLastConnected = useAppStore(state => state.setLastConnected)
    const setDeviceOrder = useAppStore(state => state.setDeviceOrder)
    const setLeftPanel = useAppStore(state => state.setLeftPanel)
    const setRightPanel = useAppStore(state => state.setRightPanel)
    const addDeviceDialogOpen = useAppStore(state => state.addDeviceDialogOpen)
    const settingsDialogOpen = useAppStore(state => state.settingsDialogOpen)
    const devicePropertiesDevice = useAppStore(state => state.devicePropertiesDevice)
    const loadSettings = useAppStore(state => state.loadSettings)
    const setDeviceNicknames = useAppStore(state => state.setDeviceNicknames)
    const setDeviceHasAuth = useAppStore(state => state.setDeviceHasAuth)
    const setDeviceHasAuthForIp = useAppStore(state => state.setDeviceHasAuthForIp)
    const setSettingsDialogOpen = useAppStore(state => state.setSettingsDialogOpen)
    const appZoomLevel = useAppStore(state => state.appZoomLevel)
    const aiConfigured = useAppStore(state => state.aiConfigured)
    const leftPanelWidth = useAppStore(state => state.leftPanelWidth)
    const rightPanelWidth = useAppStore(state => state.rightPanelWidth)
    const setAiConfigured = useAppStore(state => state.setAiConfigured)
    const setLeftPanelWidth = useAppStore(state => state.setLeftPanelWidth)
    const setRightPanelWidth = useAppStore(state => state.setRightPanelWidth)
    const setLeftSplitRatio = useAppStore(state => state.setLeftSplitRatio)
    const initAiChatStream = useAppStore(state => state.initAiChatStream)
    const [aboutOpen, setAboutOpen] = useState(false)
    const [updatesOpen, setUpdatesOpen] = useState(false)
    const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
    const [booting, setBooting] = useState(true)
    // Becomes true only after the persisted panel state has been loaded and applied.
    // The panel-state persist effect skips writing until then, so its mount-time run
    // cannot clobber the saved layout (e.g. the AI chat dock) with default values.
    const hydratedRef = useRef(false)
    const persistTimerRef = useRef<number | undefined>(undefined)
    const latestPanelStateRef = useRef<Parameters<typeof window.rokdock.store.setPanelState>[0] | null>(null)

    // Opens the update dialog in its checking state and runs a check. Used by the
    // Help > Check for Updates action (both menus) and the dialog's retry button.
    const runUpdateCheck = () => {
        setUpdateResult(null)
        setUpdatesOpen(true)
        void window.rokdock.updates.check()
            .then(setUpdateResult)
            .catch((err: unknown) =>
                setUpdateResult({ status: 'error', error: err instanceof Error ? err.message : String(err) })
            )
    }
    // Sync CSS custom properties used by index.html global styles (non-React elements).
    // These legacy aliases (no --rokdock- prefix) are kept for index.html compatibility and
    // are distinct from the --rokdock-* vars that bootBundledTheme applies in index.tsx. The
    // boot splash does not depend on either: it has its own default colors inline in index.html,
    // so it renders before React mounts; this effect just keeps the aliases in sync on theme change.
    // The aliases reference the already-tinted --rokdock-* vars directly (single source of truth
    // in toCSSVars), so no second tint pass is needed here.
    useEffect(() => {
        const root = document.documentElement.style
        root.setProperty('--body-bg', 'var(--rokdock-bg-base)')
        root.setProperty('--body-text', 'var(--rokdock-text-primary)')
        root.setProperty('--bg-gradient-a', 'var(--rokdock-bg-gradient-a)')
        root.setProperty('--bg-gradient-b', 'var(--rokdock-bg-gradient-b)')
        root.setProperty('--selection-bg', 'var(--rokdock-selection-bg)')
        root.setProperty('--selection-text', 'var(--rokdock-selection-text)')
        root.setProperty('--focus-border', 'var(--rokdock-focus-border)')
        root.setProperty('--focus-shadow', 'var(--rokdock-focus-shadow)')
        root.setProperty('--scrollbar-thumb', 'var(--rokdock-scrollbar-thumb)')
        root.setProperty('--scrollbar-thumb-hover', 'var(--rokdock-scrollbar-thumb-hover)')
        root.setProperty('--brand-purple-base', 'var(--rokdock-brand-primary)')
        root.setProperty('--brand-purple-light', 'var(--rokdock-brand-primary-light)')
        root.setProperty('--splash-card-start', 'var(--rokdock-bg-panel)')
        root.setProperty('--splash-card-end', 'var(--rokdock-bg-surface)')
        root.setProperty('--splash-card-border', 'var(--rokdock-border-light)')
        root.setProperty('--splash-subtitle', 'var(--rokdock-text-dim)')
        root.setProperty('--splash-overlay-bg', 'var(--rokdock-overlay-bg)')
        void window.rokdock.window.setAuxThemeMode(themeMode).catch((err: unknown) => {
            console.error('Failed to sync aux window theme mode:', err)
        })
    }, [themeMode])

    useEffect(() => {
        let cancelled = false
        let bootFinished = false
        const bootStartedAt = Date.now()
        const finishBoot = () => {
            if (cancelled || bootFinished) return
            bootFinished = true
            const elapsedMs = Date.now() - bootStartedAt
            const remainingMinDurationMs = Math.max(0, BOOT_SPLASH_MIN_DURATION_MS - elapsedMs)
            window.setTimeout(() => {
                if (!cancelled) setBooting(false)
            }, remainingMinDurationMs)
        }

        // Wire AI chat stream subscriptions once on mount.
        initAiChatStream()

        // Load AI provider availability. Silently hides the chat toggle if no active provider resolves.
        // A detected-but-unactivated CLI must not surface a chat that would error on send.
        const aiConfigLoad = computeAiConfigured().then(setAiConfigured).catch(() => { /* leave hidden */ })

        // Load persisted panel state (left/right visibility plus AI layout fields).
        const panelStateLoad = window.rokdock.store.getPanelState().then((state: PanelState) => {
            setLeftPanel(state.leftOpen)
            setRightPanel(state.rightOpen)
            if (typeof state.leftWidth === 'number') setLeftPanelWidth(state.leftWidth)
            if (typeof state.leftSplit === 'number') setLeftSplitRatio(state.leftSplit)
            if (typeof state.rightWidth === 'number') setRightPanelWidth(state.rightWidth)
            if (typeof state.aiChatOpen === 'boolean' && state.aiChatOpen) useAppStore.setState({ aiChatOpen: true })
            if (state.aiChatDock === 'left' || state.aiChatDock === 'middle' || state.aiChatDock === 'right') {
                useAppStore.setState({ aiChatDock: state.aiChatDock })
            }
            if (typeof state.aiChatDrawerHeight === 'number') {
                useAppStore.setState({ aiChatDrawerHeight: state.aiChatDrawerHeight })
            }
            // Saved values applied: persistence may now run without clobbering them.
            hydratedRef.current = true
        }).catch((err: unknown) => {
            console.error('Failed to load panel state:', err)
            hydratedRef.current = true  // allow persistence even if the load failed
        })

        // Load initial devices
        const devicesLoad = window.rokdock.discovery.getDevices().then(setDevices).catch((err: unknown) => {
            console.error('Failed to load devices:', err)
        })

        // Load persisted connection order
        const lastConnectedLoad = window.rokdock.store.getLastConnected().then(setLastConnected).catch((err: unknown) => {
            console.error('Failed to load last connected devices:', err)
        })
        const deviceOrderLoad = window.rokdock.store.getDeviceOrder().then(setDeviceOrder).catch((err: unknown) => {
            console.error('Failed to load device order:', err)
        })
        // Load settings (ports, command, deeplinks)
        const settingsLoad = loadSettings().catch((err: unknown) => {
            console.error('Failed to load settings:', err)
        })

        // Load device nicknames
        const nicknamesLoad = window.rokdock.store.getDeviceNicknames().then(setDeviceNicknames).catch((err: unknown) => {
            console.error('Failed to load device nicknames:', err)
        })

        // Load device auth states
        const authStatesLoad = window.rokdock.store.getAllDeviceAuthStates().then(setDeviceHasAuth).catch((err: unknown) => {
            console.error('Failed to load device auth states:', err)
        })

        void Promise.allSettled([
            panelStateLoad,
            devicesLoad,
            lastConnectedLoad,
            deviceOrderLoad,
            settingsLoad,
            nicknamesLoad,
            authStatesLoad,
            aiConfigLoad
        ]).then(finishBoot)
        const bootTimeout = window.setTimeout(finishBoot, BOOT_FALLBACK_TIMEOUT_MS)

        // Subscribe to device changes
        const unsubDevices = window.rokdock.discovery.onDevicesChanged(setDevices)
        const unsubScan = window.rokdock.discovery.onScanStarted(setLastScanAt)

        // Mirror the applied appearance from main into the store so the dock's
        // store-driven UI (terminal, theme-aware inline styles, the Settings
        // segmented control) tracks whatever every window is showing: a live preview
        // draft, the persisted values on Save/Cancel, or an OS theme flip in System mode.
        const onAppearanceApplied = (e: Event) => {
            useAppStore.getState().applyAppearance((e as CustomEvent<AppearanceDraft>).detail)
        }
        window.addEventListener('rokdock-appearance-applied', onAppearanceApplied)

        // Refresh auth state when credentials are saved
        const onAuthUpdated = (e: Event) => {
            const ip = (e as CustomEvent<{ ip: string }>).detail?.ip
            if (!ip) return
            window.rokdock.store.getDeviceAuth(ip).then((auth: { username: string; password: string } | null) => {
                setDeviceHasAuthForIp(ip, !!(auth?.username?.trim() && auth?.password?.trim()))
            }).catch(() => { /* ignore */ })
        }
        window.addEventListener('rokdock:device-auth-updated', onAuthUpdated)

        // Menu shortcuts
        const unsubNewConnection = window.rokdock.menu.onNewConnection(() => setLeftPanel(true))
        const unsubToggleDevice = window.rokdock.menu.onToggleDevicePanel(toggleLeftPanel)
        const unsubToggleRemote = window.rokdock.menu.onToggleRemotePanel(toggleRightPanel)
        const unsubOpenSettings = window.rokdock.menu.onOpenSettings(() => setSettingsDialogOpen('appearance'))
        const unsubAbout = window.rokdock.menu.onAbout(() => setAboutOpen(true))
        const unsubCheckForUpdates = window.rokdock.menu.onCheckForUpdates(runUpdateCheck)
        const unsubScreenshot = window.rokdock.menu.onScreenshot(() => {
            window.dispatchEvent(new CustomEvent('rokdock:tools-screenshot'))
        })
        const unsubNinepatch = window.rokdock.menu.onNinepatchEditor(() => {
            const currentTheme = resolveThemeMode(useAppStore.getState().themeMode)
            window.rokdock.ninepatch.openEditor(currentTheme)
        })
        const unsubSvgExporter = window.rokdock.menu.onSvgExporter(() => {
            const currentTheme = resolveThemeMode(useAppStore.getState().themeMode)
            window.rokdock.svgExporter.openEditor(currentTheme)
        })
        const unsubJsonEditor = window.rokdock.menu.onJsonEditor(() => {
            window.rokdock.json.openEditor()
        })

        // Automatic update check once per launch. Surfaces the dialog only when an
        // update is available, so an up-to-date or errored check is silent at startup.
        void window.rokdock.updates.check()
            .then((result: UpdateCheckResult) => {
                if (result.status === 'available') {
                    setUpdateResult(result)
                    setUpdatesOpen(true)
                }
            })
            .catch(() => { /* silent at launch */ })

        return () => {
            cancelled = true
            window.clearTimeout(bootTimeout)
            unsubDevices()
            unsubScan()
            window.removeEventListener('rokdock-appearance-applied', onAppearanceApplied)
            window.removeEventListener('rokdock:device-auth-updated', onAuthUpdated)
            unsubNewConnection()
            unsubToggleDevice()
            unsubToggleRemote()
            unsubOpenSettings()
            unsubAbout()
            unsubScreenshot()
            unsubNinepatch()
            unsubSvgExporter()
            unsubJsonEditor()
            unsubCheckForUpdates()
        }
    // Mount-once setup of IPC/store subscriptions and the boot sequence; deps
    // intentionally empty so it runs only on mount and tears down on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // CTRL+scrollwheel zoom
    useEffect(() => {
        const handleWheel = (e: WheelEvent) => {
            if (!e.ctrlKey) return
            e.preventDefault()
            const delta = e.deltaY < 0 ? 0.5 : -0.5
            stepAppZoom(delta)
        }
        window.addEventListener('wheel', handleWheel, { passive: false })
        return () => window.removeEventListener('wheel', handleWheel)
    }, [])

    // Keyboard zoom shortcuts with persistence parity.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey) return
            const key = e.key
            if (key === '=' || key === '+') {
                e.preventDefault()
                stepAppZoom(0.5)
                return
            }
            if (key === '-') {
                e.preventDefault()
                stepAppZoom(-0.5)
                return
            }
            if (key === '0') {
                e.preventDefault()
                setAppZoomLevel(0)
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [])

    // Apply persisted app zoom after preferences load.
    useEffect(() => {
        const current = window.rokdock.zoom.getLevel()
        if (Math.abs(current - appZoomLevel) > 0.01) {
            setAppZoomLevel(appZoomLevel)
        }
    }, [appZoomLevel])

    // Re-query AI provider availability whenever the Settings dialog closes, so
    // adding or removing a provider flips the chat toggle gate live.
    // The ref guard prevents the spurious boot-time call (settingsDialogOpen starts false).
    const aiChatOpen = useAppStore(state => state.aiChatOpen)
    const aiChatDock = useAppStore(state => state.aiChatDock)
    const aiChatDrawerHeight = useAppStore(state => state.aiChatDrawerHeight)
    const cycleAiChatDock = useAppStore(state => state.cycleAiChatDock)
    const setAiChatDrawerHeight = useAppStore(state => state.setAiChatDrawerHeight)
    const leftSplitRatio = useAppStore(state => state.leftSplitRatio)
    const prevSettingsOpen = useRef(false)
    useEffect(() => {
        if (prevSettingsOpen.current && !settingsDialogOpen) {
            void computeAiConfigured().then(setAiConfigured).catch(() => {})
        }
        prevSettingsOpen.current = settingsDialogOpen
    // Run whenever the dialog transitions to closed (open -> false).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settingsDialogOpen])

    // Persist panel state changes including AI layout fields. Guarded on hydration so
    // the mount-time run does not overwrite the saved layout before it is loaded.
    // Debounced 250ms so rapid drag events do not flood IPC.
    useEffect(() => {
        if (!hydratedRef.current) return
        const payload = {
            leftOpen: leftPanelOpen,
            rightOpen: rightPanelOpen,
            leftWidth: leftPanelWidth,
            leftSplit: leftSplitRatio,
            rightWidth: rightPanelWidth,
            aiChatOpen,
            aiChatDock,
            aiChatDrawerHeight,
        }
        latestPanelStateRef.current = payload
        clearTimeout(persistTimerRef.current)
        persistTimerRef.current = window.setTimeout(() => window.rokdock.store.setPanelState(payload), 250)
    }, [leftPanelOpen, rightPanelOpen, leftPanelWidth, leftSplitRatio, rightPanelWidth, aiChatOpen, aiChatDock, aiChatDrawerHeight])

    // Flush the latest panel state on unmount to avoid losing the last layout change
    // if the app quits within the 250ms debounce window.
    useEffect(() => () => {
        clearTimeout(persistTimerRef.current)
        if (latestPanelStateRef.current) window.rokdock.store.setPanelState(latestPanelStateRef.current)
    }, [])

    useEffect(() => {
        document.body.classList.toggle('app-ready', !booting)
        return () => {
            document.body.classList.remove('app-ready')
        }
    }, [booting])

    useEffect(() => {
        const cleanup = window.rokdock.capture.onPopoutClosed(() => {
            const state = useAppStore.getState()
            if (state.captureMode === 'popout') {
                state.setCaptureMode('docked')
            }
        })
        return cleanup
    }, [])

    useEffect(() => {
        const cleanup = window.rokdock.capture.onMuteChanged((muted: boolean) => {
            useAppStore.getState().setCaptureMuted(muted)
        })
        return cleanup
    }, [])

    useEffect(() => {
        const cleanup = window.rokdock.capture.onModeChanged?.((mode: string) => {
            const store = useAppStore.getState()
            if (mode === 'screenshot-preview' && store.captureMode !== 'screenshot-preview') {
                store.setCaptureMode('screenshot-preview')
            } else if (mode !== 'screenshot-preview' && store.captureMode === 'screenshot-preview') {
                store.setCaptureMode('docked')
            }
        })
        return cleanup ?? undefined
    }, [])

    // Fire docs.prime() whenever the chat transitions from closed to open, regardless
    // of which column is hosting it. Moved here from leftColumn.tsx so it fires in all dock modes.
    const prevChatOpen = useRef(false)
    useEffect(() => {
        if (aiChatOpen && !prevChatOpen.current) {
            void window.rokdock.docs.prime().catch(() => {})
            // Lazily load the symbol map for answer linkifying on first open, so the docs
            // tree fetch it triggers stays off the launch path (idempotent in the store).
            useAppStore.getState().loadDocSymbols()
        }
        prevChatOpen.current = aiChatOpen
    }, [aiChatOpen])

    /**
     * Shared scaffolding for the three resizable panel edge handles.
     * Captures the start coordinate, then on every mousemove clamps the new value
     * and calls the setter; removes both listeners on mouseup.
     */
    function startDrag(
        e: React.MouseEvent,
        axis: 'x' | 'y',
        sign: 1 | -1,
        startValue: number,
        min: number,
        max: number,
        setter: (v: number) => void,
    ): void {
        e.preventDefault()
        const startCoord = axis === 'x' ? e.clientX : e.clientY
        const onMove = (ev: MouseEvent): void => {
            const delta = (axis === 'x' ? ev.clientX : ev.clientY) - startCoord
            setter(Math.min(max, Math.max(min, startValue + sign * delta)))
        }
        const onUp = (): void => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
    }

    const startWidthDrag = (e: React.MouseEvent): void =>
        startDrag(e, 'x', 1, leftPanelWidth, 200, 560, setLeftPanelWidth)

    const startRightWidthDrag = (e: React.MouseEvent): void =>
        startDrag(e, 'x', -1, rightPanelWidth, 200, 560, setRightPanelWidth)

    const startDrawerHeightDrag = (e: React.MouseEvent): void =>
        startDrag(e, 'y', -1, aiChatDrawerHeight, 140, 680, setAiChatDrawerHeight)

    const styles = appStyles

    return (
        <div style={styles.container}>
            <CustomMenuBar onOpenAbout={() => setAboutOpen(true)} onCheckForUpdates={runUpdateCheck} />
            <div style={styles.main}>
                {leftPanelOpen && (
                    <div style={{ ...styles.leftPanel, width: leftPanelWidth, minWidth: leftPanelWidth, maxWidth: leftPanelWidth }}>
                        <LeftColumn />
                        <div
                            data-testid="left-width-handle"
                            className="rokdock-resize-handle"
                            style={styles.leftWidthHandle}
                            onMouseDown={startWidthDrag}
                        />
                    </div>
                )}
                <div style={styles.center}>
                    <SplitTerminalContainer />
                    {aiConfigured && aiChatDock === 'middle' && (
                        <>
                            {aiChatOpen && (
                                <div
                                    data-testid="ai-chat-drawer-divider"
                                    style={{
                                        width: '100%',
                                        height: 6,
                                        cursor: 'row-resize',
                                        flexShrink: 0,
                                        background: 'transparent',
                                    }}
                                    className="rokdock-resize-handle rokdock-resize-handle--row"
                                    onMouseDown={startDrawerHeightDrag}
                                />
                            )}
                            <div style={{
                                flex: aiChatOpen ? `0 0 ${aiChatDrawerHeight}px` : '0 0 auto',
                                minHeight: 0,
                                overflow: 'hidden',
                                flexShrink: 0,
                                borderTop: '1px solid var(--rokdock-border)',
                            }}>
                                <AiChatPanel />
                            </div>
                        </>
                    )}
                </div>
                {rightPanelOpen && (
                    <div style={{ ...styles.rightPanel, width: rightPanelWidth, minWidth: rightPanelWidth, maxWidth: rightPanelWidth }}>
                        <div
                            data-testid="right-width-handle"
                            className="rokdock-resize-handle rokdock-resize-handle--right"
                            style={styles.rightWidthHandle}
                            onMouseDown={startRightWidthDrag}
                        />
                        <div style={styles.rightPanelContent}>
                            <div style={{ flex: '1 1 0', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                                <RemotePanel
                                    extraSection={aiConfigured && aiChatDock === 'right' ? <AiChatPanel flow /> : undefined}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>
            {addDeviceDialogOpen && <AddDeviceDialog />}
            {settingsDialogOpen && <SettingsDialog />}
            {devicePropertiesDevice && <DevicePropertiesDialog />}
            {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
            {updatesOpen && (
                <UpdatesDialog result={updateResult} onClose={() => setUpdatesOpen(false)} onRetry={runUpdateCheck} />
            )}
            <CaptureFloat />
        </div>
    )
}

/**
 * Builds the static inline style map for the App shell. Styles cover the
 * outermost container (background gradient, font), the horizontal main row,
 * the left/right panel columns with their collapse-overlay shadows, and the
 * center flex region. All color/font values use CSS custom properties so the
 * styles object is stable across theme changes.
 *
 * @returns A record mapping layout element names to React CSSProperties.
 */
function buildStyles(): Record<string, React.CSSProperties> {
    return {
        container: {
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            height: '100%',
            background: `
                radial-gradient(1200px 700px at 68% -30%, var(--rokdock-bg-gradient-a) 0%, transparent 55%),
                radial-gradient(900px 520px at -12% 95%, var(--rokdock-bg-gradient-b) 0%, transparent 52%),
                var(--rokdock-bg-base)
            `,
            color: 'var(--rokdock-text-primary)',
            fontFamily: 'var(--rokdock-font-ui)'
        },
        main: {
            display: 'flex',
            flex: 1,
            overflow: 'hidden'
        },
        leftPanel: {
            width: 240,
            minWidth: 240,
            maxWidth: 240,
            borderRight: `1px solid var(--rokdock-border)`,
            display: 'flex',
            flexDirection: 'row',
            position: 'relative',
            background: `linear-gradient(180deg, var(--rokdock-left-panel-grad-start) 0%, var(--rokdock-left-panel-grad-end) 100%)`,
            boxShadow: 'var(--rokdock-shadow-panel)'
        },
        center: {
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
        },
        rightPanel: {
            borderLeft: `1px solid var(--rokdock-border)`,
            display: 'flex',
            flexDirection: 'row',
            position: 'relative',
            background: `linear-gradient(180deg, var(--rokdock-bg-panel) 0%, var(--rokdock-bg-surface) 100%)`,
            boxShadow: 'var(--rokdock-shadow-panel-right)'
        },
        rightPanelContent: {
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            paddingLeft: 3
        },
        leftWidthHandle: {
            position: 'absolute',
            top: 0,
            right: 0,
            width: 6,
            height: '100%',
            cursor: 'col-resize',
            zIndex: 6,
        },
        rightWidthHandle: {
            position: 'absolute',
            top: 0,
            left: 0,
            width: 6,
            height: '100%',
            cursor: 'col-resize',
            zIndex: 6,
        },
    }
}

/** Static App shell styles, computed once (all values are CSS custom properties). */
const appStyles = buildStyles()
