/**
 * App update checking via electron-updater (GitHub Releases provider, configured by
 * electron-builder's publish field). Exposes a manual check and a user-initiated
 * download-and-install, plus download-progress pushes.
 *
 * electron-updater only works in a packaged build: it reads app-update.yml, which is
 * generated at package time from the publish config, and is absent in dev. So every
 * entry point short-circuits when the app is not packaged, which keeps dev runs and
 * the E2E suite from invoking the updater (which would error without a feed).
 */
import { app, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateInfo } from 'electron-updater'
import type { IpcContext } from '../types'
import type { UpdateCheckResult } from '../../../shared/updates'
import type { IpcResult } from '../../../shared/types'
import { logError } from '../../utils/errorReporting'

let configured = false
function configure(context: IpcContext): void {
    if (configured) return
    configured = true
    // The user drives the download from the dialog, so do not auto-download, and keep
    // install-on-quit as a fallback. A download only ever starts from updates:download
    // (autoDownload is off), so installing as soon as it completes is safe, and wiring
    // it here (once) avoids stacking a listener per download attempt.
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('download-progress', progress =>
        context.sendToAllWindows('updates:download-progress', Math.round(progress.percent))
    )
    autoUpdater.on('update-downloaded', () => autoUpdater.quitAndInstall())
}

const releaseNotesText = (notes: UpdateInfo['releaseNotes']): string | undefined =>
    typeof notes === 'string' ? notes : undefined

/**
 * Checks GitHub Releases for a newer version. Resolves on the first of
 * update-available / update-not-available / error. Dev builds report up-to-date
 * without invoking the updater (there is no feed without a packaged app-update.yml).
 */
export function checkForUpdates(context: IpcContext): Promise<UpdateCheckResult> {
    if (!app.isPackaged) {
        return Promise.resolve({
            status: 'up-to-date',
            version: app.getVersion(),
            notes: 'Update checks run only in packaged builds.',
        })
    }
    configure(context)
    return new Promise<UpdateCheckResult>(resolve => {
        const finish = (result: UpdateCheckResult): void => {
            autoUpdater.removeListener('update-available', onAvailable)
            autoUpdater.removeListener('update-not-available', onNotAvailable)
            autoUpdater.removeListener('error', onError)
            resolve(result)
        }
        const onAvailable = (info: UpdateInfo): void =>
            finish({
                status: 'available',
                version: info.version,
                notes: releaseNotesText(info.releaseNotes),
            })
        const onNotAvailable = (): void => finish({ status: 'up-to-date', version: app.getVersion() })
        // The dialog shows a friendly message; keep the raw HTTP-layer error in the log for support.
        const onError = (err: Error): void => { logError('updates:check', err); finish({ status: 'error', error: err.message }) }

        autoUpdater.once('update-available', onAvailable)
        autoUpdater.once('update-not-available', onNotAvailable)
        autoUpdater.once('error', onError)
        // The events above resolve the common cases. Also settle on the promise itself,
        // so a rejection that never emits 'error', or a null resolution that never emits
        // 'update-not-available', cannot leave the dialog stuck on Checking forever.
        // finish() is idempotent (resolve is a no-op after the first call).
        autoUpdater.checkForUpdates()
            .then(result => { if (!result) finish({ status: 'up-to-date', version: app.getVersion() }) })
            .catch((err: unknown) => { logError('updates:check', err); finish({ status: 'error', error: err instanceof Error ? err.message : String(err) }) })
    })
}

export function registerUpdatesHandlers(context: IpcContext): void {
    ipcMain.handle('updates:check', (): Promise<UpdateCheckResult> => checkForUpdates(context))

    ipcMain.handle('updates:download', async (): Promise<IpcResult> => {
        if (!app.isPackaged) return { ok: false, error: 'Update install runs only in packaged builds.' }
        try {
            // configure() wires the one update-downloaded -> quitAndInstall listener.
            configure(context)
            await autoUpdater.downloadUpdate()
            return { ok: true }
        } catch (err) {
            logError('updates:download', err)
            return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
    })
}
