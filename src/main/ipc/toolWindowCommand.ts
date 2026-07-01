import type { BrowserWindow } from 'electron'
import { TOOL_WINDOW_COMMAND_CHANNEL, type ToolWindowCommand } from '../../shared/toolWindowCommands'

/**
 * Sends a typed command to a tool window's renderer. Replaces the prior
 * executeJavaScript('window.X...') calls. Silently ignores a destroyed window
 * (it may be closing mid-action), matching the old execInWindow guards.
 */
export function sendToolWindowCommand(win: BrowserWindow, command: ToolWindowCommand): void {
    if (!win.isDestroyed()) win.webContents.send(TOOL_WINDOW_COMMAND_CHANNEL, command)
}
