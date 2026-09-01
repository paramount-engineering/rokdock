/**
 * RokDock design token system - the single source of truth for all visual values.
 *
 * This module is intentionally dependency-free (no React, no DOM) so it can be
 * imported safely from the main process, preload script, and renderer alike.
 *
 * How it works:
 *  - darkTheme / lightTheme: typed palette objects with every color, font, spacing,
 *    shadow, and transition value used across the app.
 *  - toCSSVars(): converts a Theme object to a flat map of --rokdock-* CSS custom
 *    properties. The renderer calls this on startup (and on theme change) and applies
 *    the vars to :root so every component can consume them without direct JS imports.
 *  - nativeWindowBg(): returns the correct opaque hex background for BrowserWindow
 *    creation so tool windows don't flash white before their HTML loads.
 *
 * Adding a new token:
 *  1. Add the value to both darkTheme.colors and lightTheme.colors.
 *  2. Add the --rokdock-* entry in toCSSVars().
 *  3. Use the CSS var in your component - never hardcode hex or rgba values.
 */

// Pure theme data - no React or DOM dependencies.
// Safe to import from the main process or preload.

import { applyTint, colorHsl, isIdentityTint, type Tint } from './colorTint'

// Theme mode type
export type ThemeMode = 'dark' | 'light'

// Dark palette
export const darkTheme = {
    colors: {
        primary: '#3A1C87',
        primaryLight: '#8A6FE0',
        primaryDark: '#2B1663',
        primaryFaded: 'rgba(58, 28, 135, 0.3)',

        // Hyperlink color. On the dark background the deep brand primary is
        // illegible, so links use the lighter violet for AA contrast.
        link: '#8A6FE0',

        // Deeper navy-violet palette aligned with toolbar accent.
        bg: '#0f1022',
        bgPanel: '#1d1a36',
        bgSurface: '#2e2a52',
        bgHover: '#38345e',
        bgActive: '#44406e',
        bgInput: '#1b1d33',
        bgTerminal: '#111326',
        // Code blocks / inline code: clearly lighter than bg so code reads as a
        // distinct surface against the near-black page (bgTerminal was too close).
        bgCode: '#23264a',

        text: '#f4f6ff',
        textDim: '#dde2f7',
        textMuted: '#c1c9e9',
        textBright: '#ffffff',

        online: '#4caf50',
        offline: '#757575',
        connecting: '#ff9800',
        error: '#f44336',

        border: 'rgba(138, 111, 224, 0.22)',
        borderLight: 'rgba(138, 111, 224, 0.20)',

        tabBg: '#19162e',
        tabActive: '#221e3c',
        tabHover: '#2a2648',

        btnPrimary: '#3A1C87',
        btnPrimaryHover: '#4B269B',
        btnDanger: '#dc3545',
        btnDangerHover: '#c82333',
        btnGhost: 'transparent',
        btnGhostHover: 'rgba(255, 255, 255, 0.08)',
        btnText: '#ffffff',

        // Global CSS tokens (synced to document via useEffect in App.tsx)
        selectionBg: 'rgba(138, 111, 224, 0.40)',
        selectionText: '#fff',
        focusBorder: 'rgba(90, 58, 176, 0.6)',
        focusShadow: 'rgba(58, 28, 135, 0.2)',
        scrollbarThumb: 'rgba(58, 74, 112, 0.58)',
        scrollbarThumbHover: 'rgba(82, 105, 160, 0.92)',

        // Contextual rgba values used inline in components
        overlayBg: 'rgba(0, 0, 0, 0.55)',
        cardGradientStart: 'rgba(52, 48, 88, 0.95)',
        cardGradientEnd: 'rgba(58, 28, 135, 0.28)',
        subtleShadow: 'rgba(0, 0, 0, 0.18)',
        strongShadow: 'rgba(0, 0, 0, 0.24)',
        menuTextPrimary: 'rgba(255, 255, 255, 0.75)',
        menuTextDim: 'rgba(255, 255, 255, 0.55)',
        menuBorder: 'rgba(255, 255, 255, 0.15)',
        menuActiveBg: 'rgba(255, 255, 255, 0.16)',
        errorText: '#ff8a80',
        bgGradientA: 'rgba(90, 58, 176, 0.18)',
        bgGradientB: 'rgba(79, 195, 247, 0.07)',
        tabGlow: 'rgba(58, 28, 135, 0.4)',

        // Script editor step type colors
        stepPress: '#6a9fdb',
        stepDelay: '#d4a843',
        stepText: '#7cc87c',
        stepLaunch: '#c87cc8',
        stepLoop: '#43b0d4',
        stepWait: '#d49043',
        stepValidate: '#43d4a8',
        stepOther: '#8888aa',
        stepError: '#e05555',
        stepBlock: '#3a9e9e',
        stepOnError: '#c87840',
        // Script editor value syntax colors
        valueVariable: '#c87cc8',
        valueString: '#7cc87c',
        valueNumber: '#6a9fdb',

        // JSON editor syntax colors (aligned with terminal rokdockDark preset)
        jsonKey: '#f7c873',
        jsonString: '#7fe7b2',
        jsonNumber: '#ffb686',
        jsonBoolean: '#ff8ea1',
        jsonNull: '#ff8ea1',
        jsonPunctuation: '#c6cceb',

        // Surface gradients
        panelGradientStart: '#221e44',
        panelGradientEnd: '#16132a',
        cardBg: '#1d1a36',
        cardBgEnd: '#16132a',

        // Checkerboard (transparency canvas)
        checkerA: '#352f52',
        checkerB: '#221e3a',

        // Canvas/viewport
        canvasBorder: 'rgba(255,255,255,.28)',
        viewportShadow: 'inset 0 0 40px rgba(0,0,0,.35), inset 0 1px 0 rgba(0,0,0,.2)',

        // White/black overlays (consolidated)
        whiteSubtle: 'rgba(255,255,255,.08)',
        whiteMedium: 'rgba(255,255,255,.2)',
        whiteBright: 'rgba(255,255,255,.32)',
        blackSubtle: 'rgba(0,0,0,.12)',
        blackMedium: 'rgba(0,0,0,.3)',

        // Remote text overlay
        remoteSlotBg: 'linear-gradient(180deg, #2d2d2d, #252525)',
        remoteSlotInputBg: 'linear-gradient(180deg, #2a2a2a, #242424)',
        remoteSlotBorder: 'rgba(8,10,13,.8)',
        remoteSlotShadow: 'inset 0 1px 2px rgba(0,0,0,.5), inset 0 -1px 0 rgba(255,255,255,.015)',
        remoteSlotText: '#d1d1d1',

        // Loading overlay
        loadingBg: 'rgba(20,18,38,.55)',
        loadingSpinnerBorder: 'rgba(255,255,255,.1)',

        // Empty state
        emptyIconBg: 'rgba(255,255,255,.04)',
        emptyIconBorder: 'rgba(255,255,255,.11)',
        emptyIconColor: 'rgba(200,208,230,.3)',
        emptyTitle: 'rgba(200,208,230,.5)',

        // Search highlighting (subtle amber, shared by the terminal and Developer Docs)
        searchHighlightActive: 'rgba(250,204,21,.34)',
        searchHighlightMatch: 'rgba(250,204,21,.16)',
        searchLineBg: 'rgba(250,204,21,.06)',
        searchLineActiveBg: 'rgba(250,204,21,.16)',

        // Terminal app-run banding (see computeAppRunBoundaries): a wash across every line of
        // an app run, alternating per run so consecutive launches read as distinct regions while
        // scrolling. Deliberately a very subtle neutral lightening, so it reads as a slightly
        // different surface rather than another syntax color. The accent (a warm gold, distinct
        // from the cool blues and cyans that dominate ordinary log text) is used only for the
        // thin rule marking exactly where a run started.
        terminalLaunchBannerBg: 'rgba(255,255,255,.03)',
        terminalLaunchBannerAccent: '#f59e0b',

        // Measure tool
        measureLine: '#bef264',
        measureShadow: 'rgba(0,0,0,.42)',

        // Scrollbar track
        scrollbarTrack: 'rgba(255,255,255,0.06)',

        // Toggle switch
        toggleTrack: 'rgba(170,170,190,.45)',
        toggleThumb: '#f4f7ff',

        // Range input
        rangeThumbRing: 'rgba(12,14,24,.74)',
        rangeThumbBorder: 'rgba(0,0,0,.35)',

        // Script running indicator
        scriptRunningBorder: 'rgba(255, 210, 60, 0.8)',
        scriptRunningBorderDim: 'rgba(255, 210, 60, 0.3)',

        // Accent divider + button glow
        accentDivider: 'rgba(138, 111, 224, 0.4)',
        btnPrimaryGlow: '0 2px 10px rgba(58, 28, 135, 0.55)',

        // Section header purple tint (collapsible headers)
        sectionHeaderBg: 'rgba(58, 28, 135, 0.30)',
        sectionHeaderColor: 'rgba(196, 188, 255, 0.88)',

        // Left panel gradient (richer purple near toolbar, fading down)
        leftPanelGradStart: '#261a4e',
        leftPanelGradEnd: '#131128',

        // Online state variations (for glow/fade effects)
        onlineGlow: 'rgba(76, 175, 80, 0.9)',
        onlineGlowDim: 'rgba(76, 175, 80, 0.3)',
        onlineFaded: 'rgba(76, 175, 80, 0.15)',
    },

    fonts: {
        mono: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, Menlo, Monaco, 'Ubuntu Mono', ui-monospace, monospace",
        ui: "'Source Sans 3', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', 'Ubuntu', system-ui, sans-serif"
    },

    spacing: { xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '24px' },

    radius: { sm: '4px', md: '6px', lg: '8px', xl: '12px', round: '50%' },

    shadows: {
        panel: '2px 0 8px rgba(0, 0, 0, 0.3)',
        panelRight: '-2px 0 8px rgba(0, 0, 0, 0.3)',
        elevated: '0 8px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(138, 111, 224, 0.18)'
    },

    transitions: {
        fast: '0.12s ease',
        normal: '0.18s ease',
        slow: '0.3s cubic-bezier(0.4, 0, 0.2, 1)'
    },

    glows: {
        online: '0 0 6px rgba(76, 175, 80, 0.5)'
    }
}

// Light palette
export const lightTheme: Theme = {
    colors: {
        primary: '#3A1C87',
        primaryLight: '#5A3AB0',
        primaryDark: '#2B1663',
        primaryFaded: 'rgba(58, 28, 135, 0.18)',

        // Hyperlink color. On the light background the deep brand primary reads
        // well, so links use it directly.
        link: '#3A1C87',

        bg: '#eaebf5',
        bgPanel: '#f2f0fc',
        bgSurface: '#e8e5f8',
        bgHover: '#dddaf0',
        bgActive: '#d2ceea',
        bgInput: '#ffffff',
        bgTerminal: '#f7f8fb',
        // Code surface: a cooler grey-lavender, darker than the page, so code reads
        // as a panel rather than blending into the light background.
        bgCode: '#dcdef0',

        text: '#2c3040',
        textDim: '#5a6278',
        textMuted: '#6a7089',
        textBright: '#1a1a2e',

        online: '#2e7d32',
        offline: '#9e9e9e',
        connecting: '#e65100',
        error: '#d32f2f',

        border: 'rgba(58, 28, 135, 0.18)',
        borderLight: 'rgba(58, 28, 135, 0.14)',

        tabBg: '#e8e5f5',
        tabActive: '#f2f0fc',
        tabHover: '#edeaf8',

        btnPrimary: '#4a24a8',
        btnPrimaryHover: '#5831b8',
        btnDanger: '#dc3545',
        btnDangerHover: '#c82333',
        btnGhost: 'transparent',
        btnGhostHover: 'rgba(0, 0, 0, 0.06)',
        btnText: '#ffffff',

        selectionBg: 'rgba(120, 92, 224, 0.38)',
        selectionText: '#1a1a2e',
        focusBorder: 'rgba(90, 58, 176, 0.5)',
        focusShadow: 'rgba(58, 28, 135, 0.15)',
        scrollbarThumb: 'rgba(100, 116, 150, 0.35)',
        scrollbarThumbHover: 'rgba(100, 116, 150, 0.55)',

        overlayBg: 'rgba(0, 0, 0, 0.3)',
        cardGradientStart: 'rgba(248, 247, 255, 0.95)',
        cardGradientEnd: 'rgba(58, 28, 135, 0.08)',
        subtleShadow: 'rgba(0, 0, 0, 0.08)',
        strongShadow: 'rgba(0, 0, 0, 0.12)',
        menuTextPrimary: 'rgba(255, 255, 255, 0.84)',
        menuTextDim: 'rgba(255, 255, 255, 0.62)',
        menuBorder: 'rgba(255, 255, 255, 0.16)',
        menuActiveBg: 'rgba(255, 255, 255, 0.18)',
        errorText: '#d32f2f',
        bgGradientA: 'rgba(90, 58, 176, 0.08)',
        bgGradientB: 'rgba(79, 195, 247, 0.06)',
        tabGlow: 'rgba(58, 28, 135, 0.25)',

        // Script editor step type colors
        stepPress: '#4a7fc0',
        stepDelay: '#b08830',
        stepText: '#5aa85a',
        stepLaunch: '#a05ca0',
        stepLoop: '#2e90b0',
        stepWait: '#b07030',
        stepValidate: '#2eb088',
        stepOther: '#6868aa',
        stepError: '#cc3333',
        stepBlock: '#1a7a7a',
        stepOnError: '#9a5a20',
        // Script editor value syntax colors
        valueVariable: '#a05ca0',
        valueString: '#5aa85a',
        valueNumber: '#4a7fc0',

        // JSON editor syntax colors (aligned with terminal rokdockLight preset)
        jsonKey: '#9b5a00',
        jsonString: '#1c8f63',
        jsonNumber: '#b35d00',
        jsonBoolean: '#c62856',
        jsonNull: '#c62856',
        jsonPunctuation: '#3f465c',

        // Surface gradients
        panelGradientStart: '#f8f7ff',
        panelGradientEnd: '#eeecfb',
        cardBg: '#f5f3ff',
        cardBgEnd: '#eae6fa',

        // Checkerboard (transparency canvas)
        checkerA: '#cccbd6',
        checkerB: '#dddce6',

        // Canvas/viewport
        canvasBorder: 'rgba(0,0,0,.28)',
        viewportShadow: 'inset 0 0 40px rgba(0,0,0,.07), inset 0 1px 0 rgba(0,0,0,.05)',

        // White/black overlays (consolidated)
        whiteSubtle: 'rgba(255,255,255,.08)',
        whiteMedium: 'rgba(255,255,255,.2)',
        whiteBright: 'rgba(255,255,255,.32)',
        blackSubtle: 'rgba(0,0,0,.12)',
        blackMedium: 'rgba(0,0,0,.3)',

        // Remote text overlay
        remoteSlotBg: 'linear-gradient(180deg, #303030, #282828)',
        remoteSlotInputBg: 'linear-gradient(180deg, #2c2c2c, #272727)',
        remoteSlotBorder: 'rgba(8,10,13,.58)',
        remoteSlotShadow: 'inset 0 1px 2px rgba(0,0,0,.34), inset 0 -1px 0 rgba(255,255,255,.03)',
        remoteSlotText: '#d1d1d1',

        // Loading overlay
        loadingBg: 'rgba(255,255,255,.55)',
        loadingSpinnerBorder: 'rgba(0,0,0,.1)',

        // Empty state
        emptyIconBg: 'rgba(0,0,0,.04)',
        emptyIconBorder: 'rgba(0,0,0,.14)',
        emptyIconColor: 'rgba(40,46,64,.35)',
        emptyTitle: 'rgba(40,46,64,.5)',

        // Search highlighting (subtle amber, shared by the terminal and Developer Docs)
        searchHighlightActive: 'rgba(250,204,21,.34)',
        searchHighlightMatch: 'rgba(250,204,21,.16)',
        searchLineBg: 'rgba(250,204,21,.06)',
        searchLineActiveBg: 'rgba(250,204,21,.16)',

        // Terminal app-run banding, as in darkTheme but darkening instead of lightening: a white
        // wash would be invisible against this theme's near-white terminal background.
        terminalLaunchBannerBg: 'rgba(0,0,0,.03)',
        terminalLaunchBannerAccent: '#b45309',

        // Measure tool
        measureLine: '#6d28d9',
        measureShadow: 'rgba(0,0,0,.42)',

        // Scrollbar track
        scrollbarTrack: 'rgba(58,28,135,0.08)',

        // Toggle switch
        toggleTrack: 'rgba(120,125,140,.35)',
        toggleThumb: '#f4f7ff',

        // Range input
        rangeThumbRing: 'rgba(255,255,255,.96)',
        rangeThumbBorder: 'rgba(0,0,0,.35)',

        // Script running indicator
        scriptRunningBorder: 'rgba(110, 60, 200, 0.8)',
        scriptRunningBorderDim: 'rgba(110, 60, 200, 0.15)',

        // Accent divider + button glow
        accentDivider: 'rgba(58, 28, 135, 0.28)',
        btnPrimaryGlow: '0 2px 8px rgba(58, 28, 135, 0.3)',

        // Section header purple tint (collapsible headers)
        sectionHeaderBg: 'rgba(58, 28, 135, 0.14)',
        sectionHeaderColor: 'rgba(58, 28, 135, 0.75)',

        // Left panel gradient (noticeable purple at top, lighter at bottom)
        leftPanelGradStart: '#ddd6f4',
        leftPanelGradEnd: '#eeecfb',

        // Online state variations (for glow/fade effects)
        onlineGlow: 'rgba(56, 142, 60, 0.85)',
        onlineGlowDim: 'rgba(56, 142, 60, 0.3)',
        onlineFaded: 'rgba(56, 142, 60, 0.12)',
    },

    fonts: darkTheme.fonts,
    spacing: darkTheme.spacing,
    radius: darkTheme.radius,

    shadows: {
        panel: '2px 0 8px rgba(0, 0, 0, 0.08)',
        panelRight: '-2px 0 8px rgba(0, 0, 0, 0.08)',
        elevated: '0 4px 16px rgba(58, 28, 135, 0.12), 0 0 0 1px rgba(58, 28, 135, 0.1)'
    },

    transitions: darkTheme.transitions,

    glows: {
        online: '0 0 6px rgba(46, 125, 50, 0.35)'
    }
}

// Theme type (inferred from the dark palette)
export type Theme = typeof darkTheme

// Static tokens (font sizes / weights)
/** Default anchor for the UI type scale, in px. The font-scale offset nudges this. */
export const FONT_BASE_PX = 14
/** Static tokens that don't change with theme */
const staticTokens: Record<string, string> = {
    // The type scale is an arithmetic ladder anchored on --rokdock-font-base:
    // every other size is a fixed px offset from it, so a single change to the
    // base shifts the whole scale and keeps the steps intact.
    '--rokdock-font-base': `${FONT_BASE_PX}px`,
    '--rokdock-font-xxs': 'calc(var(--rokdock-font-base) - 3px)',
    '--rokdock-font-xs': 'calc(var(--rokdock-font-base) - 2px)',
    '--rokdock-font-sm': 'calc(var(--rokdock-font-base) - 1px)',
    '--rokdock-font-md': 'calc(var(--rokdock-font-base) + 1px)',
    '--rokdock-font-lg': 'calc(var(--rokdock-font-base) + 2px)',
    '--rokdock-weight-normal': '400',
    '--rokdock-weight-medium': '500',
    '--rokdock-weight-semibold': '600',
}

/**
 * The Appearance tint is hue-gated rather than driven by a token name list.
 * Only colors whose base hue sits in the brand purple range (and that are
 * saturated enough to carry a hue) are tinted. This tints all brand chrome
 * (backgrounds, panels, tabs, cards, buttons, scrollbars, section headers,
 * borders, accents) while leaving every semantic color true without anyone
 * maintaining a list: status reds/greens/ambers, the BrightScript and JSON
 * syntax palettes, the script step colors, and the user-assigned port colors
 * all fall outside the band, and neutral overlays (whites, blacks, grays) fall
 * below the saturation floor.
 *
 * The brand cluster measures at hue 222 to 259, saturation 0.26 and up. The
 * nearest semantic colors are at hue 212 (blue) and 300 (magenta), so a
 * [216, 285] band with a 0.20 saturation floor captures the brand and excludes
 * the semantics. The one semantic purple, the 'other' script step color at hue
 * 240, is protected by its 0.17 saturation.
 */
export const BRAND_HUE_MIN = 216
export const BRAND_HUE_MAX = 285
export const BRAND_SAT_MIN = 0.20
/** The hue of the brand primary color (#3A1C87). Slider gradients are
 *  phase-shifted by this amount so the track matches the app's actual colors. */
export const BRAND_BASE_HUE = Math.round(colorHsl(darkTheme.colors.primary)?.h ?? 257)

/**
 * True when a color value is in the brand purple range and saturated enough to
 * tint. Non-color values (gradient strings, fonts, spacing) return false, so
 * running this over every emitted var is safe.
 */
export function isBrandTintable(value: string): boolean {
    if (!value.startsWith('#') && !value.startsWith('rgb')) return false
    const hsl = colorHsl(value)
    if (!hsl) return false
    return hsl.s >= BRAND_SAT_MIN && hsl.h >= BRAND_HUE_MIN && hsl.h <= BRAND_HUE_MAX
}

/**
 * Flatten a Theme object into --rokdock-* CSS custom properties.
 * Pass monoFont to prepend the user's terminal font to the mono stack.
 * Pass tint to apply an HSL shift to every brand-range color (see isBrandTintable).
 */
export function toCSSVars(theme: Theme, opts: { monoFont?: string; tint?: Tint; fontBaseOffset?: number } = {}): Record<string, string> {
    const { monoFont, tint, fontBaseOffset } = opts
    const colors = theme.colors
    const monoStack = monoFont
        ? `'${monoFont}', ${theme.fonts.mono}`
        : theme.fonts.mono

    const vars: Record<string, string> = {
        ...staticTokens,
        '--rokdock-font-ui': theme.fonts.ui,
        '--rokdock-font-mono': monoStack,

        // Brand
        '--rokdock-brand-primary': colors.primary,
        '--rokdock-brand-primary-light': colors.primaryLight,
        '--rokdock-brand-primary-dark': colors.primaryDark,
        '--rokdock-brand-primary-faded': colors.primaryFaded,
        '--rokdock-link': colors.link,

        // Backgrounds
        '--rokdock-bg-base': colors.bg,
        '--rokdock-bg-panel': colors.bgPanel,
        '--rokdock-bg-surface': colors.bgSurface,
        '--rokdock-bg-hover': colors.bgHover,
        '--rokdock-bg-active': colors.bgActive,
        '--rokdock-bg-input': colors.bgInput,
        '--rokdock-bg-terminal': colors.bgTerminal,
        '--rokdock-bg-code': colors.bgCode,
        '--rokdock-bg-gradient-a': colors.bgGradientA,
        '--rokdock-bg-gradient-b': colors.bgGradientB,

        // Text
        '--rokdock-text-primary': colors.text,
        '--rokdock-text-dim': colors.textDim,
        '--rokdock-text-muted': colors.textMuted,
        '--rokdock-text-bright': colors.textBright,
        '--rokdock-error-text': colors.errorText,

        // State
        '--rokdock-state-online': colors.online,
        '--rokdock-state-online-glow': colors.onlineGlow,
        '--rokdock-state-online-glow-dim': colors.onlineGlowDim,
        '--rokdock-state-online-faded': colors.onlineFaded,
        '--rokdock-state-offline': colors.offline,
        '--rokdock-state-connecting': colors.connecting,
        '--rokdock-state-error': colors.error,

        // Border
        '--rokdock-border': colors.border,
        '--rokdock-border-light': colors.borderLight,

        // Tabs
        '--rokdock-tab-bg': colors.tabBg,
        '--rokdock-tab-active': colors.tabActive,
        '--rokdock-tab-hover': colors.tabHover,
        '--rokdock-tab-glow': colors.tabGlow,

        // Buttons
        '--rokdock-btn-primary': colors.btnPrimary,
        '--rokdock-btn-primary-hover': colors.btnPrimaryHover,
        '--rokdock-btn-danger': colors.btnDanger,
        '--rokdock-btn-danger-hover': colors.btnDangerHover,
        '--rokdock-btn-ghost': colors.btnGhost,
        '--rokdock-btn-ghost-hover': colors.btnGhostHover,
        '--rokdock-btn-text': colors.btnText,

        // Selection
        '--rokdock-selection-bg': colors.selectionBg,
        '--rokdock-selection-text': colors.selectionText,

        // Focus
        '--rokdock-focus-border': colors.focusBorder,
        '--rokdock-focus-shadow': colors.focusShadow,

        // Scrollbar
        '--rokdock-scrollbar-track': colors.scrollbarTrack,
        '--rokdock-scrollbar-thumb': colors.scrollbarThumb,
        '--rokdock-scrollbar-thumb-hover': colors.scrollbarThumbHover,

        // Overlay
        '--rokdock-overlay-bg': colors.overlayBg,

        // Card
        '--rokdock-card-gradient-start': colors.cardGradientStart,
        '--rokdock-card-gradient-end': colors.cardGradientEnd,

        // Shadows
        '--rokdock-shadow-subtle': colors.subtleShadow,
        '--rokdock-shadow-strong': colors.strongShadow,
        '--rokdock-shadow-panel': theme.shadows.panel,
        '--rokdock-shadow-panel-right': theme.shadows.panelRight,
        '--rokdock-shadow-elevated': theme.shadows.elevated,

        // Menu
        '--rokdock-menu-text-primary': colors.menuTextPrimary,
        '--rokdock-menu-text-dim': colors.menuTextDim,
        '--rokdock-menu-border': colors.menuBorder,
        '--rokdock-menu-active-bg': colors.menuActiveBg,

        // Script editor step types
        '--rokdock-step-press': colors.stepPress,
        '--rokdock-step-delay': colors.stepDelay,
        '--rokdock-step-text': colors.stepText,
        '--rokdock-step-launch': colors.stepLaunch,
        '--rokdock-step-loop': colors.stepLoop,
        '--rokdock-step-wait': colors.stepWait,
        '--rokdock-step-validate': colors.stepValidate,
        '--rokdock-step-other': colors.stepOther,
        '--rokdock-step-error': colors.stepError,
        '--rokdock-step-block': colors.stepBlock,
        '--rokdock-step-on-error': colors.stepOnError,
        // Script editor value syntax
        '--rokdock-value-variable': colors.valueVariable,
        '--rokdock-value-string': colors.valueString,
        '--rokdock-value-number': colors.valueNumber,

        // JSON editor syntax
        '--rokdock-json-key': colors.jsonKey,
        '--rokdock-json-string': colors.jsonString,
        '--rokdock-json-number': colors.jsonNumber,
        '--rokdock-json-boolean': colors.jsonBoolean,
        '--rokdock-json-null': colors.jsonNull,
        '--rokdock-json-punctuation': colors.jsonPunctuation,

        // Surface gradients
        '--rokdock-panel-gradient-start': colors.panelGradientStart,
        '--rokdock-panel-gradient-end': colors.panelGradientEnd,
        '--rokdock-card-bg': colors.cardBg,
        '--rokdock-card-bg-end': colors.cardBgEnd,

        // Checkerboard
        '--rokdock-checker-a': colors.checkerA,
        '--rokdock-checker-b': colors.checkerB,

        // Canvas
        '--rokdock-canvas-border': colors.canvasBorder,
        '--rokdock-viewport-shadow': colors.viewportShadow,

        // Overlay alphas
        '--rokdock-white-subtle': colors.whiteSubtle,
        '--rokdock-white-medium': colors.whiteMedium,
        '--rokdock-white-bright': colors.whiteBright,
        '--rokdock-black-subtle': colors.blackSubtle,
        '--rokdock-black-medium': colors.blackMedium,

        // Remote
        '--rokdock-remote-slot-bg': colors.remoteSlotBg,
        '--rokdock-remote-slot-input-bg': colors.remoteSlotInputBg,
        '--rokdock-remote-slot-border': colors.remoteSlotBorder,
        '--rokdock-remote-slot-shadow': colors.remoteSlotShadow,
        '--rokdock-remote-slot-text': colors.remoteSlotText,

        // Loading
        '--rokdock-loading-bg': colors.loadingBg,
        '--rokdock-loading-spinner-border': colors.loadingSpinnerBorder,

        // Empty state
        '--rokdock-empty-icon-bg': colors.emptyIconBg,
        '--rokdock-empty-icon-border': colors.emptyIconBorder,
        '--rokdock-empty-icon-color': colors.emptyIconColor,
        '--rokdock-empty-title': colors.emptyTitle,

        // Search
        '--rokdock-search-highlight-active': colors.searchHighlightActive,
        '--rokdock-search-highlight-match': colors.searchHighlightMatch,
        '--rokdock-search-line-bg': colors.searchLineBg,
        '--rokdock-search-line-active-bg': colors.searchLineActiveBg,
        '--rokdock-terminal-launch-banner-bg': colors.terminalLaunchBannerBg,
        '--rokdock-terminal-launch-banner-accent': colors.terminalLaunchBannerAccent,

        // Measure
        '--rokdock-measure-line': colors.measureLine,
        '--rokdock-measure-shadow': colors.measureShadow,

        // Toggle
        '--rokdock-toggle-track': colors.toggleTrack,
        '--rokdock-toggle-thumb': colors.toggleThumb,

        // Range
        '--rokdock-range-thumb-border': colors.rangeThumbBorder,
        '--rokdock-script-running-border': colors.scriptRunningBorder,
        '--rokdock-script-running-border-dim': colors.scriptRunningBorderDim,

        // Accent divider and button glow
        '--rokdock-accent-divider': colors.accentDivider,
        '--rokdock-btn-primary-glow': colors.btnPrimaryGlow,

        // Section header + left panel gradient
        '--rokdock-section-header-bg': colors.sectionHeaderBg,
        '--rokdock-section-header-color': colors.sectionHeaderColor,
        '--rokdock-left-panel-grad-start': colors.leftPanelGradStart,
        '--rokdock-left-panel-grad-end': colors.leftPanelGradEnd,

        // Spacing
        '--rokdock-space-xs': theme.spacing.xs,
        '--rokdock-space-sm': theme.spacing.sm,
        '--rokdock-space-md': theme.spacing.md,
        '--rokdock-space-lg': theme.spacing.lg,
        '--rokdock-space-xl': theme.spacing.xl,

        // Radius
        '--rokdock-radius-sm': theme.radius.sm,
        '--rokdock-radius-md': theme.radius.md,
        '--rokdock-radius-lg': theme.radius.lg,
        '--rokdock-radius-xl': theme.radius.xl,
        '--rokdock-radius-round': theme.radius.round,

        // Transitions
        '--rokdock-transition-fast': theme.transitions.fast,

        // Glows
        '--rokdock-glow-online': theme.glows.online,

        // Native <input type="range"> (settings-range) vars. Emitted here, not set
        // ad hoc in app.tsx, so they ride the same tint pass as every other token:
        // the fill is brand purple and tints, the neutral track/ring stay true.
        '--range-fill': colors.primaryLight,
        '--range-track': colors.whiteMedium,
        '--range-border': colors.whiteSubtle,
        '--range-thumb-ring': colors.rangeThumbRing,
    }

    if (tint && !isIdentityTint(tint)) {
        for (const name of Object.keys(vars)) {
            const value = vars[name]
            if (isBrandTintable(value)) vars[name] = applyTint(value, tint)
        }
    }

    // Shift the whole type scale by nudging its anchor. The font ladder is
    // calc(var(--rokdock-font-base) +/- Npx), so overriding the base (FONT_BASE_PX)
    // scales every UI font size together.
    if (fontBaseOffset) vars['--rokdock-font-base'] = `${FONT_BASE_PX + fontBaseOffset}px`

    return vars
}

/**
 * Background color for BrowserWindow creation to prevent a white flash before
 * the theme loads. Applies the Appearance tint so a tinted window does not flash
 * an untinted panel color, matching what toCSSVars emits for --rokdock-bg-panel.
 */
export function nativeWindowBg(mode: ThemeMode, tint?: Tint): string {
    const base = mode === 'light' ? lightTheme.colors.bgPanel : darkTheme.colors.bgPanel
    if (tint && !isIdentityTint(tint) && isBrandTintable(base)) return applyTint(base, tint)
    return base
}
