/**
 * IPC handlers for theme initialization and live appearance preview.
 *
 * Every window applies its initial theme in the renderer via bootBundledTheme()
 * (theme:get-vars). While a Settings surface (the dock dialog or a tool-window
 * Appearance modal) is open, it previews its full draft live across every window
 * through a single override here (appearance:preview-draft). Nothing persists
 * until Save. appearance:clear-preview drops the override and rebroadcasts the
 * persisted values, reverting the preview. Each broadcast fans three messages:
 * CSS vars (theme:css-vars-updated) for CSS-var styling, the zoom level
 * (appearance:zoom-changed) for webFrame zoom, and the full applied appearance
 * (appearance:applied) so store-driven surfaces (the dock terminal and theme-aware
 * UI, the JSON editor's CodeMirror) reflect it.
 */

import { BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { darkTheme, lightTheme, toCSSVars } from '../../../shared/themeData'
import { IDENTITY_TINT } from '../../../shared/colorTint'
import type { AppearanceDraft } from '../../../shared/appearanceDraft'
import type { AppPreferences } from '../../../shared/types'
import type { IpcContext } from '../types'

type ThemeStore = IpcContext['store']

/**
 * The full appearance draft being previewed while a Settings surface is open, or
 * null when none is. Broadcasts prefer it over the persisted prefs so several
 * unsaved changes preview together and no field's broadcast reverts another's.
 */
let appearanceDraft: AppearanceDraft | null = null

/**
 * The webContents id of the surface that established the current preview. The dock
 * dialog and a tool-window modal can be open at once and share this one slot, so
 * only the owner may clear it (a non-owner close must not revert the owner's
 * in-flight preview). Null whenever appearanceDraft is null.
 */
let appearanceDraftOwner: number | null = null

/**
 * Resolve a stored theme mode to the concrete mode to render. 'system'
 * follows the OS via the caller-supplied prefersDark.
 *
 * @param mode - The stored preference: 'dark', 'light', or 'system'.
 * @param prefersDark - Whether the OS is currently in dark mode.
 */
export function resolveThemeMode(mode: 'dark' | 'light' | 'system', prefersDark: boolean): 'dark' | 'light' {
    if (mode === 'system') return prefersDark ? 'dark' : 'light'
    return mode
}

/** The persisted appearance as a full draft (the fallback when no preview is active). */
function persistedAppearance(preferences: AppPreferences): AppearanceDraft {
    return {
        themeMode: preferences.themeMode ?? 'dark',
        appZoomLevel: preferences.appZoomLevel ?? 0,
        uiFontScale: preferences.uiFontScale ?? 0,
        tint: preferences.tint ?? IDENTITY_TINT,
        fontFamily: preferences.fontFamily ?? '',
        fontSize: preferences.fontSize ?? 13,
        syntaxPreset: preferences.terminalSyntaxThemePreset ?? 'rokdockDark',
        syntaxCustom: (preferences.terminalSyntaxThemeCustomColors ?? {}) as Record<string, string>,
        useThemeBackground: preferences.terminalUseThemeBackground ?? false,
        fallbackColor: preferences.terminalFallbackColor ?? '#e0e0e0',
    }
}

/** Build the CSS var map (theme + mono font + tint + font-base offset) for an appearance. */
function cssVarsFor(appearance: AppearanceDraft, fontBaseOffset: number): { resolved: 'dark' | 'light'; cssVars: Record<string, string> } {
    const resolved = resolveThemeMode(appearance.themeMode, nativeTheme.shouldUseDarkColors)
    const theme = resolved === 'light' ? lightTheme : darkTheme
    const cssVars = toCSSVars(theme, { monoFont: appearance.fontFamily || undefined, tint: appearance.tint, fontBaseOffset })
    return { resolved, cssVars }
}

/**
 * The appearance to render now (the live preview draft, else the persisted values)
 * together with its resolved CSS-var map. Reads preferences once so the appearance
 * and the font-scale offset come from a single snapshot.
 */
function effectiveThemeVars(store: ThemeStore): { appearance: AppearanceDraft; resolved: 'dark' | 'light'; cssVars: Record<string, string> } {
    const appearance = appearanceDraft ?? persistedAppearance(store.getPreferences())
    return { appearance, ...cssVarsFor(appearance, appearance.uiFontScale) }
}

/** Fan the effective appearance to every open window: CSS vars, zoom, applied draft. */
function broadcastAppearance(store: ThemeStore): void {
    const { appearance, resolved, cssVars } = effectiveThemeVars(store)
    for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue
        win.webContents.send('theme:css-vars-updated', { themeMode: resolved, cssVars })
        win.webContents.send('appearance:zoom-changed', appearance.appZoomLevel)
        win.webContents.send('appearance:applied', appearance)
    }
}

/**
 * Drop any active preview draft and rebroadcast the persisted appearance to every
 * window. Shared by the three revert paths: clearing a preview on Save/Cancel,
 * recovering when a preview owner is destroyed, and the config reset (where the
 * persisted appearance is the factory default, so this reverts the dock and every
 * open tool window live without the resetting surface clearing its own preview).
 */
export function clearPreviewAndBroadcast(store: ThemeStore): void {
    appearanceDraft = null
    appearanceDraftOwner = null
    broadcastAppearance(store)
}

/** Validate a raw preview-draft payload into an AppearanceDraft, or null if malformed. */
function parseDraft(raw: unknown): AppearanceDraft | null {
    if (!raw || typeof raw !== 'object') return null
    const record = raw as Record<string, unknown>
    const tint = record.tint as Record<string, unknown> | undefined
    if (!tint || typeof tint.hue !== 'number' || typeof tint.saturation !== 'number' || typeof tint.brightness !== 'number') return null
    if (record.themeMode !== 'dark' && record.themeMode !== 'light' && record.themeMode !== 'system') return null
    if (typeof record.appZoomLevel !== 'number' || !Number.isFinite(record.appZoomLevel)) return null
    if (typeof record.uiFontScale !== 'number' || !Number.isFinite(record.uiFontScale)) return null
    if (typeof record.fontSize !== 'number' || !Number.isFinite(record.fontSize)) return null
    if (typeof record.fontFamily !== 'string' || typeof record.syntaxPreset !== 'string' || typeof record.fallbackColor !== 'string') return null
    if (typeof record.useThemeBackground !== 'boolean' || !record.syntaxCustom || typeof record.syntaxCustom !== 'object') return null
    return {
        themeMode: record.themeMode,
        appZoomLevel: record.appZoomLevel,
        uiFontScale: record.uiFontScale,
        tint: { hue: tint.hue, saturation: tint.saturation, brightness: tint.brightness },
        fontFamily: record.fontFamily,
        fontSize: record.fontSize,
        syntaxPreset: record.syntaxPreset,
        syntaxCustom: record.syntaxCustom as Record<string, string>,
        useThemeBackground: record.useThemeBackground,
        fallbackColor: record.fallbackColor,
    }
}

/**
 * Registers the theme and appearance-preview IPC handlers.
 *
 * @param ctx - Shared IPC context providing store access.
 */
export function registerThemeHandlers(ctx: IpcContext): void {
    const { store } = ctx

    /**
     * Returns the theme vars a renderer entry needs to apply CSS vars and theme
     * classes on boot, plus the zoom level. Reflects an active preview draft so a
     * window opened mid-preview boots matching what every other window is showing.
     */
    ipcMain.handle('theme:get-vars', () => {
        const { appearance, resolved, cssVars } = effectiveThemeVars(store)
        return {
            themeMode: resolved,
            cssVars,
            platform: process.platform,
            appZoomLevel: appearance.appZoomLevel,
        }
    })

    /**
     * Fire-and-forget: a Settings surface calls this on every appearance change
     * while open. Stores the full draft as the live override and fans it out, so
     * the change previews across all windows without persisting.
     */
    ipcMain.on('appearance:preview-draft', (event, raw: unknown) => {
        const draft = parseDraft(raw)
        if (!draft) return
        const senderId = event.sender.id
        if (appearanceDraftOwner !== senderId) {
            // Drop the override if the owning surface is destroyed without clearing it
            // (a crash or forced close), so a stale preview cannot stick for the other
            // windows. Registered once per owner, on the owner-change transition.
            event.sender.once('destroyed', () => {
                if (appearanceDraftOwner !== senderId) return
                clearPreviewAndBroadcast(store)
            })
        }
        appearanceDraft = draft
        appearanceDraftOwner = senderId
        broadcastAppearance(store)
    })

    /**
     * Fire-and-forget: a Settings surface calls this on Save (after persisting) and
     * on Cancel/close. Drops the preview override (owner-guarded) and rebroadcasts
     * the persisted appearance, so the preview reverts to the saved values.
     */
    ipcMain.on('appearance:clear-preview', (event) => {
        if (appearanceDraftOwner !== null && appearanceDraftOwner !== event.sender.id) return
        clearPreviewAndBroadcast(store)
    })

    /**
     * When the stored mode is 'system', rebroadcast the appearance any time the OS
     * switches between light and dark so every window (and its store-driven,
     * theme-aware UI) updates immediately.
     */
    nativeTheme.on('updated', () => {
        if ((store.getPreferences().themeMode ?? 'dark') !== 'system') return
        broadcastAppearance(store)
    })
}
