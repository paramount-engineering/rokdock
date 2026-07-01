/**
 * IPC handlers for deep link configuration management.
 *
 * Deep links are ECP launch/input commands saved for quick reuse from the
 * Deeplinks panel. Stored in <userData>/deeplinks.json via DeeplinkLibrary.
 *
 * On first load, if no deeplinks.json exists, migrates legacy entries from the
 * main settings store so users don't lose configs after the storage move.
 */

import { ipcMain } from 'electron'
import { DeeplinkLibrary } from '../../services/deeplinkLibrary'
import { isValidDeeplinkConfig } from '../../utils/validation'
import type { DeeplinkConfig } from '../../../shared/types'
import type { IpcContext } from '../types'

const library = new DeeplinkLibrary()

/**
 * Registers IPC handlers for deep link library management.
 *
 * @param context - Shared IPC context providing store access for legacy migration.
 */
export function registerDeeplinkHandlers(context: IpcContext): void {
    /**
     * Returns all saved deep link configurations.
     * On first call, if deeplinks.json does not yet exist, migrates legacy entries
     * from the main settings store so users retain their configurations after the
     * storage migration.
     * @returns {DeeplinkConfig[]} Array of deep link config objects (may be empty).
     */
    ipcMain.handle('deeplink:list', () => {
        if (!library.exists()) {
            const settings = context.store.getSettings()
            if (settings.deeplinks && settings.deeplinks.length > 0) {
                library.saveAll(settings.deeplinks)
                return settings.deeplinks
            }
            return []
        }
        return library.list()
    })

    /**
     * Replaces the entire deep link library with the provided array.
     * Silently ignores the call if the argument is not an array or if any entry
     * fails the DeeplinkConfig validation check.
     * @param deeplinks - Array of DeeplinkConfig objects to persist.
     */
    ipcMain.handle('deeplink:save-all', (_event, deeplinks: unknown) => {
        if (!Array.isArray(deeplinks)) return
        const items = deeplinks as unknown[]
        if (!items.every(isValidDeeplinkConfig)) return
        library.saveAll(items as DeeplinkConfig[])
    })
}
