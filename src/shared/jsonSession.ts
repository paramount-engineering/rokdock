/**
 * Types shared by the JSON-editor session-persistence path across main, preload,
 * and the renderer. A buffer is one editor tab.
 */

/** One buffer in the snapshot the renderer pushes to main. */
export interface JsonPersistBuffer {
    id: string
    title: string
    filePath: string | null
    dirty: boolean
    /** Raw editor text when the buffer needs a draft (dirty or untitled-with-content). Null when clean and file-backed. */
    content: string | null
}

/** The full snapshot the renderer pushes (fire-and-forget) on edits and structural changes. */
export interface JsonSessionSnapshot {
    activeBufferId: string | null
    buffers: JsonPersistBuffer[]
}

/** One buffer main hands back to rebuild a tab, content already loaded. */
export interface JsonRestoredBuffer {
    id: string
    title: string
    filePath: string | null
    dirty: boolean
    content: string
}

/** The session main returns at boot for the standalone window. */
export interface JsonRestoredSession {
    activeBufferId: string | null
    buffers: JsonRestoredBuffer[]
    /** filePaths of clean file-backed tabs whose file was gone at restore. The renderer toasts these. */
    missing: string[]
}
