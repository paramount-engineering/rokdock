/**
 * Central application state store for the RokDock renderer.
 *
 * Uses Zustand for reactive state management. This single store holds all UI state
 * that needs to be shared across components: discovered devices, terminal tabs, pane
 * layout, panel visibility, user preferences, theme settings, and dialog open states.
 *
 * State is organized into logical sections (devices, tabs, panes, panels, preferences,
 * theme, dialogs) but lives in one flat store for simple cross-cutting access.
 *
 * Persistence: preferences are written back to the main process via IPC when they
 * change (debounced). Devices are kept in sync by subscribing to 'discovery:devices-changed'
 * IPC events in the useDeviceSync hook.
 *
 * The store exposes both data and action functions. Components should prefer importing
 * specific selectors (e.g. `useAppStore(state => state.devices)`) over the full store to
 * minimize re-renders.
 *
 * Note: dialog open/close state for device properties, settings, etc. lives here so
 * any component can trigger a dialog open without prop-drilling through the tree.
 */

import { create } from 'zustand'
import { DEFAULT_REMOTE_KEY_BINDINGS, normalizeRemoteKeyBindings } from '../constants/remoteKeyBindings'
import { cloneDefaultPortConfigs } from '../../shared/ports'
import { DEFAULT_SCREENSHOT_NAMING_FORMAT } from '../../shared/toolbarConstants'
import type { PortConfig, DeeplinkParam, DeeplinkConfig, CaptureMode, AiChatDock } from '../../shared/types'
import type { DeviceInfo } from '../../shared/device'
import type { ThemeMode } from '../styles/theme'
import type { Tint } from '@shared/colorTint'
import type { AppearanceDraft } from '@shared/appearanceDraft'
import type { TerminalSyntaxThemePreset, TerminalTokenPalette } from '../styles/terminalSyntaxThemes'
import type { ChatMessage } from '../../shared/ai/types'

export type { PortConfig, DeeplinkParam, DeeplinkConfig }
export type Device = DeviceInfo

export type PaneId = 'a' | 'b'

export interface PaneState {
    activeTabId: string | null
}

export interface TabInfo {
    id: string
    deviceIp: string
    deviceName: string
    port: number
    status: 'connecting' | 'connected' | 'disconnected' | 'error'
    autoScroll: boolean
    wordWrap: boolean
    hasActivity: boolean
    paneId: PaneId
}

export type SettingsTab = 'appearance' | 'ai' | 'deeplinks' | 'remote' | 'devices' | 'capture' | 'advanced'

export type TabLabelMode = 'displayName' | 'ip'

/**
 * The persisted theme-mode setting. Wider than the concrete {@link ThemeMode}
 * because the user can choose 'system', which the renderer resolves to a
 * concrete palette via `resolveThemeMode` only at the point a palette is needed.
 */
export type ThemeModeSetting = ThemeMode | 'system'

const DEFAULT_FALLBACK_TEXT_DARK = '#e0e0e0'
const DEFAULT_FALLBACK_TEXT_LIGHT = '#2c3040'

/** Normalize a hex color string to lowercase trimmed form for stable comparison. */
function normalizeHex(value: string): string {
    return value.trim().toLowerCase()
}

/**
 * Resolve a stored theme-mode setting to a concrete 'dark' | 'light' for the
 * places that need a real palette (here, the terminal fallback-color heuristic).
 * 'system' resolves to whichever theme is currently applied to <html> (the boot
 * path and the live theme:css-vars-updated handler keep that class current),
 * defaulting to 'dark'. Kept local to avoid a value-level import cycle with
 * styles/theme.ts, which imports this store.
 */
function resolveConcreteThemeMode(mode: ThemeModeSetting): ThemeMode {
    if (mode === 'system') {
        return typeof document !== 'undefined' && document.documentElement.classList.contains('theme-light')
            ? 'light'
            : 'dark'
    }
    return mode
}

/** Return the PaneState for the given pane ID, or null if pane B does not exist. */
function getPaneState(paneId: PaneId, state: { paneA: PaneState; paneB: PaneState | null }): PaneState | null {
    return paneId === 'a' ? state.paneA : state.paneB
}

interface AppState {
    // Devices
    devices: Device[]
    setDevices: (devices: Device[]) => void
    lastScanAt: number
    setLastScanAt: (ts: number) => void

    // Tabs
    tabs: TabInfo[]
    addTab: (tab: TabInfo) => void
    removeTab: (id: string) => void
    setActiveTab: (id: string | null) => void
    updateTabStatus: (id: string, status: TabInfo['status']) => void
    markTabActivity: (id: string) => void
    toggleTabAutoScroll: (id: string) => void
    toggleTabWordWrap: (id: string) => void

    // Panes
    paneA: PaneState
    paneB: PaneState | null
    focusedPaneId: PaneId
    splitRatio: number
    setFocusedPane: (paneId: PaneId) => void
    splitTab: (tabId: string) => void
    unsplit: () => void
    moveTabToPane: (tabId: string, targetPane: PaneId) => void
    reorderTab: (tabId: string, beforeTabId: string | null) => void
    setSplitRatio: (ratio: number) => void

    // Panels
    leftPanelOpen: boolean
    rightPanelOpen: boolean
    toggleLeftPanel: () => void
    toggleRightPanel: () => void
    setLeftPanel: (open: boolean) => void
    setRightPanel: (open: boolean) => void

    // Collapsible section persistence
    collapsedPanels: string[]
    toggleCollapsedPanel: (id: string) => void

    // Remote panel target IP (shared by remote + deeplinks)
    remoteTargetIp: string | null
    setRemoteTargetIp: (ip: string | null) => void

    /** Tools > Screenshot: mirrors remote panel capture button (device selected, not in-flight). */
    toolsScreenshotEnabled: boolean
    setToolsScreenshotEnabled: (enabled: boolean) => void

    // Last connected timestamps per device IP
    lastConnected: Record<string, number>
    deviceOrder: string[]
    setLastConnected: (data: Record<string, number>) => void
    setDeviceOrder: (order: string[]) => void
    recordConnection: (ip: string) => void

    // Add device dialog
    addDeviceDialogOpen: boolean
    setAddDeviceDialogOpen: (open: boolean) => void

    // Search bar visibility per tab
    searchVisible: Record<string, boolean>
    toggleSearch: (tabId: string) => void
    setSearchVisible: (tabId: string, visible: boolean) => void

    /** Current line count per terminal tab (for tab strip buffer meter). */
    terminalBufferLineCount: Record<string, number>
    setTerminalBufferLineCount: (tabId: string, lineCount: number) => void

    // Settings
    ports: PortConfig[]
    deeplinks: DeeplinkConfig[]
    terminalFontSize: number
    terminalFontFamily: string
    terminalFallbackColor: string
    terminalUseThemeBackground: boolean
    terminalAutoScroll: boolean
    terminalWordWrap: boolean
    terminalSyntaxThemePreset: TerminalSyntaxThemePreset
    terminalSyntaxThemeCustomColors: Partial<TerminalTokenPalette>
    terminalCommandHistory: string[]
    remoteKeyBindings: Record<string, string>
    tabLabelMode: TabLabelMode
    /** The user's raw choice, including 'system'. Drives the Settings segmented control. */
    themeMode: ThemeModeSetting
    /**
     * The concrete light/dark mode currently applied to the document. Tracks OS
     * flips in System mode (updated from the appearance broadcast), so useTheme and
     * its inline-style consumers re-render even though themeMode stays 'system'.
     */
    appliedThemeMode: ThemeMode
    tint: Tint
    discoveryScanIntervalMs: number
    discoveryRequestTimeoutMs: number
    devAppPollIntervalMs: number
    appZoomLevel: number
    uiFontScale: number
    setPorts: (ports: PortConfig[]) => void
    setDeeplinks: (deeplinks: DeeplinkConfig[]) => void
    // Code-surface appearance fields (font, syntax, fallback, background) are written
    // in bulk by applyAppearance from the appearance broadcast, not by per-field setters.
    setTerminalAutoScroll: (enabled: boolean) => void
    setTerminalWordWrap: (enabled: boolean) => void
    addTerminalCommandHistory: (command: string) => void
    setRemoteKeyBindings: (bindings: Record<string, string>) => void
    setTabLabelMode: (mode: TabLabelMode) => void
    setThemeMode: (mode: ThemeModeSetting) => void
    setDiscoveryScanIntervalMs: (ms: number) => void
    setDiscoveryRequestTimeoutMs: (ms: number) => void
    setDevAppPollIntervalMs: (ms: number) => void
    setAppZoomLevel: (level: number) => void
    loadSettings: () => Promise<void>
    saveSettings: () => Promise<void>

    // Device nicknames
    deviceNicknames: Record<string, string>
    setDeviceNicknames: (nicknames: Record<string, string>) => void
    deviceHasAuth: Record<string, boolean>
    setDeviceHasAuth: (states: Record<string, boolean>) => void
    setDeviceHasAuthForIp: (ip: string, hasAuth: boolean) => void
    setDeviceNickname: (ip: string, nickname: string) => void

    // Settings dialog
    settingsDialogOpen: boolean
    settingsDefaultTab: SettingsTab
    settingsDefaultSection: string | null
    setSettingsDialogOpen: (open: boolean | SettingsTab, section?: string) => void

    // Device properties dialog
    devicePropertiesDevice: Device | null
    devicePropertiesFocusField: 'nickname' | 'password'
    setDevicePropertiesDevice: (device: Device | null) => void
    setDevicePropertiesFocusField: (field: 'nickname' | 'password') => void

    // Capture device preview
    captureDeviceId: string | null
    /** Stable label of the remembered device; re-resolves captureDeviceId across launches. */
    captureDeviceLabel: string | null
    captureMuted: boolean
    captureVolume: number
    captureMode: CaptureMode
    captureDockSide: 'left' | 'right'
    capturePipBounds: { x: number; y: number; w: number; h: number } | null
    captureAvailable: boolean
    captureAspectRatio: '16:9' | '4:3' | 'auto'
    captureIdleTimeoutSec: number
    /** Refresh only the volatile device id (used when re-resolving by label). */
    setCaptureDeviceId: (id: string | null) => void
    /** Select a device: persist both its volatile id and its stable label. */
    setCaptureDevice: (id: string | null, label: string | null) => void
    setCaptureMuted: (muted: boolean) => void
    setCaptureVolume: (volume: number) => void
    setCaptureMode: (mode: CaptureMode) => void
    setCaptureDockSide: (side: 'left' | 'right') => void
    setCapturePipBounds: (bounds: { x: number; y: number; w: number; h: number } | null) => void
    setCaptureAvailable: (available: boolean) => void
    setCaptureAspectRatio: (ratio: '16:9' | '4:3' | 'auto') => void
    setCaptureIdleTimeoutSec: (sec: number) => void
    screenshotFolder: string
    screenshotNamingFormat: string
    setScreenshotFolder: (folder: string) => void
    setScreenshotNamingFormat: (format: string) => void

    /**
     * Apply an appearance broadcast to the in-memory store. Called by the
     * rokdock-appearance-applied window listener in app.tsx whenever main fans out
     * the effective appearance (a live preview draft, or the persisted values on
     * Save/Cancel and OS theme flips). This keeps the dock's store-driven UI (the
     * terminal, theme-aware inline styles, the Settings segmented control) in sync
     * with what every window is showing. Does NOT persist and does NOT re-broadcast,
     * so there is no feedback loop.
     */
    applyAppearance: (draft: AppearanceDraft) => void

    // AI chat
    aiConfigured: boolean
    aiChatOpen: boolean
    aiChatMessages: ChatMessage[]
    aiChatStreaming: { sessionId: string; text: string; activity: string | null } | null
    aiChatError: string | null
    aiChatDock: AiChatDock
    aiChatDrawerHeight: number
    aiConversationId: string | null
    leftPanelWidth: number
    rightPanelWidth: number
    leftSplitRatio: number
    setAiConfigured: (configured: boolean) => void
    toggleAiChat: () => void
    sendChatMessage: (text: string) => Promise<void>
    openChatWith: (text: string) => Promise<void>
    cancelChat: () => void
    newChat: () => void
    setLeftPanelWidth: (px: number) => void
    setRightPanelWidth: (px: number) => void
    setLeftSplitRatio: (ratio: number) => void
    setAiChatDock: (dock: AiChatDock) => void
    cycleAiChatDock: () => void
    setAiChatDrawerHeight: (px: number) => void
    initAiChatStream: () => void
    loadDocSymbols: () => void
    aiDocSymbols: Record<string, string>
}

/**
 * Coalescing preference writer. Accumulates patches from persistPreference calls
 * and flushes a single merged IPC call after 300ms of inactivity. The timer resets
 * on each new call so rapid changes (volume slider, zoom, split-ratio drag) produce
 * only one disk write. A trailing write is always guaranteed: each new patch clears
 * and re-arms the timer, so the final settled value always flushes.
 *
 * A synchronous flush is registered on beforeunload/pagehide so any pending patch
 * is not lost when the renderer is torn down on quit.
 *
 * Only routes fire-and-forget preference writes (the persistPreference path). Setters
 * that carry descriptive .catch messages (autoScroll, wordWrap, splitRatio,
 * collapsedPanels, terminalCommandHistory, themeMode) are left wired directly so
 * their per-call error context is preserved.
 */
const prefCoalescer = (() => {
    type PrefPatch = Parameters<typeof window.rokdock.store.setPreferences>[0]
    let pending: PrefPatch | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const DELAY_MS = 300

    function flush(): void {
        if (timer !== null) {
            clearTimeout(timer)
            timer = null
        }
        if (pending === null) return
        const patch = pending
        pending = null
        void window.rokdock.store.setPreferences(patch).catch(console.error)
    }

    function schedule(patch: PrefPatch): void {
        // Merge last-writer-wins per key.
        pending = pending === null ? { ...patch } : { ...pending, ...patch }
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(flush, DELAY_MS)
    }

    // Flush synchronously when the page is unloaded so the final write is not lost.
    if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', flush)
        window.addEventListener('pagehide', flush)
    }

    return { schedule }
})()

/**
 * Persist a preferences patch fire-and-forget via the coalescing writer. Shared by
 * the setters whose only error handling is to log (capture and screenshot settings).
 * Rapid calls within 300ms are merged into a single IPC flush (last-writer-wins per
 * key). Setters that need a descriptive failure message keep their own inline .catch.
 */
function persistPreference(patch: Parameters<typeof window.rokdock.store.setPreferences>[0]): void {
    prefCoalescer.schedule(patch)
}

/**
 * Guards against double-registering the AI chat stream IPC listeners. The mount
 * effect that calls initAiChatStream can fire more than once (React StrictMode in
 * dev double-invokes mount effects, and a remount would too). These are process-lifetime
 * listeners routed by sessionId, so registering them exactly once is correct.
 * Without this guard each delta is appended once per duplicate listener, which made
 * the live streaming text render every token N times (the committed message stayed
 * correct because it uses the server's finalText, not the accumulated live text).
 */
let aiStreamWired = false

/**
 * Guards the one-time fetch of the documented-symbol map. The map only feeds answer
 * linkifying, so it is loaded lazily on the first chat open (not at app mount), to keep
 * the docs tree fetch it triggers off the launch path. Reset on failure so the next chat
 * open retries.
 */
let docSymbolsRequested = false

/** Human label for the live tool-activity line. The two tool names are ours. */
function formatActivity(name: string, args: Record<string, unknown>): string {
    if (name === 'search_docs' && typeof args.query === 'string') return `Searching docs: "${args.query}"`
    if (name === 'fetch_page' && typeof args.path === 'string') return `Reading: ${args.path}`
    return 'Working...'
}

export const useAppStore = create<AppState>((set, get) => ({
    // Devices
    devices: [],
    lastScanAt: 0,
    /** Record the timestamp of the most recent device discovery scan. */
    setLastScanAt: (ts) => set({ lastScanAt: ts }),
    /** Replace the full device list (called by useDeviceSync on discovery events). */
    setDevices: (devices) => set({ devices }),

    // Tabs
    tabs: [],
    /**
     * Add a new terminal tab, assigning it to the currently focused pane.
     * Automatically sets it as the active tab in its pane and updates remoteTargetIp.
     */
    addTab: (tab) => set((state) => {
        const paneId = state.paneB && state.focusedPaneId === 'b' ? 'b' as PaneId : 'a' as PaneId
        const newTab: TabInfo = { ...tab, paneId }
        const paneKey = paneId === 'a' ? 'paneA' : 'paneB'
        return {
            tabs: [...state.tabs, newTab],
            [paneKey]: { ...getPaneState(paneId, state), activeTabId: newTab.id },
            focusedPaneId: paneId,
            remoteTargetIp: newTab.deviceIp
        }
    }),
    /**
     * Remove a tab by ID. Handles active-tab promotion, split-pane collapse when a pane
     * empties, and re-opening the left panel when no tabs remain.
     */
    removeTab: (id) => set((state) => {
        const removedTab = state.tabs.find(tab => tab.id === id)
        const newTabs = state.tabs.filter(tab => tab.id !== id)
        const { [id]: _removedSearchVisible, ...nextSearchVisible } = state.searchVisible

        let paneA = { ...state.paneA }
        let paneB: PaneState | null = state.paneB ? { ...state.paneB } : null
        let focusedPaneId = state.focusedPaneId

        if (removedTab) {
            const paneId = removedTab.paneId
            const paneTabs = newTabs.filter(tab => tab.paneId === paneId)
            if (paneId === 'a' && paneA.activeTabId === id) {
                const idx = state.tabs.filter(tab => tab.paneId === 'a').findIndex(tab => tab.id === id)
                paneA.activeTabId = paneTabs[Math.min(idx, paneTabs.length - 1)]?.id ?? null
            } else if (paneId === 'b' && paneB?.activeTabId === id) {
                const idx = state.tabs.filter(tab => tab.paneId === 'b').findIndex(tab => tab.id === id)
                paneB = paneTabs.length > 0
                    ? { activeTabId: paneTabs[Math.min(idx, paneTabs.length - 1)]?.id ?? null }
                    : null
            }

            // Collapse if pane B is now empty
            if (paneB && newTabs.filter(tab => tab.paneId === 'b').length === 0) {
                paneB = null
                focusedPaneId = 'a'
            }
            // If pane A emptied but pane B has tabs, reassign all B tabs to A
            if (paneB && newTabs.filter(tab => tab.paneId === 'a').length === 0) {
                const reassigned = newTabs.map(tab => tab.paneId === 'b' ? { ...tab, paneId: 'a' as PaneId } : tab)
                const activeId = paneB.activeTabId
                return {
                    tabs: reassigned,
                    paneA: { activeTabId: activeId },
                    paneB: null,
                    focusedPaneId: 'a' as PaneId,
                    searchVisible: nextSearchVisible,
                    ...(reassigned.length === 0 ? { leftPanelOpen: true } : {})
                }
            }
        }

        return {
            tabs: newTabs,
            paneA,
            paneB,
            focusedPaneId,
            searchVisible: nextSearchVisible,
            ...(newTabs.length === 0 ? { leftPanelOpen: true, focusedPaneId: 'a' as PaneId } : {})
        }
    }),
    /**
     * Set the active tab in its pane, clear its activity badge, shift focus to its pane,
     * and update remoteTargetIp to the tab's device.
     */
    setActiveTab: (id) => {
        const state = get()
        const tab = state.tabs.find(candidate => candidate.id === id)
        if (!tab) return
        const paneKey = tab.paneId === 'a' ? 'paneA' : 'paneB'
        set({
            [paneKey]: { ...getPaneState(tab.paneId, state), activeTabId: id },
            tabs: state.tabs.map(candidate => candidate.id === id ? { ...candidate, hasActivity: false } : candidate),
            focusedPaneId: tab.paneId,
            remoteTargetIp: tab.deviceIp
        })
    },
    /**
     * Update the connection status of a tab. If no tabs remain connected or connecting,
     * the left panel is re-opened so the user can select a device.
     */
    updateTabStatus: (id, status) => set((state) => {
        const newTabs = state.tabs.map(tab => tab.id === id ? { ...tab, status } : tab)
        const anyConnected = newTabs.some(tab => tab.status === 'connected' || tab.status === 'connecting')
        return {
            tabs: newTabs,
            ...(!anyConnected ? { leftPanelOpen: true } : {})
        }
    }),
    /**
     * Mark a tab as having new activity (new log lines). Has no effect if the tab
     * is already the active tab in its pane, since the user is already viewing it.
     */
    markTabActivity: (id) => set((state) => {
        const tab = state.tabs.find(candidate => candidate.id === id)
        if (!tab) return state
        if (getPaneState(tab.paneId, state)?.activeTabId === id) return state
        return { tabs: state.tabs.map(candidate => candidate.id === id ? { ...candidate, hasActivity: true } : candidate) }
    }),
    /**
     * Toggle auto-scroll for a single tab and persist the new value to preferences
     * so new tabs open with the updated default.
     */
    toggleTabAutoScroll: (id) => set((state) => {
        let nextAutoScroll: boolean | null = null
        const nextTabs = state.tabs.map((tab) => {
            if (tab.id !== id) return tab
            nextAutoScroll = !tab.autoScroll
            return { ...tab, autoScroll: nextAutoScroll }
        })
        if (nextAutoScroll !== null) {
            void window.rokdock.store.setPreferences({ autoScroll: nextAutoScroll }).catch((err: unknown) => {
                console.error('Failed to persist terminal auto-scroll:', err)
            })
        }
        return {
            tabs: nextTabs,
            ...(nextAutoScroll !== null ? { terminalAutoScroll: nextAutoScroll } : {})
        }
    }),
    /**
     * Toggle word-wrap for a single tab and persist the new value to preferences
     * so new tabs open with the updated default.
     */
    toggleTabWordWrap: (id) => set((state) => {
        let nextWordWrap: boolean | null = null
        const nextTabs = state.tabs.map((tab) => {
            if (tab.id !== id) return tab
            nextWordWrap = !tab.wordWrap
            return { ...tab, wordWrap: nextWordWrap }
        })
        if (nextWordWrap !== null) {
            void window.rokdock.store.setPreferences({ wordWrap: nextWordWrap }).catch((err: unknown) => {
                console.error('Failed to persist terminal word-wrap:', err)
            })
        }
        return {
            tabs: nextTabs,
            ...(nextWordWrap !== null ? { terminalWordWrap: nextWordWrap } : {})
        }
    }),

    // Panes
    paneA: { activeTabId: null },
    paneB: null,
    focusedPaneId: 'a',
    splitRatio: 0.5,
    /** Set the pane that currently has keyboard/focus context. */
    setFocusedPane: (paneId) => set({ focusedPaneId: paneId }),
    /**
     * Move `tabId` into pane B, creating the split view.
     * Does nothing if pane B already exists or fewer than 2 tabs are open.
     */
    splitTab: (tabId) => set((state) => {
        if (state.paneB) return state
        if (state.tabs.length < 2) return state
        const tab = state.tabs.find(candidate => candidate.id === tabId)
        if (!tab) return state
        const newTabs = state.tabs.map(candidate => candidate.id === tabId ? { ...candidate, paneId: 'b' as PaneId } : candidate)
        let paneAActive = state.paneA.activeTabId
        if (paneAActive === tabId) {
            const remaining = newTabs.filter(candidate => candidate.paneId === 'a')
            paneAActive = remaining[0]?.id ?? null
        }
        return {
            tabs: newTabs,
            paneA: { activeTabId: paneAActive },
            paneB: { activeTabId: tabId },
            focusedPaneId: 'b' as PaneId
        }
    }),
    /** Collapse the split view, moving all pane B tabs back into pane A. */
    unsplit: () => set((state) => {
        if (!state.paneB) return state
        const newTabs = state.tabs.map(tab => ({ ...tab, paneId: 'a' as PaneId }))
        const activeId = state.paneA.activeTabId ?? state.paneB.activeTabId
        return {
            tabs: newTabs,
            paneA: { activeTabId: activeId },
            paneB: null,
            focusedPaneId: 'a' as PaneId
        }
    }),
    /**
     * Move a tab from its current pane to `targetPane`. If the source pane empties,
     * the split is automatically collapsed.
     */
    moveTabToPane: (tabId, targetPane) => set((state) => {
        const tab = state.tabs.find(candidate => candidate.id === tabId)
        if (!tab || tab.paneId === targetPane) return state
        const sourcePane = tab.paneId
        const newTabs = state.tabs.map(candidate => candidate.id === tabId ? { ...candidate, paneId: targetPane } : candidate)

        let paneA = { ...state.paneA }
        let paneB: PaneState | null = state.paneB ? { ...state.paneB } : { activeTabId: null }

        // Set moved tab as active in target pane
        if (targetPane === 'a') paneA.activeTabId = tabId
        else paneB!.activeTabId = tabId

        // Fix source pane active tab if it was moved
        const sourcePaneTabs = newTabs.filter(tab => tab.paneId === sourcePane)
        if (sourcePane === 'a' && state.paneA.activeTabId === tabId) {
            paneA.activeTabId = sourcePaneTabs[0]?.id ?? null
        } else if (sourcePane === 'b' && state.paneB?.activeTabId === tabId) {
            if (sourcePaneTabs.length === 0) {
                return {
                    tabs: newTabs,
                    paneA,
                    paneB: null,
                    focusedPaneId: targetPane
                }
            }
            paneB!.activeTabId = sourcePaneTabs[0]?.id ?? null
        }

        // Collapse if pane A emptied
        if (newTabs.filter(tab => tab.paneId === 'a').length === 0) {
            const reassigned = newTabs.map(tab => ({ ...tab, paneId: 'a' as PaneId }))
            return {
                tabs: reassigned,
                paneA: { activeTabId: paneB!.activeTabId },
                paneB: null,
                focusedPaneId: 'a' as PaneId
            }
        }

        return { tabs: newTabs, paneA, paneB, focusedPaneId: targetPane }
    }),
    /**
     * Reorder a tab within its pane by inserting it before `beforeTabId`.
     * Pass `null` for `beforeTabId` to move the tab to the end of its pane.
     */
    reorderTab: (tabId, beforeTabId) => set((state) => {
        const tabIdx = state.tabs.findIndex(candidate => candidate.id === tabId)
        if (tabIdx === -1) return state
        const tab = state.tabs[tabIdx]
        const without = state.tabs.filter(candidate => candidate.id !== tabId)
        if (beforeTabId === null) {
            let lastIdx = -1
            for (let i = without.length - 1; i >= 0; i--) {
                if (without[i].paneId === tab.paneId) { lastIdx = i; break }
            }
            const newTabs = [...without]
            newTabs.splice(lastIdx + 1, 0, tab)
            return { tabs: newTabs }
        }
        const insertIdx = without.findIndex(candidate => candidate.id === beforeTabId)
        if (insertIdx === -1) return state
        const newTabs = [...without]
        newTabs.splice(insertIdx, 0, tab)
        return { tabs: newTabs }
    }),
    /** Set the pane split divider position (0..1) and persist it to preferences. */
    setSplitRatio: (ratio) => {
        set({ splitRatio: ratio })
        void window.rokdock.store.setPreferences({ splitRatio: ratio }).catch((err: unknown) => {
            console.error('Failed to persist split ratio:', err)
        })
    },

    // Panels
    leftPanelOpen: true,
    rightPanelOpen: true,
    /** Toggle the left (device list) side-panel open/closed. */
    toggleLeftPanel: () => set((state) => ({ leftPanelOpen: !state.leftPanelOpen })),
    /** Toggle the right (remote/capture) side-panel open/closed. */
    toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
    /** Explicitly set the left panel visibility. */
    setLeftPanel: (open) => set({ leftPanelOpen: open }),
    /** Explicitly set the right panel visibility. */
    setRightPanel: (open) => set({ rightPanelOpen: open }),

    // Collapsible section persistence
    collapsedPanels: ['scripts'],
    /**
     * Toggle the collapsed state of a collapsible panel section by ID.
     * Persists the updated list of collapsed IDs to user preferences.
     */
    toggleCollapsedPanel: (id) => {
        const current = get().collapsedPanels
        const next = current.includes(id)
            ? current.filter(panelId => panelId !== id)
            : [...current, id]
        set({ collapsedPanels: next })
        void window.rokdock.store.setPreferences({ collapsedPanels: next }).catch((err: unknown) => {
            console.error('Failed to persist collapsed panels:', err)
        })
    },

    // Remote panel target IP
    remoteTargetIp: null,
    /** Set the device IP shown in the remote panel and deeplinks panel. */
    setRemoteTargetIp: (ip) => set({ remoteTargetIp: ip }),

    toolsScreenshotEnabled: false,
    /** Set whether the Tools > Screenshot action is available (device selected and not in-flight). */
    setToolsScreenshotEnabled: (enabled) => set({ toolsScreenshotEnabled: enabled }),

    // Last connected
    lastConnected: {},
    deviceOrder: [],
    /** Replace the full lastConnected map (used during settings load). */
    setLastConnected: (data) => set({ lastConnected: data }),
    /** Replace the device display order, deduplicating entries. */
    setDeviceOrder: (order) => set({ deviceOrder: Array.from(new Set(order)) }),
    /**
     * Record that a connection was opened to `ip`. Bumps `lastConnected`, moves
     * `ip` to the front of `deviceOrder`, and persists both via IPC.
     */
    recordConnection: (ip) => {
        // Reject empty or whitespace-only IPs to prevent corrupting lastConnected and deviceOrder.
        if (typeof ip !== 'string' || ip.trim() === '') return
        // Keep local UI ordering responsive, then persist asynchronously.
        const updated = { ...get().lastConnected, [ip]: Date.now() }
        const currentOrder = get().deviceOrder.filter((entry) => entry !== ip)
        const discoveredIps = get().devices.map((device) => device.ip).filter(Boolean)
        const nextOrder = Array.from(new Set([
            ip,
            ...currentOrder,
            ...discoveredIps
        ]))
        set({
            lastConnected: updated,
            deviceOrder: nextOrder
        })
        window.rokdock.store.recordConnection(ip)
        void window.rokdock.store.setDeviceOrder(nextOrder).catch((err: unknown) => {
            console.error('Failed to persist device order after connect:', err)
        })
    },

    // Add device dialog
    addDeviceDialogOpen: false,
    /** Open or close the Add Device dialog. */
    setAddDeviceDialogOpen: (open) => set({ addDeviceDialogOpen: open }),

    // Search
    searchVisible: {},
    /** Toggle the search bar visibility for a specific terminal tab. */
    toggleSearch: (tabId) => set((state) => ({
        searchVisible: { ...state.searchVisible, [tabId]: !state.searchVisible[tabId] }
    })),
    /** Explicitly set the search bar visibility for a specific terminal tab. */
    setSearchVisible: (tabId, visible) => set((state) => ({
        searchVisible: { ...state.searchVisible, [tabId]: visible }
    })),

    terminalBufferLineCount: {},
    /** Update the tracked line count for a terminal tab (used by the tab strip buffer meter). */
    setTerminalBufferLineCount: (tabId, lineCount) => set((state) => ({
        terminalBufferLineCount: { ...state.terminalBufferLineCount, [tabId]: lineCount }
    })),

    // Settings
    ports: cloneDefaultPortConfigs(),
    deeplinks: [],
    terminalFontSize: 13,
    terminalFontFamily: '',
    terminalFallbackColor: DEFAULT_FALLBACK_TEXT_DARK,
    terminalUseThemeBackground: false,
    terminalAutoScroll: true,
    terminalWordWrap: true,
    terminalSyntaxThemePreset: 'rokdockDark',
    terminalSyntaxThemeCustomColors: {},
    terminalCommandHistory: [],
    remoteKeyBindings: { ...DEFAULT_REMOTE_KEY_BINDINGS },
    tabLabelMode: 'displayName',
    themeMode: 'dark',
    appliedThemeMode: 'dark',
    tint: { hue: 0, saturation: 1, brightness: 0 },
    discoveryScanIntervalMs: 60000,
    discoveryRequestTimeoutMs: 5000,
    devAppPollIntervalMs: 3000,
    appZoomLevel: 0,
    uiFontScale: 0,
    /** Replace the port configuration list (port number, label, enabled flag). */
    setPorts: (ports) => set({ ports }),
    /** Replace the deeplink configuration list. */
    setDeeplinks: (deeplinks) => set({ deeplinks }),
    /** Set the global default auto-scroll preference for new terminal tabs. */
    setTerminalAutoScroll: (enabled) => set({ terminalAutoScroll: enabled }),
    /** Set the global default word-wrap preference for new terminal tabs. */
    setTerminalWordWrap: (enabled) => set({ terminalWordWrap: enabled }),
    /**
     * Append a command to the terminal command history, deduplicating and capping
     * the list at 1000 entries, then persist it to user preferences.
     */
    addTerminalCommandHistory: (command) => {
        const trimmed = command.trim()
        if (!trimmed) return
        const current = get().terminalCommandHistory
        const deduped = current.filter((entry) => entry !== trimmed)
        const pushed = [...deduped, trimmed]
        const next = pushed.length > 1000 ? pushed.slice(pushed.length - 1000) : pushed
        set({ terminalCommandHistory: next })
        void window.rokdock.store.setPreferences({ terminalCommandHistory: next }).catch((err: unknown) => {
            console.error('Failed to persist terminal command history:', err)
        })
    },
    /** Set the remote key binding map, filling missing keys from defaults via normalizeRemoteKeyBindings. */
    setRemoteKeyBindings: (bindings) => set({ remoteKeyBindings: normalizeRemoteKeyBindings(bindings) }),
    /** Set whether tab labels show the device display name or IP address. */
    setTabLabelMode: (mode) => set({ tabLabelMode: mode }),
    /** Set the interval between automatic device discovery scans (milliseconds). */
    setDiscoveryScanIntervalMs: (ms) => set({ discoveryScanIntervalMs: ms }),
    /** Set the per-request timeout for device discovery probes (milliseconds). */
    setDiscoveryRequestTimeoutMs: (ms) => set({ discoveryRequestTimeoutMs: ms }),
    /** Set the polling interval for the dev-app install/launch status check (milliseconds). */
    setDevAppPollIntervalMs: (ms) => set({ devAppPollIntervalMs: ms }),
    /** Store the current Electron zoom level in state (applied externally via appZoom utils). */
    setAppZoomLevel: (level) => set({ appZoomLevel: level }),
    /**
     * Switch the app color theme as a direct, persist-immediately action (the menu
     * bar theme toggle). Auto-adjusts the terminal fallback color when it was still
     * at the previous theme's default, persists both, then asks main to rebroadcast
     * the persisted appearance so every window applies it. The Settings dialog does
     * NOT use this: it edits a save-gated draft and previews via appearance.previewDraft.
     */
    setThemeMode: (mode) => {
        const current = get()
        const currentConcrete = resolveConcreteThemeMode(current.themeMode)
        const nextConcrete = resolveConcreteThemeMode(mode)
        const currentModeDefault = currentConcrete === 'light' ? DEFAULT_FALLBACK_TEXT_LIGHT : DEFAULT_FALLBACK_TEXT_DARK
        const nextModeDefault = nextConcrete === 'light' ? DEFAULT_FALLBACK_TEXT_LIGHT : DEFAULT_FALLBACK_TEXT_DARK
        const shouldAutoAdjustFallback = normalizeHex(current.terminalFallbackColor) === normalizeHex(currentModeDefault)
        const nextFallback = shouldAutoAdjustFallback ? nextModeDefault : current.terminalFallbackColor

        set({ themeMode: mode, terminalFallbackColor: nextFallback })
        void window.rokdock.store.setPreferences({
            themeMode: mode,
            ...(shouldAutoAdjustFallback ? { terminalFallbackColor: nextFallback } : {})
        }).catch((err: unknown) => {
            console.error('Failed to persist theme mode:', err)
        })
        // No preview is active for a direct toggle. clearPreview rebroadcasts the
        // now-persisted appearance so all windows apply the new mode.
        window.rokdock.appearance.clearPreview()
    },
    /**
     * Load all persisted settings and preferences from the main process via IPC
     * and apply them to the store. Called once on app startup.
     * Handles theme-aware fallback color migration for legacy settings.
     */
    loadSettings: async () => {
        // Settings come from two stores: static app settings + user preferences.
        const settings = await window.rokdock.store.getSettings()
        const prefs = await window.rokdock.store.getPreferences()
        // The user's actual choice (including 'system') is stored in themeMode below.
        // 'system' resolves to a concrete theme via nativeTheme in the main process.
        // Here we only need a concrete value for the fallback-color heuristic.
        const storedMode: ThemeModeSetting = prefs.themeMode ?? 'dark'
        const concreteMode = resolveConcreteThemeMode(storedMode)
        const prefFallback = prefs.terminalFallbackColor
        const resolvedFallback = (() => {
            if (!prefFallback) return concreteMode === 'light' ? DEFAULT_FALLBACK_TEXT_LIGHT : DEFAULT_FALLBACK_TEXT_DARK
            // Migrate the legacy single default to a readable light-mode default.
            if (concreteMode === 'light' && normalizeHex(prefFallback) === normalizeHex(DEFAULT_FALLBACK_TEXT_DARK)) {
                return DEFAULT_FALLBACK_TEXT_LIGHT
            }
            return prefFallback
        })()
        const deeplinks = await window.rokdock.deeplinks.list()
        set({
            ports: settings.ports,
            deeplinks,
            terminalFontSize: prefs.fontSize ?? 13,
            terminalFontFamily: prefs.fontFamily ?? '',
            terminalFallbackColor: resolvedFallback,
            terminalUseThemeBackground: prefs.terminalUseThemeBackground ?? false,
            terminalAutoScroll: prefs.autoScroll ?? true,
            terminalWordWrap: prefs.wordWrap ?? false,
            terminalSyntaxThemePreset: prefs.terminalSyntaxThemePreset ?? (concreteMode === 'dark' ? 'rokdockDark' : 'rokdockLight'),
            terminalSyntaxThemeCustomColors: prefs.terminalSyntaxThemeCustomColors ?? {},
            terminalCommandHistory: prefs.terminalCommandHistory ?? [],
            remoteKeyBindings: normalizeRemoteKeyBindings(prefs.remoteKeyBindings),
            tabLabelMode: prefs.tabLabelMode ?? 'displayName',
            themeMode: storedMode,
            appliedThemeMode: concreteMode,
            tint: prefs.tint ?? { hue: 0, saturation: 1, brightness: 0 },
            discoveryScanIntervalMs: prefs.discoveryScanIntervalMs ?? 60000,
            discoveryRequestTimeoutMs: prefs.discoveryRequestTimeoutMs ?? 5000,
            devAppPollIntervalMs: prefs.devAppPollIntervalMs ?? 3000,
            appZoomLevel: prefs.appZoomLevel ?? 0,
            uiFontScale: prefs.uiFontScale ?? 0,
            splitRatio: prefs.splitRatio ?? 0.5,
            collapsedPanels: prefs.collapsedPanels ?? ['scripts'],
            captureDeviceId: prefs.captureDeviceId ?? null,
            captureDeviceLabel: prefs.captureDeviceLabel ?? null,
            captureMuted: prefs.captureMuted ?? true,
            captureVolume: prefs.captureVolume ?? 80,
            captureMode: (prefs.captureMode === 'popout' ? 'docked' : (prefs.captureMode as CaptureMode)) ?? 'docked',
            captureDockSide: (prefs.captureDockSide as 'left' | 'right') ?? 'left',
            capturePipBounds: prefs.capturePipBounds ?? null,
            captureAspectRatio: (prefs.captureAspectRatio as '16:9' | '4:3' | 'auto') ?? 'auto',
            captureIdleTimeoutSec: prefs.captureIdleTimeoutSec ?? 3600,
            screenshotFolder: prefs.screenshotFolder ?? '',
            screenshotNamingFormat: prefs.screenshotNamingFormat ?? DEFAULT_SCREENSHOT_NAMING_FORMAT,
        })
    },
    /**
     * Persist the current settings and preferences back to the main process via IPC.
     * Called by SettingsDialog on save. Writes port config, deeplinks, and all
     * terminal/theme/behavior preferences.
     */
    saveSettings: async () => {
        // Persist app-level settings and user preferences separately.
        const {
            ports,
            deeplinks,
            terminalFontSize,
            terminalFontFamily,
            terminalFallbackColor,
            terminalUseThemeBackground,
            terminalAutoScroll,
            terminalWordWrap,
            terminalSyntaxThemePreset,
            terminalSyntaxThemeCustomColors,
            terminalCommandHistory,
            remoteKeyBindings,
            tabLabelMode,
            themeMode,
            tint,
            discoveryScanIntervalMs,
            discoveryRequestTimeoutMs,
            devAppPollIntervalMs,
            appZoomLevel,
            uiFontScale,
            splitRatio
        } = get()
        await window.rokdock.store.setSettings({ ports })
        await window.rokdock.deeplinks.saveAll(deeplinks)
        await window.rokdock.store.setPreferences({
            fontSize: terminalFontSize,
            fontFamily: terminalFontFamily,
            terminalFallbackColor,
            terminalUseThemeBackground,
            autoScroll: terminalAutoScroll,
            wordWrap: terminalWordWrap,
            terminalSyntaxThemePreset,
            terminalSyntaxThemeCustomColors,
            terminalCommandHistory,
            remoteKeyBindings,
            tabLabelMode,
            themeMode,
            tint,
            discoveryScanIntervalMs,
            discoveryRequestTimeoutMs,
            devAppPollIntervalMs,
            appZoomLevel,
            uiFontScale,
            splitRatio
        })
    },

    // Device nicknames
    deviceNicknames: {},
    /** Replace the full device nickname map (used during settings load). */
    setDeviceNicknames: (nicknames) => set({ deviceNicknames: nicknames }),
    deviceHasAuth: {},
    /** Replace the full device auth-state map (used during settings load). */
    setDeviceHasAuth: (states) => set({ deviceHasAuth: states }),
    /** Set the auth state for a single device IP without replacing the whole map. */
    setDeviceHasAuthForIp: (ip, hasAuth) => set(state => ({ deviceHasAuth: { ...state.deviceHasAuth, [ip]: hasAuth } })),
    /**
     * Set or clear the nickname for a device, persisting the change via IPC.
     * Passing an empty or whitespace-only string removes the nickname entry.
     */
    setDeviceNickname: (ip, nickname) => {
        const updated = { ...get().deviceNicknames }
        if (nickname.trim()) {
            updated[ip] = nickname.trim()
        } else {
            delete updated[ip]
        }
        set({ deviceNicknames: updated })
        window.rokdock.store.setDeviceNickname(ip, nickname)
    },

    // Settings dialog
    settingsDialogOpen: false,
    settingsDefaultTab: 'appearance',
    settingsDefaultSection: null,
    /**
     * Open or close the Settings dialog. Pass a `SettingsTab` to open directly to
     * a tab, optionally with an in-tab `section` anchor (e.g. open Appearance
     * scrolled to the Terminal section). Pass a boolean to just show/hide.
     */
    setSettingsDialogOpen: (open, section) => {
        if (typeof open === 'string') {
            set({ settingsDialogOpen: true, settingsDefaultTab: open, settingsDefaultSection: section ?? null })
        } else {
            set({ settingsDialogOpen: open, ...(open ? {} : { settingsDefaultSection: null }) })
        }
    },

    // Device properties dialog
    devicePropertiesDevice: null,
    devicePropertiesFocusField: 'nickname',
    /** Set the device shown in the Device Properties dialog, or null to close it. */
    setDevicePropertiesDevice: (device) => set({ devicePropertiesDevice: device }),
    /** Set which field ('nickname' or 'password') receives focus when Device Properties opens. */
    setDevicePropertiesFocusField: (field) => set({ devicePropertiesFocusField: field }),

    // Capture device preview
    captureDeviceId: null,
    captureDeviceLabel: null,
    captureMuted: true,
    captureVolume: 80,
    captureMode: 'docked' as CaptureMode,
    captureDockSide: 'left' as 'left' | 'right',
    capturePipBounds: null,
    captureAvailable: false,
    captureAspectRatio: 'auto' as '16:9' | '4:3' | 'auto',
    captureIdleTimeoutSec: 3600,

    /**
     * Refresh only the volatile device id. Used when re-resolving the remembered
     * device by label after Chromium re-salts deviceIds; the stable label is left
     * untouched so the device stays remembered.
     */
    setCaptureDeviceId: (id) => {
        set({ captureDeviceId: id })
        persistPreference({ captureDeviceId: id })
    },
    /**
     * Select a capture device. Persists both the volatile deviceId and the stable
     * label so the device can be re-resolved across launches even when its id changes.
     */
    setCaptureDevice: (id, label) => {
        set({ captureDeviceId: id, captureDeviceLabel: label })
        persistPreference({ captureDeviceId: id, captureDeviceLabel: label })
    },
    /** Set the capture audio mute state and persist it to preferences. */
    setCaptureMuted: (muted) => {
        set({ captureMuted: muted })
        persistPreference({ captureMuted: muted })
    },
    /** Set the capture audio volume (0-100) and persist it to preferences. */
    setCaptureVolume: (volume) => {
        set({ captureVolume: volume })
        persistPreference({ captureVolume: volume })
    },
    /** Set the capture display mode ('docked' or 'pip') and persist it to preferences. */
    setCaptureMode: (mode) => {
        set({ captureMode: mode })
        persistPreference({ captureMode: mode })
    },
    /** Set which side ('left' or 'right') the docked capture panel appears on, and persist it. */
    setCaptureDockSide: (side) => {
        set({ captureDockSide: side })
        persistPreference({ captureDockSide: side })
    },
    /** Set the Picture-in-Picture window bounds (x, y, w, h) and persist them to preferences. */
    setCapturePipBounds: (bounds) => {
        set({ capturePipBounds: bounds })
        persistPreference({ capturePipBounds: bounds })
    },
    /** Set whether any capture device is available (updated by useCaptureStream after enumeration). */
    setCaptureAvailable: (available) => set({ captureAvailable: available }),
    /** Set the forced capture aspect ratio ('16:9', '4:3', or 'auto') and persist to preferences. */
    setCaptureAspectRatio: (ratio) => {
        set({ captureAspectRatio: ratio })
        persistPreference({ captureAspectRatio: ratio })
    },
    /** Set the idle timeout in seconds before the capture stream is auto-paused (0 = disabled). Persists to preferences. */
    setCaptureIdleTimeoutSec: (sec) => {
        set({ captureIdleTimeoutSec: sec })
        persistPreference({ captureIdleTimeoutSec: sec })
    },

    screenshotFolder: '',
    screenshotNamingFormat: DEFAULT_SCREENSHOT_NAMING_FORMAT,
    /** Set the directory where screenshots are saved and persist it to preferences. */
    setScreenshotFolder: (folder) => {
        set({ screenshotFolder: folder })
        persistPreference({ screenshotFolder: folder })
    },
    /** Set the screenshot filename format string (supports `{YYYY}`, `{MM}`, etc. tokens) and persist to preferences. */
    setScreenshotNamingFormat: (format) => {
        set({ screenshotNamingFormat: format })
        persistPreference({ screenshotNamingFormat: format })
    },

    /**
     * Apply a broadcast appearance draft to the store in one atomic set call. No
     * persistence and no re-broadcast (the terminal and theme-aware UI read these
     * fields reactively and restyle immediately). themeMode may be 'system', and the
     * store keeps the raw choice and resolves it where a concrete palette is needed.
     */
    applyAppearance: (draft) => set({
        themeMode: draft.themeMode,
        // The document class was just updated by the css-vars broadcast that precedes
        // this one, so resolve the concrete applied mode from it (tracks OS flips).
        appliedThemeMode: resolveConcreteThemeMode(draft.themeMode),
        appZoomLevel: draft.appZoomLevel,
        uiFontScale: draft.uiFontScale,
        tint: draft.tint,
        terminalFontFamily: draft.fontFamily,
        terminalFontSize: draft.fontSize,
        terminalSyntaxThemePreset: draft.syntaxPreset as TerminalSyntaxThemePreset,
        terminalSyntaxThemeCustomColors: draft.syntaxCustom,
        terminalUseThemeBackground: draft.useThemeBackground,
        terminalFallbackColor: draft.fallbackColor,
    }),

    // AI chat
    aiConfigured: false,
    aiChatOpen: false,
    aiChatMessages: [],
    aiChatStreaming: null,
    aiChatError: null,
    aiChatDock: 'left',
    aiConversationId: null,
    aiDocSymbols: {},
    aiChatDrawerHeight: 280,
    leftPanelWidth: 240,
    rightPanelWidth: 240,
    leftSplitRatio: 0.5,

    setAiConfigured: (configured) => set(state => ({ aiConfigured: configured, aiChatOpen: configured ? state.aiChatOpen : false })),
    toggleAiChat: () => set(state => ({ aiChatOpen: !state.aiChatOpen })),
    setLeftPanelWidth: (px) => set({ leftPanelWidth: px }),
    setRightPanelWidth: (px) => set({ rightPanelWidth: px }),
    setLeftSplitRatio: (ratio) => set({ leftSplitRatio: Math.min(0.85, Math.max(0.15, ratio)) }),
    setAiChatDock: (dock) => {
        const update: Partial<AppState> = { aiChatDock: dock, aiChatOpen: true }
        if (dock === 'left') update.leftPanelOpen = true
        if (dock === 'right') update.rightPanelOpen = true
        set(update)
    },
    cycleAiChatDock: () => {
        const order: AiChatDock[] = ['left', 'middle', 'right']
        const current = get().aiChatDock
        const next = order[(order.indexOf(current) + 1) % order.length]
        get().setAiChatDock(next)
    },
    setAiChatDrawerHeight: (px) => set({ aiChatDrawerHeight: Math.min(680, Math.max(140, px)) }),

    sendChatMessage: async (text) => {
        const trimmed = text.trim()
        if (!trimmed) return
        const state = get()
        if (state.aiChatStreaming) return
        const priorMessages = state.aiChatMessages
        // Mint a conversationId lazily on the first message so subsequent turns in the same
        // chat can resume the CLI session. The id is stable for the lifetime of this conversation.
        let conversationId = state.aiConversationId
        if (!conversationId) { conversationId = crypto.randomUUID(); set({ aiConversationId: conversationId }) }
        set({ aiChatMessages: [...state.aiChatMessages, { role: 'user', content: trimmed }], aiChatError: null })
        try {
            const { sessionId } = await window.rokdock.ai.startStream({ messages: [...priorMessages, { role: 'user', content: trimmed }] }, conversationId)
            set({ aiChatStreaming: { sessionId, text: '', activity: null } })
        } catch (e) {
            set({ aiChatError: e instanceof Error ? e.message : String(e) })
        }
    },

    openChatWith: async (text) => {
        const dock = get().aiChatDock
        const update: Partial<AppState> = { aiChatOpen: true }
        if (dock === 'left') update.leftPanelOpen = true
        if (dock === 'right') update.rightPanelOpen = true
        set(update)
        await get().sendChatMessage(text)
    },

    cancelChat: () => {
        const streaming = get().aiChatStreaming
        if (!streaming) return
        window.rokdock.ai.cancelStream(streaming.sessionId)
        set(state => ({
            aiChatStreaming: null,
            aiChatMessages: streaming.text
                ? [...state.aiChatMessages, { role: 'assistant', content: streaming.text }]
                : state.aiChatMessages,
        }))
    },

    newChat: () => {
        const streaming = get().aiChatStreaming
        if (streaming) window.rokdock.ai.cancelStream(streaming.sessionId)
        // Null the conversationId so the next message mints a fresh one and starts a new CLI session.
        // Provider or model changes do not need explicit clearing: the host detects the mismatch and forces a START.
        set({ aiChatMessages: [], aiChatStreaming: null, aiChatError: null, aiConversationId: null })
    },

    loadDocSymbols: () => {
        if (docSymbolsRequested) return
        docSymbolsRequested = true
        void window.rokdock.ai.getDocSymbols()
            .then((map: Record<string, string>) => {
                // An empty map means the docs index was not ready yet (chat opened before
                // the tree loaded). Allow a retry on the next chat open rather than locking
                // in no links for the session; only a populated map sticks.
                if (Object.keys(map).length === 0) { docSymbolsRequested = false; return }
                set({ aiDocSymbols: map })
            })
            .catch(() => { docSymbolsRequested = false /* allow a retry on the next chat open. linkify stays off until then */ })
    },

    initAiChatStream: () => {
        if (aiStreamWired) return
        aiStreamWired = true
        window.rokdock.ai.onStreamChunk(({ sessionId, delta }: { sessionId: string; delta: string }) => {
            const streaming = get().aiChatStreaming
            if (!streaming || streaming.sessionId !== sessionId) return
            set({ aiChatStreaming: { ...streaming, text: streaming.text + delta } })
        })
        window.rokdock.ai.onStreamActivity(({ sessionId, name, args }: { sessionId: string; name: string; args: Record<string, unknown> }) => {
            const streaming = get().aiChatStreaming
            if (!streaming || streaming.sessionId !== sessionId) return
            set({ aiChatStreaming: { ...streaming, activity: formatActivity(name, args) } })
        })
        window.rokdock.ai.onStreamDone(({ sessionId, finalText, sources }: { sessionId: string; finalText: string; sources: { path: string; title: string }[] }) => {
            const streaming = get().aiChatStreaming
            if (!streaming || streaming.sessionId !== sessionId) return
            const message: ChatMessage = { role: 'assistant', content: finalText, ...(sources.length ? { sources } : {}) }
            set(state => ({
                aiChatStreaming: null,
                aiChatMessages: [...state.aiChatMessages, message],
            }))
        })
        window.rokdock.ai.onStreamError(({ sessionId, message }: { sessionId: string; message: string }) => {
            const streaming = get().aiChatStreaming
            if (!streaming || streaming.sessionId !== sessionId) return
            set({ aiChatStreaming: null, aiChatError: message })
        })
    },
}))

/**
 * Factory for creating a new `TabInfo` object with sensible defaults.
 * The returned tab always starts in 'connecting' status, with no activity badge,
 * and is initially assigned to pane 'a' (addTab will re-assign to the focused pane).
 *
 * @param id - Unique tab identifier (typically a UUID).
 * @param deviceIp - IP address of the Roku device for this tab.
 * @param deviceName - Display name used in the tab strip label.
 * @param port - Telnet/debug port number (e.g. 8085 for the main dev channel).
 * @param options - Optional overrides for autoScroll and wordWrap defaults.
 */
export function createTabInfo(
    id: string,
    deviceIp: string,
    deviceName: string,
    port: number,
    options?: { autoScroll?: boolean; wordWrap?: boolean }
): TabInfo {
    return {
        id,
        deviceIp,
        deviceName,
        port,
        status: 'connecting',
        autoScroll: options?.autoScroll ?? true,
        wordWrap: options?.wordWrap ?? false,
        hasActivity: false,
        paneId: 'a'
    }
}
