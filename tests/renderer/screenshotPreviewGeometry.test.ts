import { describe, it, expect } from 'vitest'
import {
    fitZoomPercent,
    snapZoomPercent,
    measureDelta,
    measureLabelText,
    measureTickFractions
} from '@renderer/screenshotPreviewGeometry'

describe('fitZoomPercent', () => {
    it('fits a large image down to the viewport without upscaling past 100', () => {
        // 1920x1080 into 960x540 -> 50%
        expect(fitZoomPercent(1920, 1080, 960, 540, 10)).toBe(50)
    })

    it('never upscales a small image past 100%', () => {
        expect(fitZoomPercent(100, 100, 1000, 1000, 10)).toBe(100)
    })

    it('clamps to minZoom when the image is far larger than the viewport', () => {
        // 10000 wide into 100 -> 1% raw, clamped to minZoom 10
        expect(fitZoomPercent(10000, 100, 100, 100, 10)).toBe(10)
    })

    it('uses the limiting dimension (height-constrained)', () => {
        // width fits at 100%, height needs 50%
        expect(fitZoomPercent(500, 1080, 1000, 540, 10)).toBe(50)
    })

    it('floors fractional fit percentages', () => {
        // min ratio 0.333... -> 33
        expect(fitZoomPercent(300, 300, 100, 100, 10)).toBe(33)
    })

    it('returns null for degenerate image dimensions', () => {
        expect(fitZoomPercent(0, 100, 100, 100, 10)).toBeNull()
        expect(fitZoomPercent(100, 0, 100, 100, 10)).toBeNull()
    })

    it('treats a zero viewport as at least 1px (no divide-by-zero)', () => {
        expect(fitZoomPercent(1000, 1000, 0, 0, 10)).toBe(10)
    })
})

describe('snapZoomPercent', () => {
    it('snaps to 100 within the threshold', () => {
        expect(snapZoomPercent(101, 10, 300, 100, 2)).toBe(100)
        expect(snapZoomPercent(99, 10, 300, 100, 2)).toBe(100)
        expect(snapZoomPercent(98, 10, 300, 100, 2)).toBe(100)
    })

    it('does not snap outside the threshold', () => {
        expect(snapZoomPercent(97, 10, 300, 100, 2)).toBe(97)
        expect(snapZoomPercent(103, 10, 300, 100, 2)).toBe(103)
    })

    it('clamps to the max then does not snap', () => {
        expect(snapZoomPercent(500, 10, 300, 100, 2)).toBe(300)
    })

    it('clamps to the min', () => {
        expect(snapZoomPercent(1, 10, 300, 100, 2)).toBe(10)
    })
})

describe('measureDelta', () => {
    it('computes rounded axis and diagonal distances', () => {
        const delta = measureDelta({ nx: 0, ny: 0 }, { nx: 3, ny: 4 })
        expect(delta).toEqual({ dx: 3, dy: 4, adx: 3, ady: 4, diag: 5 })
    })

    it('rounds sub-pixel coordinates', () => {
        const delta = measureDelta({ nx: 0.4, ny: 0 }, { nx: 10.6, ny: 0 })
        // 10.6 - 0.4 = 10.2 -> round 10
        expect(delta.dx).toBe(10)
        expect(delta.adx).toBe(10)
    })

    it('reports absolute values for a negative-direction drag', () => {
        const delta = measureDelta({ nx: 50, ny: 50 }, { nx: 10, ny: 20 })
        expect(delta.adx).toBe(40)
        expect(delta.ady).toBe(30)
        expect(delta.diag).toBe(50)
    })
})

describe('measureLabelText', () => {
    it('reads "0 px" for no movement', () => {
        expect(measureLabelText({ dx: 0, dy: 0, adx: 0, ady: 0, diag: 0 })).toBe('0 px')
    })

    it('reads horizontal for a pure-x measure', () => {
        expect(measureLabelText({ dx: 12, dy: 0, adx: 12, ady: 0, diag: 12 })).toBe('12 px (horizontal)')
    })

    it('reads vertical for a pure-y measure', () => {
        expect(measureLabelText({ dx: 0, dy: 7, adx: 0, ady: 7, diag: 7 })).toBe('7 px (vertical)')
    })

    it('reads all three components for a diagonal measure', () => {
        expect(measureLabelText({ dx: 3, dy: 4, adx: 3, ady: 4, diag: 5 })).toBe(
            'dx: 3 px\ndy: 4 px\nDiagonal: 5 px'
        )
    })
})

describe('measureTickFractions', () => {
    it('returns no ticks for a short line', () => {
        expect(measureTickFractions(10, 100, 20)).toEqual([])
    })

    it('returns no ticks when the display length is negligible', () => {
        expect(measureTickFractions(200, 0.1, 20)).toEqual([])
    })

    it('places ticks every step, skipping the ends', () => {
        // length 100, step 20 -> ticks at 20,40,60 (80 excluded: 80 < 100 - 7 = 93 is true, so 80 included)
        const fractions = measureTickFractions(100, 100, 20)
        // t = 20,40,60,80 ; stop when t >= 100 - 7 = 93
        expect(fractions).toEqual([0.2, 0.4, 0.6, 0.8])
    })

    it('expresses ticks as fractions of the natural length', () => {
        const fractions = measureTickFractions(200, 400, 50)
        expect(fractions).toEqual([0.25, 0.5, 0.75])
    })
})
