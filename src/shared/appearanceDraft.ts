/**
 * The full set of visual appearance settings that a Settings surface (the dock
 * dialog or a tool-window Appearance modal) edits as one draft.
 *
 * While a surface is open, its draft is previewed live across every window
 * through a single main-process override (appearance:preview-draft). Nothing
 * persists until Save. Cancel or close clears the override and main rebroadcasts
 * the persisted values, reverting the preview. Holding all fields in one draft
 * (rather than per-field preview channels) is what lets several unsaved changes
 * preview together without one field's broadcast reverting another's.
 *
 * This is the single source of truth for the preview payload shape: main reads it
 * (resolving nothing, since syntax-theme resolution is renderer code), the preload
 * relays it, and the dock terminal and JSON editor consume it. Tab Label Format is
 * NOT here: it has no cross-window visual and stays a dock-local draft.
 *
 * Pure, dependency-light (only the Tint type), so the main process, preload, and
 * renderer all import it safely.
 */
import type { Tint } from './colorTint'

export interface AppearanceDraft {
    themeMode: 'dark' | 'light' | 'system'
    appZoomLevel: number
    /** Offset in px applied to --rokdock-font-base (the UI type-scale anchor). 0 = default. */
    uiFontScale: number
    tint: Tint
    fontFamily: string
    fontSize: number
    syntaxPreset: string
    syntaxCustom: Record<string, string>
    useThemeBackground: boolean
    fallbackColor: string
}
