/**
 * Pure resolver: given the current store slice and a cache reader, produce the focused terminal
 * tab's payload for roBot's terminal-output tools. Kept free of React and IPC so it is unit-testable
 * and can run from an always-mounted responder regardless of whether any terminal view is mounted.
 */
import type { TerminalLineChunk, FocusedTerminalPayload } from '../shared/terminal'
import type { PaneId, PaneState, TabInfo } from './store/appStore'

interface FocusedTerminalState {
    focusedPaneId: PaneId
    paneA: PaneState
    paneB: PaneState | null
    tabs: TabInfo[]
}

export function resolveFocusedTerminalPayload(
    state: FocusedTerminalState,
    readCache: (tabId: string) => TerminalLineChunk[] | undefined,
): FocusedTerminalPayload | null {
    const pane = state.focusedPaneId === 'a' ? state.paneA : state.paneB
    const tabId = pane?.activeTabId
    if (!tabId) return null
    const tab = state.tabs.find(entry => entry.id === tabId)
    if (!tab) return null
    const chunks = readCache(tabId) ?? []
    return { label: tab.deviceName || tab.deviceIp, lines: chunks.map(chunk => chunk.text) }
}
