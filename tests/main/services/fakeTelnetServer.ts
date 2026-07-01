/**
 * In-process fake Roku debug-port TCP server for integration tests.
 *
 * Listens on 127.0.0.1 on an OS-assigned port (listen(0)) so there is
 * no risk of a fixed-port collision. Tests call start() to get the
 * chosen port, push scripted data via send(), and drop the client
 * connection via disconnect(). call stop() in afterEach to close the
 * server and all outstanding sockets.
 *
 * Usage pattern in a test:
 *
 *   const server = new FakeTelnetServer()
 *   const port = await server.start()
 *   await server.send(Buffer.from('hello\r\n'))
 *   await server.disconnect()
 *   await server.stop()
 */

import net from 'net'

export class FakeTelnetServer {
    private server: net.Server
    private clientSocket: net.Socket | null = null
    private _port = 0

    constructor() {
        this.server = net.createServer((socket) => {
            this.clientSocket = socket
            // Absorb any inbound bytes (negotiation responses) so the socket
            // stays open and does not back-pressure the client.
            socket.on('data', () => undefined)
            socket.on('error', () => undefined)
        })
    }

    /** Starts the server and returns the OS-assigned port. */
    start(): Promise<number> {
        return new Promise((resolve, reject) => {
            this.server.listen(0, '127.0.0.1', () => {
                const addr = this.server.address()
                if (!addr || typeof addr === 'string') {
                    reject(new Error('Unexpected server address format'))
                    return
                }
                this._port = addr.port
                resolve(this._port)
            })
            this.server.on('error', reject)
        })
    }

    /** The port chosen by the OS after start(). */
    get port(): number {
        return this._port
    }

    /**
     * Sends a buffer to the connected client.
     * Waits until a client has connected before writing.
     */
    send(data: Buffer, timeoutMs = 2000): Promise<void> {
        return new Promise((resolve, reject) => {
            const deadline = Date.now() + timeoutMs
            const tryWrite = () => {
                if (this.clientSocket && !this.clientSocket.destroyed) {
                    this.clientSocket.write(data, (err) => {
                        if (err) reject(err)
                        else resolve()
                    })
                    return
                }
                if (Date.now() >= deadline) {
                    reject(new Error('Timed out waiting for a client to connect before send()'))
                    return
                }
                setTimeout(tryWrite, 10)
            }
            tryWrite()
        })
    }

    /**
     * Drops the server-side end of the connection (sends FIN).
     * The client service will see a 'close' event on its socket.
     */
    disconnect(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.clientSocket || this.clientSocket.destroyed) {
                resolve()
                return
            }
            this.clientSocket.end(() => resolve())
        })
    }

    /** Closes the server and destroys any remaining client socket. */
    stop(): Promise<void> {
        return new Promise((resolve) => {
            if (this.clientSocket && !this.clientSocket.destroyed) {
                this.clientSocket.destroy()
                this.clientSocket = null
            }
            this.server.close(() => resolve())
        })
    }
}
