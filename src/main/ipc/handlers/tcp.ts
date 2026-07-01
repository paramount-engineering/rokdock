/**
 * IPC handlers for raw TCP connections.
 *
 * Provides lower-level TCP socket access used for streaming connections that don't
 * go through the Telnet session service. Data and status events are broadcast to
 * all windows so multiple renderer panels can observe the same connection.
 *
 * Note: Most Roku debug terminal use goes through the terminal handlers (TelnetSessionService)
 * which includes tokenization. These TCP handlers provide the raw binary pipe.
 */

import { ipcMain } from 'electron'
import { isNonEmptyString, isValidPort } from '../../utils/validation'
import type { IpcContext } from '../types'

/**
 * Registers all raw TCP connection IPC handlers and wires up TCP service event forwarding.
 *
 * @param context - Destructured to extract the TcpManager and sendToAllWindows helper.
 */
export function registerTcpHandlers({ tcp, sendToAllWindows }: IpcContext): void {
    /**
     * Opens a raw TCP connection to the specified device and port.
     * @param deviceIp - The device IP address to connect to.
     * @param port - The TCP port number (validated to be in the 1-65535 range).
     * @returns { ok: true, id } with the connection ID on success; { ok: false, error } on invalid args.
     */
    ipcMain.handle('tcp:connect', (_event, deviceIp: string, port: number) => {
        if (!isNonEmptyString(deviceIp) || !isValidPort(port)) {
            return { ok: false, error: 'Invalid TCP connect arguments.' }
        }
        return tcp.connect(deviceIp.trim(), port)
    })

    /**
     * Disconnects and removes a TCP connection by its ID.
     * Silently ignores empty or invalid IDs.
     * @param id - The connection ID returned by tcp:connect.
     */
    ipcMain.handle('tcp:disconnect', (_event, id: string) => {
        if (!isNonEmptyString(id)) return
        tcp.removeConnection(id)
    })

    /**
     * Sends input data to an open TCP connection.
     * Fire-and-forget (uses ipcMain.on, not handle). Silently ignores invalid args.
     * @param id - The connection ID.
     * @param data - The string data to write to the socket.
     */
    ipcMain.on('tcp:input', (_event, id: string, data: string) => {
        if (!isNonEmptyString(id) || typeof data !== 'string') return
        tcp.sendInput(id, data)
    })

    /**
     * Forwards incoming TCP data from TcpManager to all renderer windows.
     * Emitted as 'tcp:data' with the connection ID and the received string.
     */
    tcp.on('data', ({ id, data }: { id: string; data: string }) => {
        sendToAllWindows('tcp:data', id, data)
    })

    /**
     * Forwards TCP connection status changes from TcpManager to all renderer windows.
     * Emitted as 'tcp:status' with the connection ID, status string, and optional error message.
     */
    tcp.on('status', ({ id, status, error }: { id: string; status: string; error?: string }) => {
        sendToAllWindows('tcp:status', id, status, error)
    })
}
