import { describe, it, expect } from 'vitest'
import { flattenPages, filterPages } from '@renderer/components/docs/quickOpenSearch'
import type { DocsTreeNode } from '@shared/docs/types'

// Minimal tree: one top-level directory (no indexPath), a child directory
// with an indexPath, and leaf page nodes at multiple depths.
const tree: DocsTreeNode[] = [
    {
        slug: 'developer-program',
        label: 'Developer Program',
        path: 'docs/developer-program',
        kind: 'directory',
        children: [
            {
                slug: 'getting-started',
                label: 'Getting Started',
                path: 'docs/developer-program/getting-started',
                kind: 'directory',
                indexPath: 'docs/developer-program/getting-started/index.md',
                children: [
                    {
                        slug: 'overview',
                        label: 'Overview',
                        path: 'docs/developer-program/getting-started/overview.md',
                        kind: 'page',
                    },
                    {
                        slug: 'installation',
                        label: 'Installation Guide',
                        path: 'docs/developer-program/getting-started/installation.md',
                        kind: 'page',
                    },
                ],
            },
            {
                slug: 'references',
                label: 'References',
                path: 'docs/developer-program/references',
                kind: 'directory',
                // No indexPath: should not appear as a page.
                children: [
                    {
                        slug: 'api',
                        label: 'API Reference',
                        path: 'docs/developer-program/references/api.md',
                        kind: 'page',
                    },
                ],
            },
        ],
    },
]

describe('flattenPages', () => {
    it('includes leaf page nodes', () => {
        const pages = flattenPages(tree)
        const paths = pages.map(page => page.path)
        expect(paths).toContain('docs/developer-program/getting-started/overview.md')
        expect(paths).toContain('docs/developer-program/getting-started/installation.md')
        expect(paths).toContain('docs/developer-program/references/api.md')
    })

    it('includes a directory index page when indexPath is present', () => {
        const pages = flattenPages(tree)
        const paths = pages.map(page => page.path)
        expect(paths).toContain('docs/developer-program/getting-started/index.md')
    })

    it('does NOT include a directory without an indexPath', () => {
        const pages = flattenPages(tree)
        const paths = pages.map(page => page.path)
        expect(paths).not.toContain('docs/developer-program/getting-started')
        expect(paths).not.toContain('docs/developer-program/references')
        expect(paths).not.toContain('docs/developer-program')
    })

    it('uses the directory label as the title for index pages', () => {
        const pages = flattenPages(tree)
        const index = pages.find(page => page.path === 'docs/developer-program/getting-started/index.md')
        expect(index?.title).toBe('Getting Started')
    })

    it('assigns the top-level ancestor label as the section', () => {
        const pages = flattenPages(tree)
        for (const page of pages) {
            expect(page.section).toBe('Developer Program')
        }
    })
})

describe('filterPages', () => {
    const pages = flattenPages(tree)

    it('returns at most max results for an empty query', () => {
        const result = filterPages(pages, '', 2)
        expect(result.length).toBeLessThanOrEqual(2)
    })

    it('returns results for an empty query (shows first max pages)', () => {
        const result = filterPages(pages, '', 50)
        expect(result.length).toBe(pages.length)
    })

    it('is case-insensitive', () => {
        const upper = filterPages(pages, 'OVERVIEW', 50)
        const lower = filterPages(pages, 'overview', 50)
        expect(upper.map(page => page.path)).toEqual(lower.map(page => page.path))
    })

    it('matches by subsequence (scattered chars)', () => {
        // 'ig' is a subsequence of 'Installation Guide'
        const result = filterPages(pages, 'ig', 50)
        expect(result.some(page => page.title === 'Installation Guide')).toBe(true)
    })

    it('excludes titles that do not contain query chars in order', () => {
        const result = filterPages(pages, 'zzz', 50)
        expect(result.length).toBe(0)
    })

    it('ranks starts-with above substring', () => {
        // 'over' starts 'Overview' and is a substring of nothing else here,
        // but this verifies the exact-match / starts-with top rank.
        const result = filterPages(pages, 'Over', 50)
        expect(result[0].title).toBe('Overview')
    })

    it('ranks exact match first', () => {
        const result = filterPages(pages, 'Overview', 50)
        expect(result[0].title).toBe('Overview')
    })

    it('returns empty array when no pages match', () => {
        expect(filterPages(pages, 'xqz', 50)).toEqual([])
    })
})
