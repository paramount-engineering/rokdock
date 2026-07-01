/**
 * Terminal syntax color theme definitions and resolution.
 *
 * Each TerminalSyntaxThemePreset maps to a TerminalTokenPalette - a record
 * keyed by TerminalTokenKind (the token classifications produced by the
 * main-process tokenizer) with hex color string values.
 *
 * Built-in presets include popular editor themes: Dracula, Nord, Tokyo Night,
 * Solarized, GitHub, Gruvbox, Catppuccin, Atom One, Monokai, and the default
 * RokDock dark/light palettes. The 'custom' preset uses the user-defined
 * palette from appStore (customSyntaxPalette).
 *
 * resolveSyntaxTheme(preset, customPalette): returns the palette for a given
 * preset, falling back to the default RokDock dark palette for 'none'.
 * CustomTerminalView calls this on each render to get the active color map.
 */
import type { TerminalTokenKind } from '../../shared/terminal'

export type TerminalSyntaxThemePreset =
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
    | 'tokyoNight'
    | 'tokyoNightDay'
    | 'githubDark'
    | 'githubLight'
    | 'gruvboxDark'
    | 'gruvboxLight'
    | 'catppuccinMocha'
    | 'catppuccinLatte'
    | 'custom'
export type TerminalTokenPalette = Record<TerminalTokenKind, string>

export interface TerminalSyntaxTheme {
    name: string
    mode: 'dark' | 'light'
    colors: TerminalTokenPalette
    background: string
}

const rokdockDarkColors: TerminalTokenPalette = {
    plain: '#e6e9ff',
    prompt: '#f8f9ff',
    brightscriptDebuggerPrompt: '#8a6fe0',
    comment: '#8e97b8',
    separator: '#49507a',
    debuggerBanner: '#6dd3ff',
    sectionHeader: '#b59aff',
    threadRow: '#ffbd6f',
    stackFrame: '#7aa2ff',
    sourceLineNumber: '#f0a86e',
    selectedMarker: '#ff6f91',
    logTag: '#c6cceb',
    beaconMetric: '#f7c873',
    filePath: '#6dd3ff',
    referenceMeta: '#9ba8d6',
    rokuType: '#88a8ff',
    functionName: '#7dc3ff',
    objectKey: '#f7c873',
    objectPunctuation: '#c6cceb',
    objectStringValue: '#7fe7b2',
    objectNumberValue: '#ffb686',
    objectBooleanValue: '#ff8ea1',
    objectNullValue: '#ff8ea1',
    string: '#78e6a8',
    number: '#ffb173',
    boolean: '#ff8ea1',
    nullish: '#ff8ea1',
    error: '#ff6b6b',
    warning: '#ffb84d',
    info: '#6dc3ff',
    debug: '#c093ff',
    trace: '#95a0c8',
    rokuSymbol: '#88a8ff',
    keyword: '#d199ff',
    dateTime: '#9ba8d6',
    bracketContent: '#b9a2ff',
    pathLike: '#6dd3ff',
    url: '#7fd9ff',
    queryKey: '#f7c873',
    queryValue: '#ffb686'
}

const rokdockLightColors: TerminalTokenPalette = {
    plain: '#2c3040',
    prompt: '#1a1a2e',
    brightscriptDebuggerPrompt: '#5a3ab0',
    comment: '#7b839e',
    separator: '#b3bbd3',
    debuggerBanner: '#007ba7',
    sectionHeader: '#6a3db6',
    threadRow: '#a35e00',
    stackFrame: '#2b63d9',
    sourceLineNumber: '#9b5a00',
    selectedMarker: '#d64563',
    logTag: '#5a6278',
    beaconMetric: '#9b5a00',
    filePath: '#007ba7',
    referenceMeta: '#7f88a7',
    rokuType: '#2b63d9',
    functionName: '#1e7fbf',
    objectKey: '#9b5a00',
    objectPunctuation: '#3f465c',
    objectStringValue: '#1c8f63',
    objectNumberValue: '#b35d00',
    objectBooleanValue: '#c62856',
    objectNullValue: '#c62856',
    string: '#237a57',
    number: '#b35d00',
    boolean: '#c62856',
    nullish: '#c62856',
    error: '#c62828',
    warning: '#b26a00',
    info: '#2b63d9',
    debug: '#7d4cd6',
    trace: '#7b839e',
    rokuSymbol: '#2b63d9',
    keyword: '#7d4cd6',
    dateTime: '#7f88a7',
    bracketContent: '#7356d9',
    pathLike: '#007ba7',
    url: '#007ba7',
    queryKey: '#9b5a00',
    queryValue: '#b35d00'
}

const atomOneDarkColors: TerminalTokenPalette = {
    plain: '#d7dae0',
    prompt: '#ffffff',
    brightscriptDebuggerPrompt: '#5cc8ff',
    comment: '#7d8b7e',
    separator: '#5c6370',
    debuggerBanner: '#56b6c2',
    sectionHeader: '#c678dd',
    threadRow: '#e5c07b',
    stackFrame: '#61afef',
    sourceLineNumber: '#d19a66',
    selectedMarker: '#e06c75',
    logTag: '#abb2bf',
    beaconMetric: '#e5c07b',
    filePath: '#56b6c2',
    referenceMeta: '#8ea2b2',
    rokuType: '#61afef',
    functionName: '#61afef',
    objectKey: '#e5c07b',
    objectPunctuation: '#abb2bf',
    objectStringValue: '#98c379',
    objectNumberValue: '#d19a66',
    objectBooleanValue: '#e06c75',
    objectNullValue: '#e06c75',
    string: '#98c379',
    number: '#d19a66',
    boolean: '#e06c75',
    nullish: '#e06c75',
    error: '#ef5350',
    warning: '#e5c07b',
    info: '#61afef',
    debug: '#c678dd',
    trace: '#7f8c8d',
    rokuSymbol: '#61afef',
    keyword: '#c678dd',
    dateTime: '#8ea2b2',
    bracketContent: '#b392f0',
    pathLike: '#56b6c2',
    url: '#56b6c2',
    queryKey: '#e5c07b',
    queryValue: '#d19a66'
}

const atomOneLightColors: TerminalTokenPalette = {
    plain: '#383a42',
    prompt: '#111111',
    brightscriptDebuggerPrompt: '#005f8f',
    comment: '#a0a1a7',
    separator: '#a0a1a7',
    debuggerBanner: '#0184bc',
    sectionHeader: '#a626a4',
    threadRow: '#986801',
    stackFrame: '#4078f2',
    sourceLineNumber: '#986801',
    selectedMarker: '#e45649',
    logTag: '#6c6f75',
    beaconMetric: '#986801',
    filePath: '#0184bc',
    referenceMeta: '#8b8f96',
    rokuType: '#4078f2',
    functionName: '#4078f2',
    objectKey: '#986801',
    objectPunctuation: '#383a42',
    objectStringValue: '#50a14f',
    objectNumberValue: '#986801',
    objectBooleanValue: '#e45649',
    objectNullValue: '#e45649',
    string: '#50a14f',
    number: '#986801',
    boolean: '#e45649',
    nullish: '#e45649',
    error: '#c41f1f',
    warning: '#986801',
    info: '#4078f2',
    debug: '#a626a4',
    trace: '#7f8c8d',
    rokuSymbol: '#4078f2',
    keyword: '#a626a4',
    dateTime: '#8b8f96',
    bracketContent: '#7c4dff',
    pathLike: '#0184bc',
    url: '#0184bc',
    queryKey: '#986801',
    queryValue: '#c18401'
}

const draculaColors: TerminalTokenPalette = {
    ...atomOneDarkColors,
    plain: '#f8f8f2',
    prompt: '#ffffff',
    brightscriptDebuggerPrompt: '#bd93f9',
    comment: '#6272a4',
    keyword: '#ff79c6',
    functionName: '#8be9fd',
    string: '#f1fa8c',
    number: '#bd93f9',
    boolean: '#ff79c6',
    error: '#ff5555',
    warning: '#ffb86c',
    info: '#8be9fd',
    debug: '#bd93f9',
    filePath: '#8be9fd',
    url: '#8be9fd',
    objectStringValue: '#f1fa8c',
    objectNumberValue: '#bd93f9'
}

const nordColors: TerminalTokenPalette = {
    ...atomOneDarkColors,
    plain: '#d8dee9',
    prompt: '#eceff4',
    brightscriptDebuggerPrompt: '#81a1c1',
    comment: '#616e88',
    separator: '#4c566a',
    keyword: '#b48ead',
    functionName: '#88c0d0',
    string: '#a3be8c',
    number: '#d08770',
    boolean: '#b48ead',
    error: '#bf616a',
    warning: '#ebcb8b',
    info: '#5e81ac',
    debug: '#81a1c1',
    filePath: '#8fbcbb',
    url: '#88c0d0',
    objectStringValue: '#a3be8c',
    objectNumberValue: '#d08770'
}

const solarizedDarkColors: TerminalTokenPalette = {
    ...atomOneDarkColors,
    plain: '#93a1a1',
    prompt: '#eee8d5',
    brightscriptDebuggerPrompt: '#2aa198',
    comment: '#586e75',
    separator: '#657b83',
    keyword: '#859900',
    functionName: '#268bd2',
    string: '#2aa198',
    number: '#d33682',
    boolean: '#cb4b16',
    error: '#dc322f',
    warning: '#b58900',
    info: '#268bd2',
    debug: '#6c71c4',
    filePath: '#2aa198',
    url: '#268bd2'
}

const solarizedLightColors: TerminalTokenPalette = {
    ...atomOneLightColors,
    plain: '#586e75',
    prompt: '#073642',
    brightscriptDebuggerPrompt: '#268bd2',
    comment: '#93a1a1',
    separator: '#93a1a1',
    keyword: '#859900',
    functionName: '#268bd2',
    string: '#2aa198',
    number: '#d33682',
    boolean: '#cb4b16',
    error: '#dc322f',
    warning: '#b58900',
    info: '#268bd2',
    debug: '#6c71c4',
    filePath: '#2aa198',
    url: '#268bd2'
}

const monokaiColors: TerminalTokenPalette = {
    ...atomOneDarkColors,
    plain: '#f8f8f2',
    prompt: '#ffffff',
    brightscriptDebuggerPrompt: '#66d9ef',
    comment: '#75715e',
    keyword: '#f92672',
    functionName: '#a6e22e',
    string: '#e6db74',
    number: '#ae81ff',
    boolean: '#ae81ff',
    error: '#f92672',
    warning: '#fd971f',
    info: '#66d9ef',
    debug: '#ae81ff',
    filePath: '#66d9ef',
    url: '#66d9ef'
}

const TOKEN_KEYS = Object.keys(rokdockDarkColors) as TerminalTokenKind[]

/**
 * Creates a TerminalTokenPalette where every token kind maps to the same
 * color. Used for the 'none' preset which renders all terminal output in a
 * single flat color without syntax differentiation.
 *
 * @param color - Hex color string to assign to all token kinds.
 */
function createMonochromePalette(color: string): TerminalTokenPalette {
    return TOKEN_KEYS.reduce((acc, key) => {
        acc[key] = color
        return acc
    }, {} as TerminalTokenPalette)
}

const oneDarkProColors: TerminalTokenPalette = { ...atomOneDarkColors, plain: '#dcdfe4', sectionHeader: '#c792ea', keyword: '#c792ea' }
const oneLightColors: TerminalTokenPalette = { ...atomOneLightColors, plain: '#2f343f', sectionHeader: '#a626a4', keyword: '#a626a4' }
const tokyoNightColors: TerminalTokenPalette = { ...atomOneDarkColors, plain: '#c0caf5', comment: '#565f89', keyword: '#bb9af7', string: '#9ece6a', number: '#ff9e64', info: '#7aa2f7', functionName: '#7dcfff', brightscriptDebuggerPrompt: '#7aa2f7' }
const tokyoNightDayColors: TerminalTokenPalette = { ...atomOneLightColors, plain: '#3760bf', comment: '#848cb5', keyword: '#9854f1', string: '#587539', number: '#b15c00', info: '#2e7de9', functionName: '#007197', brightscriptDebuggerPrompt: '#2e7de9' }
const githubDarkColors: TerminalTokenPalette = { ...atomOneDarkColors, plain: '#c9d1d9', comment: '#8b949e', keyword: '#ff7b72', string: '#a5d6ff', number: '#79c0ff', functionName: '#d2a8ff', info: '#58a6ff', brightscriptDebuggerPrompt: '#58a6ff' }
const githubLightColors: TerminalTokenPalette = { ...atomOneLightColors, plain: '#24292f', comment: '#6e7781', keyword: '#cf222e', string: '#0a3069', number: '#0550ae', functionName: '#8250df', info: '#0969da', brightscriptDebuggerPrompt: '#0969da' }
const gruvboxDarkColors: TerminalTokenPalette = { ...atomOneDarkColors, plain: '#ebdbb2', comment: '#928374', keyword: '#fb4934', string: '#b8bb26', number: '#d3869b', warning: '#fabd2f', info: '#83a598', brightscriptDebuggerPrompt: '#83a598' }
const gruvboxLightColors: TerminalTokenPalette = { ...atomOneLightColors, plain: '#3c3836', comment: '#928374', keyword: '#9d0006', string: '#79740e', number: '#8f3f71', warning: '#b57614', info: '#076678', brightscriptDebuggerPrompt: '#076678' }
const catppuccinMochaColors: TerminalTokenPalette = { ...atomOneDarkColors, plain: '#cdd6f4', comment: '#6c7086', keyword: '#cba6f7', string: '#a6e3a1', number: '#fab387', info: '#89b4fa', functionName: '#89dceb', brightscriptDebuggerPrompt: '#89b4fa' }
const catppuccinLatteColors: TerminalTokenPalette = { ...atomOneLightColors, plain: '#4c4f69', comment: '#9ca0b0', keyword: '#8839ef', string: '#40a02b', number: '#fe640b', info: '#1e66f5', functionName: '#179299', brightscriptDebuggerPrompt: '#1e66f5' }

export const TERMINAL_SYNTAX_THEMES: Record<Exclude<TerminalSyntaxThemePreset, 'custom'>, TerminalSyntaxTheme> = {
    none: { name: 'No Colorization', mode: 'dark', colors: createMonochromePalette('#d7dae0'), background: '#111326' },
    rokdockDark: { name: 'RokDock Dark', mode: 'dark', colors: { ...rokdockDarkColors }, background: '#111326' },
    rokdockLight: { name: 'RokDock Light', mode: 'light', colors: { ...rokdockLightColors }, background: '#f7f8fb' },
    atomOneDark: { name: 'Atom One Dark', mode: 'dark', colors: { ...atomOneDarkColors }, background: '#282c34' },
    atomOneLight: { name: 'Atom One Light', mode: 'light', colors: { ...atomOneLightColors }, background: '#fafafa' },
    oneDarkPro: { name: 'One Dark Pro', mode: 'dark', colors: { ...oneDarkProColors }, background: '#282c34' },
    oneLight: { name: 'One Light', mode: 'light', colors: { ...oneLightColors }, background: '#fafafa' },
    dracula: { name: 'Dracula', mode: 'dark', colors: { ...draculaColors }, background: '#282a36' },
    nord: { name: 'Nord', mode: 'dark', colors: { ...nordColors }, background: '#2e3440' },
    solarizedDark: { name: 'Solarized Dark', mode: 'dark', colors: { ...solarizedDarkColors }, background: '#002b36' },
    solarizedLight: { name: 'Solarized Light', mode: 'light', colors: { ...solarizedLightColors }, background: '#fdf6e3' },
    monokai: { name: 'Monokai', mode: 'dark', colors: { ...monokaiColors }, background: '#272822' },
    tokyoNight: { name: 'Tokyo Night', mode: 'dark', colors: { ...tokyoNightColors }, background: '#1a1b26' },
    tokyoNightDay: { name: 'Tokyo Night Day', mode: 'light', colors: { ...tokyoNightDayColors }, background: '#e1e2e7' },
    githubDark: { name: 'GitHub Dark', mode: 'dark', colors: { ...githubDarkColors }, background: '#0d1117' },
    githubLight: { name: 'GitHub Light', mode: 'light', colors: { ...githubLightColors }, background: '#ffffff' },
    gruvboxDark: { name: 'Gruvbox Dark', mode: 'dark', colors: { ...gruvboxDarkColors }, background: '#282828' },
    gruvboxLight: { name: 'Gruvbox Light', mode: 'light', colors: { ...gruvboxLightColors }, background: '#fbf1c7' },
    catppuccinMocha: { name: 'Catppuccin Mocha', mode: 'dark', colors: { ...catppuccinMochaColors }, background: '#1e1e2e' },
    catppuccinLatte: { name: 'Catppuccin Latte', mode: 'light', colors: { ...catppuccinLatteColors }, background: '#eff1f5' }
}

/**
 * Light/dark companion pairs. Each preset that ships in both a dark and a light
 * variant is mapped to its counterpart in the other mode (bidirectionally). The
 * dark-only presets (Dracula, Nord, Monokai) are intentionally absent: they have
 * no companion, so they are left unchanged when the UI mode flips.
 */
const SYNTAX_THEME_COMPANIONS: Partial<Record<TerminalSyntaxThemePreset, Exclude<TerminalSyntaxThemePreset, 'custom'>>> = {
    rokdockDark: 'rokdockLight', rokdockLight: 'rokdockDark',
    atomOneDark: 'atomOneLight', atomOneLight: 'atomOneDark',
    oneDarkPro: 'oneLight', oneLight: 'oneDarkPro',
    solarizedDark: 'solarizedLight', solarizedLight: 'solarizedDark',
    tokyoNight: 'tokyoNightDay', tokyoNightDay: 'tokyoNight',
    githubDark: 'githubLight', githubLight: 'githubDark',
    gruvboxDark: 'gruvboxLight', gruvboxLight: 'gruvboxDark',
    catppuccinMocha: 'catppuccinLatte', catppuccinLatte: 'catppuccinMocha'
}

/**
 * Returns the syntax preset best suited to a target UI mode. When the current
 * preset has a light/dark companion and its own mode differs from the target,
 * the companion is returned (e.g. switching the UI to light maps GitHub Dark to
 * GitHub Light). Presets without a companion (Dracula, Nord, Monokai), the
 * mode-aware 'none' and 'custom' presets, and presets that already match the
 * target mode are returned unchanged.
 *
 * @param preset - The currently selected syntax theme preset.
 * @param mode - The concrete UI mode being switched to ('dark' | 'light').
 * @returns The preset to use for that mode (its companion, or the input).
 */
export function syntaxPresetForMode(
    preset: TerminalSyntaxThemePreset,
    mode: 'dark' | 'light'
): TerminalSyntaxThemePreset {
    const companion = SYNTAX_THEME_COMPANIONS[preset]
    if (!companion) return preset
    // companion is the opposite-mode variant of preset; pick it only when it is
    // the one that matches the target mode, otherwise preset already matches.
    return TERMINAL_SYNTAX_THEMES[companion].mode === mode ? companion : preset
}

/**
 * Resolves a TerminalSyntaxTheme for a given preset and UI mode.
 *
 * - 'none': returns a monochrome palette appropriate for the current mode.
 * - 'custom': merges the user-supplied customColors over the matching
 *   RokDock dark/light fallback palette.
 * - Any other preset: returns the corresponding entry from TERMINAL_SYNTAX_THEMES.
 *
 * @param preset - The selected syntax theme preset name.
 * @param mode - The current UI mode ('dark' | 'light'), used for mode-aware
 *               fallbacks when preset is 'none' or 'custom'.
 * @param customColors - Optional partial palette overrides used when preset
 *                       is 'custom'.
 * @returns The resolved TerminalSyntaxTheme including name, mode, full color
 *          palette, and terminal background color.
 */
export function resolveSyntaxTheme(
    preset: TerminalSyntaxThemePreset,
    mode: 'dark' | 'light',
    customColors?: Partial<TerminalTokenPalette>
): TerminalSyntaxTheme {
    if (preset === 'none') {
        return {
            name: 'No Colorization',
            mode,
            colors: createMonochromePalette(mode === 'dark' ? '#d7dae0' : '#2c3040'),
            background: mode === 'dark' ? '#111326' : '#f7f8fb'
        }
    }
    if (preset === 'custom') {
        const fallback = mode === 'dark' ? TERMINAL_SYNTAX_THEMES.rokdockDark : TERMINAL_SYNTAX_THEMES.rokdockLight
        return {
            name: 'Custom',
            mode,
            colors: { ...fallback.colors, ...(customColors ?? {}) },
            background: fallback.background
        }
    }
    return TERMINAL_SYNTAX_THEMES[preset]
}
