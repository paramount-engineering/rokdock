/**
 * In-window Appearance settings modal for dock-less tool windows.
 *
 * This is the standalone counterpart to the dock's Settings dialog: the toolbar
 * gear opens it as a modal overlay inside the current tool window (not a separate
 * OS window), so the experience matches the dock. It reuses the same prop-driven
 * AppearanceTab with the dock-only Terminal section gated off (terminal: false).
 *
 * It is mounted imperatively via mountAppearanceModal() so it can be code-split:
 * the React modal (and AppearanceTab) load only when the gear is first clicked,
 * keeping the lean vanilla tool-window bundles out of React at boot.
 *
 * Every control is save-gated: changing any setting previews the full draft live
 * across all windows (appearance.previewDraft), nothing persists until Save, and
 * Cancel or close clears the preview override so main rebroadcasts the persisted
 * values, reverting. The same model is used by the dock Settings dialog.
 *
 * The Code section (font and syntax/colors) is enabled for tool windows that have
 * a JSON editor.
 */

import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { CSSProperties } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark } from '@fortawesome/free-solid-svg-icons'
import { IDENTITY_TINT, type Tint } from '@shared/colorTint'
import type { AppPreferences } from '@shared/types'
import type { AppearanceDraft } from '@shared/appearanceDraft'
import DialogFrame from '../common/dialogFrame'
import { AppearanceTab } from './appearanceTab'
import {
    resolveSyntaxTheme,
    syntaxPresetForMode,
    type TerminalSyntaxThemePreset,
    type TerminalTokenPalette
} from '../../styles/terminalSyntaxThemes'
import { resolveThemeMode } from '../../styles/theme'
import { FONT_PRESETS, TERMINAL_THEME_OPTIONS } from './codeAppearanceConstants'

type ThemeMode = 'dark' | 'light' | 'system'

function asThemeMode(value: unknown): ThemeMode {
    return value === 'light' || value === 'system' ? value : 'dark'
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
    justifyContent: 'center'
}

const DIALOG_STYLE: CSSProperties = { width: 460, maxWidth: '92vw', display: 'flex', flexDirection: 'column' }
const BODY_STYLE: CSSProperties = { padding: 'var(--rokdock-space-lg)', maxHeight: '70vh', overflowY: 'auto' }

// Local style constants matching the dock dialog equivalents.
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
const SECTION_STYLE: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14 }
const COLOR_ROW_STYLE: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center' }
const COLOR_INPUT_STYLE: CSSProperties = {
    width: 28,
    height: 28,
    padding: 0,
    border: '1px solid var(--rokdock-border)',
    borderRadius: 'var(--rokdock-radius-sm)',
    background: 'transparent',
    cursor: 'pointer'
}

function AppearanceModal({ onClose }: { onClose: () => void }) {
    const [loaded, setLoaded] = useState(false)
    const [themeMode, setThemeMode] = useState<ThemeMode>('dark')
    const [zoomLevel, setZoomLevel] = useState(0)
    const [fontScale, setFontScale] = useState(0)
    const [tint, setTint] = useState<Tint>(IDENTITY_TINT)

    // Code section draft state.
    const [fontFamily, setFontFamily] = useState('')
    const [fontSize, setFontSize] = useState(13)
    const [syntaxPreset, setSyntaxPreset] = useState<TerminalSyntaxThemePreset>('rokdockDark')
    const [syntaxCustom, setSyntaxCustom] = useState<Partial<TerminalTokenPalette>>({})
    const [useThemeBackground, setUseThemeBackground] = useState(false)
    const [fallbackColor, setFallbackColor] = useState('#e0e0e0')
    const [fontPickerMode, setFontPickerMode] = useState<'preset' | 'custom'>('preset')

    useEffect(() => {
        let cancelled = false
        void window.rokdock.store.getPreferences().then((preferences: AppPreferences) => {
            if (cancelled) return
            setThemeMode(asThemeMode(preferences.themeMode))
            setZoomLevel(preferences.appZoomLevel ?? 0)
            setFontScale(preferences.uiFontScale ?? 0)
            setTint(preferences.tint ?? IDENTITY_TINT)

            // Seed the code section from persisted preferences. Derive the light/dark
            // default for the syntax preset from the document class so it matches
            // the current theme at open time.
            const isLightAtOpen = document.documentElement.classList.contains('theme-light')
            const defaultPreset: TerminalSyntaxThemePreset = isLightAtOpen ? 'rokdockLight' : 'rokdockDark'
            const storedPreset = preferences.terminalSyntaxThemePreset
            // 'custom' is not a selectable preset in this UI. Fall back to the default.
            const resolvedPreset: TerminalSyntaxThemePreset =
                storedPreset && storedPreset !== 'custom' ? storedPreset : defaultPreset
            setFontFamily(preferences.fontFamily ?? '')
            setFontSize(preferences.fontSize ?? 13)
            setSyntaxPreset(resolvedPreset)
            setSyntaxCustom(preferences.terminalSyntaxThemeCustomColors ?? {})
            setUseThemeBackground(preferences.terminalUseThemeBackground ?? true)
            setFallbackColor(preferences.terminalFallbackColor ?? '#e0e0e0')
            setFontPickerMode('preset')

            setLoaded(true)
        })
        return () => { cancelled = true }
    }, [])

    // Derive isLight from the live document class so the preview reacts to theme
    // changes made in this same modal session.
    const isLight = document.documentElement.classList.contains('theme-light')

    // Memoized syntax theme preview. Recomputed when the preset, custom colors,
    // or light/dark mode changes.
    const previewSyntaxTheme = useMemo(
        () => resolveSyntaxTheme(syntaxPreset, isLight ? 'light' : 'dark', syntaxCustom),
        [syntaxPreset, isLight, syntaxCustom]
    )

    /** Returns the hex color for a token kind in the current preview theme.
     *  Falls back to fallbackColor when no syntax preset is active. */
    const previewColor = (kind: keyof TerminalTokenPalette): string => {
        if (syntaxPreset === 'none') return fallbackColor
        return previewSyntaxTheme.colors[kind] ?? fallbackColor
    }

    // Build the full draft from current state plus a one-field patch, and preview it
    // across all windows. Only one field changes per handler, so reading the rest
    // from the current render is correct.
    const buildDraft = (patch: Partial<AppearanceDraft>): AppearanceDraft => ({
        themeMode,
        appZoomLevel: zoomLevel,
        uiFontScale: fontScale,
        tint,
        fontFamily,
        fontSize,
        syntaxPreset,
        syntaxCustom: syntaxCustom as Record<string, string>,
        useThemeBackground,
        fallbackColor,
        ...patch,
    })
    const preview = (patch: Partial<AppearanceDraft>): void =>
        window.rokdock.appearance.previewDraft(buildDraft(patch))

    // Every control is a save-gated live preview: update local draft, preview across
    // windows, persist only on Save, revert on Cancel/close (main rebroadcasts the
    // persisted values when the preview override is cleared).
    const handleThemeMode = (mode: ThemeMode) => {
        const nextPreset = syntaxPresetForMode(syntaxPreset, resolveThemeMode(mode))
        setThemeMode(mode)
        setSyntaxPreset(nextPreset)
        preview({ themeMode: mode, syntaxPreset: nextPreset })
    }
    const handleFontScale = (px: number) => { setFontScale(px); preview({ uiFontScale: px }) }
    const handleTint = (next: Tint) => { setTint(next); preview({ tint: next }) }

    /** Discard the preview and close. Main rebroadcasts the persisted appearance, reverting. */
    const handleCancel = () => {
        window.rokdock.appearance.clearPreview()
        onClose()
    }

    /** Persist the full draft, then clear the preview override (main rebroadcasts the
     *  now-saved values) and close. */
    const handleSave = async () => {
        await window.rokdock.store.setPreferences({
            themeMode,
            appZoomLevel: zoomLevel,
            uiFontScale: fontScale,
            tint,
            fontFamily,
            fontSize,
            terminalSyntaxThemePreset: syntaxPreset,
            terminalSyntaxThemeCustomColors: syntaxCustom,
            terminalUseThemeBackground: useThemeBackground,
            terminalFallbackColor: fallbackColor,
        })
        window.rokdock.appearance.clearPreview()
        onClose()
    }

    const codeProps = {
        fieldStyle: FIELD_STYLE,
        smallBtnStyle: SMALL_BTN_STYLE,
        sectionStyle: SECTION_STYLE,
        colorRowStyle: COLOR_ROW_STYLE,
        colorInputStyle: COLOR_INPUT_STYLE,
        fontPresets: FONT_PRESETS,
        terminalThemeOptions: TERMINAL_THEME_OPTIONS,
        fontPickerMode,
        setFontPickerMode,
        localFontFamily: fontFamily,
        setLocalFontFamily: (value: string) => { setFontFamily(value); preview({ fontFamily: value }) },
        localFontSize: fontSize,
        setLocalFontSize: (value: number) => { setFontSize(value); preview({ fontSize: value }) },
        localSyntaxPreset: syntaxPreset,
        setLocalSyntaxPreset: (value: TerminalSyntaxThemePreset) => { setSyntaxPreset(value); preview({ syntaxPreset: value }) },
        localUseThemeBackground: useThemeBackground,
        setLocalUseThemeBackground: (value: boolean) => { setUseThemeBackground(value); preview({ useThemeBackground: value }) },
        localFallbackColor: fallbackColor,
        setLocalFallbackColor: (value: string) => { setFallbackColor(value); preview({ fallbackColor: value }) },
        previewSyntaxTheme,
        previewColor,
    }

    return (
        <DialogFrame open onClose={handleCancel} dialogStyle={DIALOG_STYLE}>
            <div className="rokdock-dialog-header">
                <span className="rokdock-title">Appearance</span>
                <button style={CLOSE_BTN_STYLE} onClick={handleCancel} aria-label="Close"><FontAwesomeIcon icon={faXmark} /></button>
            </div>
            <div style={BODY_STYLE}>
                {loaded && (
                    <AppearanceTab
                        context={{ surfaces: { terminal: false, code: true } }}
                        initialSection={null}
                        themeMode={themeMode}
                        onThemeMode={handleThemeMode}
                        uiFontScale={fontScale}
                        onUiFontScale={handleFontScale}
                        tint={tint}
                        onTint={handleTint}
                        codeProps={codeProps}
                    />
                )}
            </div>
            <div className="rokdock-dialog-actions">
                <button className="rokdock-btn rokdock-btn-ghost" onClick={handleCancel}>Cancel</button>
                <button className="rokdock-btn rokdock-btn-primary" onClick={handleSave}>Save</button>
            </div>
        </DialogFrame>
    )
}

// One modal at a time per window; a second gear click while open is a no-op.
let activeHost: HTMLDivElement | null = null

/**
 * Mounts the Appearance modal as an overlay in the current window. Creates a
 * detached React root in a host div appended to the body so it works in both
 * React (Docs) and vanilla (SVG/9-Patch/JSON/Script/Screenshot) tool windows.
 * Idempotent while open.
 */
export function mountAppearanceModal(): void {
    if (activeHost) return
    const host = document.createElement('div')
    activeHost = host
    document.body.appendChild(host)
    const root = createRoot(host)
    const close = () => {
        root.unmount()
        host.remove()
        if (activeHost === host) activeHost = null
    }
    root.render(<AppearanceModal onClose={close} />)
}
