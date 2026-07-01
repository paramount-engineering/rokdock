import { describe, it, expect } from 'vitest'
import { createDocSymbolIndex } from '@main/services/ai/docsSymbols'
import { isLinkableTitle } from '@shared/docs/docSymbols'

describe('isLinkableTitle', () => {
    it('accepts Roku component/interface and camel/Pascal hump names', () => {
        for (const title of ['roSGNode', 'ifDeviceInfo', 'ContentNode', 'createObject']) expect(isLinkableTitle(title)).toBe(true)
    })
    it('accepts a single capitalized component word (Rectangle, Label, Poster)', () => {
        for (const title of ['Rectangle', 'Label', 'Poster', 'Group', 'Scene']) expect(isLinkableTitle(title)).toBe(true)
    })
    it('rejects lowercase words, too-short tokens, multi-word titles, and all-caps acronyms', () => {
        for (const title of ['the', 'set', 'no', 'Getting Started', 'RGB', 'HTTP', 'XML']) expect(isLinkableTitle(title)).toBe(false)
    })
})

describe('createDocSymbolIndex', () => {
    it('maps linkable titles to their paths, memoized', async () => {
        let calls = 0
        const idx = createDocSymbolIndex(async () => { calls++; return [['a/roSGNode.md', 'roSGNode'], ['b/Poster.md', 'Poster'], ['c/Getting Started.md', 'Getting Started']] })
        const map = await idx.get()
        expect(map).toEqual({ roSGNode: 'a/roSGNode.md', Poster: 'b/Poster.md' })
        await idx.get()
        expect(calls).toBe(1)
    })

    it('does not memoize an empty result, so it rebuilds once labels arrive', async () => {
        let labels: Array<[string, string]> = []
        let calls = 0
        const idx = createDocSymbolIndex(async () => { calls++; return labels })
        expect(await idx.get()).toEqual({})
        expect(calls).toBe(1)
        // The docs tree is now loaded; the next get rebuilds rather than returning the cached empty.
        labels = [['a/Poster.md', 'Poster']]
        expect(await idx.get()).toEqual({ Poster: 'a/Poster.md' })
        expect(calls).toBe(2)
    })
})
