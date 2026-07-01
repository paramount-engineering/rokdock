/**
 * Persists the standalone JSON editor's session: a manifest (session.json) plus one
 * draft file per dirty/untitled buffer, under userData/json-editor-session/. Enforces
 * the invariant that the draft files on disk are exactly the buffers marked
 * dirty/untitled, so saved or closed buffers never resurrect a stale draft.
 */
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import type { JsonSessionSnapshot, JsonRestoredSession, JsonRestoredBuffer } from '../../shared/jsonSession'

const SESSION_DIR_NAME = 'json-editor-session'
const MANIFEST_FILE = 'session.json'
const DRAFT_EXT = '.txt'
const MANIFEST_VERSION = 1

interface ManifestBuffer {
    id: string
    title: string
    filePath: string | null
    dirty: boolean
    hasDraft: boolean
}
interface Manifest {
    version: number
    activeBufferId: string | null
    buffers: ManifestBuffer[]
}

function sessionDir(): string {
    return path.join(app.getPath('userData'), SESSION_DIR_NAME)
}
function manifestPath(): string {
    return path.join(sessionDir(), MANIFEST_FILE)
}
function draftPath(id: string): string {
    return path.join(sessionDir(), `${id}${DRAFT_EXT}`)
}

export class JsonSessionStore {
    /**
     * Persists a snapshot: writes a draft for every buffer that carries content,
     * writes the manifest, then reconciles so the drafts on disk are exactly the
     * buffers with a draft. Best-effort, a single failed file never throws.
     */
    writeSession(snapshot: JsonSessionSnapshot): void {
        // The snapshot arrives over IPC, so do not trust its shape.
        if (!snapshot || !Array.isArray(snapshot.buffers)) return
        try {
            fs.mkdirSync(sessionDir(), { recursive: true })
        } catch { return }

        const buffers: ManifestBuffer[] = snapshot.buffers.map(bufferEntry => {
            // Record hasDraft only when the draft actually lands on disk, so a failed
            // write does not leave the manifest claiming a draft that restore cannot find.
            let hasDraft = false
            if (bufferEntry.content !== null) {
                try {
                    fs.writeFileSync(draftPath(bufferEntry.id), bufferEntry.content, 'utf-8')
                    hasDraft = true
                } catch { /* best-effort */ }
            }
            return { id: bufferEntry.id, title: bufferEntry.title, filePath: bufferEntry.filePath, dirty: bufferEntry.dirty, hasDraft }
        })

        const manifest: Manifest = { version: MANIFEST_VERSION, activeBufferId: snapshot.activeBufferId, buffers }
        try {
            fs.writeFileSync(manifestPath(), JSON.stringify(manifest, null, 2), 'utf-8')
        } catch { /* best-effort */ }

        this.reconcileDrafts(new Set(buffers.filter(bufferEntry => bufferEntry.hasDraft).map(bufferEntry => bufferEntry.id)))
    }

    /** Delete every draft file whose buffer id is not in the keep set. */
    private reconcileDrafts(keep: Set<string>): void {
        let files: string[]
        try { files = fs.readdirSync(sessionDir()) } catch { return }
        for (const filename of files) {
            if (!filename.endsWith(DRAFT_EXT)) continue
            const id = filename.slice(0, -DRAFT_EXT.length)
            if (!keep.has(id)) {
                try { fs.unlinkSync(path.join(sessionDir(), filename)) } catch { /* best-effort */ }
            }
        }
    }

    /**
     * Reads the manifest and assembles the session for restore: draft content for
     * dirty/untitled buffers, on-disk content for clean file-backed buffers. A clean
     * buffer whose file is gone is dropped and reported in `missing`. A dirty buffer
     * whose draft cannot be read is silently omitted (it appears in neither buffers nor missing).
     * Returns null if there is no manifest or it is corrupt.
     */
    loadRestoredSession(): JsonRestoredSession | null {
        let manifest: Manifest
        try {
            manifest = JSON.parse(fs.readFileSync(manifestPath(), 'utf-8')) as Manifest
        } catch { return null }
        if (!manifest || !Array.isArray(manifest.buffers)) return null

        const buffers: JsonRestoredBuffer[] = []
        const missing: string[] = []
        for (const bufferEntry of manifest.buffers) {
            if (bufferEntry.hasDraft) {
                let content: string | null = null
                try { content = fs.readFileSync(draftPath(bufferEntry.id), 'utf-8') } catch { content = null }
                if (content !== null) {
                    buffers.push({ id: bufferEntry.id, title: bufferEntry.title, filePath: bufferEntry.filePath, dirty: bufferEntry.dirty, content })
                }
                // A dirty buffer with a missing draft is silently skipped (nothing to restore).
            } else if (bufferEntry.filePath) {
                try {
                    const content = fs.readFileSync(bufferEntry.filePath, 'utf-8')
                    buffers.push({ id: bufferEntry.id, title: bufferEntry.title, filePath: bufferEntry.filePath, dirty: false, content })
                } catch {
                    missing.push(bufferEntry.filePath)
                }
            }
            // A clean buffer with no filePath carries nothing to restore, so skip it.
        }
        return { activeBufferId: manifest.activeBufferId, buffers, missing }
    }
}
