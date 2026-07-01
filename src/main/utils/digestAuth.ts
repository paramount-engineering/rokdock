/**
 * HTTP Digest Authentication helpers for Roku developer endpoints.
 *
 * Roku's /plugin_inspect and /plugin_install endpoints require HTTP Digest auth
 * (RFC 7616). This module implements the MD5-based Digest challenge-response
 * handshake used by Roku's web server.
 *
 * Usage pattern:
 *  1. Call buildDigestAuthHeader() which first makes an unauthenticated request to
 *     get the 401 WWW-Authenticate challenge header, then computes and returns the
 *     Digest Authorization header string for the actual request.
 *  2. Build the multipart form body using buildMultipartField() for text fields
 *     alongside a manually-constructed file part for binary uploads.
 *
 * Note: Roku uses digest-auth even in developer mode. If developer mode is not
 * enabled, the server returns no WWW-Authenticate header and buildDigestAuthHeader
 * throws with a helpful error message.
 */

import { createHash, randomBytes } from 'crypto'

export interface RokuDeviceCredentials {
    user: string
    password: string
}

/** Computes the MD5 hex digest of a string. Used for Digest auth HA1/HA2/response fields. */
function md5(value: string): string {
    return createHash('md5').update(value).digest('hex')
}

/**
 * Serializes a single text field as a multipart/form-data part.
 * Produces the boundary header, Content-Disposition line, and the field value
 * as a ready-to-concatenate Buffer. Binary file parts must be constructed manually.
 *
 * @param boundary - The full multipart delimiter line prefix (the caller includes the leading dashes).
 * @param name - The form field name for the Content-Disposition header.
 * @param content - The string value of the field. May be empty.
 * @returns Buffer containing the encoded multipart field part.
 */
export function buildMultipartField(boundary: string, name: string, content: string): Buffer {
    const buffers: Buffer[] = []
    buffers.push(Buffer.from(`${boundary}\r\n`))
    buffers.push(Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n`))
    if (content || content === '') {
        buffers.push(Buffer.from(`\r\n${content}`))
    }
    buffers.push(Buffer.from('\r\n'))
    return Buffer.concat(buffers)
}

/**
 * Parses a WWW-Authenticate Digest header value into a key/value map.
 * Handles both quoted and unquoted field values. The leading 'Digest ' prefix
 * is stripped automatically if present.
 *
 * @param header - The raw WWW-Authenticate header value (e.g. 'Digest realm="...", nonce="..."').
 * @returns Map of lowercase field names to their unquoted values.
 */
function extractFirstDigestHeader(header: string): Record<string, string> {
    const digestHeader = header.startsWith('Digest ') ? header.slice(7) : header
    const fields: Record<string, string> = {}
    const regex = /(\w+)=(".*?"|'.*?'|[^,]*)(?:,|$)/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(digestHeader)) !== null) {
        fields[match[1].toLowerCase()] = match[2].replace(/^["']|["']$/g, '')
    }
    return fields
}

/**
 * Performs the HTTP Digest authentication handshake and returns the Authorization header.
 *
 * Makes an unauthenticated request to obtain the 401 WWW-Authenticate challenge,
 * then computes the MD5-based Digest response (RFC 7616) using a fresh cnonce.
 * The returned string is ready to use as the Authorization header value on the
 * actual request.
 *
 * @param method - HTTP method for both the probe request and the Authorization uri field.
 * @param url - Full URL of the Roku endpoint (e.g. 'http://192.168.1.x/plugin_inspect').
 * @param creds - Developer mode username and password.
 * @returns Fully formed 'Digest ...' Authorization header value.
 * @throws If the server does not return a WWW-Authenticate header (developer mode not enabled).
 */
export async function buildDigestAuthHeader(
    method: 'GET' | 'POST',
    url: string,
    creds: RokuDeviceCredentials
): Promise<string> {
    const authResponse = await fetch(url, { method })
    const wwwAuthenticate = authResponse.headers.get('www-authenticate')
    if (!wwwAuthenticate) {
        throw new Error('www-authenticate header not found. Is developer mode enabled?')
    }

    const digest = extractFirstDigestHeader(wwwAuthenticate)
    const realm = digest.realm ?? ''
    const nonce = digest.nonce ?? ''
    const opaque = digest.opaque
    const qop = digest.qop?.split(',')[0]?.trim()
    const nc = '00000001'
    const cnonce = randomBytes(8).toString('hex')
    const parsed = new URL(url)
    const uri = parsed.pathname

    const ha1 = md5(`${creds.user}:${realm}:${creds.password}`)
    const ha2 = md5(`${method}:${uri}`)
    const response = md5(`${ha1}:${nonce}:${nc}:${cnonce}${qop ? `:${qop}` : ''}:${ha2}`)

    return `Digest username="${creds.user}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}", ${opaque ? `opaque="${opaque}", ` : ''}${qop ? `qop=${qop}, ` : ''}nc=${nc}, cnonce="${cnonce}"`
}
