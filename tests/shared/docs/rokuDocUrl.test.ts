import { describe, it, expect } from 'vitest'
import { rokuDocUrl } from '@shared/docs/rokuDocUrl'

const HOME = 'https://developer.roku.com/docs'

describe('rokuDocUrl', () => {
    it('maps a deep reference path to the canonical developer.roku.com URL', () => {
        expect(rokuDocUrl('docs/references/scenegraph/xml-elements/script.md'))
            .toBe('https://developer.roku.com/docs/references/scenegraph/xml-elements/script.md')
    })

    it('maps an index.md path directly', () => {
        expect(rokuDocUrl('docs/developer-program/getting-started/index.md'))
            .toBe('https://developer.roku.com/docs/developer-program/getting-started/index.md')
    })

    it('returns the home fallback for a path not starting with docs/', () => {
        expect(rokuDocUrl('other/stuff/page.md')).toBe(HOME)
    })

    it('returns the home fallback for null', () => {
        expect(rokuDocUrl(null)).toBe(HOME)
    })

    it('returns the home fallback for undefined', () => {
        expect(rokuDocUrl(undefined)).toBe(HOME)
    })

    it('returns the home fallback for an empty string', () => {
        expect(rokuDocUrl('')).toBe(HOME)
    })
})
