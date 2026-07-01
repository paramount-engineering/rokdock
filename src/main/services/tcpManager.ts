/**
 * TCP connection manager for raw socket connections to Roku devices.
 *
 * Manages persistent TCP connections used for Telnet-style debug sessions
 * (BrightScript debugger on port 8085, etc.). Each connection gets a unique
 * ID and emits 'data' and 'status' events consumed by the IPC terminal handlers.
 *
 * Note: Most terminal output routing now goes through TelnetSession (which uses
 * TcpManager internally). This class is the lower-level socket abstraction.
 */

import net from 'net'
import { EventEmitter } from 'events'

export interface TcpConnection {
    id: string
    deviceIp: string
    port: number
    status: 'connecting' | 'connected' | 'disconnected' | 'error'
    socket: net.Socket | null
}

/**
 * Low-level TCP connection manager.
 *
 * Extends `EventEmitter` and emits:
 * - `'data'` with `{ id, data: string }` when bytes arrive on a socket.
 * - `'status'` with `{ id, status, error? }` on connection lifecycle changes.
 */
export class TcpManager extends EventEmitter {
    private connections: Map<string, TcpConnection> = new Map()

    /**
     * Opens a TCP connection to the given host/port and registers it in the
     * internal connection map.
     *
     * The connection ID is returned immediately; actual connection events are
     * delivered asynchronously via the `'status'` emitter.
     *
     * @param deviceIp - Hostname or IPv4 address of the remote device.
     * @param port - TCP port to connect to.
     * @returns A unique connection ID of the form `"<ip>:<port>:<timestamp>"`.
     */
    connect(deviceIp: string, port: number): string {
        const id = `${deviceIp}:${port}:${Date.now()}`

        const socket = new net.Socket()
        const connection: TcpConnection = {
            id,
            deviceIp,
            port,
            status: 'connecting',
            socket
        }

        this.connections.set(id, connection)

        socket.setTimeout(10000)

        socket.connect(port, deviceIp, () => {
            connection.status = 'connected'
            socket.setTimeout(0) // Clear timeout once connected
            this.emit('status', { id, status: 'connected' })
        })

        socket.on('data', (data: Buffer) => {
            this.emit('data', { id, data: data.toString('utf-8') })
        })

        socket.on('error', (err: Error) => {
            connection.status = 'error'
            this.emit('status', { id, status: 'error', error: err.message })
            socket.destroy()
        })

        socket.on('close', () => {
            connection.status = 'disconnected'
            connection.socket = null
            this.emit('status', { id, status: 'disconnected' })
            this.connections.delete(id)
        })

        socket.on('timeout', () => {
            connection.status = 'error'
            this.emit('status', { id, status: 'error', error: 'Connection timed out' })
            socket.destroy()
        })

        this.emit('status', { id, status: 'connecting' })
        return id
    }

    /**
     * Destroys the socket for the given connection and emits a `'disconnected'` status.
     * Safe to call on a connection that is already closed.
     *
     * @param id - Connection ID returned by `connect`.
     */
    disconnect(id: string): void {
        const conn = this.connections.get(id)
        if (conn?.socket) {
            conn.socket.destroy()
            conn.socket = null
        }
        if (conn) {
            conn.status = 'disconnected'
        }
        this.emit('status', { id, status: 'disconnected' })
    }

    /**
     * Writes raw data to the socket identified by `id`.
     * Silently drops the write if the connection does not exist or is not connected.
     *
     * @param id - Connection ID.
     * @param data - String data to send.
     */
    sendInput(id: string, data: string): void {
        const conn = this.connections.get(id)
        if (conn?.socket && conn.status === 'connected') {
            conn.socket.write(data)
        }
    }

    /**
     * Disconnects and removes all tracked connections.
     * Typically called on app shutdown.
     */
    disconnectAll(): void {
        for (const [id] of this.connections) {
            this.disconnect(id)
        }
        this.connections.clear()
    }

    /**
     * Disconnects the socket and removes it from the connection map.
     *
     * @param id - Connection ID to remove.
     */
    removeConnection(id: string): void {
        this.disconnect(id)
        this.connections.delete(id)
    }
}
