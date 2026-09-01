/**
 * IPC handler for the terminal pane context menu.
 *
 * The renderer cannot create native context menus directly (sandbox restriction),
 * so it sends a 'context-menu:terminal' message with the current terminal state.
 * This handler builds the native Menu with context-appropriate enabled states
 * (copy requires a selection, clear/reconnect only when connected, etc.) and
 * fires back 'context-menu:action' events that the renderer acts on.
 */

import { BrowserWindow, ipcMain, Menu, type MenuItemConstructorOptions } from 'electron'
import { AI_EXPLAIN_ACTION, withBeta } from '../../../shared/ai/labels'

interface TerminalContextMenuOptions {
    tabId: string
    autoScroll: boolean
    wordWrap: boolean
    hasSelection: boolean
    /** True when the selection is a short term (1 to 3 words) worth a docs lookup. */
    lookupEligible: boolean
    /** True when an AI provider is configured. Gates the Ask roBot item. */
    aiAvailable: boolean
    isDisconnected: boolean
    isStreaming: boolean
}

/** Registers the terminal context menu IPC handler. */
export function registerContextMenuHandlers(): void {
    /**
     * Builds and displays a native context menu for the terminal pane.
     * Called by the renderer (which cannot create native menus in sandbox mode).
     * Menu item enabled states are derived from the current terminal state.
     * When an item is clicked, a 'context-menu:action' event is sent back to the renderer.
     *
     * @param options.tabId - Identifies the terminal tab the menu belongs to.
     * @param options.autoScroll - Whether auto-scroll is currently enabled (shown as checked).
     * @param options.wordWrap - Whether word-wrap is currently enabled (shown as checked).
     * @param options.hasSelection - If false, the Copy item is disabled.
     * @param options.lookupEligible - If false, the Look up in Docs item is disabled.
     * @param options.isDisconnected - If true, the Disconnect item is disabled.
     * @param options.isStreaming - Controls the label of the stream output toggle item.
     */
    ipcMain.on('context-menu:terminal', (event, options: TerminalContextMenuOptions) => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return

        const template: MenuItemConstructorOptions[] = [
            {
                label: 'Copy',
                accelerator: 'CmdOrCtrl+Shift+C',
                enabled: options.hasSelection,
                click: () => event.sender.send('context-menu:action', options.tabId, 'copy')
            },
            {
                label: 'Paste',
                accelerator: 'CmdOrCtrl+Shift+V',
                click: () => event.sender.send('context-menu:action', options.tabId, 'paste')
            },
            {
                label: 'Select All',
                accelerator: 'CmdOrCtrl+A',
                click: () => event.sender.send('context-menu:action', options.tabId, 'select-all')
            },
            { type: 'separator' },
            {
                label: 'Find...',
                accelerator: 'CmdOrCtrl+F',
                click: () => event.sender.send('context-menu:action', options.tabId, 'find')
            },
            {
                label: 'Filter Output...',
                accelerator: 'CmdOrCtrl+Shift+F',
                click: () => event.sender.send('context-menu:action', options.tabId, 'toggle-filter')
            },
            {
                label: 'Look up in Developer Docs',
                enabled: options.lookupEligible,
                click: () => event.sender.send('context-menu:action', options.tabId, 'lookup-docs')
            },
            ...(options.aiAvailable ? [{
                label: withBeta(AI_EXPLAIN_ACTION),
                enabled: options.hasSelection,
                click: () => event.sender.send('context-menu:action', options.tabId, 'explain')
            } as MenuItemConstructorOptions] : []),
            {
                label: 'Clear Terminal',
                click: () => event.sender.send('context-menu:action', options.tabId, 'clear')
            },
            { type: 'separator' },
            {
                label: 'Auto-scroll',
                type: 'checkbox',
                checked: options.autoScroll,
                click: () => event.sender.send('context-menu:action', options.tabId, 'toggle-autoscroll')
            },
            {
                label: 'Word Wrap',
                type: 'checkbox',
                checked: options.wordWrap,
                click: () => event.sender.send('context-menu:action', options.tabId, 'toggle-wordwrap')
            },
            { type: 'separator' },
            {
                label: 'Save Output...',
                click: () => event.sender.send('context-menu:action', options.tabId, 'save-output')
            },
            {
                label: options.isStreaming ? 'Stop Streaming Output' : 'Start Streaming Output...',
                click: () => event.sender.send('context-menu:action', options.tabId, options.isStreaming ? 'stop-stream-output' : 'start-stream-output')
            },
            { type: 'separator' },
            {
                label: 'Reconnect',
                click: () => event.sender.send('context-menu:action', options.tabId, 'reconnect')
            },
            {
                label: 'Disconnect',
                enabled: !options.isDisconnected,
                click: () => event.sender.send('context-menu:action', options.tabId, 'disconnect')
            }
        ]

        const menu = Menu.buildFromTemplate(template)
        menu.popup({ window: win })
    })
}
