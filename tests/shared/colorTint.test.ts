import { describe, it, expect } from 'vitest'
import { applyTint, isIdentityTint, IDENTITY_TINT, type Tint } from '@shared/colorTint'

const neutral: Tint = { hue: 0, saturation: 1, brightness: 0 }

describe('isIdentityTint', () => {
    it('is true for the neutral tint', () => {
        expect(isIdentityTint(IDENTITY_TINT)).toBe(true)
        expect(isIdentityTint(neutral)).toBe(true)
    })
    it('is false when any channel is off-neutral', () => {
        expect(isIdentityTint({ hue: 10, saturation: 1, brightness: 0 })).toBe(false)
        expect(isIdentityTint({ hue: 0, saturation: 1.5, brightness: 0 })).toBe(false)
        expect(isIdentityTint({ hue: 0, saturation: 1, brightness: 0.1 })).toBe(false)
    })
})

describe('applyTint', () => {
    it('returns the input unchanged for the identity tint', () => {
        expect(applyTint('#3a1c87', IDENTITY_TINT)).toBe('#3a1c87')
    })
    it('returns the input unchanged for unparseable values (gradients, names)', () => {
        const grad = 'linear-gradient(180deg, #2d2d2d, #252525)'
        expect(applyTint(grad, { hue: 30, saturation: 1, brightness: 0 })).toBe(grad)
        expect(applyTint('transparent', { hue: 30, saturation: 1, brightness: 0 })).toBe('transparent')
    })
    it('rotates hue: a 120deg rotation turns pure red into pure green', () => {
        expect(applyTint('#ff0000', { hue: 120, saturation: 1, brightness: 0 }).toLowerCase()).toBe('#00ff00')
    })
    it('saturation 0 produces a gray (R=G=B)', () => {
        const out = applyTint('#ff0000', { hue: 0, saturation: 0, brightness: 0 })
        const hexMatch = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(out)
        expect(hexMatch).not.toBeNull()
        expect(hexMatch![1]).toBe(hexMatch![2])
        expect(hexMatch![2]).toBe(hexMatch![3])
    })
    it('positive brightness lightens toward white', () => {
        const out = applyTint('#808080', { hue: 0, saturation: 1, brightness: 0.25 })
        const redValue = parseInt(out.slice(1, 3), 16)
        expect(redValue).toBeGreaterThan(0x80)
    })
    it('preserves rgba alpha and emits rgba', () => {
        const out = applyTint('rgba(58, 28, 135, 0.3)', { hue: 0, saturation: 1, brightness: 0 })
        expect(out.startsWith('rgba(')).toBe(true)
        expect(out.replace(/\s+/g, '')).toContain(',0.3)')
    })
})
