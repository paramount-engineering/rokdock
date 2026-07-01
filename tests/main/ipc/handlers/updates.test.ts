import { describe, it, expect, vi } from 'vitest'

// Not packaged: the dev guard should short-circuit before any electron-updater call.
vi.mock('electron', () => ({
    app: { isPackaged: false, getVersion: () => '1.2.3' },
    ipcMain: { handle: vi.fn() },
}))
vi.mock('electron-updater', () => ({
    autoUpdater: {
        on: vi.fn(),
        once: vi.fn(),
        removeListener: vi.fn(),
        checkForUpdates: vi.fn(),
        downloadUpdate: vi.fn(),
        quitAndInstall: vi.fn(),
    },
}))

import { checkForUpdates } from '@main/ipc/handlers/updates'
import { autoUpdater } from 'electron-updater'
import type { IpcContext } from '@main/ipc/types'

describe('checkForUpdates', () => {
    const context = { sendToAllWindows: vi.fn() } as unknown as IpcContext

    it('reports up-to-date in a dev (unpacked) build without invoking the updater', async () => {
        const result = await checkForUpdates(context)
        expect(result.status).toBe('up-to-date')
        expect(result.version).toBe('1.2.3')
        expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
    })
})
