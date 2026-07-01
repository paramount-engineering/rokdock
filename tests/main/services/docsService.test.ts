import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DocsService } from '@main/services/docsService'
import { DocsCache } from '@main/services/docsCache'
import fs from 'fs'
import os from 'os'
import path from 'path'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTreeResponse(paths: string[]) {
    return {
        tree: paths.map(docPath => ({ path: docPath, type: 'blob' })),
        truncated: false,
    }
}

function makeFmChunk(title: string, hidden = false): string {
    return `---\ntitle: "${title}"${hidden ? '\nhidden: true' : ''}\n---\nbody text`
}

function makeOrderYaml(slugs: string[]): string {
    return slugs.map(slug => `- ${slug}`).join('\n') + '\n'
}

// A fetch mock that dispatches on URL:
//   - TREE_API  -> treePayload
//   - raw .md   -> front-matter chunk (or 404 if not in fmMap)
//   - _order.yaml -> yaml text (or 404 if not in orderMap)
function buildFetchMock(
    treePayload: object,
    fmMap: Record<string, string>,
    orderMap: Record<string, string>,
) {
    return vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('api.github.com')) {
            return { ok: true, status: 200, json: async () => treePayload }
        }
        // Strip the raw base to get the path.
        const rawBase = 'https://raw.githubusercontent.com/rokudev/dev-doc/v2.0/'
        const path = url.replace(rawBase, '')

        if (path.endsWith('_order.yaml')) {
            const dir = path.replace('/_order.yaml', '')
            if (orderMap[dir] !== undefined) {
                return { ok: true, status: 200, text: async () => orderMap[dir] }
            }
            return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' }
        }

        // Front-matter fetch (Range header used, but mock ignores it).
        if (fmMap[path] !== undefined) {
            return { ok: true, status: 206, text: async () => fmMap[path] }
        }
        return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' }
    })
}

beforeEach(() => vi.unstubAllGlobals())

// ---------------------------------------------------------------------------
// getTree: basic structure
// ---------------------------------------------------------------------------

describe('getTree', () => {
    it('fetches once, caches result, and builds slug index', async () => {
        const paths = ['docs/FEATURES/overview.md', 'docs/FEATURES/index.md']
        const fetchMock = buildFetchMock(
            makeTreeResponse(paths),
            {
                'docs/FEATURES/overview.md': makeFmChunk('Overview'),
                'docs/FEATURES/index.md': makeFmChunk('Features'),
            },
            {},
        )
        vi.stubGlobal('fetch', fetchMock)
        const svc = new DocsService()
        const t1 = await svc.getTree()
        const t2 = await svc.getTree()
        // Tree API must be hit only once.
        expect(fetchMock.mock.calls.filter(([url]: [string]) => url.includes('api.github.com'))).toHaveLength(1)
        expect(t2).toBe(t1)
        // index.md slug maps to folder name.
        expect(t1.slugIndex['features']).toBe('docs/FEATURES/index.md')
        expect(t1.slugIndex['overview']).toBe('docs/FEATURES/overview.md')
    })

    it('excludes reference/ paths and non-md blobs', async () => {
        const paths = [
            'docs/FEATURES/page.md',
            'reference/some-ref.md',
            'docs/FEATURES/_order.yaml',
        ]
        const fetchMock = buildFetchMock(
            makeTreeResponse(paths),
            { 'docs/FEATURES/page.md': makeFmChunk('Page') },
            {},
        )
        vi.stubGlobal('fetch', fetchMock)
        const tree = await new DocsService().getTree()
        const serialized = JSON.stringify(tree.roots)
        expect(serialized).not.toContain('reference')
        expect(serialized).not.toContain('_order')
        expect(serialized).toContain('FEATURES')
    })

    it('top-level category label is the folder name verbatim (not the index title)', async () => {
        const paths = ['docs/FEATURES/index.md', 'docs/FEATURES/page.md']
        const fetchMock = buildFetchMock(
            makeTreeResponse(paths),
            {
                'docs/FEATURES/index.md': makeFmChunk('Features Overview Title'),
                'docs/FEATURES/page.md': makeFmChunk('A Page'),
            },
            {},
        )
        vi.stubGlobal('fetch', fetchMock)
        const tree = await new DocsService().getTree()
        const cat = tree.roots.find(node => node.slug === 'FEATURES')
        expect(cat).toBeDefined()
        // Label must be the folder name, NOT the index title.
        expect(cat!.label).toBe('FEATURES')
    })

    it('a title-less page is labeled by its raw slug, not a humanized one', async () => {
        const paths = ['docs/CAT/script.md', 'docs/CAT/titled.md']
        const fetchMock = buildFetchMock(
            makeTreeResponse(paths),
            {
                // No title in front-matter -> fall back to the raw slug.
                'docs/CAT/script.md': '---\nhidden: false\n---\nbody text',
                'docs/CAT/titled.md': makeFmChunk('A Titled Page'),
            },
            {},
        )
        vi.stubGlobal('fetch', fetchMock)
        const tree = await new DocsService().getTree()
        const cat = tree.roots.find(node => node.slug === 'CAT')!
        const scriptNode = cat.children!.find(child => child.slug === 'script')!
        expect(scriptNode.label).toBe('script')
    })

    it('nested directory label comes from its index.md title', async () => {
        const paths = ['docs/CAT/subdir/index.md', 'docs/CAT/subdir/page.md']
        const fetchMock = buildFetchMock(
            makeTreeResponse(paths),
            {
                'docs/CAT/subdir/index.md': makeFmChunk('My Subdir Title'),
                'docs/CAT/subdir/page.md': makeFmChunk('A Page'),
            },
            {},
        )
        vi.stubGlobal('fetch', fetchMock)
        const tree = await new DocsService().getTree()
        const cat = tree.roots.find(node => node.slug === 'CAT')
        expect(cat).toBeDefined()
        const subdir = cat!.children!.find(node => node.slug === 'subdir')
        expect(subdir).toBeDefined()
        expect(subdir!.label).toBe('My Subdir Title')
    })

    it('hidden: true page is NOT under its parent and IS under a Hidden root node', async () => {
        const paths = ['docs/CAT/normal.md', 'docs/CAT/secret.md']
        const fetchMock = buildFetchMock(
            makeTreeResponse(paths),
            {
                'docs/CAT/normal.md': makeFmChunk('Normal Page'),
                'docs/CAT/secret.md': makeFmChunk('Secret Page', true),
            },
            {},
        )
        vi.stubGlobal('fetch', fetchMock)
        const tree = await new DocsService().getTree()
        const cat = tree.roots.find(node => node.slug === 'CAT')
        expect(cat).toBeDefined()
        // Secret must not appear under CAT.
        expect(cat!.children!.some(child => child.slug === 'secret')).toBe(false)
        // A Hidden root node must exist and contain secret.
        const hidden = tree.roots.find(node => node.slug === '__hidden__')
        expect(hidden).toBeDefined()
        expect(hidden!.label).toBe('Hidden')
        expect(hidden!.children!.some(child => child.slug === 'secret')).toBe(true)
        // Hidden node must be last.
        expect(tree.roots[tree.roots.length - 1].slug).toBe('__hidden__')
    })

    it('no Hidden node when no hidden pages exist', async () => {
        const paths = ['docs/CAT/page.md']
        const fetchMock = buildFetchMock(
            makeTreeResponse(paths),
            { 'docs/CAT/page.md': makeFmChunk('Page') },
            {},
        )
        vi.stubGlobal('fetch', fetchMock)
        const tree = await new DocsService().getTree()
        expect(tree.roots.find(node => node.slug === '__hidden__')).toBeUndefined()
    })

    it('ordering follows docs/_order.yaml for top-level categories', async () => {
        const paths = [
            'docs/ALPHA/page.md',
            'docs/BETA/page.md',
            'docs/GAMMA/page.md',
        ]
        const fetchMock = buildFetchMock(
            makeTreeResponse(paths),
            {
                'docs/ALPHA/page.md': makeFmChunk('Alpha Page'),
                'docs/BETA/page.md': makeFmChunk('Beta Page'),
                'docs/GAMMA/page.md': makeFmChunk('Gamma Page'),
            },
            { docs: makeOrderYaml(['GAMMA', 'ALPHA', 'BETA']) },
        )
        vi.stubGlobal('fetch', fetchMock)
        const tree = await new DocsService().getTree()
        const catSlugs = tree.roots.map(node => node.slug)
        expect(catSlugs).toEqual(['GAMMA', 'ALPHA', 'BETA'])
    })

    it('ordering within a category follows its _order.yaml', async () => {
        const paths = ['docs/CAT/aaa.md', 'docs/CAT/bbb.md', 'docs/CAT/ccc.md']
        const fetchMock = buildFetchMock(
            makeTreeResponse(paths),
            {
                'docs/CAT/aaa.md': makeFmChunk('AAA'),
                'docs/CAT/bbb.md': makeFmChunk('BBB'),
                'docs/CAT/ccc.md': makeFmChunk('CCC'),
            },
            { 'docs/CAT': makeOrderYaml(['ccc', 'aaa', 'bbb']) },
        )
        vi.stubGlobal('fetch', fetchMock)
        const tree = await new DocsService().getTree()
        const cat = tree.roots.find(node => node.slug === 'CAT')!
        expect(cat.children!.map(child => child.slug)).toEqual(['ccc', 'aaa', 'bbb'])
    })

    it('resets treePromise on rejection so next call retries', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({}) })
            .mockResolvedValue({ ok: true, status: 200, json: async () => makeTreeResponse(['docs/CAT/page.md']), text: async () => makeFmChunk('Page') })
        vi.stubGlobal('fetch', fetchMock)
        const svc = new DocsService()
        await expect(svc.getTree()).rejects.toThrow()
        // After reset, a second call should use the second (successful) mock.
        // It will also fire front-matter fetches; stub text too.
        const fetchMock2 = buildFetchMock(
            makeTreeResponse(['docs/CAT/page.md']),
            { 'docs/CAT/page.md': makeFmChunk('Page') },
            {},
        )
        vi.stubGlobal('fetch', fetchMock2)
        const tree = await svc.getTree()
        expect(tree.roots.length).toBeGreaterThan(0)
    })
})

// ---------------------------------------------------------------------------
// getPage
// ---------------------------------------------------------------------------

describe('getPage', () => {
    it('fetches raw markdown, strips front-matter, resolves title, caches', async () => {
        const md = '---\ntitle: "ECP"\n---\n# Body'
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => md }))
        const svc = new DocsService()
        const page = await svc.getPage('docs/A/external-control-api.md')
        expect(page.title).toBe('ECP')
        expect(page.markdown).toContain('# Body')
        expect(page.markdown).not.toContain('title:')
        const callsBefore = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls.length
        await svc.getPage('docs/A/external-control-api.md')
        expect((vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore)
    })

    it('falls back to the raw slug for a title-less page', async () => {
        const md = '---\nhidden: false\n---\n# Body'
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => md }))
        const page = await new DocsService().getPage('docs/REFERENCES/scenegraph/xml-elements/script.md')
        expect(page.title).toBe('script')
    })

    it('throws a clear error on a failed fetch', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' }))
        await expect(new DocsService().getPage('docs/missing.md')).rejects.toThrow(/404/)
    })

    it('parses excerpt from front-matter and omits it when absent', async () => {
        const mdWithExcerpt = '---\ntitle: "ECP"\nexcerpt: "Control your Roku externally."\n---\n# Body'
        const mdWithoutExcerpt = '---\ntitle: "ECP"\n---\n# Body'

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => mdWithExcerpt }))
        const pageWith = await new DocsService().getPage('docs/A/page.md')
        expect(pageWith.excerpt).toBe('Control your Roku externally.')

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => mdWithoutExcerpt }))
        const pageWithout = await new DocsService().getPage('docs/A/page.md')
        expect(pageWithout.excerpt).toBeUndefined()
    })

    it('strips EOF front-matter (no trailing newline after closing ---)', async () => {
        const md = '---\ntitle: "EOF Test"\n---'
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => md }))
        const page = await new DocsService().getPage('docs/A/page.md')
        expect(page.title).toBe('EOF Test')
        expect(page.markdown).toBe('')
    })
})

// ---------------------------------------------------------------------------
// disk cache tier
// ---------------------------------------------------------------------------

describe('disk cache tier', () => {
    it('serves a cached page without hitting the network', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-svc-'))
        try {
            const cachedPage = { path: 'docs/x/y.md', title: 'Y', markdown: '# Y' }
            fs.mkdirSync(path.join(dir, 'pages'), { recursive: true })
            fs.writeFileSync(
                path.join(dir, 'pages', 'docs~x~y.md.json'),
                JSON.stringify(cachedPage), 'utf-8',
            )
            const fetchMock = vi.fn()
            vi.stubGlobal('fetch', fetchMock)
            const svc = new DocsService(dir)
            const page = await svc.getPage('docs/x/y.md')
            expect(page).toEqual(cachedPage)
            expect(fetchMock).not.toHaveBeenCalled()
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('persists a network-fetched page to disk', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-svc-'))
        try {
            const fetchMock = vi.fn(async () => ({
                ok: true, status: 200, text: async () => '---\ntitle: "Z"\n---\n# Z body',
            }))
            vi.stubGlobal('fetch', fetchMock)
            const svc = new DocsService(dir)
            await svc.getPage('docs/z.md')
            const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'pages', 'docs~z.md.json'), 'utf-8'))
            expect(onDisk.title).toBe('Z')
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })
})

// ---------------------------------------------------------------------------
// revalidation
// ---------------------------------------------------------------------------

describe('revalidation', () => {
    function buildCommitsCompareMock(headSha: string, changed: Array<{ filename: string; status: string }>) {
        return vi.fn(async (url: string) => {
            if (url.includes('/commits')) {
                return { ok: true, status: 200, json: async () => [{ sha: headSha }] }
            }
            if (url.includes('/compare')) {
                return { ok: true, status: 200, json: async () => ({ files: changed }) }
            }
            // tree + raw md
            if (url.includes('api.github.com')) {
                return { ok: true, status: 200, json: async () => makeTreeResponse(['docs/a.md']) }
            }
            return { ok: true, status: 200, text: async () => '---\ntitle: "A"\n---\nbody' }
        })
    }

    it('does nothing when the HEAD sha matches the cached sha', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-reval-'))
        try {
            new DocsCache(dir, 'v2.0').setSha('same-sha')
            const fetchMock = buildCommitsCompareMock('same-sha', [])
            vi.stubGlobal('fetch', fetchMock)
            const svc = new DocsService(dir)
            await svc.prime()
            const compareCalls = fetchMock.mock.calls.filter(call => String(call[0]).includes('/compare'))
            expect(compareCalls).toHaveLength(0)
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('refetches a changed page and updates the cached sha', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-reval-'))
        try {
            const cache = new DocsCache(dir, 'v2.0')
            cache.setSha('old-sha')
            cache.writePage({ path: 'docs/a.md', title: 'A old', markdown: 'old' })
            const fetchMock = buildCommitsCompareMock('new-sha', [{ filename: 'docs/a.md', status: 'modified' }])
            vi.stubGlobal('fetch', fetchMock)
            const svc = new DocsService(dir)
            await svc.prime()
            expect(new DocsCache(dir, 'v2.0').getSha()).toBe('new-sha')
            const compareCalls = fetchMock.mock.calls.filter(call => String(call[0]).includes('/compare'))
            expect(compareCalls.length).toBeGreaterThan(0)
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('deletes a removed page from the cache on revalidation', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-reval-'))
        try {
            const cache = new DocsCache(dir, 'v2.0')
            cache.setSha('old-sha')
            cache.writePage({ path: 'docs/gone.md', title: 'Gone', markdown: 'x' })
            const fetchMock = buildCommitsCompareMock('new-sha', [{ filename: 'docs/gone.md', status: 'removed' }])
            vi.stubGlobal('fetch', fetchMock)
            const svc = new DocsService(dir)
            await svc.prime()
            expect(new DocsCache(dir, 'v2.0').readPage('docs/gone.md')).toBeNull()
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('cold path: no prior sha records the head with zero /compare calls', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-reval-'))
        try {
            // Cache has a page but no recorded sha (getSha() === null).
            const cache = new DocsCache(dir, 'v2.0')
            cache.writePage({ path: 'docs/a.md', title: 'A', markdown: 'body' })
            expect(cache.getSha()).toBeNull()
            const fetchMock = buildCommitsCompareMock('head-sha', [])
            vi.stubGlobal('fetch', fetchMock)
            const svc = new DocsService(dir)
            await svc.prime()
            const compareCalls = fetchMock.mock.calls.filter(call => String(call[0]).includes('/compare'))
            expect(compareCalls).toHaveLength(0)
            expect(new DocsCache(dir, 'v2.0').getSha()).toBe('head-sha')
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })
})

describe("What's New degradation", () => {
    it('returns the last cached result with a stale flag when the live fetch fails', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-wn-'))
        try {
            new DocsCache(dir, 'v2.0').writeLastWhatsNew({
                entries: [], since: '2026-01-01T00:00:00.000Z', truncated: false,
            })
            // Tree succeeds (needed by fetchWhatsNew), commits call 403s.
            const fetchMock = vi.fn(async (url: string) => {
                if (url.includes('/commits')) {
                    return { ok: false, status: 403, statusText: 'rate limited', json: async () => [] }
                }
                if (url.includes('api.github.com')) {
                    return { ok: true, status: 200, json: async () => makeTreeResponse(['docs/a.md']) }
                }
                return { ok: true, status: 200, text: async () => '---\ntitle: "A"\n---\nbody' }
            })
            vi.stubGlobal('fetch', fetchMock)
            const svc = new DocsService(dir)
            const result = await svc.getWhatsNew('2026-06-01T00:00:00.000Z')
            expect(result.stale).toBe(true)
            expect(result.staleAsOf).toMatch(/^\d{4}-/)
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('rethrows when there is no cached result to fall back on', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-wn-'))
        try {
            const fetchMock = vi.fn(async (url: string) => {
                if (url.includes('/commits')) {
                    return { ok: false, status: 403, statusText: 'rate limited', json: async () => [] }
                }
                if (url.includes('api.github.com')) {
                    return { ok: true, status: 200, json: async () => makeTreeResponse(['docs/a.md']) }
                }
                return { ok: true, status: 200, text: async () => '---\ntitle: "A"\n---\nbody' }
            })
            vi.stubGlobal('fetch', fetchMock)
            const svc = new DocsService(dir)
            await expect(svc.getWhatsNew('2026-06-01T00:00:00.000Z')).rejects.toThrow()
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })
})
