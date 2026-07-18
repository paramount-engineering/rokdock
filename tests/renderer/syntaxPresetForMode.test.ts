import { describe, it, expect } from 'vitest'
import { syntaxPresetForMode } from '@renderer/styles/terminalSyntaxThemes'

describe('syntaxPresetForMode', () => {
    it('swaps a dark preset to its light companion when switching to light', () => {
        expect(syntaxPresetForMode('githubDark', 'light')).toBe('githubLight')
        expect(syntaxPresetForMode('solarizedDark', 'light')).toBe('solarizedLight')
        expect(syntaxPresetForMode('tokyoNight', 'light')).toBe('tokyoNightDay')
        expect(syntaxPresetForMode('catppuccinMocha', 'light')).toBe('catppuccinLatte')
        expect(syntaxPresetForMode('rokdockDark', 'light')).toBe('rokdockLight')
        expect(syntaxPresetForMode('oneDarkPro', 'light')).toBe('oneLight')
        expect(syntaxPresetForMode('dracula', 'light')).toBe('alucard')
    })

    it('swaps a light preset to its dark companion when switching to dark', () => {
        expect(syntaxPresetForMode('githubLight', 'dark')).toBe('githubDark')
        expect(syntaxPresetForMode('tokyoNightDay', 'dark')).toBe('tokyoNight')
        expect(syntaxPresetForMode('catppuccinLatte', 'dark')).toBe('catppuccinMocha')
        expect(syntaxPresetForMode('oneLight', 'dark')).toBe('oneDarkPro')
        expect(syntaxPresetForMode('alucard', 'dark')).toBe('dracula')
    })

    it('leaves a preset unchanged when it already matches the target mode', () => {
        expect(syntaxPresetForMode('githubDark', 'dark')).toBe('githubDark')
        expect(syntaxPresetForMode('githubLight', 'light')).toBe('githubLight')
    })

    it('leaves companion-less dark presets unchanged in either direction', () => {
        expect(syntaxPresetForMode('nord', 'light')).toBe('nord')
        expect(syntaxPresetForMode('monokai', 'light')).toBe('monokai')
        expect(syntaxPresetForMode('monokai', 'dark')).toBe('monokai')
    })

    it('leaves the mode-aware none and custom presets unchanged', () => {
        expect(syntaxPresetForMode('none', 'light')).toBe('none')
        expect(syntaxPresetForMode('none', 'dark')).toBe('none')
        expect(syntaxPresetForMode('custom', 'light')).toBe('custom')
        expect(syntaxPresetForMode('custom', 'dark')).toBe('custom')
    })
})
