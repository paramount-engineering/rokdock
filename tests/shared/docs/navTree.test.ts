import { describe, it, expect } from 'vitest'
import { humanizeSlug, buildSlugIndex, buildNavTree, orderChildren, parseFrontMatterField, parseFrontMatterTitle, stripFrontMatter, parseFrontMatterMeta } from '@shared/docs/navTree'

describe('humanizeSlug', () => {
    it('title-cases a kebab slug', () => {
        expect(humanizeSlug('external-control-api')).toBe('External Control Api')
    })
})

describe('buildSlugIndex', () => {
    it('maps lowercased basename slug to path, ignoring _order.yaml and non-md', () => {
        const paths = ['docs/DEVELOPER/dev-tools/external-control-api.md', 'docs/DEVELOPER/_order.yaml']
        expect(buildSlugIndex(paths)).toEqual({ 'external-control-api': 'docs/DEVELOPER/dev-tools/external-control-api.md' })
    })
    it('maps an index.md path to the parent folder name (lowercased)', () => {
        const paths = ['docs/A/dashboard/index.md', 'docs/A/foo.md']
        const index = buildSlugIndex(paths)
        expect(index['dashboard']).toBe('docs/A/dashboard/index.md')
        expect(index['foo']).toBe('docs/A/foo.md')
    })
})

describe('buildNavTree', () => {
    it('nests directories and pages from flat paths', () => {
        const paths = ['docs/A/index.md', 'docs/A/b/page.md']
        const roots = buildNavTree(paths)
        expect(roots[0].slug).toBe('docs')
        const dirNode = roots[0].children!.find(node => node.slug === 'A')!
        expect(dirNode.kind).toBe('directory')
        expect(dirNode.children!.some(node => node.slug === 'b' && node.kind === 'directory')).toBe(true)
    })

    it('folds a directory index.md into indexPath and drops the separate Index child', () => {
        const roots = buildNavTree(['docs/A/index.md', 'docs/A/page.md'])
        const dirNode = roots[0].children!.find(node => node.slug === 'A')!
        expect(dirNode.indexPath).toBe('docs/A/index.md')
        expect(dirNode.children!.some(node => node.slug === 'index')).toBe(false)
        expect(dirNode.children!.some(node => node.slug === 'page')).toBe(true)
    })
})

describe('orderChildren', () => {
    it('orders by the _order.yaml slug sequence, appending unlisted alphabetically', () => {
        const children = [{ slug: 'b' }, { slug: 'a' }, { slug: 'c' }] as any
        expect(orderChildren(children, ['c', 'a']).map((node: any) => node.slug)).toEqual(['c', 'a', 'b'])
    })
})

describe('parseFrontMatterField', () => {
    it('extracts an excerpt value from front-matter', () => {
        const md = '---\ntitle: "My Page"\nexcerpt: "A short description of the page."\n---\nbody'
        expect(parseFrontMatterField(md, 'excerpt')).toBe('A short description of the page.')
    })
    it('returns null for a key that is not present in the front-matter', () => {
        const md = '---\ntitle: "My Page"\n---\nbody'
        expect(parseFrontMatterField(md, 'excerpt')).toBeNull()
    })
    it('returns null when there is no front-matter block', () => {
        expect(parseFrontMatterField('# Heading', 'title')).toBeNull()
    })
    it('delegates to the same logic as parseFrontMatterTitle for the title key', () => {
        const md = '---\ntitle: "SceneGraph"\n---\nbody'
        expect(parseFrontMatterField(md, 'title')).toBe('SceneGraph')
    })
})

describe('parseFrontMatterTitle', () => {
    it('extracts title from YAML front-matter', () => {
        const md = '---\ntitle: "SceneGraph coordinate systems"\nhidden: false\n---\nbody'
        expect(parseFrontMatterTitle(md)).toBe('SceneGraph coordinate systems')
    })
    it('returns null when no front-matter', () => {
        expect(parseFrontMatterTitle('# Heading')).toBeNull()
    })
    it('extracts title from CRLF front-matter', () => {
        const md = '---\r\ntitle: "CRLF Title"\r\n---\r\nbody'
        expect(parseFrontMatterTitle(md)).toBe('CRLF Title')
    })
})

describe('stripFrontMatter', () => {
    it('removes LF front-matter and returns the body', () => {
        expect(stripFrontMatter('---\ntitle: T\n---\nbody')).toBe('body')
    })
    it('returns unchanged string when no front-matter', () => {
        expect(stripFrontMatter('# Heading')).toBe('# Heading')
    })
    it('removes CRLF front-matter and returns the body', () => {
        const md = '---\r\ntitle: T\r\n---\r\nbody'
        expect(stripFrontMatter(md)).toBe('body')
    })
    it('strips front-matter when closing --- is at end-of-file with no trailing newline', () => {
        const md = '---\ntitle: T\n---'
        expect(stripFrontMatter(md)).toBe('')
    })
})

describe('parseFrontMatterField EOF', () => {
    it('parses title when closing --- is at end-of-file with no trailing newline', () => {
        const md = '---\ntitle: EOF Page\n---'
        expect(parseFrontMatterField(md, 'title')).toBe('EOF Page')
    })
})

describe('parseFrontMatterMeta', () => {
    it('extracts title and hidden: false from a complete front-matter block', () => {
        const md = '---\ntitle: "My Page"\nhidden: false\n---\nbody'
        expect(parseFrontMatterMeta(md)).toEqual({ title: 'My Page', hidden: false })
    })
    it('detects hidden: true', () => {
        const md = '---\ntitle: "Secret"\nhidden: true\n---\nbody'
        expect(parseFrontMatterMeta(md)).toEqual({ title: 'Secret', hidden: true })
    })
    it('is tolerant of a truncated chunk without closing ---', () => {
        const chunk = '---\ntitle: "Truncated Title"\nhidden: true\n'
        const result = parseFrontMatterMeta(chunk)
        expect(result.title).toBe('Truncated Title')
        expect(result.hidden).toBe(true)
    })
    it('returns { hidden: false } when chunk does not start with ---', () => {
        expect(parseFrontMatterMeta('# Not front-matter')).toEqual({ hidden: false })
    })
    it('strips surrounding quotes from title', () => {
        const md = '---\ntitle: \'Single Quoted\'\n---\nbody'
        expect(parseFrontMatterMeta(md).title).toBe('Single Quoted')
    })
})
