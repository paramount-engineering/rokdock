import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAppStore } from '@renderer/store/appStore'

// A direct theme toggle (the menu-bar quick switch) must swap the syntax theme to its
// light/dark companion, matching the Settings and Appearance-modal surfaces. A named theme's
// palette is fixed regardless of mode, so without the swap a dark theme stays dark in light mode.

let setPreferencesMock: ReturnType<typeof vi.fn>
let clearPreviewMock: ReturnType<typeof vi.fn>

beforeEach(() => {
    setPreferencesMock = vi.fn(async () => {})
    clearPreviewMock = vi.fn()
    ;(globalThis as unknown as { window: unknown }).window = {
        rokdock: {
            store: { setPreferences: setPreferencesMock },
            appearance: { clearPreview: clearPreviewMock },
        },
    }
})

describe('setThemeMode syntax companion swap', () => {
    it('swaps a dark named theme to its light companion when toggling to light, and persists it', () => {
        useAppStore.setState({ themeMode: 'dark', terminalSyntaxThemePreset: 'rokdockDark' })
        useAppStore.getState().setThemeMode('light')
        expect(useAppStore.getState().terminalSyntaxThemePreset).toBe('rokdockLight')
        expect(setPreferencesMock).toHaveBeenCalledWith(expect.objectContaining({
            themeMode: 'light',
            terminalSyntaxThemePreset: 'rokdockLight',
        }))
    })

    it('swaps back to the dark companion when toggling to dark', () => {
        useAppStore.setState({ themeMode: 'light', terminalSyntaxThemePreset: 'githubLight' })
        useAppStore.getState().setThemeMode('dark')
        expect(useAppStore.getState().terminalSyntaxThemePreset).toBe('githubDark')
    })

    it('leaves a companion-less theme unchanged (negative control)', () => {
        useAppStore.setState({ themeMode: 'dark', terminalSyntaxThemePreset: 'nord' })
        useAppStore.getState().setThemeMode('light')
        expect(useAppStore.getState().terminalSyntaxThemePreset).toBe('nord')
    })

    it('leaves the mode-aware none and custom presets unchanged', () => {
        useAppStore.setState({ themeMode: 'dark', terminalSyntaxThemePreset: 'none' })
        useAppStore.getState().setThemeMode('light')
        expect(useAppStore.getState().terminalSyntaxThemePreset).toBe('none')

        useAppStore.setState({ themeMode: 'dark', terminalSyntaxThemePreset: 'custom' })
        useAppStore.getState().setThemeMode('light')
        expect(useAppStore.getState().terminalSyntaxThemePreset).toBe('custom')
    })
})
