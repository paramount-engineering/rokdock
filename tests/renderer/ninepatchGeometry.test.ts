import { describe, it, expect } from 'vitest'
import {
    to720,
    hexToRgba,
    bseg,
    outPos,
    detectRuns,
    scaleZones720,
    scalePad720,
    S720,
} from '@renderer/ninepatchGeometry'

describe('S720', () => {
    it('equals 2/3', () => {
        expect(S720).toBeCloseTo(2 / 3)
    })
})

describe('to720', () => {
    it('rounds 120 to 80', () => {
        expect(to720(120)).toBe(80)
    })

    it('rounds 1920 to 1280', () => {
        expect(to720(1920)).toBe(1280)
    })

    it('rounds 1080 to 720', () => {
        expect(to720(1080)).toBe(720)
    })

    it('rounds fractional result to nearest integer', () => {
        // 10 * (2/3) = 6.666... rounds to 7
        expect(to720(10)).toBe(7)
    })

    it('returns 0 for 0', () => {
        expect(to720(0)).toBe(0)
    })
})

describe('hexToRgba', () => {
    it('converts white at full opacity', () => {
        expect(hexToRgba('#ffffff', 100)).toBe('rgba(255,255,255,1)')
    })

    it('converts black at zero opacity', () => {
        expect(hexToRgba('#000000', 0)).toBe('rgba(0,0,0,0)')
    })

    it('converts a mid-range color at 50% opacity', () => {
        expect(hexToRgba('#4caf50', 50)).toBe('rgba(76,175,80,0.5)')
    })

    it('converts a color at a fractional opacity', () => {
        expect(hexToRgba('#0a0b0c', 6)).toBe('rgba(10,11,12,0.06)')
    })
})

describe('bseg', () => {
    it('produces a single stretch segment when zones cover the full width', () => {
        const segs = bseg([{ start: 0, end: 100 }], 100)
        expect(segs).toEqual([{ position: 0, length: 100, stretchable: true }])
    })

    it('wraps a stretch zone with fixed edges', () => {
        const segs = bseg([{ start: 20, end: 80 }], 100)
        expect(segs).toEqual([
            { position: 0, length: 20, stretchable: false },
            { position: 20, length: 60, stretchable: true },
            { position: 80, length: 20, stretchable: false },
        ])
    })

    it('handles two stretch zones with gaps between them', () => {
        const segs = bseg([{ start: 10, end: 40 }, { start: 60, end: 90 }], 100)
        expect(segs).toEqual([
            { position: 0, length: 10, stretchable: false },
            { position: 10, length: 30, stretchable: true },
            { position: 40, length: 20, stretchable: false },
            { position: 60, length: 30, stretchable: true },
            { position: 90, length: 10, stretchable: false },
        ])
    })

    it('sorts zones by start before segmenting', () => {
        const segs = bseg([{ start: 60, end: 90 }, { start: 10, end: 40 }], 100)
        expect(segs[0]).toEqual({ position: 0, length: 10, stretchable: false })
        expect(segs[1]).toEqual({ position: 10, length: 30, stretchable: true })
    })

    it('returns a single fixed segment when zones array is empty', () => {
        const segs = bseg([], 100)
        expect(segs).toEqual([{ position: 0, length: 100, stretchable: false }])
    })

    it('handles a zone that starts at position 0', () => {
        const segs = bseg([{ start: 0, end: 50 }], 100)
        expect(segs).toEqual([
            { position: 0, length: 50, stretchable: true },
            { position: 50, length: 50, stretchable: false },
        ])
    })
})

describe('outPos', () => {
    it('maps the origin to 0', () => {
        const segs = bseg([{ start: 20, end: 80 }], 100)
        expect(outPos(0, segs, 200)).toBe(0)
    })

    it('maps the end of a fixed segment without stretching', () => {
        // Fixed left edge is 20px; in a 200px output it still occupies 20px
        const segs = bseg([{ start: 20, end: 80 }], 100)
        expect(outPos(20, segs, 200)).toBe(20)
    })

    it('maps the end of the stretch segment to output-end minus fixed right', () => {
        // Fixed right edge is 20px (100-80); in 200px output that is still 20px
        // so stretch zone end should map to 200-20 = 180
        const segs = bseg([{ start: 20, end: 80 }], 100)
        expect(outPos(80, segs, 200)).toBe(180)
    })

    it('maps the total end to the output size', () => {
        const segs = bseg([{ start: 20, end: 80 }], 100)
        expect(outPos(100, segs, 200)).toBe(200)
    })

    it('returns correct position when output equals source size (no stretch)', () => {
        const segs = bseg([{ start: 20, end: 80 }], 100)
        expect(outPos(50, segs, 100)).toBe(50)
    })

    it('collapses the stretch segment to zero when the output is smaller than the fixed edges', () => {
        // Fixed edges total 40px (20 left + 20 right). With a 30px output the
        // stretch zone gets 0px, so its end maps onto the left fixed edge end.
        const segs = bseg([{ start: 20, end: 80 }], 100)
        expect(outPos(80, segs, 30)).toBe(20)
    })

    it('maps the total end past the output size when the fixed edges overflow it', () => {
        // The fixed edges (40px) exceed the 30px output, so the total end lands at
        // 40 (> 30). This overflow is what drives the preview min-size warning.
        const segs = bseg([{ start: 20, end: 80 }], 100)
        expect(outPos(100, segs, 30)).toBe(40)
    })
})

describe('detectRuns', () => {
    it('finds a single run in the middle', () => {
        const arr = [false, false, true, true, true, false, false]
        const runs = detectRuns(0, arr.length, i => arr[i])
        expect(runs).toEqual([{ start: 2, end: 5 }])
    })

    it('finds a run that touches the start', () => {
        const arr = [true, true, false, false]
        const runs = detectRuns(0, arr.length, i => arr[i])
        expect(runs).toEqual([{ start: 0, end: 2 }])
    })

    it('finds a run that touches the end', () => {
        const arr = [false, false, true, true]
        const runs = detectRuns(0, arr.length, i => arr[i])
        expect(runs).toEqual([{ start: 2, end: 4 }])
    })

    it('finds multiple non-contiguous runs', () => {
        const arr = [true, false, true, true, false, true]
        const runs = detectRuns(0, arr.length, i => arr[i])
        expect(runs).toEqual([{ start: 0, end: 1 }, { start: 2, end: 4 }, { start: 5, end: 6 }])
    })

    it('returns empty array when no indices match', () => {
        const runs = detectRuns(0, 5, () => false)
        expect(runs).toEqual([])
    })

    it('respects the from/to bounds', () => {
        // Only search indices 2..4 of [true,true,true,true,true]
        const runs = detectRuns(2, 4, () => true)
        expect(runs).toEqual([{ start: 2, end: 4 }])
    })
})

describe('scaleZones720', () => {
    it('scales each zone start and end', () => {
        const result = scaleZones720([{ start: 30, end: 90 }, { start: 120, end: 180 }])
        expect(result[0]).toEqual({ start: 20, end: 60 })
        expect(result[1]).toEqual({ start: 80, end: 120 })
    })

    it('returns an empty array for an empty input', () => {
        expect(scaleZones720([])).toEqual([])
    })
})

describe('scalePad720', () => {
    it('scales a padding zone', () => {
        expect(scalePad720({ start: 12, end: 108 })).toEqual({ start: 8, end: 72 })
    })

    it('returns null for null input', () => {
        expect(scalePad720(null)).toBeNull()
    })
})
