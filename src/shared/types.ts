/**
 * Shared application-wide TypeScript types used across the main process, preload,
 * and renderer. These interfaces define the shape of persistent data (preferences,
 * device auth, port/deeplink configs) and the cross-process IpcResult return type.
 *
 * Any field added here typically needs a corresponding UI control, store update,
 * and IPC handler update to be fully wired in.
 */

import type { DocsLibraryEntry, DocsLayoutMode } from './docs/types'
import type { Tint } from './colorTint'
import type { StoredAiProfile, AiCliOverrides } from './ai/types'

export type CaptureMode = 'docked' | 'pip' | 'popout' | 'screenshot-preview' | 'off'

export interface PortConfig {
    port: number
    label: string
    color: string
    enabled: boolean
}

export interface DeeplinkParam {
    key: string
    value: string
}

export interface DeeplinkConfig {
    id: string
    name: string
    type: 'launch' | 'input'
    appId: string
    mediaType: string
    contentId: string
    extraParams: DeeplinkParam[]
}

export interface DeviceAuth {
    username: string
    password: string
}

export interface AppPreferences {
    autoScroll: boolean
    wordWrap: boolean
    fontSize: number
    fontFamily: string
    terminalFallbackColor: string
    terminalUseThemeBackground: boolean
    terminalSyntaxThemePreset:
        | 'none'
        | 'rokdockDark'
        | 'rokdockLight'
        | 'atomOneDark'
        | 'atomOneLight'
        | 'oneLight'
        | 'oneDarkPro'
        | 'dracula'
        | 'nord'
        | 'solarizedDark'
        | 'solarizedLight'
        | 'monokai'
        | 'tokyoNightDay'
        | 'tokyoNight'
        | 'githubDark'
        | 'githubLight'
        | 'gruvboxDark'
        | 'gruvboxLight'
        | 'catppuccinMocha'
        | 'catppuccinLatte'
        | 'custom'
    terminalSyntaxThemeCustomColors: Partial<Record<
        | 'plain'
        | 'prompt'
        | 'brightscriptDebuggerPrompt'
        | 'comment'
        | 'separator'
        | 'debuggerBanner'
        | 'sectionHeader'
        | 'threadRow'
        | 'stackFrame'
        | 'sourceLineNumber'
        | 'selectedMarker'
        | 'logTag'
        | 'beaconMetric'
        | 'filePath'
        | 'referenceMeta'
        | 'rokuType'
        | 'functionName'
        | 'objectKey'
        | 'objectPunctuation'
        | 'objectStringValue'
        | 'objectNumberValue'
        | 'objectBooleanValue'
        | 'objectNullValue'
        | 'string'
        | 'number'
        | 'boolean'
        | 'nullish'
        | 'error'
        | 'warning'
        | 'info'
        | 'debug'
        | 'trace'
        | 'rokuSymbol'
        | 'keyword'
        | 'dateTime'
        | 'bracketContent'
        | 'pathLike'
        | 'url'
        | 'queryKey'
        | 'queryValue',
        string
    >>
    terminalCommandHistory: string[]
    /** Previously-applied live-filter regex patterns, most-recent-last (same shape as terminalCommandHistory). */
    terminalFilterHistory: string[]
    remoteKeyBindings: Record<string, string>
    tabLabelMode: 'displayName' | 'ip'
    /**
     * Band the terminal output by app run, alternating a subtle background tint at every
     * "Running dev ..." marker the Roku console emits at app launch. Defaults to true.
     */
    terminalHighlightAppLaunchLines: boolean
    themeMode: 'dark' | 'light' | 'system'
    /** HSL Appearance tint over background and accent tokens. Identity = no change. */
    tint: Tint
    /** Configured AI provider profiles (no secrets; keys live in ai-secrets.json). */
    aiProfiles: StoredAiProfile[]
    /** The id of the active profile, or null if none configured. */
    aiActiveProfileId: string | null
    /** Per-CLI overrides for auto-detected CLI providers (model, redaction, hidden). */
    aiCliOverrides: AiCliOverrides
    /** When false, roBot performs state-changing device actions (press key, launch channel,
     *  type text, deeplink) without asking for confirmation each time. Defaults to true
     *  (confirm) when unset. Toggled on the AI settings tab and persisted across sessions. */
    aiConfirmDeviceControl?: boolean
    discoveryScanIntervalMs: number
    discoveryRequestTimeoutMs: number
    devAppPollIntervalMs: number
    appZoomLevel: number
    /** Offset in px applied to --rokdock-font-base (the UI type-scale anchor). 0 = default 14px. */
    uiFontScale: number
    screenshotZoomPercent: number
    screenshotAutoRefreshEnabled: boolean
    screenshotAutoRefreshIntervalSec: number
    /** 0-100; design overlay (onion skin) blend over the live screenshot. */
    screenshotOnionOpacityPercent: number
    /**
     * Recently used comparison overlays (newest first), max 20.
     * File entries are absolute paths - picked images are copied under userData/onion-overlays so
     * history keeps working if the original file moves or is deleted. Also `rokdock-builtin:<id>`.
     */
    screenshotOnionOverlayHistory: string[]
    splitRatio: number
    collapsedPanels: string[]
    expandedPanels: string[]
    // Capture device preview
    captureDeviceId: string | null
    /** Stable label of the remembered capture device. Used to re-resolve the volatile
     *  captureDeviceId across launches, since Chromium re-salts deviceIds per session. */
    captureDeviceLabel: string | null
    captureMuted: boolean
    captureVolume: number
    captureMode: CaptureMode
    captureDockSide: 'left' | 'right'
    capturePipBounds: { x: number; y: number; w: number; h: number } | null
    captureAspectRatio: '16:9' | '4:3' | 'auto'
    /** Seconds of inactivity before the capture stream is paused to release the OS wake lock. 0 = never. */
    captureIdleTimeoutSec: number
    /** Absolute path to the folder where screenshots are saved. Empty string = default userData folder. */
    screenshotFolder: string
    /** Filename format for saved screenshots. Supports {YYYY} {MM} {DD} {HH} {mm} {ss} tokens. */
    screenshotNamingFormat: string
    favoriteDocs?: DocsLibraryEntry[]
    recentDocs?: DocsLibraryEntry[]
    /** Per-page field-table layout overrides, keyed by repo-relative page path. A
     * page the reader has switched remembers that choice across sessions; every
     * other page defaults to Auto. */
    docsLayoutByPath?: Record<string, DocsLayoutMode>
    /** Per-page docs view counts, keyed by repo-relative page path, for the
     * "Frequently Viewed" sidebar section. */
    docsViewCounts?: Record<string, { title: string; count: number }>
    /** Reading-pane text zoom for the docs viewer: a multiplier on the prose
     * font size, adjusted with Ctrl+=/Ctrl+-/Ctrl+0. Affects only the reading
     * content, not the window chrome (that is the Appearance UI scale). */
    docsReadingScale?: number
    /** Per-page personal notes for the docs viewer, keyed by repo-relative
     * page path. A missing key means no note exists for that page. */
    docsNotesByPath?: Record<string, string>
}

export interface StoreSettings {
    ports: PortConfig[]
    deeplinks: DeeplinkConfig[]
}

export interface SettingsUpdate {
    ports?: PortConfig[]
    deeplinks?: DeeplinkConfig[]
}

export interface IpcResult {
    ok: boolean
    error?: string
    path?: string
}

/**
 * Slim theme payload for bundled renderer entries. Contains only the fields
 * needed to apply CSS vars and theme classes. Bundled entries import fonts,
 * component CSS, and controls JS as Vite modules and do not need those fields.
 */
export interface ThemeVars {
    themeMode: 'dark' | 'light'
    cssVars: Record<string, string>
    platform: string
    /** The persisted global webFrame zoom level, applied per window on boot. */
    appZoomLevel: number
}

export type AiChatDock = 'left' | 'middle' | 'right'

export interface PanelState {
    leftOpen: boolean
    rightOpen: boolean
    leftWidth?: number
    leftSplit?: number
    rightWidth?: number
    aiChatOpen?: boolean
    aiChatDock?: AiChatDock
    aiChatDrawerHeight?: number
}
