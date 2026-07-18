/**
 * Shared context object passed to every IPC handler registrar.
 *
 * IpcContext provides the handler functions with access to all main-process
 * services (SSDP, ECP, TCP, store, terminal) plus convenience helpers for
 * cross-window broadcasting and window focus management.
 *
 * Using a single context object instead of passing services individually makes
 * it easy to add new handlers without changing every registration call signature.
 */

import type { BrowserWindow } from 'electron'
import type { SsdpService } from '../services/ssdp'
import type { TcpManager } from '../services/tcpManager'
import type { EcpService } from '../services/ecp'
import type { StoreService } from '../services/store'
import type { TelnetSessionService } from '../services/telnetSession'
import type { AiService } from '../services/ai/aiService'
import type { DocsService } from '../services/docsService'
import type { McpToolEndpoint } from '../services/ai/mcpToolEndpoint'
import type { IpcResult } from '../../shared/types'

export interface IpcContext {
    /** SSDP discovery service; used to get devices, trigger scans, and manage manual devices. */
    ssdp: SsdpService
    /** Raw TCP connection manager for streaming connections. */
    tcp: TcpManager
    /** ECP remote control service for keypresses, text entry, and deep links. */
    ecp: EcpService
    /** Persistent settings and preferences store. */
    store: StoreService
    /** Telnet session service backing the terminal tab panel. */
    terminalManager: TelnetSessionService
    /** Roku developer docs service (shared by the docs viewer and the AI docs provider). */
    docs: DocsService
    /** AI engine service: profiles, streaming, test connection, redaction preview. */
    ai: AiService
    /** MCP tool endpoint: loopback HTTP server that bridges tool calls from the CLI to providers. */
    mcpEndpoint: McpToolEndpoint
    /**
     * Record the IP of the device the user currently has selected (the remote target), or null.
     * The renderer pushes it on change. The AI device-control tools read it as their default
     * target, so most actions need no explicit device argument.
     */
    setActiveDeviceIp: (ip: string | null) => void
    /**
     * Broadcasts a message to all open BrowserWindows (main + any tool windows).
     * @param channel - The IPC channel name.
     * @param args - Arguments to include in the message.
     */
    sendToAllWindows: (channel: string, ...args: unknown[]) => void
    /**
     * Returns the focused BrowserWindow, or the first open window if none is focused.
     * Used to attach dialogs to the appropriate window.
     * @returns The focused or first BrowserWindow, or undefined if no windows are open.
     */
    getFocusedOrFirstWindow: () => BrowserWindow | undefined
}

export type { IpcResult }
