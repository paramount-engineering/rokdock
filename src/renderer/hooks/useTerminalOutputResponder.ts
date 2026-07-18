/**
 * Registers the terminal-output responder for roBot's tools. Mounted once from the App root
 * (outside the terminal panel), so it answers even when the terminal panel is collapsed and
 * unmounted. Resolves the focused tab from the store and reads its write-through cache.
 */
import { useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import { readTerminalCache } from '../components/customTerminalView'
import { resolveFocusedTerminalPayload } from '../terminalOutputResolver'

export function useTerminalOutputResponder(): void {
    useEffect(() => {
        return window.rokdock.terminalOutput.onRequest((requestId: string) => {
            const payload = resolveFocusedTerminalPayload(useAppStore.getState(), readTerminalCache)
            window.rokdock.terminalOutput.respond(requestId, payload)
        })
    }, [])
}
