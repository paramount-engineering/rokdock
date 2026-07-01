import { describe, it, expect } from 'vitest'
import { DocsRagIndex } from '@main/services/docsRagIndex'

function fakeDocs(pages: Record<string, { title: string; markdown: string }>) {
    return {
        listPageLabels: async () => Object.entries(pages).map(([path, page]) => [path, page.title] as [string, string]),
        getPage: async (path: string) => ({ markdown: pages[path].markdown }),
    }
}

describe('DocsRagIndex', () => {
    it('chunks pages by heading and carries path/title/heading', async () => {
        const idx = new DocsRagIndex(fakeDocs({
            'docs/a.md': { title: 'Page A', markdown: '# Intro\nalpha text\n## Details\nbravo text about roSGScreen' },
        }))
        const hits = await idx.query('roSGScreen')
        expect(hits).toHaveLength(1)
        expect(hits[0]).toMatchObject({ path: 'docs/a.md', title: 'Page A', heading: 'Details' })
        expect(hits[0].text).toContain('bravo text')
    })

    it('ranks by summed distinct-term length and returns at most k', async () => {
        const idx = new DocsRagIndex(fakeDocs({
            'docs/hi.md': { title: 'Hi', markdown: '# H\nrosgnode setfield example' },
            'docs/lo.md': { title: 'Lo', markdown: '# L\nrosgnode only' },
            'docs/no.md': { title: 'No', markdown: '# N\nbaz qux' },
        }))
        // hi matches both distinctive terms (higher score); lo matches one.
        const hits = await idx.query('rosgnode setfield', 1)
        expect(hits).toHaveLength(1)
        expect(hits[0].path).toBe('docs/hi.md')
    })

    it('does not match on a single common short word (relevance gate)', async () => {
        const idx = new DocsRagIndex(fakeDocs({
            'docs/tz.md': { title: 'Timezone', markdown: '# Timezone\nset the device timezone and locale' },
        }))
        // Only the 3-char "set" overlaps: not distinctive and a single term, so no match
        // rather than injecting an unrelated page on sheer frequency.
        expect(await idx.query('set a node')).toEqual([])
    })

    it('returns [] for an empty query and for no matches', async () => {
        const idx = new DocsRagIndex(fakeDocs({ 'docs/a.md': { title: 'A', markdown: '# H\nhello' } }))
        expect(await idx.query('   ')).toEqual([])
        expect(await idx.query('nonexistentterm')).toEqual([])
    })

    it('skips pages that fail to load rather than throwing', async () => {
        const docs = {
            listPageLabels: async () => [['docs/ok.md', 'OK'], ['docs/bad.md', 'Bad']] as Array<[string, string]>,
            getPage: async (path: string) => {
                if (path === 'docs/bad.md') throw new Error('404')
                return { markdown: '# H\nfindme content' }
            },
        }
        const idx = new DocsRagIndex(docs)
        const hits = await idx.query('findme')
        expect(hits).toHaveLength(1)
        expect(hits[0].path).toBe('docs/ok.md')
    })
})
