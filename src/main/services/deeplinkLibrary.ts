/**
 * Persistent storage for saved deep link configurations.
 *
 * Deep links are ECP launch/input commands with named parameters that let
 * developers quickly test channel deep linking. Saved configs are stored as a
 * flat JSON array in <userData>/deeplinks.json.
 *
 * Unlike the ScriptLibrary (which has one file per script), all deep links live
 * in a single file since there are typically only a handful of entries.
 */

import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import type { DeeplinkConfig } from '../../shared/types'

const DEEPLINKS_FILE = 'deeplinks.json'

/**
 * Returns the absolute path to the deeplinks JSON file in Electron's userData folder.
 */
function deeplinksPath(): string {
    return path.join(app.getPath('userData'), DEEPLINKS_FILE)
}

/**
 * File-backed store for saved deep-link configurations.
 * All entries are kept in a single flat JSON array at `<userData>/deeplinks.json`.
 */
export class DeeplinkLibrary {
    /**
     * Returns `true` if the deeplinks file exists on disk.
     * Used to distinguish "no file yet" (first launch) from "empty list".
     */
    exists(): boolean {
        return fs.existsSync(deeplinksPath())
    }

    /**
     * Reads and parses all saved deep-link configurations.
     *
     * @returns The stored array of `DeeplinkConfig` objects, or an empty array
     *   if the file does not exist or cannot be parsed.
     */
    list(): DeeplinkConfig[] {
        try {
            const raw = JSON.parse(fs.readFileSync(deeplinksPath(), 'utf-8'))
            return Array.isArray(raw) ? raw : []
        } catch { return [] }
    }

    /**
     * Overwrites the deeplinks file with the provided array.
     *
     * @param deeplinks - Full list of deep-link configurations to persist.
     */
    saveAll(deeplinks: DeeplinkConfig[]): void {
        fs.writeFileSync(deeplinksPath(), JSON.stringify(deeplinks, null, 2), 'utf-8')
    }
}
