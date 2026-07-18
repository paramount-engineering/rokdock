import { describe, it, expect } from 'vitest'
import { parseSvgDimensions } from '@main/utils/svgDimensions'

describe('parseSvgDimensions', () => {
    it('uses explicit pixel width/height when present', () => {
        expect(parseSvgDimensions('<svg width="45" height="45" viewBox="0 0 45 45"></svg>')).toEqual({ width: 45, height: 45 })
        expect(parseSvgDimensions('<svg width="120px" height="60px"></svg>')).toEqual({ width: 120, height: 60 })
        expect(parseSvgDimensions('<svg width="12.5" height="7.5"></svg>')).toEqual({ width: 12.5, height: 7.5 })
    })

    it('falls back to the viewBox when width/height are percentages (not pixels)', () => {
        expect(parseSvgDimensions('<svg width="100%" height="100%" viewBox="0 0 42 76"></svg>')).toEqual({ width: 42, height: 76 })
    })

    it('parses a viewBox whose min-x/min-y are negative (the roBotGlyph.svg regression)', () => {
        // roBotGlyph.svg is sized 100% with a viewBox offset by a negative min-y; the old regex
        // could not match the "-2" and returned { 0, 0 }, so the output defaulted to 1920x1080 and
        // stretched the portrait glyph to 16:9.
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="16 -2 42 76"><g/></svg>'
        expect(parseSvgDimensions(svg)).toEqual({ width: 42, height: 76 })
    })

    it('parses a viewBox with negative min-x and min-y', () => {
        expect(parseSvgDimensions('<svg viewBox="-10 -20 100 200"></svg>')).toEqual({ width: 100, height: 200 })
    })

    it('parses a comma-separated viewBox', () => {
        expect(parseSvgDimensions('<svg viewBox="0,0,64,48"></svg>')).toEqual({ width: 64, height: 48 })
    })

    it('returns zero when neither pixel dimensions nor a viewBox are present', () => {
        expect(parseSvgDimensions('<svg width="100%" height="100%"></svg>')).toEqual({ width: 0, height: 0 })
    })
})
