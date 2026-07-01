import { describe, it, expect } from 'vitest'
import {
    clampReadingScale,
    stepReadingScale,
    READING_SCALE_MIN,
    READING_SCALE_MAX,
    READING_SCALE_DEFAULT,
} from '@renderer/components/docs/useReadingZoom'

describe('clampReadingScale', () => {
    it('keeps an in-range value, rounded to one decimal', () => {
        expect(clampReadingScale(1)).toBe(1)
        expect(clampReadingScale(1.23)).toBe(1.2)
    })
    it('clamps below the minimum and above the maximum', () => {
        expect(clampReadingScale(0.1)).toBe(READING_SCALE_MIN)
        expect(clampReadingScale(5)).toBe(READING_SCALE_MAX)
    })
})

describe('stepReadingScale', () => {
    it('steps up and down by one increment without float drift', () => {
        expect(stepReadingScale(1, 1)).toBe(1.1)
        expect(stepReadingScale(1.1, 1)).toBe(1.2)
        expect(stepReadingScale(1, -1)).toBe(0.9)
    })
    it('does not step past the bounds', () => {
        expect(stepReadingScale(READING_SCALE_MAX, 1)).toBe(READING_SCALE_MAX)
        expect(stepReadingScale(READING_SCALE_MIN, -1)).toBe(READING_SCALE_MIN)
    })
    it('default is the identity multiplier', () => {
        expect(READING_SCALE_DEFAULT).toBe(1)
    })
})
