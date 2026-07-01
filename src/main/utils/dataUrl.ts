import fs from 'fs'
import path from 'path'

/**
 * Decode a base64 image data URL to a Buffer.
 *
 * Strips a leading `data:image/<type>;base64,` prefix before decoding. A string
 * without that prefix is decoded as-is, matching the inline behavior this helper
 * replaced across the image-export handlers.
 */
export function dataUrlToBuffer(dataUrl: string): Buffer {
    return Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64')
}

/** Maps a file extension to its image MIME type, defaulting to image/png. */
function imageMimeForExtension(filePath: string): string {
    switch (path.extname(filePath).toLowerCase()) {
        case '.jpg':
        case '.jpeg': return 'image/jpeg'
        case '.webp': return 'image/webp'
        case '.gif': return 'image/gif'
        case '.bmp': return 'image/bmp'
        default: return 'image/png'
    }
}

/**
 * Read an image file and encode it as a base64 `data:` URL, preserving its
 * original encoding (the MIME type is derived from the extension, so a JPEG is
 * not re-encoded as PNG). Used to serve screenshots and overlays to the preview
 * renderer, which runs under a tight CSP that forbids file:// images.
 *
 * @param filePath - Absolute path to the image file.
 * @returns The `data:` URL, or null if the file does not exist or cannot be read.
 */
export function fileToDataUrl(filePath: string): string | null {
    try {
        if (!fs.existsSync(filePath)) return null
        const base64 = fs.readFileSync(filePath).toString('base64')
        return `data:${imageMimeForExtension(filePath)};base64,${base64}`
    } catch {
        return null
    }
}
