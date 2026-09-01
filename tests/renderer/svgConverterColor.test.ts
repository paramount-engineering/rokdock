import { describe, it, expect } from 'vitest'
import { toHex, parseStyleRules, ensureSvgNamespace } from '@renderer/svgConverterColor'

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

describe('parseStyleRules', () => {
    it('parses a single flat rule into its selector and declarations', () => {
        expect(parseStyleRules('.cls-1{fill:#ff3355}')).toEqual([
            { selector: '.cls-1', declarations: { fill: '#ff3355' } }
        ])
    })

    it('parses multiple declarations in one rule', () => {
        expect(parseStyleRules('.cls-1{fill:#ff3355;stroke:blue}')).toEqual([
            { selector: '.cls-1', declarations: { fill: '#ff3355', stroke: 'blue' } }
        ])
    })

    it('parses multiple rules', () => {
        expect(parseStyleRules('.a{fill:red}#b{fill:blue}')).toEqual([
            { selector: '.a', declarations: { fill: 'red' } },
            { selector: '#b', declarations: { fill: 'blue' } }
        ])
    })

    it('trims whitespace around selectors and declaration values', () => {
        expect(parseStyleRules(' .cls-1 { fill : #ff3355 ; }')).toEqual([
            { selector: '.cls-1', declarations: { fill: '#ff3355' } }
        ])
    })

    it('skips a declaration with no colon', () => {
        expect(parseStyleRules('.cls-1{fill:#ff3355;garbage}')).toEqual([
            { selector: '.cls-1', declarations: { fill: '#ff3355' } }
        ])
    })

    it('ignores an at-rule condition but still picks up its nested rule (no brace-depth tracking)', () => {
        // Not a goal for this parser (media queries in an SVG <style> block are rare); this
        // documents the actual behavior so it is not mistaken for "at-rules are skipped".
        expect(parseStyleRules('@media (min-width: 1px){.cls-1{fill:red}}')).toEqual([
            { selector: '.cls-1', declarations: { fill: 'red' } }
        ])
    })

    it('returns an empty array for text with no rules', () => {
        expect(parseStyleRules('')).toEqual([])
        expect(parseStyleRules('/* just a comment, no braces */')).toEqual([])
    })
})

describe('ensureSvgNamespace', () => {
    it('injects the SVG namespace onto a root <svg> tag that lacks one', () => {
        expect(ensureSvgNamespace('<svg width="10" height="10"><rect/></svg>'))
            .toBe('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect/></svg>')
    })

    it('is a no-op when the root already declares xmlns', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect/></svg>'
        expect(ensureSvgNamespace(svg)).toBe(svg)
    })

    it('is a no-op when there is no <svg> tag at all', () => {
        expect(ensureSvgNamespace('not an svg')).toBe('not an svg')
    })

    it('injects onto a bare <svg> tag with no other attributes', () => {
        expect(ensureSvgNamespace('<svg><rect/></svg>'))
            .toBe('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')
    })

    it('preserves an XML declaration ahead of the root tag', () => {
        expect(ensureSvgNamespace('<?xml version="1.0"?><svg width="10" height="10"></svg>'))
            .toBe('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>')
    })
})
