/**
 * Renderer-side theme utilities and the useTheme() hook.
 *
 * Re-exports the shared Theme types and theme data objects from
 * src/shared/theme-data so renderer components have a single import point.
 *
 * useTheme(): React hook that reads the current themeMode from appStore and
 * returns { theme, themeMode }. Memoized on themeMode so components
 * only re-render when the theme actually changes, not on every store update.
 */
import { useMemo } from 'react'
import { useAppStore } from '../store/appStore'
import type { Theme, ThemeMode } from '../../shared/themeData'
import { darkTheme, lightTheme } from '../../shared/themeData'
import { isLightTheme } from '../../shared/themeBoot'
import type { ThemeModeSetting } from '../store/appStore'

// Re-export pure theme data from shared (also used by the main process).
export type { ThemeMode, Theme } from '../../shared/themeData'
export { darkTheme, lightTheme, toCSSVars } from '../../shared/themeData'

/**
 * Resolve a stored theme-mode setting to a concrete 'dark' | 'light'. The store
 * field can hold 'system', which is not a real palette; 'system' resolves to the
 * theme currently applied to the document (the boot path and the live
 * theme:css-vars-updated handler keep `theme-dark` / `theme-light` on <html>),
 * defaulting to 'dark' when no class is present.
 */
export function resolveThemeMode(mode: ThemeModeSetting): ThemeMode {
    if (mode === 'system') return isLightTheme() ? 'light' : 'dark'
    return mode
}

// -- useTheme hook -----------------------------------------------
/**
 * React hook that returns the current theme and theme mode. Reads themeMode
 * from appStore and resolves the matching Theme object. Memoized so components
 * only re-render when the theme actually changes, not on every unrelated store
 * update.
 *
 * @returns An object containing the resolved Theme and the active ThemeMode
 *          ('dark' | 'light').
 */
export function useTheme(): { theme: Theme; themeMode: ThemeMode } {
    // appliedThemeMode is the concrete mode currently on the document, updated from
    // the appearance broadcast. Reading it (rather than resolving themeMode, which
    // stays 'system') makes consumers re-render on an OS dark/light flip too.
    const themeMode = useAppStore(state => state.appliedThemeMode)
    const resolvedTheme = themeMode === 'light' ? lightTheme : darkTheme
    return useMemo(() => ({ theme: resolvedTheme, themeMode }), [resolvedTheme, themeMode])
}
