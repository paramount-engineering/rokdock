/**
 * Roku device screenshot and sideload utilities.
 *
 * Implements the multipart/form-data POST flow used by Roku's web-based developer
 * interface. Both screenshot capture (/plugin_inspect) and app sideload (/plugin_install)
 * use HTTP Digest authentication followed by a multipart body - this module handles both.
 *
 * Key functions:
 *  - captureRokuScreenshot(): two-step Digest auth + POST to /plugin_inspect, then
 *    a second authenticated GET to download the screenshot image. The result includes
 *    file path, MIME type, and debug curl commands for manual reproduction.
 *  - pluginInstall(): same Digest auth flow to /plugin_install with a .zip file body.
 *    Progress callbacks track upload completion in 64 KB chunks.
 *  - parsePluginInspectMessage(): parses the JSON or legacy HTML response from all
 *    /plugin_* endpoints to extract the human-readable status message.
 */

import fs from 'fs'
import http from 'http'
import path from 'path'
import { randomBytes } from 'crypto'
import { JPEG_SIGNATURE, PNG_SIGNATURE, QUERY_ACTIVE_APP_TIMEOUT_MS } from '../constants/preview'
import { buildDigestAuthHeader, buildMultipartField } from './digestAuth'
import type { RokuDeviceCredentials } from './digestAuth'
import { ECP_PORT } from '../../shared/ports'

export interface ScreenshotCaptureResult {
    filePath: string
    extension: 'png' | 'jpg'
    mimeType: string
    inspectUrl: string
    imageUrl: string
    curlInspect: string
    curlImage: string
}

/**
 * Extracts the human-readable status message from a /plugin_inspect or /plugin_install
 * HTML response. Newer Roku firmware embeds a JSON payload via JSON.parse(); older
 * firmware uses a <font color="red"> element. Returns undefined if neither pattern matches.
 *
 * @param html - Raw HTML body returned by the Roku plugin endpoint.
 * @returns Status message string, or undefined if no message was found.
 */
export function parsePluginInspectMessage(html: string): string | undefined {
    const match = html.match(/JSON\.parse\('(?<json>[\s\S]*?)'\);/)
    if (!match?.groups?.json) {
        const legacy = html.match(/\<font color="red"\>(?<response>.*?)\<\/font\>/i)?.groups?.response
        if (!legacy) return undefined
        return legacy.replace(/<[^>]+>/g, '').trim()
    }
    try {
        const parsed = JSON.parse(match.groups.json) as { messages?: Array<{ type?: string; text?: string }> }
        return parsed.messages?.[0]?.text?.replace(/<[^>]+>/g, '').trim()
    } catch {
        return undefined
    }
}

/**
 * Queries the ECP active-app endpoint to retrieve the currently running channel.
 * Aborts after QUERY_ACTIVE_APP_TIMEOUT_MS milliseconds. Returns empty strings on
 * network errors, timeouts, or non-OK responses rather than throwing.
 *
 * @param ip - IPv4 address of the Roku device.
 * @returns Object with the active app's ECP id and display name, both empty on failure.
 */
export async function queryActiveApp(ip: string): Promise<{ id: string; name: string }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), QUERY_ACTIVE_APP_TIMEOUT_MS)
    try {
        const response = await fetch(`http://${ip}:${ECP_PORT}/query/active-app`, { signal: controller.signal })
        if (!response.ok) return { id: '', name: '' }
        const xml = await response.text()
        const match = xml.match(/<app[^>]*id="([^"]*)"[^>]*>([^<]*)<\/app>/i)
        return {
            id: match?.[1]?.trim() ?? '',
            name: match?.[2]?.trim() ?? ''
        }
    } catch {
        return { id: '', name: '' }
    } finally {
        clearTimeout(timer)
    }
}

/**
 * Captures a screenshot from a Roku device using the /plugin_inspect endpoint.
 *
 * Two-step flow:
 *  1. POST a multipart/form-data request to /plugin_inspect with Digest auth to
 *     trigger screenshot capture and receive an image URL in the HTML response.
 *  2. GET the image URL with a second Digest auth header to download the bitmap.
 *
 * The image format (PNG or JPEG) is determined from the Content-Type header and
 * confirmed by inspecting the file signature bytes. The result is written to
 * outputDir with a timestamped filename.
 *
 * @param ip - IPv4 address of the Roku device.
 * @param creds - Developer mode username and password for Digest authentication.
 * @param outputDir - Directory path where the screenshot file will be written.
 * @returns Capture result including the file path, extension, MIME type, and debug curl commands.
 * @throws If authentication fails, the request is rejected, or the response payload is not a valid image.
 */
export async function captureRokuScreenshot(
    ip: string,
    creds: RokuDeviceCredentials,
    outputDir: string
): Promise<ScreenshotCaptureResult> {
    const baseUrl = `http://${ip}`
    const boundary = `------FormBoundary${randomBytes(16).toString('hex')}`
    const inspectUrl = `${baseUrl}/plugin_inspect`
    const body = Buffer.concat([
        buildMultipartField(boundary, 'mysubmit', 'Screenshot'),
        buildMultipartField(boundary, 'archive', ''),
        Buffer.from(`${boundary}--`)
    ])

    const inspectAuth = await buildDigestAuthHeader('POST', inspectUrl, creds)
    const inspectResponse = await fetch(inspectUrl, {
        method: 'POST',
        headers: {
            Authorization: inspectAuth,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': String(body.length),
            Connection: 'keep-alive'
        },
        body
    })
    if (inspectResponse.status === 401) {
        throw new Error('Authorization failed. Check Roku developer credentials in device settings.')
    }
    if (!inspectResponse.ok) {
        throw new Error(`Screenshot request failed (${inspectResponse.status} ${inspectResponse.statusText}).`)
    }

    const inspectHtml = await inspectResponse.text()
    const imgMatch = /<img[^>]*src=['"]([^'"]*)['"][^>]*>/i.exec(inspectHtml)
    if (!imgMatch?.[1]) {
        throw new Error(parsePluginInspectMessage(inspectHtml) ?? 'Failed to capture screen.')
    }

    const imageUrl = new URL(imgMatch[1], `${baseUrl}/`).toString()
    const imageAuth = await buildDigestAuthHeader('GET', imageUrl, creds)
    const imageResponse = await fetch(imageUrl, { headers: { Authorization: imageAuth } })
    if (!imageResponse.ok) {
        throw new Error(`Failed to download screenshot (${imageResponse.status} ${imageResponse.statusText}).`)
    }

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer())
    const contentType = (imageResponse.headers.get('content-type') ?? '').toLowerCase()
    const isPng = contentType.includes('image/png')
    const isJpeg = contentType.includes('image/jpeg') || contentType.includes('image/jpg')
    const looksLikePng = imageBuffer.length >= PNG_SIGNATURE.length
        && PNG_SIGNATURE.every((byte, index) => imageBuffer[index] === byte)
    const looksLikeJpeg = imageBuffer.length >= JPEG_SIGNATURE.length
        && JPEG_SIGNATURE.every((byte, index) => imageBuffer[index] === byte)
    const extension: 'png' | 'jpg' = (isPng || looksLikePng) ? 'png' : 'jpg'
    const mimeType = extension === 'png' ? 'image/png' : 'image/jpeg'

    if (!isPng && !isJpeg && !looksLikePng && !looksLikeJpeg) {
        throw new Error(parsePluginInspectMessage(imageBuffer.toString('utf-8')) ?? 'Downloaded screenshot payload is not a valid image.')
    }

    const outputPath = path.join(outputDir, `rokdock-screenshot-${ip.replace(/[^\d.]/g, '_')}-${Date.now()}.${extension}`)
    fs.writeFileSync(outputPath, imageBuffer)
    const curlInspect = `curl --digest -u "${creds.user}:<password>" -X POST -F "mysubmit=Screenshot" -F "archive=" "${inspectUrl}"`
    const curlImage = `curl --digest -u "${creds.user}:<password>" -L -o "roku-screenshot.${extension}" "${imageUrl}"`

    return {
        filePath: outputPath,
        extension,
        mimeType,
        inspectUrl,
        imageUrl,
        curlInspect,
        curlImage
    }
}

const SIDELOAD_CHUNK_SIZE = 64 * 1024

/**
 * Sideloads a channel ZIP file to a Roku device via /plugin_install.
 *
 * Builds a multipart/form-data body containing the 'Install' action field and
 * the ZIP archive, then streams it to the device in SIDELOAD_CHUNK_SIZE chunks.
 * Progress is reported via onProgress as a percentage from 0-100.
 *
 * @param ip - IPv4 address of the Roku device.
 * @param creds - Developer mode username and password for Digest authentication.
 * @param zipBuffer - Buffer containing the channel ZIP file contents.
 * @param fileName - Filename to send in the multipart Content-Disposition header.
 * @param onProgress - Optional callback invoked with upload progress (0-100).
 * @returns Result object with ok status and the parsed status message from the device response.
 * @throws If the Digest authentication challenge is missing or the TCP connection fails.
 */
export async function pluginInstall(
    ip: string,
    creds: RokuDeviceCredentials,
    zipBuffer: Buffer,
    fileName: string,
    onProgress?: (percent: number) => void
): Promise<{ ok: boolean; message?: string }> {
    const boundary = `------FormBoundary${randomBytes(16).toString('hex')}`
    const installUrl = `http://${ip}/plugin_install`

    const textPart = buildMultipartField(boundary, 'mysubmit', 'Install')
    const filePart = Buffer.concat([
        Buffer.from(`${boundary}\r\n`),
        Buffer.from(`Content-Disposition: form-data; name="archive"; filename="${fileName}"\r\n`),
        Buffer.from('Content-Type: application/zip\r\n'),
        Buffer.from('\r\n'),
        zipBuffer,
        Buffer.from('\r\n')
    ])
    const closingPart = Buffer.from(`${boundary}--`)
    const body = Buffer.concat([textPart, filePart, closingPart])

    const authHeader = await buildDigestAuthHeader('POST', installUrl, creds)

    const html = await new Promise<string>((resolve, reject) => {
        const req = http.request({
            hostname: ip,
            port: 80,
            path: '/plugin_install',
            method: 'POST',
            headers: {
                Authorization: authHeader,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': String(body.length),
                Connection: 'keep-alive'
            },
            timeout: 120000
        }, res => {
            if (res.statusCode === 401) {
                reject(new Error('Authorization failed. Check developer credentials in Device Properties.'))
                return
            }
            const chunks: Buffer[] = []
            res.on('data', (chunk: Buffer) => chunks.push(chunk))
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
            res.on('error', reject)
        })
        req.on('error', reject)
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out.')) })

        let offset = 0
        const writeChunk = () => {
            while (offset < body.length) {
                const chunk = body.slice(offset, offset + SIDELOAD_CHUNK_SIZE)
                offset += chunk.length
                onProgress?.(Math.round((offset / body.length) * 95))
                const canContinue = req.write(chunk)
                if (!canContinue) {
                    req.once('drain', writeChunk)
                    return
                }
            }
            onProgress?.(95)
            req.end()
        }
        writeChunk()
    })

    onProgress?.(100)
    const message = parsePluginInspectMessage(html)
    // If parsePluginInspectMessage returns undefined, no error indicator was found = success.
    // If it returns text, check for known success phrases from Roku firmware responses.
    const ok = message === undefined || /bytes stored|success/i.test(message)
    return { ok, message: message ?? 'Application installed successfully.' }
}
