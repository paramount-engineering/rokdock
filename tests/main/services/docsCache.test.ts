import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { DocsCache } from '@main/services/docsCache'
import type { DocsTree, DocsPage, WhatsNewResult } from '@shared/docs/types'

let dir: string
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-cache-'))
})
afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
})

const tree: DocsTree = { roots: [{ slug: 'a', label: 'A', path: 'docs/a.md', kind: 'page' }], slugIndex: {} }
const page: DocsPage = { path: 'docs/foo/bar.md', title: 'Bar', markdown: '# Bar\nbody' }

describe('DocsCache version gate', () => {
    it('is invalid before anything is written', () => {
        expect(new DocsCache(dir, 'v2.0').isValidFor()).toBe(false)
    })
    it('is valid after setSha with a matching ref', () => {
        const cache = new DocsCache(dir, 'v2.0')
        cache.setSha('abc123')
        expect(new DocsCache(dir, 'v2.0').isValidFor()).toBe(true)
    })
    it('is invalid when the ref differs', () => {
        new DocsCache(dir, 'v2.0').setSha('abc123')
        expect(new DocsCache(dir, 'v9.9').isValidFor()).toBe(false)
    })
})

describe('DocsCache tree and pages', () => {
    it('round-trips the tree', () => {
        const cache = new DocsCache(dir, 'v2.0')
        cache.writeTree(tree)
        expect(cache.readTree()).toEqual(tree)
    })
    it('round-trips a page and reads null for an absent page', () => {
        const cache = new DocsCache(dir, 'v2.0')
        expect(cache.readPage(page.path)).toBeNull()
        cache.writePage(page)
        expect(cache.readPage(page.path)).toEqual(page)
    })
    it('deletes a page', () => {
        const cache = new DocsCache(dir, 'v2.0')
        cache.writePage(page)
        cache.deletePage(page.path)
        expect(cache.readPage(page.path)).toBeNull()
    })
    it('encodes nested paths to a single safe filename without collision', () => {
        const cache = new DocsCache(dir, 'v2.0')
        const page1: DocsPage = { path: 'docs/a/b.md', title: '1', markdown: 'x' }
        const page2: DocsPage = { path: 'docs/a~b.md', title: '2', markdown: 'y' }
        cache.writePage(page1)
        cache.writePage(page2)
        expect(cache.readPage('docs/a/b.md')?.title).toBe('1')
        expect(cache.readPage('docs/a~b.md')?.title).toBe('2')
    })
})

describe('DocsCache sha', () => {
    it('returns null sha before setSha and the sha after', () => {
        const cache = new DocsCache(dir, 'v2.0')
        expect(cache.getSha()).toBeNull()
        cache.setSha('deadbeef')
        expect(new DocsCache(dir, 'v2.0').getSha()).toBe('deadbeef')
    })
})

describe('DocsCache What\'s New last-good', () => {
    it('round-trips with a savedAt timestamp', () => {
        const cache = new DocsCache(dir, 'v2.0')
        const result: WhatsNewResult = { entries: [], since: '2026-01-01T00:00:00.000Z', truncated: false }
        expect(cache.readLastWhatsNew()).toBeNull()
        cache.writeLastWhatsNew(result)
        const back = cache.readLastWhatsNew()
        expect(back?.result).toEqual(result)
        expect(typeof back?.savedAt).toBe('string')
    })
})

describe('DocsCache reconcile', () => {
    it('clears the cache when the manifest ref no longer matches', () => {
        const old = new DocsCache(dir, 'v2.0')
        old.writePage(page)
        old.setSha('abc')
        const current = new DocsCache(dir, 'v3.0')
        current.reconcile()
        expect(current.readPage(page.path)).toBeNull()
        expect(old.readPage(page.path)).toBeNull()
    })
    it('keeps the cache when the ref matches', () => {
        const cache = new DocsCache(dir, 'v2.0')
        cache.writePage(page)
        cache.setSha('abc')
        cache.reconcile()
        expect(cache.readPage(page.path)).toEqual(page)
    })
    it('is a no-op on a cold cache with no manifest', () => {
        const cache = new DocsCache(dir, 'v2.0')
        cache.writePage(page) // page written before any manifest (interrupted cold warm)
        cache.reconcile()
        expect(cache.readPage(page.path)).toEqual(page)
    })
})

describe('DocsCache resilience', () => {
    it('treats a corrupt manifest as invalid', () => {
        const cache = new DocsCache(dir, 'v2.0')
        cache.setSha('abc')
        fs.writeFileSync(path.join(dir, 'manifest.json'), '{ not json', 'utf-8')
        expect(cache.isValidFor()).toBe(false)
        expect(cache.getSha()).toBeNull()
    })
    it('returns null for a corrupt page file', () => {
        const cache = new DocsCache(dir, 'v2.0')
        cache.writePage(page)
        const file = fs.readdirSync(path.join(dir, 'pages'))[0]
        fs.writeFileSync(path.join(dir, 'pages', file), '{ not json', 'utf-8')
        expect(cache.readPage(page.path)).toBeNull()
    })
    it('clear removes the directory contents', () => {
        const cache = new DocsCache(dir, 'v2.0')
        cache.writePage(page)
        cache.setSha('abc')
        cache.clear()
        expect(cache.isValidFor()).toBe(false)
        expect(cache.readPage(page.path)).toBeNull()
    })
})
