import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcContext } from '@main/ipc/types'
import type { LaunchRequest } from '@main/launch/launchRequest'

// Mock the four handler modules so the dispatch is tested in isolation, without
// pulling in electron (which the real handler modules import at load time).
const openJson = vi.fn()
const openSvg = vi.fn()
const openNinepatch = vi.fn()
const openScript = vi.fn()
vi.mock('@main/ipc/handlers/jsonEditor', () => ({ openJsonEditorStandalone: (...args: unknown[]) => openJson(...args) }))
vi.mock('@main/ipc/handlers/svgExporter', () => ({ openSvgConverterStandalone: (...args: unknown[]) => openSvg(...args) }))
vi.mock('@main/ipc/handlers/ninepatchEditor', () => ({ openNinepatchStandalone: (...args: unknown[]) => openNinepatch(...args) }))
vi.mock('@main/ipc/handlers/scriptEditor', () => ({ openScriptEditorStandalone: (...args: unknown[]) => openScript(...args) }))

import { openToolForLaunch } from '@main/launch/openTool'

describe('openToolForLaunch', () => {
    // A stand-in context: the dispatch only forwards it, never inspects it.
    const context = {} as IpcContext

    beforeEach(() => {
        openJson.mockReset()
        openSvg.mockReset()
        openNinepatch.mockReset()
        openScript.mockReset()
    })

    const cases: Array<[LaunchRequest['tool'], typeof openJson]> = [
        ['json', openJson],
        ['svg', openSvg],
        ['ninepatch', openNinepatch],
        ['script', openScript],
    ]

    for (const [tool, opener] of cases) {
        it(`dispatches ${tool} to its standalone opener with the file path`, async () => {
            await openToolForLaunch(context, { tool, filePath: '/abs/file' })
            expect(opener).toHaveBeenCalledWith(context, '/abs/file')
            // No other opener should fire.
            for (const [otherTool, other] of cases) {
                if (otherTool !== tool) expect(other).not.toHaveBeenCalled()
            }
        })
    }

    it('forwards an absent file path as undefined', async () => {
        await openToolForLaunch(context, { tool: 'json' })
        expect(openJson).toHaveBeenCalledWith(context, undefined)
    })
})
