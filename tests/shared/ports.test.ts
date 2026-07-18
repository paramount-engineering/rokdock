import { describe, it, expect } from 'vitest'
import { randomPortColor } from '@shared/ports'

describe('randomPortColor', () => {
    it('returns a lowercase 6-digit hex color the color input accepts', () => {
        for (let i = 0; i < 50; i++) {
            expect(randomPortColor()).toMatch(/^#[0-9a-f]{6}$/)
        }
    })

    it('varies across calls (does not reuse one fixed color)', () => {
        const colors = new Set(Array.from({ length: 25 }, () => randomPortColor()))
        expect(colors.size).toBeGreaterThan(1)
    })
})
