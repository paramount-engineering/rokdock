/**
 * IPC handlers for Telnet terminal session lifecycle.
 *
 * Bridges the renderer's terminal tab system with the TelnetSessionService.
 * The renderer creates sessions (one per device+port combination), receives
 * tokenized line chunks via 'terminal:data' events, and can write command
 * strings, kill, and reconnect sessions.
 *
 * Each session ID is unique even across reconnects, so the renderer can
 * distinguish stale events from a closed session vs. new events on a fresh one.
 */

import { ipcMain } from 'electron'
import { isNonEmptyString, isValidPort } from '../../utils/validation'
import type { IpcContext } from '../types'
import type { TerminalLineChunk } from '../../../shared/terminal'

/**
 * Registers all Telnet terminal session IPC handlers and wires up session event forwarding.
 *
 * @param context - Destructured to extract the TelnetSessionService and sendToAllWindows helper.
 */
export function registerTerminalHandlers({ terminalManager, sendToAllWindows }: IpcContext): void {
    /**
     * Creates a new Telnet session for the specified device and port.
     * Returns a unique session ID that the renderer uses to correlate future events and commands.
     * @param deviceIp - The IP address of the Roku device.
     * @param deviceName - Display name for the device (shown in the tab title).
     * @param port - The Telnet port to connect to (e.g. 8085 for BrightScript debugger).
     * @returns The new session ID string.
     * @throws {Error} If any argument is invalid.
     */
    ipcMain.handle('terminal:create-session', (_event, deviceIp: string, deviceName: string, port: number) => {
        if (!isNonEmptyString(deviceIp) || !isNonEmptyString(deviceName) || !isValidPort(port)) {
            throw new Error('Invalid terminal session arguments.')
        }
        return terminalManager.createSession(deviceIp.trim(), deviceName.trim(), port)
    })

    /**
     * Writes command input to an active terminal session.
     * Fire-and-forget (uses ipcMain.on, not handle). Silently ignores invalid args.
     * @param id - The session ID to write to.
     * @param data - The command string to send to the Telnet session.
     */
    ipcMain.on('terminal:write', (_event, id: string, data: string) => {
        if (!isNonEmptyString(id) || typeof data !== 'string') return
        terminalManager.write(id, data)
    })

    /**
     * Kills an active terminal session, closing its TCP connection.
     * Silently ignores invalid IDs.
     * @param id - The session ID to kill.
     */
    ipcMain.handle('terminal:kill', (_event, id: string) => {
        if (!isNonEmptyString(id)) return
        terminalManager.kill(id)
    })

    /**
     * Reconnects a previously killed or disconnected terminal session.
     * Optional override parameters allow changing the connection target on reconnect.
     * @param id - The original session ID (used to identify the session slot to reconnect).
     * @param deviceIp - Optional new IP address; uses the session's previous IP if omitted.
     * @param deviceName - Optional new display name; uses the session's previous name if omitted.
     * @param port - Optional new port; uses the session's previous port if omitted.
     */
    ipcMain.handle('terminal:reconnect', (_event, id: string, deviceIp?: string, deviceName?: string, port?: number) => {
        if (!isNonEmptyString(id)) return
        const safeIp = isNonEmptyString(deviceIp) ? deviceIp.trim() : undefined
        const safeName = isNonEmptyString(deviceName) ? deviceName.trim() : undefined
        const safePort = typeof port === 'number' && Number.isInteger(port) ? port : undefined
        terminalManager.reconnect(id, safeIp, safeName, safePort)
    })

    /**
     * Forwards tokenized terminal output chunks from the session manager to all renderer windows.
     * Emitted as 'terminal:data' with the session ID and line chunk.
     */
    terminalManager.on('data', ({ id, chunk }: { id: string; chunk: TerminalLineChunk }) => {
        sendToAllWindows('terminal:data', id, chunk)
    })

    /**
     * Forwards terminal session exit events to all renderer windows.
     * Emitted as 'terminal:exit' with the session ID and numeric exit code.
     */
    terminalManager.on('exit', ({ id, exitCode }: { id: string; exitCode: number }) => {
        sendToAllWindows('terminal:exit', id, exitCode)
    })

    /**
     * Forwards terminal connection status changes to all renderer windows.
     * Emitted as 'terminal:status' with the session ID, status string, and optional error message.
     */
    terminalManager.on('status', ({ id, status, error }: { id: string; status: string; error?: string }) => {
        sendToAllWindows('terminal:status', id, status, error)
    })
}
