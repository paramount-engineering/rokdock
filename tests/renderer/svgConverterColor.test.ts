import { describe, it, expect } from 'vitest'
import { toHex } from '@renderer/svgConverterColor'

describe('toHex', () => {
    it('passes through a 6-digit hex unchanged', () => {
        expect(toHex('#e50914')).toBe('#e50914')
    })

    it('truncates an 8-digit hex to 6 digits', () => {
        expect(toHex('#ffffffff')).toBe('#ffffff')
    })

    it('converts rgb() to hex', () => {
        expect(toHex('rgb(245, 166, 35)')).toBe('#f5a623')
    })

    it('converts rgba() to hex, dropping the alpha', () => {
        expect(toHex('rgba(0,0,0,0.5)')).toBe('#000000')
    })

    it('clamps channel values below 0 to 0', () => {
        expect(toHex('rgb(-10, 0, 0)')).toBe('#000000')
    })

    it('clamps channel values above 255 to 255', () => {
        expect(toHex('rgb(300, 255, 0)')).toBe('#ffff00')
    })

    it('rounds fractional channel values', () => {
        // 127.6 rounds to 128 = 0x80
        expect(toHex('rgb(127.6, 0, 0)')).toBe('#800000')
    })
})
