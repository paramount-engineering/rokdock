import { it, expect } from 'vitest'
import { toggleFavorite, recordView, selectFrequentlyViewed } from '@renderer/components/docs/useDocsLibrary'

it('toggleFavorite adds then removes by path', () => {
    const favorites = toggleFavorite([], { path: 'a', title: 'A' })
    expect(favorites).toHaveLength(1)
    expect(toggleFavorite(favorites, { path: 'a', title: 'A' })).toHaveLength(0)
})

it('recordView increments count and refreshes title', () => {
    let counts = recordView({}, { path: 'a', title: 'A' })
    counts = recordView(counts, { path: 'a', title: 'A (renamed)' })
    expect(counts.a).toEqual({ title: 'A (renamed)', count: 2 })
})

it('selectFrequentlyViewed keeps only pages at/above the threshold', () => {
    const counts = {
        a: { title: 'A', count: 5 },
        b: { title: 'B', count: 4 },
        c: { title: 'C', count: 9 },
    }
    const result = selectFrequentlyViewed(counts)
    // b (4) is below the 5-view threshold. c (9) outranks a (5).
    expect(result).toEqual([
        { path: 'c', title: 'C' },
        { path: 'a', title: 'A' },
    ])
})

it('selectFrequentlyViewed caps the list', () => {
    const counts = Object.fromEntries(
        Array.from({ length: 15 }, (_, i) => [`p${i}`, { title: `P${i}`, count: 5 + i }]),
    )
    expect(selectFrequentlyViewed(counts)).toHaveLength(10)
})
