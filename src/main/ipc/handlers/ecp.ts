/**
 * IPC handlers for ECP (External Control Protocol) remote control operations.
 *
 * Exposes keypress, keydown, keyup, text entry, deep link launch, and input
 * sending to the renderer. All arguments are validated before forwarding to
 * the EcpService to prevent malformed requests from reaching the device.
 */

import { ipcMain } from 'electron'
import { isNonEmptyString } from '../../utils/validation'
import type { IpcContext } from '../types'

/**
 * Validates and trims a string argument; throws a descriptive error if the value is not a non-empty string.
 * @param value - The argument value to validate.
 * @param name - The parameter name used in the error message.
 * @returns The trimmed string value.
 * @throws {Error} If value is not a non-empty string.
 */
function assertStringArg(value: unknown, name: string): string {
    if (!isNonEmptyString(value)) {
        throw new Error(`Invalid ECP argument: ${name}.`)
    }
    return value.trim()
}

/**
 * Registers all ECP remote control IPC handlers.
 *
 * @param context - Destructured to extract the EcpService instance.
 */
export function registerEcpHandlers({ ecp }: IpcContext): void {
    /**
     * Sends an ECP keypress (down + up) event to the device.
     * @param ip - The IP address of the target Roku device.
     * @param key - The ECP key name (e.g. "Home", "Select", "VolumeUp").
     */
    ipcMain.handle('ecp:keypress', async (_event, ip: string, key: string) => {
        await ecp.keypress(assertStringArg(ip, 'ip'), assertStringArg(key, 'key'))
    })

    /**
     * Sends an ECP keydown event to the device (key held down).
     * @param ip - The IP address of the target Roku device.
     * @param key - The ECP key name.
     */
    ipcMain.handle('ecp:keydown', async (_event, ip: string, key: string) => {
        await ecp.keydown(assertStringArg(ip, 'ip'), assertStringArg(key, 'key'))
    })

    /**
     * Sends an ECP keyup event to the device (key released).
     * @param ip - The IP address of the target Roku device.
     * @param key - The ECP key name.
     */
    ipcMain.handle('ecp:keyup', async (_event, ip: string, key: string) => {
        await ecp.keyup(assertStringArg(ip, 'ip'), assertStringArg(key, 'key'))
    })

    /**
     * Sends a text string to the device via ECP (each character is sent as a Lit_ keypress).
     * @param ip - The IP address of the target Roku device.
     * @param text - The text string to type on the device.
     */
    ipcMain.handle('ecp:send-text', async (_event, ip: string, text: string) => {
        await ecp.sendText(assertStringArg(ip, 'ip'), typeof text === 'string' ? text : '')
    })

    /**
     * Launches an app on the device via ECP /launch with optional deep link parameters.
     * @param ip - The IP address of the target Roku device.
     * @param appId - The Roku channel/app ID to launch.
     * @param params - Key/value query parameters appended to the launch URL.
     */
    ipcMain.handle('ecp:launch-deeplink', async (_event, ip: string, appId: string, params: Record<string, string>) => {
        await ecp.launchDeeplink(assertStringArg(ip, 'ip'), assertStringArg(appId, 'appId'), params ?? {})
    })

    /**
     * Sends an ECP /input command to the currently running app on the device.
     * Used for runtime parameter injection into running channels.
     * @param ip - The IP address of the target Roku device.
     * @param params - Key/value parameters to send as query string to /input.
     */
    ipcMain.handle('ecp:send-input', async (_event, ip: string, params: Record<string, string>) => {
        await ecp.sendInput(assertStringArg(ip, 'ip'), params ?? {})
    })
}
