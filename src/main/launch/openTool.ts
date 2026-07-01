/**
 * Dispatches a parsed CLI launch request to the matching tool's standalone
 * opener. Each opener reads the file (if any) in main and delivers it to the
 * tool window. Used for both the first-instance launch and forwarded
 * second-instance argv.
 */
import type { IpcContext } from '../ipc/types'
import type { LaunchRequest } from './launchRequest'
import { openJsonEditorStandalone } from '../ipc/handlers/jsonEditor'
import { openNinepatchStandalone } from '../ipc/handlers/ninepatchEditor'
import { openSvgConverterStandalone } from '../ipc/handlers/svgExporter'
import { openScriptEditorStandalone } from '../ipc/handlers/scriptEditor'
import { openDocsStandalone } from '../ipc/handlers/docs'

export async function openToolForLaunch(context: IpcContext, req: LaunchRequest): Promise<void> {
    switch (req.tool) {
        case 'json': await openJsonEditorStandalone(context, req.filePath); break
        case 'svg': await openSvgConverterStandalone(context, req.filePath); break
        case 'ninepatch': await openNinepatchStandalone(context, req.filePath); break
        case 'script': await openScriptEditorStandalone(context, req.filePath); break
        case 'docs': await openDocsStandalone(context, req.filePath); break
        default: req.tool satisfies never
    }
}
