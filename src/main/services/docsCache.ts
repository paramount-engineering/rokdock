/**
 * Persistent disk cache for the Developer Docs viewer, under userData/docs-cache/.
 * Holds the nav tree (tree.json), one JSON file per page (pages/<encoded>.json),
 * the last successful What's New result (whats-new-last.json), and a manifest
 * (manifest.json) carrying the schema version, the docs ref, and the commit SHA
 * the cache was built against.
 *
 * The cache is best-effort: every read swallows errors and returns null, every
 * write swallows errors, so a disk problem can never break a docs read. A page
 * filename is a deterministic function of the repo path (slashes -> '~'), so no
 * path->filename map is needed and concurrent page writes during a corpus warm
 * never race on a shared index file.
 */
import fs from 'fs'
import path from 'path'
import type { DocsPage, DocsTree, WhatsNewResult } from '../../shared/docs/types'

const MANIFEST_VERSION = 1
const MANIFEST_FILE = 'manifest.json'
const TREE_FILE = 'tree.json'
const PAGES_DIR = 'pages'
const WHATS_NEW_FILE = 'whats-new-last.json'

interface Manifest {
    version: number
    ref: string
    builtAgainstSha: string | null
    updatedAt: string
}

interface StoredWhatsNew {
    result: WhatsNewResult
    savedAt: string
}

/** Repo path -> a single filesystem-safe filename. Encodes slashes as '~'
 *  and escapes any existing tildes to '~~' for collision-free mapping. */
function pageFileName(repoPath: string): string {
    return `${repoPath.replace(/~/g, '~~').replace(/\//g, '~')}.json`
}

export class DocsCache {
    constructor(private readonly dir: string, private readonly ref: string) {}

    private file(name: string): string {
        return path.join(this.dir, name)
    }

    /** Write `data` atomically: to a temp file, then rename over the target. */
    private writeAtomic(target: string, data: string): void {
        try {
            fs.mkdirSync(path.dirname(target), { recursive: true })
            const tmp = `${target}.tmp`
            fs.writeFileSync(tmp, data, 'utf-8')
            fs.renameSync(tmp, target)
        } catch { /* best-effort */ }
    }

    private readManifest(): Manifest | null {
        try {
            const manifest = JSON.parse(fs.readFileSync(this.file(MANIFEST_FILE), 'utf-8')) as Manifest
            if (!manifest || typeof manifest !== 'object') return null
            return manifest
        } catch { return null }
    }

    isValidFor(): boolean {
        const manifest = this.readManifest()
        return manifest !== null && manifest.version === MANIFEST_VERSION && manifest.ref === this.ref
    }

    /**
     * Clear the cache when a manifest is present but no longer valid for this
     * ref/version (e.g. the pinned docs ref changed). A cold cache with no
     * manifest is left alone so an interrupted warm's pages survive. Run once at
     * startup, before any read, so a stale-ref cache is never served.
     */
    reconcile(): void {
        const manifest = this.readManifest()
        if (manifest !== null && (manifest.version !== MANIFEST_VERSION || manifest.ref !== this.ref)) {
            this.clear()
        }
    }

    readTree(): DocsTree | null {
        try {
            return JSON.parse(fs.readFileSync(this.file(TREE_FILE), 'utf-8')) as DocsTree
        } catch { return null }
    }

    writeTree(tree: DocsTree): void {
        this.writeAtomic(this.file(TREE_FILE), JSON.stringify(tree))
    }

    readPage(repoPath: string): DocsPage | null {
        try {
            const full = path.join(this.dir, PAGES_DIR, pageFileName(repoPath))
            return JSON.parse(fs.readFileSync(full, 'utf-8')) as DocsPage
        } catch { return null }
    }

    writePage(page: DocsPage): void {
        this.writeAtomic(path.join(this.dir, PAGES_DIR, pageFileName(page.path)), JSON.stringify(page))
    }

    deletePage(repoPath: string): void {
        try {
            fs.unlinkSync(path.join(this.dir, PAGES_DIR, pageFileName(repoPath)))
        } catch { /* already gone */ }
    }

    getSha(): string | null {
        const manifest = this.readManifest()
        if (manifest === null || manifest.version !== MANIFEST_VERSION || manifest.ref !== this.ref) return null
        return manifest.builtAgainstSha
    }

    setSha(sha: string): void {
        const manifest: Manifest = {
            version: MANIFEST_VERSION,
            ref: this.ref,
            builtAgainstSha: sha,
            updatedAt: new Date().toISOString(),
        }
        this.writeAtomic(this.file(MANIFEST_FILE), JSON.stringify(manifest, null, 2))
    }

    readLastWhatsNew(): StoredWhatsNew | null {
        try {
            const stored = JSON.parse(fs.readFileSync(this.file(WHATS_NEW_FILE), 'utf-8')) as StoredWhatsNew
            if (!stored || !stored.result) return null
            return stored
        } catch { return null }
    }

    writeLastWhatsNew(result: WhatsNewResult): void {
        const stored: StoredWhatsNew = { result, savedAt: new Date().toISOString() }
        this.writeAtomic(this.file(WHATS_NEW_FILE), JSON.stringify(stored))
    }

    clear(): void {
        try {
            fs.rmSync(this.dir, { recursive: true, force: true })
        } catch { /* best-effort */ }
    }
}
