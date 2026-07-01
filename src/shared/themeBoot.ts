import type { ThemeVars } from './types'

/**
 * Bundled-entry theme boot helper.
 *
 * Ordering guarantee:
 *  1. Apply CSS vars to :root while `rokdock-theme-pending` is still on <html>.
 *     Because the HTML carries `.rokdock-theme-pending * { transition: none !important; }`,
 *     every property change at this step is instant with no animation.
 *  2. Await document.fonts.ready so the body is never shown with fallback fonts.
 *  3. Remove `rokdock-theme-pending` from <html>. The inline critical CSS rule
 *     `visibility: hidden` lifts and transitions re-enable for user interaction.
 *
 * The body is ALWAYS revealed in the finally block even if theme fetch fails,
 * so a broken IPC channel cannot produce a permanently blank window.
 *
 * Import and call this once near the top of each bundled Vite entry module.
 */

/** True when the active theme is light (the entry's <html> carries `theme-light`). */
export function isLightTheme(): boolean {
    return document.documentElement.classList.contains('theme-light')
}

export async function bootBundledTheme(): Promise<void> {
    try {
        const data: ThemeVars = await window.rokdock.theme.getVars()

        document.documentElement.classList.add(`platform-${data.platform}`)
        document.documentElement.classList.add(`theme-${data.themeMode}`)

        for (const [key, value] of Object.entries(data.cssVars)) {
            document.documentElement.style.setProperty(key, value)
        }

        // Apply persisted zoom level so every window boots at the correct UI scale.
        try {
            window.rokdock.zoom.setLevel(data.appZoomLevel ?? 0)
        } catch {
            // zoom bridge unavailable (non-bundled context); ignore
        }

        // Wait for web fonts so the first visible paint uses the correct typeface.
        try {
            await document.fonts.ready
        } catch {
            // fonts.ready failure is non-fatal; reveal anyway
        }
    } catch {
        // Theme fetch failed; proceed to reveal so the window is not permanently hidden.
    } finally {
        document.documentElement.classList.remove('rokdock-theme-pending')
    }
}
