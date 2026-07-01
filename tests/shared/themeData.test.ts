import { describe, it, expect } from 'vitest'
import { toCSSVars, isBrandTintable, nativeWindowBg, darkTheme } from '@shared/themeData'

describe('toCSSVars tint pass', () => {
    it('leaves vars unchanged with no tint (back-compat)', () => {
        const base = toCSSVars(darkTheme)
        expect(base['--rokdock-bg-base']).toBe(darkTheme.colors.bg)
    })

    it('still accepts a mono font via the options object', () => {
        const vars = toCSSVars(darkTheme, { monoFont: 'Test Mono' })
        expect(vars['--rokdock-font-mono']).toContain('Test Mono')
    })

    it('tints brand-range tokens but leaves semantic and neutral tokens true', () => {
        const tint = { hue: 172, saturation: 1, brightness: 0.12 }
        const vars = toCSSVars(darkTheme, { tint })
        const base = toCSSVars(darkTheme)
        // Brand chrome (purple range) tints. The truthy guards ensure the var
        // names are real, so these are not vacuous undefined comparisons.
        for (const name of [
            '--rokdock-bg-base',
            '--rokdock-brand-primary',
            '--rokdock-panel-gradient-start',
            '--rokdock-left-panel-grad-start',
            '--rokdock-scrollbar-thumb',
            '--rokdock-section-header-bg',
            '--rokdock-tab-bg',
            '--rokdock-btn-primary',
            '--range-fill',
        ]) {
            expect(base[name]).toBeTruthy()
            expect(vars[name]).not.toBe(base[name])
        }
        // Semantic colors (outside the brand hue range) stay true.
        for (const name of [
            '--rokdock-state-error', // red
            '--rokdock-state-online', // green
            '--rokdock-json-string', // teal syntax
            '--rokdock-btn-danger', // red
            '--rokdock-step-press', // blue, hue 212 just below the band
        ]) {
            expect(base[name]).toBeTruthy()
            expect(vars[name]).toBe(base[name])
        }
        // Neutral overlays (no meaningful hue) stay true.
        expect(vars['--rokdock-scrollbar-track']).toBe(base['--rokdock-scrollbar-track'])
    })

    it('isBrandTintable gates on hue and saturation, ignoring non-colors', () => {
        // Brand purple in range.
        expect(isBrandTintable('#3A1C87')).toBe(true) // primary, hue ~257
        expect(isBrandTintable('rgba(138, 111, 224, 0.22)')).toBe(true) // border
        // Semantic colors outside the band.
        expect(isBrandTintable('#f44336')).toBe(false) // error red
        expect(isBrandTintable('#4caf50')).toBe(false) // online green
        expect(isBrandTintable('#6a9fdb')).toBe(false) // stepPress blue, hue 212
        // Low-saturation purple (the 'other' step color) is below the floor.
        expect(isBrandTintable('#8888aa')).toBe(false) // stepOther, hue 240 sat 0.17
        // Neutrals and non-colors.
        expect(isBrandTintable('rgba(255, 255, 255, 0.2)')).toBe(false)
        expect(isBrandTintable('linear-gradient(180deg, #2d2d2d, #252525)')).toBe(false)
        expect(isBrandTintable('14px')).toBe(false)
    })

    it('nativeWindowBg tints the brand panel bg but no-ops on the identity tint', () => {
        const identity = { hue: 0, saturation: 1, brightness: 0 }
        expect(nativeWindowBg('dark')).toBe(darkTheme.colors.bgPanel)
        expect(nativeWindowBg('dark', identity)).toBe(darkTheme.colors.bgPanel)
        expect(nativeWindowBg('dark', { hue: 172, saturation: 1, brightness: 0.12 }))
            .not.toBe(darkTheme.colors.bgPanel)
    })
})
