/**
 * Application settings dialog with tabbed navigation.
 *
 * Tabs:
 *  - Appearance: theme mode (light/system/dark), UI scale, color tint, and the
 *    shared Code (font, syntax theme) and Terminal (tab label format) sections.
 *  - Devices: Telnet port definitions (label, port number, color, enabled),
 *    SSDP discovery tuning, and the configured-devices list.
 *  - Remote: keyboard bindings for each Roku remote button. Each action maps
 *    to a KeyboardEvent.code. Import/export as JSON for sharing across machines.
 *  - Deeplinks: manage saved deeplink entries (also shown read-only in the
 *    right-panel DeeplinksPanel).
 *  - Capture: screenshot folder and filename format, plus the live HDMI capture
 *    device, aspect ratio, and idle timeout.
 *  - AI (Beta): AI provider profiles (one active), per-profile redaction, and a
 *    Test Connection that exercises the real engine.
 *  - Advanced: dev-app poll interval and configuration reset.
 *
 * The active tab is seeded from appStore (settingsDefaultTab) so callers can
 * open the dialog on a specific tab. All preference changes write through to
 * appStore, which persists them via IPC to the main-process store.
 *
 * Uses rokdock-controls web component wrappers (RokdockToggle, RokdockSelect,
 * CollapsibleSettingsSection) for consistent UI.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { IDENTITY_TINT, type Tint } from '@shared/colorTint'
import type { AppearanceDraft } from '@shared/appearanceDraft'
import { useAppStore, PortConfig, DeeplinkConfig, DeeplinkParam, SettingsTab, TabLabelMode, Device } from '../store/appStore'
import { useShallow } from 'zustand/react/shallow'
import {
    REMOTE_ACTIONS,
    DEFAULT_REMOTE_KEY_BINDINGS,
    formatKeyCodeLabel,
    normalizeRemoteKeyBindings
} from '../constants/remoteKeyBindings'
import ConfirmDialog from './common/confirmDialog'
import DialogFrame from './common/dialogFrame'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronRight, faPlus, faXmark, faFileImport, faFileExport } from '@fortawesome/free-solid-svg-icons'
import type { CSSProperties } from 'react'

// Static style objects with no theme dependency (no CSS vars needed).
const FIELD_STYLE: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 }
const SMALL_BTN_STYLE: CSSProperties = {
    width: 22,
    height: 22,
    border: 'none',
    borderRadius: 'var(--rokdock-radius-sm)',
    background: 'transparent',
    color: 'var(--rokdock-text-dim)',
    fontSize: 11,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
}
const DIALOG_CLOSE_BTN_STYLE: CSSProperties = {
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
const RESET_CHECKBOX_LABEL_STYLE: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 'var(--rokdock-font-sm)', color: 'var(--rokdock-text-dim)' }
const RESET_CHECKBOX_INPUT_STYLE: CSSProperties = { accentColor: 'var(--rokdock-btn-danger)' }

/** Stop all tracks on a MediaStream ref and clear it. No-op if the ref is empty. */
function stopMediaStream(ref: React.MutableRefObject<MediaStream | null>): void {
    if (ref.current) {
        ref.current.getTracks().forEach(track => track.stop())
        ref.current = null
    }
}
import { DEV_APP_POLL_INTERVAL_RANGE, DISCOVERY_REQUEST_TIMEOUT_RANGE, DISCOVERY_SCAN_INTERVAL_RANGE } from '../constants/ui'
import { DEFAULT_SCREENSHOT_NAMING_FORMAT } from '../../shared/toolbarConstants'
import { enumerateVideoInputs, applyCaptureDeviceReconcile } from '../utils/mediaDevices'
import { resolveCaptureDeviceId, planCaptureDeviceReconcile } from '@shared/captureDeviceMatch'
import { generateId } from '@shared/generateId'
import { randomPortColor } from '@shared/ports'
import { RokdockToggle, RokdockSelect, CollapsibleSettingsSection } from './rokdock/wrappers'
import { resolveThemeMode } from '../styles/theme'
import { AppearanceTab } from './settings/appearanceTab'
import { roBot, LOGOTYPE_ASPECT, GLYPH_ASPECT } from './ai/roBotMark'
import {
    resolveSyntaxTheme,
    syntaxPresetForMode,
    type TerminalSyntaxThemePreset,
    type TerminalTokenPalette
} from '../styles/terminalSyntaxThemes'
import { FONT_PRESETS, TERMINAL_THEME_OPTIONS } from './settings/codeAppearanceConstants'
import AiTab from './settings/aiTab'

// Tab order groups app chrome first (Appearance), then the Roku device workflow
// (connect -> control -> launch -> capture), then AI and Advanced as trailing extras.
const SETTINGS_TABS: SettingsTab[] = ['appearance', 'devices', 'remote', 'deeplinks', 'capture', 'ai', 'advanced']

const REMOTE_ACTION_GROUPS: Array<{ label: string; keys: string[] }> = [
    { label: 'Navigation', keys: ['Up', 'Down', 'Left', 'Right', 'Select', 'Back', 'Home'] },
    { label: 'Playback', keys: ['Rev', 'Play', 'Fwd', 'InstantReplay'] },
    { label: 'Audio', keys: ['VolumeUp', 'VolumeDown', 'VolumeMute'] },
    { label: 'System', keys: ['PowerOff', 'Info'] },
]

const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
    appearance: 'Appearance',
    // The AI tab renders the roBot wordmark instead of this text. The string is its accessible name.
    ai: 'roBot (Beta)',
    deeplinks: 'Deeplinks',
    remote: 'Remote',
    devices: 'Devices',
    capture: 'Capture',
    advanced: 'Advanced'
}

/**
 * Returns a CSSProperties object for a range input that sets the custom
 * --range-pct CSS variable used to style the filled track portion.
 */
const rangeStyle = (value: number, min: number, max: number): CSSProperties => ({
    flex: 1,
    ['--range-pct' as string]: `${Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))}%`
} as CSSProperties)

/**
 * Tabbed application settings dialog. All preference edits are held in local
 * draft state until Save is clicked, at which point they are committed to
 * appStore and persisted via IPC. Opening the dialog on a specific tab is
 * controlled by settingsDefaultTab in appStore.
 */
export default function SettingsDialog() {
    // Dialog open/tab state (two primitive scalars, individual selectors are cheapest).
    const settingsDialogOpen = useAppStore(state => state.settingsDialogOpen)
    const settingsDefaultTab = useAppStore(state => state.settingsDefaultTab)
    const settingsDefaultSection = useAppStore(state => state.settingsDefaultSection)

    // Terminal and discovery state grouped with shallow equality so the component
    // only re-renders when one of these values actually changes.
    const {
        storePorts,
        storeDeeplinks,
        storeFontSize,
        storeFontFamily,
        storeTerminalFallbackColor,
        storeTerminalUseThemeBackground,
        storeTerminalSyntaxThemePreset,
        storeTerminalSyntaxThemeCustomColors,
        storeRemoteKeyBindings,
        storeTabLabelMode,
        storeDiscoveryScanIntervalMs,
        storeDiscoveryRequestTimeoutMs,
        storeDevAppPollIntervalMs,
        themeMode,
        appZoomLevel,
        uiFontScale,
        tint,
    } = useAppStore(useShallow(state => ({
        storePorts: state.ports,
        storeDeeplinks: state.deeplinks,
        storeFontSize: state.terminalFontSize,
        storeFontFamily: state.terminalFontFamily,
        storeTerminalFallbackColor: state.terminalFallbackColor,
        storeTerminalUseThemeBackground: state.terminalUseThemeBackground,
        storeTerminalSyntaxThemePreset: state.terminalSyntaxThemePreset,
        storeTerminalSyntaxThemeCustomColors: state.terminalSyntaxThemeCustomColors,
        storeRemoteKeyBindings: state.remoteKeyBindings,
        storeTabLabelMode: state.tabLabelMode,
        storeDiscoveryScanIntervalMs: state.discoveryScanIntervalMs,
        storeDiscoveryRequestTimeoutMs: state.discoveryRequestTimeoutMs,
        storeDevAppPollIntervalMs: state.devAppPollIntervalMs,
        themeMode: state.themeMode,
        appZoomLevel: state.appZoomLevel,
        uiFontScale: state.uiFontScale,
        tint: state.tint,
    })))

    // Devices and capture state grouped with shallow equality.
    const {
        devices,
        captureDeviceId,
        captureDeviceLabel,
        captureAspectRatio,
        captureIdleTimeoutSec,
        screenshotFolder,
        screenshotNamingFormat,
    } = useAppStore(useShallow(state => ({
        devices: state.devices,
        captureDeviceId: state.captureDeviceId,
        captureDeviceLabel: state.captureDeviceLabel,
        captureAspectRatio: state.captureAspectRatio,
        captureIdleTimeoutSec: state.captureIdleTimeoutSec,
        screenshotFolder: state.screenshotFolder,
        screenshotNamingFormat: state.screenshotNamingFormat,
    })))

    // Action setters are stable references in zustand (never change identity),
    // so shallow equality on this group always short-circuits after the first render.
    const {
        setSettingsDialogOpen,
        setPorts,
        setDeeplinks,
        setRemoteKeyBindings,
        setTabLabelMode,
        applyAppearance,
        setDiscoveryScanIntervalMs,
        setDiscoveryRequestTimeoutMs,
        setDevAppPollIntervalMs,
        setAddDeviceDialogOpen,
        setDevicePropertiesDevice,
        saveSettings,
        setCaptureDeviceId,
        setCaptureDevice,
        setCaptureAspectRatio,
        setCaptureIdleTimeoutSec,
        setScreenshotFolder,
        setScreenshotNamingFormat,
    } = useAppStore(useShallow(state => ({
        setSettingsDialogOpen: state.setSettingsDialogOpen,
        setPorts: state.setPorts,
        setDeeplinks: state.setDeeplinks,
        setRemoteKeyBindings: state.setRemoteKeyBindings,
        setTabLabelMode: state.setTabLabelMode,
        applyAppearance: state.applyAppearance,
        setDiscoveryScanIntervalMs: state.setDiscoveryScanIntervalMs,
        setDiscoveryRequestTimeoutMs: state.setDiscoveryRequestTimeoutMs,
        setDevAppPollIntervalMs: state.setDevAppPollIntervalMs,
        setAddDeviceDialogOpen: state.setAddDeviceDialogOpen,
        setDevicePropertiesDevice: state.setDevicePropertiesDevice,
        saveSettings: state.saveSettings,
        setCaptureDeviceId: state.setCaptureDeviceId,
        setCaptureDevice: state.setCaptureDevice,
        setCaptureAspectRatio: state.setCaptureAspectRatio,
        setCaptureIdleTimeoutSec: state.setCaptureIdleTimeoutSec,
        setScreenshotFolder: state.setScreenshotFolder,
        setScreenshotNamingFormat: state.setScreenshotNamingFormat,
    })))

    const [activeTab, setActiveTab] = useState<SettingsTab>('appearance')
    const [localPorts, setLocalPorts] = useState<PortConfig[]>([])
    const [localDeeplinks, setLocalDeeplinks] = useState<DeeplinkConfig[]>([])
    const [localFontSize, setLocalFontSize] = useState(13)
    const [localFontFamily, setLocalFontFamily] = useState('')
    const [localTerminalFallbackColor, setLocalTerminalFallbackColor] = useState('#e0e0e0')
    const [localTerminalUseThemeBackground, setLocalTerminalUseThemeBackground] = useState(false)
    const [localTerminalSyntaxThemePreset, setLocalTerminalSyntaxThemePreset] = useState<TerminalSyntaxThemePreset>('rokdockDark')
    const [localTerminalSyntaxThemeCustomColors, setLocalTerminalSyntaxThemeCustomColors] = useState<Partial<TerminalTokenPalette>>({})
    // Appearance fields are a save-gated draft (like the tool-window modal): edits
    // preview live but persist only on Save, and revert on Cancel/close.
    const [localThemeMode, setLocalThemeMode] = useState<'dark' | 'light' | 'system'>('dark')
    const [localZoomLevel, setLocalZoomLevel] = useState(0)
    const [localFontScale, setLocalFontScale] = useState(0)
    const [localTint, setLocalTint] = useState<Tint>(IDENTITY_TINT)
    const [localTabLabelMode, setLocalTabLabelMode] = useState<TabLabelMode>('displayName')
    const [localDiscoveryScanIntervalMs, setLocalDiscoveryScanIntervalMs] = useState(60000)
    const [localDiscoveryRequestTimeoutMs, setLocalDiscoveryRequestTimeoutMs] = useState(5000)
    const [localDevAppPollIntervalMs, setLocalDevAppPollIntervalMs] = useState(3000)
    const [localRemoteKeyBindings, setLocalRemoteKeyBindings] = useState<Record<string, string>>({
        ...DEFAULT_REMOTE_KEY_BINDINGS
    })
    const [authByIp, setAuthByIp] = useState<Record<string, boolean>>({})
    const [fontPickerMode, setFontPickerMode] = useState<'preset' | 'custom'>('preset')
    const [expandedDeeplinks, setExpandedDeeplinks] = useState<Set<string>>(new Set())
    const [showResetConfirm, setShowResetConfirm] = useState(false)
    const [resetDeleteDeeplinks, setResetDeleteDeeplinks] = useState(false)
    const [resetDeleteScripts, setResetDeleteScripts] = useState(false)
    const [resetScreenshotFolder, setResetScreenshotFolder] = useState(false)
    const [pendingDeviceDelete, setPendingDeviceDelete] = useState<{ id: string; name: string; ip: string } | null>(null)
    const [captureDevices, setCaptureDevices] = useState<Array<{ deviceId: string; label: string }>>([])
    // The absolute folder screenshots land in when no custom folder is set, shown so the user
    // knows where their files go and so Browse can open into it. Static per install; fetched once.
    const [defaultScreenshotFolder, setDefaultScreenshotFolder] = useState('')

    useEffect(() => {
        window.rokdock.store.getDefaultScreenshotFolder().then(setDefaultScreenshotFolder).catch(() => {})
    }, [])

    useEffect(() => {
        if (settingsDialogOpen) {
            setActiveTab(settingsDefaultTab)
            setLocalPorts(structuredClone(storePorts))
            setLocalDeeplinks(structuredClone(storeDeeplinks))
            setLocalFontSize(storeFontSize)
            setLocalFontFamily(storeFontFamily)
            setLocalTerminalFallbackColor(storeTerminalFallbackColor)
            setLocalTerminalUseThemeBackground(storeTerminalUseThemeBackground)
            setLocalTerminalSyntaxThemePreset(storeTerminalSyntaxThemePreset === 'custom' ? 'rokdockDark' : storeTerminalSyntaxThemePreset)
            setLocalTerminalSyntaxThemeCustomColors(storeTerminalSyntaxThemeCustomColors)
            setLocalThemeMode(themeMode)
            setLocalZoomLevel(appZoomLevel)
            setLocalFontScale(uiFontScale)
            setLocalTint(tint)
            setLocalTabLabelMode(storeTabLabelMode)
            setLocalDiscoveryScanIntervalMs(storeDiscoveryScanIntervalMs)
            setLocalDiscoveryRequestTimeoutMs(storeDiscoveryRequestTimeoutMs)
            setLocalDevAppPollIntervalMs(storeDevAppPollIntervalMs)
            setLocalRemoteKeyBindings(normalizeRemoteKeyBindings(storeRemoteKeyBindings))
            setFontPickerMode('preset')
        }
    // Seed the local draft and the active tab only on the open transition (and when
    // a deeplink changes the requested tab). Intentionally NOT keyed on the store
    // values it reads: re-running while the dialog is open would both reset the
    // active tab (e.g. changing the theme adjusts terminalFallbackColor, which used
    // to bounce you back to the entry tab) and clobber in-progress edits. Seeding
    // from the store at open time is the intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settingsDialogOpen, settingsDefaultTab])

    useEffect(() => {
        if (!settingsDialogOpen) return
        let cancelled = false
        const loadAuthMap = async (ips?: string[]) => {
            const sourceIps = ips ?? Array.from(new Set(devices.map(device => device.ip).filter(Boolean)))
            if (sourceIps.length === 0) {
                if (!cancelled) setAuthByIp({})
                return
            }
            const entries = await Promise.all(sourceIps.map(async (ip) => {
                try {
                    const auth = await window.rokdock.store.getDeviceAuth(ip)
                    return [ip, !!(auth?.username && auth?.password)] as const
                } catch {
                    return [ip, false] as const
                }
            }))
            if (!cancelled) {
                setAuthByIp(prev => ({ ...prev, ...Object.fromEntries(entries) }))
            }
        }
        void loadAuthMap()
        const onAuthUpdated = (event: CustomEvent<{ ip?: string }>) => {
            const detail = event.detail
            const ip = detail?.ip
            if (ip) {
                void loadAuthMap([ip])
            } else {
                void loadAuthMap()
            }
        }
        window.addEventListener('rokdock:device-auth-updated', onAuthUpdated as EventListener)
        return () => {
            cancelled = true
            window.removeEventListener('rokdock:device-auth-updated', onAuthUpdated as EventListener)
        }
    }, [settingsDialogOpen, devices])

    useEffect(() => {
        if (activeTab !== 'capture') return
        const enumerate = async () => {
            try {
                setCaptureDevices(await enumerateVideoInputs())
            } catch {
                setCaptureDevices([])
            }
        }
        void enumerate()
        navigator.mediaDevices.addEventListener('devicechange', enumerate)
        return () => navigator.mediaDevices.removeEventListener('devicechange', enumerate)
    }, [activeTab])


    // Capture device preview in settings
    const capturePreviewRef = useRef<HTMLVideoElement>(null)
    const captureStreamRef = useRef<MediaStream | null>(null)

    // The remembered device's deviceId is re-salted per session, so the stored id may be
    // stale even when the same physical device is present. Resolve it (by id, then by the
    // stable label) to the current-session id. The dropdown and preview key off the
    // resolved id so a re-salted device is still selectable and a genuinely gone one
    // cleanly shows the placeholder with no dead preview.
    const resolvedCaptureDeviceId = resolveCaptureDeviceId(captureDevices, captureDeviceId, captureDeviceLabel)
    const captureDeviceAvailable = resolvedCaptureDeviceId != null

    // Keep the persisted selection current: refresh the stored volatile id after a
    // re-salt, backfill a missing label, or drop the id when the device is truly gone
    // (the stable label is kept so it reconnects if it returns).
    useEffect(() => {
        applyCaptureDeviceReconcile(
            planCaptureDeviceReconcile(captureDevices, captureDeviceId, captureDeviceLabel),
            setCaptureDevice,
            setCaptureDeviceId
        )
    }, [captureDevices, captureDeviceId, captureDeviceLabel, setCaptureDevice, setCaptureDeviceId])

    useEffect(() => {
        if (activeTab !== 'capture' || !resolvedCaptureDeviceId) {
            stopMediaStream(captureStreamRef)
            if (capturePreviewRef.current) {
                capturePreviewRef.current.srcObject = null
            }
            return
        }

        let cancelled = false

        const startPreview = async () => {
            // Stop any existing stream first
            stopMediaStream(captureStreamRef)

            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { deviceId: { exact: resolvedCaptureDeviceId }, width: { exact: 1920 }, height: { exact: 1080 } },
                    audio: false
                })
                if (cancelled) {
                    stream.getTracks().forEach(track => track.stop())
                    return
                }
                captureStreamRef.current = stream
                if (capturePreviewRef.current) {
                    capturePreviewRef.current.srcObject = stream
                }
            } catch {
                // Device unavailable - preview stays blank
            }
        }

        startPreview()

        return () => {
            cancelled = true
            stopMediaStream(captureStreamRef)
        }
    }, [activeTab, resolvedCaptureDeviceId])

    // Computed before the early return so the hook runs unconditionally (rules-of-hooks).
    const previewSyntaxTheme = useMemo(
        () => resolveSyntaxTheme(localTerminalSyntaxThemePreset, resolveThemeMode(localThemeMode), localTerminalSyntaxThemeCustomColors),
        [localTerminalSyntaxThemeCustomColors, localTerminalSyntaxThemePreset, localThemeMode]
    )

    if (!settingsDialogOpen) return null

    /**
     * Builds the full appearance draft from the current local appearance state,
     * with an optional one-field patch overriding it. Used both to preview a single
     * change and to assemble the draft to sync the store on Save.
     */
    const buildAppearanceDraft = (patch: Partial<AppearanceDraft> = {}): AppearanceDraft => ({
        themeMode: localThemeMode,
        appZoomLevel: localZoomLevel,
        uiFontScale: localFontScale,
        tint: localTint,
        fontFamily: localFontFamily,
        fontSize: localFontSize,
        syntaxPreset: localTerminalSyntaxThemePreset,
        syntaxCustom: localTerminalSyntaxThemeCustomColors as Record<string, string>,
        useThemeBackground: localTerminalUseThemeBackground,
        fallbackColor: localTerminalFallbackColor,
        ...patch,
    })

    /** Previews a one-field appearance change live across all windows (no persist). */
    const previewAppearance = (patch: Partial<AppearanceDraft>): void =>
        window.rokdock.appearance.previewDraft(buildAppearanceDraft(patch))

    /**
     * Discards the appearance preview and closes. Main rebroadcasts the persisted
     * appearance (via the appearance-applied broadcast the store mirrors), reverting
     * the preview. The non-appearance local drafts are dropped by never committing.
     */
    const handleClose = () => {
        window.rokdock.appearance.clearPreview()
        setSettingsDialogOpen(false)
    }

    /**
     * Commits the local drafts and persists via IPC. applyAppearance syncs the store
     * appearance from the draft so saveSettings persists the edited values. The
     * non-appearance drafts are committed directly, then the preview override is
     * cleared (main rebroadcasts the now-saved appearance) and the dialog closes.
     */
    const handleSave = async () => {
        setPorts(localPorts)
        setDeeplinks(localDeeplinks)
        setRemoteKeyBindings(localRemoteKeyBindings)
        setTabLabelMode(localTabLabelMode)
        setDiscoveryScanIntervalMs(localDiscoveryScanIntervalMs)
        setDiscoveryRequestTimeoutMs(localDiscoveryRequestTimeoutMs)
        setDevAppPollIntervalMs(localDevAppPollIntervalMs)
        applyAppearance(buildAppearanceDraft())
        await saveSettings()
        window.rokdock.appearance.clearPreview()
        setSettingsDialogOpen(false)
    }

    /**
     * Returns the resolved hex color for a given token kind in the currently
     * previewed syntax theme, falling back to the fallback text color when no
     * theme is selected.
     */
    const previewColor = (kind: keyof TerminalTokenPalette): string => {
        if (localTerminalSyntaxThemePreset === 'none') return localTerminalFallbackColor
        return previewSyntaxTheme.colors[kind] ?? localTerminalFallbackColor
    }

    /**
     * Resets app configuration to defaults, optionally also deleting saved
     * deeplinks, scripts, and the custom screenshot folder, then reloads the
     * renderer.
     */
    const handleResetConfig = async () => {
        const folderToRestore = resetScreenshotFolder ? null : screenshotFolder
        await window.rokdock.store.resetConfig()
        if (resetDeleteDeeplinks) await window.rokdock.deeplinks.saveAll([])
        if (resetDeleteScripts) await window.rokdock.scriptEditor.deleteAll()
        if (folderToRestore) await window.rokdock.store.setPreferences({ screenshotFolder: folderToRestore })
        // resetConfig (awaited above) already reverted the appearance on every window
        // from the main side, so the renderer does not need to clear its own preview.
        window.location.reload()
    }

    const handleAddPort = () => {
        setLocalPorts([...localPorts, { port: 0, label: '', color: randomPortColor(), enabled: true }])
    }

    const handleRemovePort = (idx: number) => {
        setLocalPorts(localPorts.filter((_, i) => i !== idx))
    }

    const handlePortChange = (idx: number, field: keyof PortConfig, value: string | number | boolean) => {
        const updated = [...localPorts]
        updated[idx] = { ...updated[idx], [field]: value }
        setLocalPorts(updated)
    }

    /**
     * Opens a JSON file picker and imports deeplink entries from an exported
     * RokuDeepLinking JSON file, appending them to the current local list.
     */
    const handleImportDeeplinks = async () => {
        const content = await window.rokdock.dialog.openJsonFile()
        if (!content) return
        let parsed: unknown
        try { parsed = JSON.parse(content) } catch { return }
        const channels = (parsed as { channels?: unknown[] })?.channels
        if (!Array.isArray(channels)) return
        const imported: DeeplinkConfig[] = []
        for (const channelEntry of channels) {
            const channel = channelEntry as { id?: string; options?: unknown[] }
            const appId = String(channel.id ?? 'dev')
            const options = Array.isArray(channel.options) ? channel.options : []
            for (const optionEntry of options) {
                const option = optionEntry as { name?: string; launchChannelMode?: string; params?: { key?: string; value?: string }[] }
                const params = Array.isArray(option.params) ? option.params : []
                const mediaType = params.find(param => param.key === 'mediaType')?.value ?? ''
                const contentId = params.find(param => param.key === 'contentId')?.value ?? ''
                const extraParams = params
                    .filter(param => param.key && param.key !== 'mediaType' && param.key !== 'contentId')
                    .map(param => ({ key: param.key ?? '', value: param.value ?? '' }))
                imported.push({
                    id: generateId(),
                    name: String(option.name ?? ''),
                    type: 'launch',
                    appId,
                    mediaType,
                    contentId,
                    extraParams
                })
            }
        }
        if (imported.length > 0) setLocalDeeplinks([...localDeeplinks, ...imported])
    }

    /**
     * Serialises the current deeplink list to the RokuDeepLinking JSON format
     * and prompts the user to save it as a timestamped .json file.
     */
    const handleExportDeeplinks = async () => {
        if (localDeeplinks.length === 0) return
        const channelMap = new Map<string, { id: string; name: string; options: unknown[] }>()
        for (const deeplink of localDeeplinks) {
            const appId = deeplink.appId || 'dev'
            if (!channelMap.has(appId)) {
                channelMap.set(appId, { id: appId, name: appId, options: [] })
            }
            const params: { key: string; value: string }[] = []
            if (deeplink.mediaType) params.push({ key: 'mediaType', value: deeplink.mediaType })
            if (deeplink.contentId) params.push({ key: 'contentId', value: deeplink.contentId })
            for (const param of deeplink.extraParams) {
                if (param.key) params.push({ key: param.key, value: param.value })
            }
            channelMap.get(appId)!.options.push({
                name: deeplink.name,
                launchChannelMode: 'launch',
                params
            })
        }
        const payload = JSON.stringify({ channels: Array.from(channelMap.values()) }, null, 2)
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        await window.rokdock.dialog.saveJson(`RokuDeepLinking_${ts}.json`, payload)
    }

    const handleAddDeeplink = () => {
        const id = generateId()
        setLocalDeeplinks([...localDeeplinks, {
            id,
            name: '',
            type: 'launch',
            appId: 'dev',
            mediaType: '',
            contentId: '',
            extraParams: []
        }])
        setExpandedDeeplinks(prev => new Set(prev).add(id))
    }

    const handleRemoveDeeplink = (idx: number) => {
        setLocalDeeplinks(localDeeplinks.filter((_, i) => i !== idx))
    }

    const handleDeeplinkChange = (idx: number, field: string, value: string) => {
        const updated = [...localDeeplinks]
        updated[idx] = { ...updated[idx], [field]: value }
        setLocalDeeplinks(updated)
    }

    const handleAddParam = (deeplinkIndex: number) => {
        const updated = [...localDeeplinks]
        updated[deeplinkIndex] = {
            ...updated[deeplinkIndex],
            extraParams: [...updated[deeplinkIndex].extraParams, { key: '', value: '' }]
        }
        setLocalDeeplinks(updated)
    }

    const handleRemoveParam = (deeplinkIndex: number, paramIndex: number) => {
        const updated = [...localDeeplinks]
        updated[deeplinkIndex] = {
            ...updated[deeplinkIndex],
            extraParams: updated[deeplinkIndex].extraParams.filter((_, i) => i !== paramIndex)
        }
        setLocalDeeplinks(updated)
    }

    const configuredDevices = [...devices]
        .filter(device => device.configured || device.hasAuth || !!authByIp[device.ip])
        .sort((deviceA, deviceB) => deviceA.name.localeCompare(deviceB.name))

    const handleParamChange = (deeplinkIndex: number, paramIndex: number, field: 'key' | 'value', val: string) => {
        const updated = [...localDeeplinks]
        const params = [...updated[deeplinkIndex].extraParams]
        params[paramIndex] = { ...params[paramIndex], [field]: val }
        updated[deeplinkIndex] = { ...updated[deeplinkIndex], extraParams: params }
        setLocalDeeplinks(updated)
    }

    const styles = STYLES

    return (
        <DialogFrame
            open={settingsDialogOpen}
            onClose={handleClose}
            dialogStyle={styles.dialog}
        >
            <div className="rokdock-dialog-header">
                <span className="rokdock-title">Settings</span>
                <button style={DIALOG_CLOSE_BTN_STYLE} onClick={handleClose}><FontAwesomeIcon icon={faXmark} /></button>
            </div>
            <div style={styles.tabs}>
                {SETTINGS_TABS.map(tab => (
                    <button
                        type="button"
                        key={tab}
                        // The AI tab shows the roBot brand wordmark in place of the "AI" text. The
                        // wordmark SVG is decorative (aria-hidden), so the button carries the name.
                        aria-label={tab === 'ai' ? SETTINGS_TAB_LABELS.ai : undefined}
                        style={{
                            ...styles.tab,
                            ...(activeTab === tab ? styles.tabActive : {})
                        }}
                        onClick={() => setActiveTab(tab)}
                    >
                        {tab === 'ai'
                            ? (
                                // Compose the mark from its parts and size it in em so "roBot" sits at
                                // the same scale as the other tab labels (the baked wordmark ties the
                                // icon and text at a fixed ratio, leaving the text off-scale here). Use
                                // inline flow with vertical-align so "roBot" and "(Beta)" share the text
                                // baseline. The icon (1em) is centered on the caps via a small offset.
                                <span>
                                    <roBot.Glyph style={{ height: '1em', width: `${GLYPH_ASPECT}em`, verticalAlign: '-0.15em', marginRight: '0.2em' }} />
                                    <roBot.Logotype style={{ height: '0.8em', width: `${0.8 * LOGOTYPE_ASPECT}em`, verticalAlign: 'baseline' }} />
                                    <span style={{ marginLeft: '0.25em', fontSize: '0.62em', verticalAlign: 'super', textTransform: 'uppercase', letterSpacing: '0.04em' }}>(Beta)</span>
                                </span>
                            )
                            : SETTINGS_TAB_LABELS[tab]}
                    </button>
                ))}
            </div>
            <div style={styles.body}>
                {activeTab === 'ai' && (
                    <div style={styles.section}>
                        <AiTab />
                    </div>
                )}
                    {activeTab === 'devices' && (
                    <div style={styles.section}>
                        <div style={styles.compactControlList}>
                            {localPorts.map((port, idx) => (
                                <div key={idx} style={styles.portRow}>
                                    <input
                                        type="color"
                                        value={port.color}
                                        onChange={e => handlePortChange(idx, 'color', e.target.value)}
                                        style={styles.colorInput}
                                        title="Port color"
                                    />
                                    <input
                                        className="rokdock-input" style={{ width: 76, boxSizing: 'border-box' as const, MozAppearance: 'textfield' as const }}
                                        type="number"
                                        value={port.port || ''}
                                        onChange={e => handlePortChange(idx, 'port', parseInt(e.target.value) || 0)}
                                        placeholder="Port"
                                    />
                                    <input
                                        className="rokdock-input" style={{ flex: 1 }}
                                        type="text"
                                        value={port.label}
                                        onChange={e => handlePortChange(idx, 'label', e.target.value)}
                                        placeholder="Display name"
                                    />
                                    <RokdockToggle
                                        checked={port.enabled}
                                        onChange={({ checked }) => handlePortChange(idx, 'enabled', checked)}
                                    />
                                    <button style={SMALL_BTN_STYLE} onClick={() => handleRemovePort(idx)}><FontAwesomeIcon icon={faXmark} /></button>
                                </div>
                            ))}
                        </div>
                        <button style={styles.addItemBtn} onClick={handleAddPort}>+ Add Port</button>

                        <CollapsibleSettingsSection label="Discovery" gap={10} padding="10px 14px 10px 14px">
                            <div style={FIELD_STYLE}>
                                <label className="rokdock-label">Scan Interval: {Math.round(localDiscoveryScanIntervalMs / 1000)}s</label>
                                <div style={styles.colorRow}>
                                    <span className="rokdock-hint">{Math.round(DISCOVERY_SCAN_INTERVAL_RANGE.min / 1000)}s</span>
                                    <input
                                        className="settings-range"
                                        type="range"
                                        min={DISCOVERY_SCAN_INTERVAL_RANGE.min}
                                        max={DISCOVERY_SCAN_INTERVAL_RANGE.max}
                                        step={DISCOVERY_SCAN_INTERVAL_RANGE.step}
                                        value={localDiscoveryScanIntervalMs}
                                        onChange={e => setLocalDiscoveryScanIntervalMs(parseInt(e.target.value))}
                                        style={rangeStyle(localDiscoveryScanIntervalMs, DISCOVERY_SCAN_INTERVAL_RANGE.min, DISCOVERY_SCAN_INTERVAL_RANGE.max)}
                                    />
                                    <span className="rokdock-hint">{Math.round(DISCOVERY_SCAN_INTERVAL_RANGE.max / 1000)}s</span>
                                </div>
                            </div>
                            <div style={FIELD_STYLE}>
                                <label className="rokdock-label">Request Timeout: {Math.round(localDiscoveryRequestTimeoutMs)}ms</label>
                                <div style={styles.colorRow}>
                                    <span className="rokdock-hint">{DISCOVERY_REQUEST_TIMEOUT_RANGE.min}</span>
                                    <input
                                        className="settings-range"
                                        type="range"
                                        min={DISCOVERY_REQUEST_TIMEOUT_RANGE.min}
                                        max={DISCOVERY_REQUEST_TIMEOUT_RANGE.max}
                                        step={DISCOVERY_REQUEST_TIMEOUT_RANGE.step}
                                        value={localDiscoveryRequestTimeoutMs}
                                        onChange={e => setLocalDiscoveryRequestTimeoutMs(parseInt(e.target.value))}
                                        style={rangeStyle(localDiscoveryRequestTimeoutMs, DISCOVERY_REQUEST_TIMEOUT_RANGE.min, DISCOVERY_REQUEST_TIMEOUT_RANGE.max)}
                                    />
                                    <span className="rokdock-hint">{DISCOVERY_REQUEST_TIMEOUT_RANGE.max}</span>
                                </div>
                            </div>
                            <span className="rokdock-hint">Tune SSDP scan cadence and discovery request timeout.</span>
                        </CollapsibleSettingsSection>

                        <CollapsibleSettingsSection
                            label="Configured Devices"
                            gap={8}
                            padding="10px 14px 10px 14px"
                            actions={
                                <button style={styles.addConfiguredBtn} onClick={() => { handleClose(); setAddDeviceDialogOpen(true) }}>
                                    <FontAwesomeIcon icon={faPlus} /> Add
                                </button>
                            }
                        >
                            {configuredDevices.length === 0 ? (
                                <span style={styles.localHint}>No configured devices.</span>
                            ) : (
                                <div style={styles.manualList}>
                                    {configuredDevices.map(device => (
                                        <div key={device.id} style={styles.manualRow}>
                                            <ConfiguredDeviceRow
                                                device={device}
                                                styles={styles}
                                                smallBtnStyle={SMALL_BTN_STYLE}
                                                isManualState={!!device.configured}
                                                isAuthSaved={!!(authByIp[device.ip] || device.hasAuth)}
                                                onOpenProperties={() => setDevicePropertiesDevice(device)}
                                                onRemove={() => setPendingDeviceDelete({ id: device.id, name: device.name, ip: device.ip })}
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CollapsibleSettingsSection>
                    </div>
                )}
                {activeTab === 'deeplinks' && (
                    <div style={styles.section}>
                        {localDeeplinks.map((deeplink, dlIdx) => (
                            <div key={deeplink.id} style={styles.deeplinkCard}>
                                <div
                                    style={styles.deeplinkHeader}
                                    onClick={() => setExpandedDeeplinks(prev => {
                                        const next = new Set(prev)
                                        next.has(deeplink.id) ? next.delete(deeplink.id) : next.add(deeplink.id)
                                        return next
                                    })}
                                >
                                    <span style={{
                                        ...styles.deeplinkChevron,
                                        transform: expandedDeeplinks.has(deeplink.id) ? 'rotate(90deg)' : 'rotate(0deg)'
                                    }}><FontAwesomeIcon icon={faChevronRight} /></span>
                                    <span style={styles.deeplinkTitle}>{deeplink.name || 'Untitled'}</span>
                                    <button style={SMALL_BTN_STYLE} onClick={(e) => { e.stopPropagation(); handleRemoveDeeplink(dlIdx) }}><FontAwesomeIcon icon={faXmark} /></button>
                                </div>
                                {expandedDeeplinks.has(deeplink.id) && (
                                    <div style={styles.deeplinkBody}>
                                        <div style={styles.fieldRow}>
                                            <div style={{ ...FIELD_STYLE, flex: 1 }}>
                                                <label className="rokdock-label">Display Name</label>
                                                <input
                                                    className="rokdock-input"
                                                    type="text"
                                                    value={deeplink.name}
                                                    onChange={e => handleDeeplinkChange(dlIdx, 'name', e.target.value)}
                                                    placeholder="My Deeplink"
                                                />
                                            </div>
                                            <div style={{ ...FIELD_STYLE, width: 90 }}>
                                                <label className="rokdock-label">Type</label>
                                                <RokdockSelect
                                                    value={deeplink.type || 'launch'}
                                                    onChange={value => handleDeeplinkChange(dlIdx, 'type', value)}
                                                    style={{ width: '100%' }}
                                                >
                                                    <option value="launch">Launch</option>
                                                    <option value="input">Input</option>
                                                </RokdockSelect>
                                            </div>
                                        </div>
                                        {(deeplink.type || 'launch') === 'launch' && (
                                            <div style={styles.fieldRow}>
                                                <div style={{ ...FIELD_STYLE, flex: 1 }}>
                                                    <label className="rokdock-label">App ID</label>
                                                    <input
                                                        className="rokdock-input"
                                                        type="text"
                                                        value={deeplink.appId || 'dev'}
                                                        onChange={e => handleDeeplinkChange(dlIdx, 'appId', e.target.value)}
                                                        placeholder="dev"
                                                    />
                                                </div>
                                            </div>
                                        )}
                                        <div style={styles.fieldRow}>
                                            <div style={{ ...FIELD_STYLE, flex: 1 }}>
                                                <label className="rokdock-label">Media Type</label>
                                                <input
                                                    className="rokdock-input"
                                                    type="text"
                                                    value={deeplink.mediaType}
                                                    onChange={e => handleDeeplinkChange(dlIdx, 'mediaType', e.target.value)}
                                                    placeholder="mediaType"
                                                />
                                            </div>
                                            <div style={{ ...FIELD_STYLE, flex: 1 }}>
                                                <label className="rokdock-label">Content ID</label>
                                                <input
                                                    className="rokdock-input"
                                                    type="text"
                                                    value={deeplink.contentId}
                                                    onChange={e => handleDeeplinkChange(dlIdx, 'contentId', e.target.value)}
                                                    placeholder="contentID"
                                                />
                                            </div>
                                        </div>
                                        {deeplink.extraParams.map((param: DeeplinkParam, pIdx: number) => (
                                            <div key={pIdx} style={styles.fieldRow}>
                                                <input
                                                    className="rokdock-input" style={{ flex: 1 }}
                                                    type="text"
                                                    value={param.key}
                                                    onChange={e => handleParamChange(dlIdx, pIdx, 'key', e.target.value)}
                                                    placeholder="Key"
                                                />
                                                <input
                                                    className="rokdock-input" style={{ flex: 1 }}
                                                    type="text"
                                                    value={param.value}
                                                    onChange={e => handleParamChange(dlIdx, pIdx, 'value', e.target.value)}
                                                    placeholder="Value"
                                                />
                                                <button style={SMALL_BTN_STYLE} onClick={() => handleRemoveParam(dlIdx, pIdx)}><FontAwesomeIcon icon={faXmark} /></button>
                                            </div>
                                        ))}
                                        <button style={styles.addItemBtn} onClick={() => handleAddParam(dlIdx)}>+ Add Parameter</button>
                                    </div>
                                )}
                            </div>
                        ))}
                        <div style={styles.deeplinkActions}>
                            <button style={styles.addItemBtn} onClick={handleAddDeeplink}>+ Add Deeplink</button>
                            <div style={{ display: 'flex', gap: 6 }}>
                                <button className="rokdock-btn rokdock-btn-ghost" style={styles.deeplinkActionBtn} onClick={handleImportDeeplinks}>
                                    <FontAwesomeIcon icon={faFileImport} /> Import
                                </button>
                                <button className="rokdock-btn rokdock-btn-ghost" style={{ ...styles.deeplinkActionBtn, opacity: localDeeplinks.length === 0 ? 0.4 : 1 }} onClick={handleExportDeeplinks} disabled={localDeeplinks.length === 0}>
                                    <FontAwesomeIcon icon={faFileExport} /> Export
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                {activeTab === 'appearance' && (
                    <div style={styles.section}>
                        <AppearanceTab
                            context={{ surfaces: { terminal: true, code: true } }}
                            initialSection={settingsDefaultSection}
                            themeMode={localThemeMode}
                            onThemeMode={(mode) => {
                                const nextPreset = syntaxPresetForMode(localTerminalSyntaxThemePreset, resolveThemeMode(mode))
                                setLocalThemeMode(mode)
                                setLocalTerminalSyntaxThemePreset(nextPreset)
                                previewAppearance({ themeMode: mode, syntaxPreset: nextPreset })
                            }}
                            uiFontScale={localFontScale}
                            onUiFontScale={(px) => { setLocalFontScale(px); previewAppearance({ uiFontScale: px }) }}
                            tint={localTint}
                            onTint={(nextTint) => { setLocalTint(nextTint); previewAppearance({ tint: nextTint }) }}
                            codeProps={{
                                fieldStyle: FIELD_STYLE,
                                smallBtnStyle: SMALL_BTN_STYLE,
                                sectionStyle: styles.section,
                                colorRowStyle: styles.colorRow,
                                colorInputStyle: styles.colorInput,
                                fontPresets: FONT_PRESETS,
                                terminalThemeOptions: TERMINAL_THEME_OPTIONS,
                                fontPickerMode, setFontPickerMode,
                                localFontFamily,
                                setLocalFontFamily: (value: string) => { setLocalFontFamily(value); previewAppearance({ fontFamily: value }) },
                                localFontSize,
                                setLocalFontSize: (value: number) => { setLocalFontSize(value); previewAppearance({ fontSize: value }) },
                                localSyntaxPreset: localTerminalSyntaxThemePreset,
                                setLocalSyntaxPreset: (value) => { setLocalTerminalSyntaxThemePreset(value); previewAppearance({ syntaxPreset: value }) },
                                localUseThemeBackground: localTerminalUseThemeBackground,
                                setLocalUseThemeBackground: (value: boolean) => { setLocalTerminalUseThemeBackground(value); previewAppearance({ useThemeBackground: value }) },
                                localFallbackColor: localTerminalFallbackColor,
                                setLocalFallbackColor: (value: string) => { setLocalTerminalFallbackColor(value); previewAppearance({ fallbackColor: value }) },
                                previewSyntaxTheme, previewColor,
                            }}
                            terminalProps={{
                                fieldStyle: FIELD_STYLE,
                                localTabLabelMode, setLocalTabLabelMode,
                            }}
                        />
                    </div>
                )}
                {activeTab === 'remote' && (
                    <div style={styles.section}>
                        <span className="rokdock-hint">Press a key in any field to assign it.</span>
                        {REMOTE_ACTION_GROUPS.map(group => (
                            <CollapsibleSettingsSection key={group.label} label={group.label} gap={4} padding="8px 14px 8px 14px">
                                {REMOTE_ACTIONS.filter(action => group.keys.includes(action.key)).map(action => (
                                    <div key={action.key} style={styles.keybindRow}>
                                        <label style={styles.keybindLabel}>{action.title}</label>
                                        <input
                                            className="rokdock-input rokdock-input-mono" style={styles.keybindInput}
                                            type="text"
                                            readOnly
                                            value={formatKeyCodeLabel(localRemoteKeyBindings[action.key] || '')}
                                            onKeyDown={(e) => {
                                                e.preventDefault()
                                                e.stopPropagation()
                                                setLocalRemoteKeyBindings(prev => ({ ...prev, [action.key]: e.code }))
                                            }}
                                            onFocus={(e) => e.currentTarget.select()}
                                            title="Press any key to assign"
                                        />
                                        <button
                                            style={{ ...SMALL_BTN_STYLE, ...styles.keybindClearBtn }}
                                            onClick={() => setLocalRemoteKeyBindings(prev => ({ ...prev, [action.key]: '' }))}
                                            title="Clear binding"
                                        ><FontAwesomeIcon icon={faXmark} /></button>
                                    </div>
                                ))}
                            </CollapsibleSettingsSection>
                        ))}
                    </div>
                )}
                {activeTab === 'capture' && (
                    <div style={styles.section}>
                        <CollapsibleSettingsSection label="Screenshot" gap={14} padding="10px 14px 10px 14px">
                            <div style={FIELD_STYLE}>
                                <label className="rokdock-label">Screenshot Folder</label>
                                <div style={{ display: 'flex', gap: 'var(--rokdock-space-xs)', alignItems: 'center' }}>
                                    <input
                                        className="rokdock-input rokdock-code"
                                        style={{ flex: 1, minWidth: 0 }}
                                        type="text"
                                        value={screenshotFolder}
                                        placeholder={defaultScreenshotFolder || 'Default folder'}
                                        onChange={e => setScreenshotFolder(e.target.value)}
                                    />
                                    <button
                                        className="rokdock-btn rokdock-btn-ghost"
                                        type="button"
                                        onClick={async () => {
                                            const picked = await window.rokdock.dialog.pickFolder(screenshotFolder || defaultScreenshotFolder || undefined)
                                            if (picked) setScreenshotFolder(picked)
                                        }}
                                    >
                                        Browse
                                    </button>
                                </div>
                                <span className="rokdock-hint">
                                    Leave blank to save screenshots in the default folder shown above.
                                </span>
                            </div>
                            <div style={FIELD_STYLE}>
                                <label className="rokdock-label">Filename Format</label>
                                <input
                                    className="rokdock-input rokdock-code"
                                    type="text"
                                    value={screenshotNamingFormat}
                                    placeholder={DEFAULT_SCREENSHOT_NAMING_FORMAT}
                                    onChange={e => setScreenshotNamingFormat(e.target.value)}
                                />
                                <span className="rokdock-hint" style={{ marginTop: 'var(--rokdock-space-xs)' }}>
                                    Tokens: {'{YYYY}'} {'{MM}'} {'{DD}'} {'{HH}'} {'{mm}'} {'{ss}'}
                                </span>
                            </div>
                        </CollapsibleSettingsSection>
                        <CollapsibleSettingsSection label="Live Capture" gap={14} padding="10px 14px 10px 14px">
                            <div style={FIELD_STYLE}>
                                <label className="rokdock-label">Capture Device</label>
                                <RokdockSelect
                                    value={resolvedCaptureDeviceId ?? ''}
                                    disabled={captureDevices.length === 0}
                                    onChange={value => setCaptureDevice(
                                        value || null,
                                        captureDevices.find(device => device.deviceId === value)?.label ?? null
                                    )}
                                    style={{ width: '100%' }}
                                >
                                    {captureDevices.length === 0 ? (
                                        <option value="">No capture devices detected</option>
                                    ) : (
                                        <>
                                            <option value="">Select a device...</option>
                                            {captureDevices.map(device => (
                                                <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
                                            ))}
                                        </>
                                    )}
                                </RokdockSelect>
                            </div>
                            <div style={FIELD_STYLE}>
                                <label className="rokdock-label">Aspect Ratio</label>
                                <RokdockSelect
                                    value={captureAspectRatio}
                                    onChange={value => setCaptureAspectRatio(value as '16:9' | '4:3' | 'auto')}
                                    style={{ width: '100%' }}
                                >
                                    <option value="auto">Auto (from device)</option>
                                    <option value="16:9">16:9</option>
                                    <option value="4:3">4:3</option>
                                </RokdockSelect>
                            </div>
                            <div style={FIELD_STYLE}>
                                <label className="rokdock-label">Idle Timeout</label>
                                <RokdockSelect
                                    value={String(captureIdleTimeoutSec)}
                                    onChange={value => setCaptureIdleTimeoutSec(Number(value))}
                                    style={{ width: '100%' }}
                                >
                                    <option value="0">Never</option>
                                    <option value="60">1 minute</option>
                                    <option value="300">5 minutes</option>
                                    <option value="600">10 minutes</option>
                                    <option value="900">15 minutes</option>
                                    <option value="1800">30 minutes</option>
                                    <option value="3600">1 hour</option>
                                    <option value="7200">2 hours</option>
                                    <option value="14400">4 hours</option>
                                </RokdockSelect>
                                <span className="rokdock-hint" style={{ marginTop: 'var(--rokdock-space-xs)' }}>
                                    Pause capture after this period of inactivity to allow the screensaver to run.
                                </span>
                            </div>
                            {captureDeviceAvailable && (
                                <div style={{ display: 'flex', justifyContent: 'center' }}>
                                    <div style={{
                                        borderRadius: 'var(--rokdock-radius-md)',
                                        overflow: 'hidden',
                                        background: '#000',
                                        maxWidth: captureAspectRatio === '4:3' ? 360 : 480,
                                        width: '100%',
                                    }}>
                                        <video
                                            ref={capturePreviewRef}
                                            autoPlay
                                            playsInline
                                            muted
                                            style={{
                                                width: '100%',
                                                objectFit: 'contain',
                                                display: 'block',
                                                ...(captureAspectRatio !== 'auto'
                                                    ? { aspectRatio: captureAspectRatio.replace(':', ' / '), objectFit: 'fill' as const }
                                                    : {}),
                                            }}
                                        />
                                    </div>
                                </div>
                            )}
                        </CollapsibleSettingsSection>
                    </div>
                )}
                {activeTab === 'advanced' && (
                    <div style={styles.section}>

                        <CollapsibleSettingsSection label="Dev App Polling" gap={10} padding="10px 14px 10px 14px">
                            <div style={FIELD_STYLE}>
                                <label className="rokdock-label">Poll Interval: {localDevAppPollIntervalMs}ms</label>
                                <div style={styles.colorRow}>
                                    <span className="rokdock-hint">{DEV_APP_POLL_INTERVAL_RANGE.min}</span>
                                    <input
                                        className="settings-range"
                                        type="range"
                                        min={DEV_APP_POLL_INTERVAL_RANGE.min}
                                        max={DEV_APP_POLL_INTERVAL_RANGE.max}
                                        step={DEV_APP_POLL_INTERVAL_RANGE.step}
                                        value={localDevAppPollIntervalMs}
                                        onChange={e => setLocalDevAppPollIntervalMs(parseInt(e.target.value))}
                                        style={rangeStyle(localDevAppPollIntervalMs, DEV_APP_POLL_INTERVAL_RANGE.min, DEV_APP_POLL_INTERVAL_RANGE.max)}
                                    />
                                    <span className="rokdock-hint">{DEV_APP_POLL_INTERVAL_RANGE.max}</span>
                                </div>
                            </div>
                            <span className="rokdock-hint">
                                Controls how often the Remote panel checks whether the active app is "dev" for screenshot availability.
                            </span>
                        </CollapsibleSettingsSection>
                        <CollapsibleSettingsSection label="Reset Configuration" gap={10} padding="10px 14px 10px 14px">
                            <span className="rokdock-hint">
                                Clears local app configuration and resets to defaults.
                            </span>
                            <button
                                className="rokdock-btn rokdock-btn-danger"
                                onClick={() => setShowResetConfirm(true)}
                            >
                                Clear / Reset to Defaults
                            </button>
                        </CollapsibleSettingsSection>
                    </div>
                )}
            </div>
            <div className="rokdock-dialog-actions">
                <button className="rokdock-btn rokdock-btn-ghost" onClick={handleClose}>Cancel</button>
                <button className="rokdock-btn rokdock-btn-primary" onClick={handleSave}>Save</button>
            </div>
            <ConfirmDialog
                open={showResetConfirm}
                title="Reset Configuration"
                message="Reset all RokDock configuration to defaults? This clears saved settings, appearance, nicknames, custom devices, auth credentials, AI providers and their saved keys, panel state, screenshot history, and comparison overlay history (including copied overlay files)."
                confirmLabel="Reset"
                destructive
                onCancel={() => {
                    setShowResetConfirm(false)
                    setResetDeleteDeeplinks(false)
                    setResetDeleteScripts(false)
                    setResetScreenshotFolder(false)
                }}
                onConfirm={() => {
                    setShowResetConfirm(false)
                    void handleResetConfig()
                }}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                    <label style={RESET_CHECKBOX_LABEL_STYLE}>
                        <input
                            type="checkbox"
                            checked={resetDeleteDeeplinks}
                            onChange={e => setResetDeleteDeeplinks(e.target.checked)}
                            style={RESET_CHECKBOX_INPUT_STYLE}
                        />
                        Also delete all saved Deeplinks
                    </label>
                    <label style={RESET_CHECKBOX_LABEL_STYLE}>
                        <input
                            type="checkbox"
                            checked={resetDeleteScripts}
                            onChange={e => setResetDeleteScripts(e.target.checked)}
                            style={RESET_CHECKBOX_INPUT_STYLE}
                        />
                        Also delete all saved Scripts
                    </label>
                    {screenshotFolder && (
                        <label style={RESET_CHECKBOX_LABEL_STYLE}>
                            <input
                                type="checkbox"
                                checked={resetScreenshotFolder}
                                onChange={e => setResetScreenshotFolder(e.target.checked)}
                                style={RESET_CHECKBOX_INPUT_STYLE}
                            />
                            Also reset Screenshot folder to default
                        </label>
                    )}
                </div>
            </ConfirmDialog>
            <ConfirmDialog
                open={!!pendingDeviceDelete}
                title="Remove Configured Device"
                message={pendingDeviceDelete
                    ? `Remove "${pendingDeviceDelete.name}" (${pendingDeviceDelete.ip}) from configured devices?`
                    : ''}
                confirmLabel="Remove"
                destructive
                onCancel={() => setPendingDeviceDelete(null)}
                onConfirm={() => {
                    if (!pendingDeviceDelete) return
                    const toRemove = pendingDeviceDelete
                    setPendingDeviceDelete(null)
                    void window.rokdock.discovery.removeDevice(toRemove.id)
                }}
            />
        </DialogFrame>
    )
}

/**
 * Row component for a single device in the "Configured Devices" list inside
 * Settings. Displays the device name, IP, and badges for manual-entry and
 * saved-auth status, plus buttons to open Device Properties or remove the device.
 */
function ConfiguredDeviceRow({
    device,
    styles,
    smallBtnStyle,
    isManualState,
    isAuthSaved,
    onOpenProperties,
    onRemove
}: {
    device: Device
    styles: Record<string, React.CSSProperties>
    smallBtnStyle: React.CSSProperties
    isManualState: boolean
    isAuthSaved: boolean
    onOpenProperties: () => void
    onRemove: () => void
}) {
    return (
        <>
            <div style={styles.manualText}>
                <span style={styles.manualName}>{device.name}</span>
                <span style={styles.manualIp}>
                    {device.ip}
                </span>
            </div>
            <div style={styles.manualMeta}>
                {isManualState && <span style={styles.sourceBadge}>Manual</span>}
                {isAuthSaved && <span style={{ ...styles.authBadge, ...styles.authBadgeOn }}>Auth saved</span>}
                <button
                    style={smallBtnStyle}
                    title="Open device properties"
                    onClick={onOpenProperties}
                >
                    <FontAwesomeIcon icon={faChevronRight} />
                </button>
                <button
                    style={smallBtnStyle}
                    title="Remove configured device"
                    onClick={onRemove}
                >
                    <FontAwesomeIcon icon={faXmark} />
                </button>
            </div>
        </>
    )
}

/** Builds the inline style map for SettingsDialog and its tab body sections. */
function buildStyles(): Record<string, React.CSSProperties> {
    return {
        dialog: {
            width: 680,
            height: 'min(700px, 82vh)',
            display: 'flex',
            flexDirection: 'column'
        },
        tabs: {
            display: 'flex',
            // Scroll horizontally instead of wrapping to a second row when the tabs are
            // wider than the dialog (e.g. at a larger UI font size).
            flexWrap: 'nowrap',
            overflowX: 'auto',
            scrollbarWidth: 'thin' as const,
            padding: '0 12px',
            background: 'var(--rokdock-bg-surface)',
            gap: 2,
        },
        tab: {
            flexShrink: 0,
            whiteSpace: 'nowrap' as const,
            padding: '9px 14px',
            border: 'none',
            background: 'transparent',
            color: 'var(--rokdock-text-muted)',
            fontSize: 'var(--rokdock-font-base)',
            fontWeight: 500,
            cursor: 'pointer',
            outline: 'none',
            boxShadow: 'none',
            appearance: 'none' as const,
            borderRadius: 'var(--rokdock-radius-sm) var(--rokdock-radius-sm) 0 0',
            transition: `background var(--rokdock-transition-fast), color var(--rokdock-transition-fast)`,
        },
        tabActive: {
            color: 'var(--rokdock-brand-primary-light)',
            background: 'var(--rokdock-bg-panel)',
            boxShadow: `inset 0 -2px 0 var(--rokdock-brand-primary)`
        },
        body: {
            padding: 16,
            overflow: 'auto',
            flex: 1,
            minHeight: 0,
            borderTop: `1px solid var(--rokdock-border)`
        },
        section: {
            display: 'flex',
            flexDirection: 'column',
            gap: 14
        },
        compactControlList: {
            display: 'flex',
            flexDirection: 'column',
            gap: 4
        },
        advancedSection: {
            background: 'var(--rokdock-bg-surface)',
            border: `1px solid var(--rokdock-border-light)`,
            borderRadius: 'var(--rokdock-radius-md)',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10
        },
        advancedTitle: {
            fontSize: 'var(--rokdock-font-xs)',
            fontWeight: 600,
            color: 'var(--rokdock-section-header-color)',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.05em',
        },
        configuredHeaderRow: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8
        },
        addConfiguredBtn: {
            padding: '4px 8px',
            border: `1px dashed var(--rokdock-border)`,
            borderRadius: 'var(--rokdock-radius-md)',
            background: 'transparent',
            color: 'var(--rokdock-text-primary)',
            fontSize: 'var(--rokdock-font-sm)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6
        },
        sectionDesc: {
            fontSize: 'var(--rokdock-font-base)',
            color: 'var(--rokdock-text-muted)',
            opacity: 0.7,
            margin: '0 0 4px 0',
            lineHeight: 1.5
        },
        deeplinkActions: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8
        },
        deeplinkActionBtn: {
            fontSize: 'var(--rokdock-font-xs)',
            padding: '3px 10px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5
        },
        iconToolBtn: {
            width: 24,
            height: 24,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `1px solid var(--rokdock-border-light)`,
            borderRadius: 'var(--rokdock-radius-sm)',
            background: 'transparent',
            color: 'var(--rokdock-text-dim)',
            fontSize: 'var(--rokdock-font-xs)',
            cursor: 'pointer'
        },
        portRow: {
            display: 'flex',
            alignItems: 'center',
            gap: 6
        },
        colorInput: {
            width: 28,
            height: 28,
            padding: 0,
            border: `1px solid var(--rokdock-border)`,
            borderRadius: 'var(--rokdock-radius-sm)',
            background: 'transparent',
            cursor: 'pointer'
        },
        fieldRow: {
            display: 'flex',
            gap: 6,
            alignItems: 'flex-end'
        },
        colorRow: {
            display: 'flex',
            gap: 8,
            alignItems: 'center'
        },
        code: {
            fontFamily: 'var(--rokdock-font-mono)',
            fontSize: 'var(--rokdock-font-xs)',
            color: 'var(--rokdock-brand-primary-light)',
            background: 'var(--rokdock-bg-surface)',
            padding: '1px 4px',
            borderRadius: 3
        },
        checkLabel: {
            display: 'flex',
            alignItems: 'center'
        },
        addItemBtn: {
            padding: '5px 10px',
            border: `1px dashed var(--rokdock-border)`,
            borderRadius: 'var(--rokdock-radius-md)',
            background: 'transparent',
            color: 'var(--rokdock-text-primary)',
            fontSize: 'var(--rokdock-font-sm)',
            cursor: 'pointer',
            alignSelf: 'flex-start'
        },
        deeplinkCard: {
            border: `1px solid var(--rokdock-border)`,
            borderRadius: 'var(--rokdock-radius-md)',
            overflow: 'hidden'
        },
        deeplinkHeader: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 10px',
            background: 'var(--rokdock-bg-surface)',
            cursor: 'pointer',
            gap: 6
        },
        deeplinkChevron: {
            fontSize: 'var(--rokdock-font-md)',
            fontWeight: 600,
            color: 'var(--rokdock-text-dim)',
            transition: 'transform 0.15s ease',
            flexShrink: 0
        },
        deeplinkTitle: {
            fontSize: 'var(--rokdock-font-base)',
            fontWeight: 500,
            color: 'var(--rokdock-text-primary)',
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
        },
        deeplinkBody: {
            padding: '8px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8
        },
        keybindRow: {
            display: 'flex',
            gap: 5,
            alignItems: 'center'
        },
        keybindLabel: {
            width: 120,
            fontSize: 'var(--rokdock-font-base)',
            color: 'var(--rokdock-text-primary)',
            flexShrink: 0
        },
        keybindInput: {
            flex: 1,
            cursor: 'text',
            padding: '3px 8px',
            minHeight: 24,
            fontSize: 'var(--rokdock-font-xs)'
        },
        keybindClearBtn: {
            width: 22,
            height: 22,
            minWidth: 22,
            padding: 0
        },
        manualList: {
            display: 'flex',
            flexDirection: 'column',
            gap: 6
        },
        manualRow: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8
        },
        manualMeta: {
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0
        },
        manualText: {
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0
        },
        manualName: {
            fontSize: 'var(--rokdock-font-base)',
            color: 'var(--rokdock-text-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
        },
        manualIp: {
            fontSize: 'var(--rokdock-font-sm)',
            color: 'var(--rokdock-text-primary)',
            fontFamily: 'var(--rokdock-font-mono)'
        },
        sourceBadge: {
            fontSize: 'var(--rokdock-font-xs)',
            color: 'var(--rokdock-text-bright)',
            background: 'var(--rokdock-bg-surface)',
            border: `1px solid var(--rokdock-border)`,
            borderRadius: 4,
            padding: '1px 5px',
            letterSpacing: '0.2px'
        },
        authBadge: {
            fontSize: 'var(--rokdock-font-xs)',
            color: 'var(--rokdock-text-dim)',
            background: 'var(--rokdock-bg-surface)',
            border: `1px solid var(--rokdock-border)`,
            borderRadius: 4,
            padding: '1px 5px',
            letterSpacing: '0.2px'
        },
        authBadgeOn: {
            color: 'var(--rokdock-state-online)',
            borderColor: 'var(--rokdock-state-online)'
        },
        localHint: {
            fontSize: 'var(--rokdock-font-sm)',
            color: 'var(--rokdock-text-muted)'
        }
    }
}

/** Built once at module load: the style map is static (literals + CSS-var strings),
 *  so it never needs rebuilding per render (the dialog re-renders on every keystroke). */
const STYLES = buildStyles()
