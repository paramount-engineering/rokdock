/**
 * Shared constants for the Code appearance section.
 *
 * Both the dock Settings dialog (settingsDialog.tsx) and the JSON editor
 * Appearance modal (appearanceModal.tsx) consume these arrays. They live here
 * so neither consumer imports from the other.
 */
import type { TerminalSyntaxThemePreset } from '../../styles/terminalSyntaxThemes'

export const FONT_PRESETS: { value: string; label: string }[] = [
    { value: '', label: 'Default (system monospace stack)' },
    { value: "'Cascadia Code', monospace", label: 'Cascadia Code' },
    { value: "'Cascadia Mono', monospace", label: 'Cascadia Mono' },
    { value: "Consolas, monospace", label: 'Consolas' },
    { value: "'Courier New', monospace", label: 'Courier New' },
    { value: "'DejaVu Sans Mono', monospace", label: 'DejaVu Sans Mono' },
    { value: "'Fira Code', monospace", label: 'Fira Code' },
    { value: "'Fira Mono', monospace", label: 'Fira Mono' },
    { value: "'Hack', monospace", label: 'Hack' },
    { value: "'IBM Plex Mono', monospace", label: 'IBM Plex Mono' },
    { value: "'Inconsolata', monospace", label: 'Inconsolata' },
    { value: "'JetBrains Mono', monospace", label: 'JetBrains Mono' },
    { value: "'Lucida Console', monospace", label: 'Lucida Console' },
    { value: "'Menlo', monospace", label: 'Menlo' },
    { value: "'Monaco', monospace", label: 'Monaco' },
    { value: "'Source Code Pro', monospace", label: 'Source Code Pro' },
    { value: "'Ubuntu Mono', monospace", label: 'Ubuntu Mono' },
]

export const TERMINAL_THEME_OPTIONS: Array<{
    value: TerminalSyntaxThemePreset
    label: string
    category: 'none' | 'rokdock' | 'popular'
}> = [
    { value: 'none', label: 'No colorization', category: 'none' },
    { value: 'rokdockDark', label: 'RokDock Dark', category: 'rokdock' },
    { value: 'rokdockLight', label: 'RokDock Light', category: 'rokdock' },
    { value: 'atomOneDark', label: 'Atom One Dark', category: 'popular' },
    { value: 'atomOneLight', label: 'Atom One Light', category: 'popular' },
    { value: 'oneLight', label: 'One Light', category: 'popular' },
    { value: 'oneDarkPro', label: 'One Dark Pro', category: 'popular' },
    { value: 'dracula', label: 'Dracula', category: 'popular' },
    { value: 'nord', label: 'Nord', category: 'popular' },
    { value: 'solarizedDark', label: 'Solarized Dark', category: 'popular' },
    { value: 'solarizedLight', label: 'Solarized Light', category: 'popular' },
    { value: 'monokai', label: 'Monokai', category: 'popular' },
    { value: 'tokyoNight', label: 'Tokyo Night', category: 'popular' },
    { value: 'tokyoNightDay', label: 'Tokyo Night Day', category: 'popular' },
    { value: 'githubDark', label: 'GitHub Dark', category: 'popular' },
    { value: 'githubLight', label: 'GitHub Light', category: 'popular' },
    { value: 'gruvboxDark', label: 'Gruvbox Dark', category: 'popular' },
    { value: 'gruvboxLight', label: 'Gruvbox Light', category: 'popular' },
    { value: 'catppuccinMocha', label: 'Catppuccin Mocha', category: 'popular' },
    { value: 'catppuccinLatte', label: 'Catppuccin Latte', category: 'popular' },
]
