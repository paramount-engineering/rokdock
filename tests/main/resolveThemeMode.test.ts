import { describe, it, expect } from 'vitest'
import { resolveThemeMode } from '@main/ipc/handlers/theme'

describe('resolveThemeMode', () => {
    it('passes through explicit dark/light', () => {
        expect(resolveThemeMode('dark', true)).toBe('dark')
        expect(resolveThemeMode('light', true)).toBe('light')
        expect(resolveThemeMode('light', false)).toBe('light')
    })
    it('resolves system to the OS preference', () => {
        expect(resolveThemeMode('system', true)).toBe('dark')
        expect(resolveThemeMode('system', false)).toBe('light')
    })
})
