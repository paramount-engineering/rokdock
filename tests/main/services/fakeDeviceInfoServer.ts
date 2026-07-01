/**
 * Fake HTTP server for integration testing of the SSDP device-info fetch pipeline.
 *
 * Serves realistic Roku ECP responses on 127.0.0.1 using an OS-assigned ephemeral
 * port (listen(0)), so tests never collide with real services or each other.
 *
 * Supported variants allow tests to exercise error paths without touching the network:
 *  - default: a valid device-info XML response followed by a valid active-app response
 *  - malformedDeviceInfo: returns garbled XML at /query/device-info
 *  - notFound: returns HTTP 404 for every request
 *  - refused: closes every socket immediately to simulate ECONNREFUSED
 *
 * COVERAGE NOTE: SSDP multicast discovery (UDP M-SEARCH + multicast reply) is NOT
 * covered here because it requires a real network interface and cannot be exercised
 * reliably in-process. Those flows need real-device or manual verification.
 */

import http from 'http'
import type { AddressInfo } from 'net'

/** Controls which response the fake server sends. */
export type FakeServerVariant = 'default' | 'malformedDeviceInfo' | 'notFound' | 'refused'

/** Fields a test can override on the default device-info response. */
export interface FakeDeviceOptions {
    udn?: string
    serialNumber?: string
    modelName?: string
    modelNumber?: string
    userDeviceName?: string
    friendlyDeviceName?: string
    softwareVersion?: string
    developerEnabled?: boolean
}

const DEFAULT_DEVICE: Required<FakeDeviceOptions> = {
    udn: 'rid:TESTDEVICE001',
    serialNumber: 'X00000000001',
    modelName: 'Roku Express',
    modelNumber: '3900X',
    userDeviceName: 'Test Living Room Roku',
    friendlyDeviceName: 'Test Friendly Roku',
    softwareVersion: '12.0.0',
    developerEnabled: false
}

function buildDeviceInfoXml(opts: Required<FakeDeviceOptions>): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<device-info>
  <udn>${opts.udn}</udn>
  <serial-number>${opts.serialNumber}</serial-number>
  <model-name>${opts.modelName}</model-name>
  <model-number>${opts.modelNumber}</model-number>
  <user-device-name>${opts.userDeviceName}</user-device-name>
  <friendly-device-name>${opts.friendlyDeviceName}</friendly-device-name>
  <software-version>${opts.softwareVersion}</software-version>
  <developer-enabled>${opts.developerEnabled}</developer-enabled>
</device-info>`
}

const ACTIVE_APP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<active-app>
  <app id="tvinput.hdmi1">HDMI 1</app>
</active-app>`

const MALFORMED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<device-info>
  <unclosed-tag>
  this is not valid xml`

export class FakeDeviceInfoServer {
    private server: http.Server | null = null
    private variant: FakeServerVariant
    private deviceOptions: Required<FakeDeviceOptions>

    constructor(variant: FakeServerVariant = 'default', deviceOptions: FakeDeviceOptions = {}) {
        this.variant = variant
        this.deviceOptions = { ...DEFAULT_DEVICE, ...deviceOptions }
    }

    /**
     * Starts the fake server. Resolves with the ephemeral port it is listening on.
     * Always binds to 127.0.0.1 to avoid firewall prompts and stay loopback-only.
     */
    start(): Promise<number> {
        return new Promise((resolve, reject) => {
            if (this.variant === 'refused') {
                // For the refused variant, we bind a real port and then immediately
                // close every incoming connection before the server processes the request,
                // simulating a port that refuses connections.
                this.server = http.createServer()
                this.server.on('connection', (socket) => {
                    socket.destroy()
                })
                this.server.listen(0, '127.0.0.1', () => {
                    const port = (this.server!.address() as AddressInfo).port
                    resolve(port)
                })
                this.server.on('error', reject)
                return
            }

            this.server = http.createServer((req, res) => {
                if (this.variant === 'notFound') {
                    res.writeHead(404, { 'Content-Type': 'text/plain' })
                    res.end('Not Found')
                    return
                }

                if (req.url === '/query/device-info') {
                    if (this.variant === 'malformedDeviceInfo') {
                        res.writeHead(200, { 'Content-Type': 'text/xml' })
                        res.end(MALFORMED_XML)
                        return
                    }
                    const xml = buildDeviceInfoXml(this.deviceOptions)
                    res.writeHead(200, { 'Content-Type': 'text/xml' })
                    res.end(xml)
                    return
                }

                if (req.url === '/query/active-app') {
                    res.writeHead(200, { 'Content-Type': 'text/xml' })
                    res.end(ACTIVE_APP_XML)
                    return
                }

                res.writeHead(404)
                res.end()
            })

            this.server.listen(0, '127.0.0.1', () => {
                const port = (this.server!.address() as AddressInfo).port
                resolve(port)
            })

            this.server.on('error', reject)
        })
    }

    /** Returns the port the server is listening on, or null if not started. */
    get port(): number | null {
        if (!this.server) return null
        const addr = this.server.address() as AddressInfo | null
        return addr?.port ?? null
    }

    /** Stops the fake server and closes all open connections. */
    stop(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.server) {
                resolve()
                return
            }
            this.server.closeAllConnections?.()
            this.server.close(() => {
                this.server = null
                resolve()
            })
        })
    }
}
