/**
 * Persistent storage layer for RokDock automation scripts.
 *
 * Scripts are stored as JSON files in Electron's userData directory under
 * the 'scripts/' subdirectory, using the '.rscript' extension. Files written
 * before this change used the compound '.rscript.json' extension (legacy).
 * The library reads both extensions and upgrades a legacy file to '.rscript'
 * in place the first time that script is saved.
 *
 * The library also maintains a sort-order.json file so the user's custom
 * ordering in the scripts panel is preserved across sessions. New scripts
 * not yet in the sort order are appended by modification time.
 *
 * All operations are synchronous file I/O (scripts are small and infrequent).
 * The init() method must be called once at startup to create the scripts directory.
 */

import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import type { ScriptFile } from '../../shared/script'

const SCRIPTS_DIR_NAME = 'scripts'
const SCRIPT_EXT = '.rscript'
const LEGACY_SCRIPT_EXT = '.rscript.json'
const SORT_ORDER_FILE = 'sort-order.json'

/**
 * Returns the absolute path to the scripts directory inside Electron's userData folder.
 */
function scriptsDir(): string {
    return path.join(app.getPath('userData'), SCRIPTS_DIR_NAME)
}

/**
 * Creates the scripts directory (and any missing parents) if it does not already exist.
 */
function ensureScriptsDir(): void {
    fs.mkdirSync(scriptsDir(), { recursive: true })
}

/**
 * Sanitizes a script display name into a safe filename stem. Illegal filesystem
 * characters become underscores. A blank result falls back to 'untitled'.
 */
function safeFileStem(name: string): string {
    return name.replace(/[/\\:*?"<>|]/g, '_').trim() || 'untitled'
}

/**
 * Absolute path for a script's new-extension (.rscript) file, derived from its name.
 */
function scriptPath(name: string): string {
    return path.join(scriptsDir(), `${safeFileStem(name)}${SCRIPT_EXT}`)
}

/**
 * Returns the script extension a filename ends with (new or legacy), or null.
 * The two never overlap because a .rscript.json ends with .json, not .rscript.
 */
function scriptExtOf(filename: string): string | null {
    if (filename.endsWith(SCRIPT_EXT)) return SCRIPT_EXT
    if (filename.endsWith(LEGACY_SCRIPT_EXT)) return LEGACY_SCRIPT_EXT
    return null
}

export interface ScriptListEntry {
    name: string
    filePath: string
    modifiedAt: number
    stepCount: number
}

/**
 * File-based CRUD store for RokDock automation scripts.
 * Each script is a separate '.rscript' file (or legacy '.rscript.json'). Sort order
 * is maintained in a sidecar JSON file.
 */
export class ScriptLibrary {
    /**
     * Ensures the scripts directory exists. Must be called once at app startup
     * before any other method is used.
     */
    init(): void {
        ensureScriptsDir()
    }

    /**
     * Returns the absolute path to the sort-order sidecar file.
     */
    private sortOrderPath(): string {
        return path.join(scriptsDir(), SORT_ORDER_FILE)
    }

    /**
     * Reads the persisted sort order from disk.
     *
     * @returns An array of absolute file paths in the user's preferred order,
     *   or an empty array if the sidecar file is absent or unreadable.
     */
    getSortOrder(): string[] {
        try {
            return JSON.parse(fs.readFileSync(this.sortOrderPath(), 'utf-8'))
        } catch { return [] }
    }

    /**
     * Writes the sort order to the sidecar file, creating the scripts directory
     * if necessary.
     *
     * @param order - Array of absolute file paths in the desired display order.
     */
    saveSortOrder(order: string[]): void {
        ensureScriptsDir()
        fs.writeFileSync(this.sortOrderPath(), JSON.stringify(order, null, 2), 'utf-8')
    }

    /**
     * Returns all scripts in the user's preferred sort order.
     *
     * Scripts already in the saved order come first; new scripts not yet in the
     * order are appended sorted by modification time (newest first). Scripts whose
     * files have been deleted are omitted automatically.
     *
     * @returns Array of lightweight list entries (no step data loaded).
     */
    list(): ScriptListEntry[] {
        ensureScriptsDir()
        const dir = scriptsDir()
        try {
            const entries = fs.readdirSync(dir)
                .map(filename => ({ filename, ext: scriptExtOf(filename) }))
                .filter((fileEntry): fileEntry is { filename: string; ext: string } => fileEntry.ext !== null)
                .map(({ filename, ext }) => {
                    const filePath = path.join(dir, filename)
                    const stat = fs.statSync(filePath)
                    const name = filename.slice(0, -ext.length)
                    let stepCount = 0
                    try {
                        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
                        stepCount = Array.isArray(data.steps) ? data.steps.length : 0
                    } catch { /* corrupted file - show 0 */ }
                    return { name, filePath, modifiedAt: stat.mtimeMs, stepCount }
                })

            // Apply saved sort order if available, fall back to modifiedAt
            const order = this.getSortOrder()
            if (order.length === 0) return entries.sort((entryA, entryB) => entryB.modifiedAt - entryA.modifiedAt)

            const byPath = new Map(entries.map(entry => [entry.filePath, entry]))
            const ordered: ScriptListEntry[] = []
            for (const filePath of order) {
                const entry = byPath.get(filePath)
                if (entry) { ordered.push(entry); byPath.delete(filePath) }
            }
            // Append new scripts not in sort order (by modifiedAt)
            const remaining = [...byPath.values()].sort((entryA, entryB) => entryB.modifiedAt - entryA.modifiedAt)
            return ordered.concat(remaining)
        } catch {
            return []
        }
    }

    /**
     * Reads and parses a script from disk.
     *
     * @param filePath - Absolute path to a '.rscript' (new) or legacy '.rscript.json' file.
     * @returns The parsed `ScriptFile` object.
     * @throws If the file cannot be read or is not valid JSON.
     */
    load(filePath: string): ScriptFile {
        const content = fs.readFileSync(filePath, 'utf-8')
        return JSON.parse(content) as ScriptFile
    }

    /**
     * Serialises and writes a script to disk, deriving the filename from `script.name`.
     * Always writes to the '.rscript' extension. If a same-name legacy '.rscript.json'
     * file exists it is deleted so the script does not appear twice in the list.
     *
     * @param script - The script to persist.
     * @returns The absolute path of the file that was written.
     */
    save(script: ScriptFile): string {
        ensureScriptsDir()
        const filePath = scriptPath(script.name)
        fs.writeFileSync(filePath, JSON.stringify(script, null, 2), 'utf-8')
        // Upgrade in place: remove a same-name legacy .rscript.json so the script does
        // not appear twice in the list. A missing legacy file (ENOENT) is the normal
        // case, so the unlink is best-effort.
        const legacy = path.join(scriptsDir(), `${safeFileStem(script.name)}${LEGACY_SCRIPT_EXT}`)
        try {
            fs.unlinkSync(legacy)
            // The unlink succeeded, so a legacy file existed. The sort order is keyed by
            // absolute path, so carry its position to the new path; otherwise the upgrade
            // would drop the script to the modified-time tail on the next list().
            const order = this.getSortOrder()
            const idx = order.indexOf(legacy)
            if (idx !== -1) {
                order[idx] = filePath
                this.saveSortOrder(order)
            }
        } catch { /* no legacy file (the normal case), or a best-effort cleanup failure */ }
        return filePath
    }

    /**
     * Deletes a single script file from disk.
     *
     * @param filePath - Absolute path to the '.rscript' (new) or legacy '.rscript.json' file to remove.
     * @throws If the file does not exist or cannot be deleted.
     */
    delete(filePath: string): void {
        fs.unlinkSync(filePath)
    }

    /**
     * Deletes all script files and the sort-order sidecar from disk.
     * Individual file errors are silently ignored so one corrupted file cannot
     * block removal of the rest.
     */
    deleteAll(): void {
        const dir = scriptsDir()
        try {
            const files = fs.readdirSync(dir).filter(filename => scriptExtOf(filename) !== null || filename === SORT_ORDER_FILE)
            for (const filename of files) {
                try { fs.unlinkSync(path.join(dir, filename)) } catch { /* skip */ }
            }
        } catch { /* dir may not exist */ }
    }
}
