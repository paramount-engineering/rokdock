import { describe, it, expect } from 'vitest'
import { createDocsContextProvider } from '@main/services/ai/docsContextProvider'
import type { DocChunk } from '@main/services/docsRagIndex'

const chunk = (path: string): DocChunk => ({ path, title: 'Node', heading: 'Overview', text: 'body text' })

function provider(over: Partial<{ query: (text: string, k?: number) => Promise<DocChunk[]>; getPage: (path: string) => Promise<{ markdown: string }> }> = {}) {
    return createDocsContextProvider({
        query: over.query ?? (async () => [chunk('SceneGraph/Node.md')]),
        getPage: over.getPage ?? (async () => ({ markdown: '# Node\nfull page' })),
    })
}

describe('createDocsContextProvider', () => {
    it('does not push docs per turn: there is no retrieve, only the on-demand tools', () => {
        expect(provider().retrieve).toBeUndefined()
    })
})

describe('docs provider tools', () => {
    it('exposes search_docs and fetch_page specs', () => {
        const tools = provider().tools!()
        expect(tools.map(tool => tool.name).sort()).toEqual(['fetch_page', 'search_docs'])
    })

    it('search_docs returns a JSON list of {path,title,heading,snippet}', async () => {
        const result = await provider().callTool!('search_docs', { query: 'node' }, new AbortController().signal)
        expect(result.isError).toBeFalsy()
        const hits = JSON.parse(result.content)
        expect(hits[0]).toEqual({ path: 'SceneGraph/Node.md', title: 'Node', heading: 'Overview', snippet: 'body text' })
    })

    it('fetch_page returns the page markdown, capped', async () => {
        const big = 'x'.repeat(20000)
        const result = await provider({ getPage: async () => ({ markdown: big }) }).callTool!('fetch_page', { path: 'p.md' }, new AbortController().signal)
        expect(result.isError).toBeFalsy()
        expect(result.content.length).toBe(8000)
    })

    it('fetch_page on a load failure returns an isError result', async () => {
        const result = await provider({ getPage: async () => { throw new Error('404') } }).callTool!('fetch_page', { path: 'missing.md' }, new AbortController().signal)
        expect(result.isError).toBe(true)
        expect(result.content).toContain('missing.md')
    })

    it('an unknown tool name returns an isError result', async () => {
        const result = await provider().callTool!('nope', {}, new AbortController().signal)
        expect(result.isError).toBe(true)
    })

    it('a missing query arg returns an isError result, not a throw', async () => {
        const result = await provider().callTool!('search_docs', {}, new AbortController().signal)
        expect(result.isError).toBe(true)
    })
})
