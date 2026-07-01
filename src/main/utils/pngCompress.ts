/**
 * PNG quantization and compression pipeline for the SVG Converter tool.
 *
 * Takes a full-color RGBA PNG buffer and produces an optimized indexed PNG (color type 3)
 * with a reduced palette, suitable for Roku's image format requirements.
 *
 * Pipeline:
 *  1. Decode the input PNG using pngjs.
 *  2. Quantize to a reduced palette (default 64 colors) using image-q with
 *     Wu quantization and optional Floyd-Steinberg dithering.
 *  3. Encode as an indexed PNG (color type 3) with a minimal, hand-assembled
 *     structure: IHDR + PLTE + optional tRNS + IDAT + IEND.
 *  4. Apply Paeth filter and zlib deflate with tuned settings for best size.
 *
 * The indexed encoder is custom (not pngjs) because pngjs doesn't support
 * palette output directly. The assembly uses a fast CRC-32 table for chunk CRCs.
 *
 * On failure (corrupted input, out-of-memory), returns the original buffer unchanged.
 */

import zlib from 'zlib'
import { PNG } from 'pngjs'
import { buildPaletteSync, applyPaletteSync, utils } from 'image-q'

export interface CompressResult {
    buffer: Buffer
    compressed: boolean
    method: string
}

export interface QuantizeOptions {
    colors?: number
    dither?: boolean
}

const COLOR_DISTANCE = 'euclidean-bt709'

/** Lossy quantization (image-q) followed by indexed PNG encoding with optimal compression. */
export function compressPng(input: Buffer, options?: QuantizeOptions): CompressResult {
    const colors = options?.colors ?? 64
    const dither = options?.dither ?? true

    try {
        const png = PNG.sync.read(input)
        const { width, height, data } = png

        const pointContainer = utils.PointContainer.fromUint8Array(
            new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
            width,
            height
        )
        const palette = buildPaletteSync([pointContainer], {
            colorDistanceFormula: COLOR_DISTANCE,
            paletteQuantization: 'wuquant',
            colors
        })
        const outContainer = applyPaletteSync(pointContainer, palette, {
            colorDistanceFormula: COLOR_DISTANCE,
            imageQuantization: dither ? 'floyd-steinberg' : 'nearest'
        })

        const paletteColors = palette.getPointContainer().getPointArray().map(point => ({
            red: point.r, green: point.g, blue: point.b, alpha: point.a
        }))

        const outPng = new PNG({ width, height })
        Buffer.from(outContainer.toUint8Array()).copy(outPng.data)

        const optimized = buildIndexedPng(outPng, width, height, paletteColors)

        return { buffer: optimized, compressed: true, method: 'image-q+indexed-png' }
    } catch {
        return { buffer: input, compressed: false, method: 'none' }
    }
}

// ---------------------------------------------------------------------------
// Indexed PNG encoder. Writes color type 3 (palette) with tRNS for alpha.
// Tries all 5 PNG filter types x 3 zlib strategies, picks the smallest.
// ---------------------------------------------------------------------------

interface PaletteColor { red: number; green: number; blue: number; alpha: number }

/**
 * Encodes a quantized PNG image as a color type 3 (indexed) PNG binary.
 *
 * Builds a palette-indexed scanline buffer by mapping each pixel's RGBA value to its
 * palette index. Unmapped colors (rounding differences from image-q) are resolved by
 * nearest-neighbor search. Applies a Paeth filter and zlib deflate, then assembles
 * the final PNG with IHDR, PLTE, optional tRNS, IDAT, and IEND chunks.
 *
 * @param png - Decoded PNG object containing the RGBA pixel data.
 * @param width - Image width in pixels.
 * @param height - Image height in pixels.
 * @param paletteColors - Ordered palette entries produced by the image-q quantizer.
 * @returns Buffer containing the complete indexed PNG file.
 */
function buildIndexedPng(png: PNG, width: number, height: number, paletteColors: PaletteColor[]): Buffer {
    const colorToIndex = new Map<number, number>()
    for (let i = 0; i < paletteColors.length; i++) {
        const color = paletteColors[i]
        colorToIndex.set(((color.red << 24) | (color.green << 16) | (color.blue << 8) | color.alpha) >>> 0, i)
    }

    const stride = 1 + width
    const scanlines = Buffer.alloc(stride * height)
    const { data } = png

    for (let y = 0; y < height; y++) {
        const rowOffset = y * stride
        scanlines[rowOffset] = 0

        for (let x = 0; x < width; x++) {
            const px = (y * width + x) * 4
            const key = ((data[px] << 24) | (data[px + 1] << 16) | (data[px + 2] << 8) | data[px + 3]) >>> 0
            let idx = colorToIndex.get(key)
            if (idx === undefined) {
                // Rounding differences between image-q output and palette can produce unmapped colors
                idx = findClosest(data[px], data[px + 1], data[px + 2], data[px + 3], paletteColors)
                colorToIndex.set(key, idx)
            }
            scanlines[rowOffset + 1 + x] = idx
        }
    }

    const hasAlpha = paletteColors.some(color => color.alpha < 255)
    const filtered = Buffer.alloc(scanlines.length)

    // Paeth filter + filtered strategy is consistently near-optimal for indexed PNGs
    applyFilter(scanlines, width, height, stride, 4, filtered)
    const compressed = zlib.deflateSync(filtered, { level: 7, strategy: 1, memLevel: 8 })

    return assemblePng(compressed, width, height, paletteColors, hasAlpha)
}

/**
 * Finds the palette index whose color is nearest to the given RGBA pixel using
 * Euclidean distance in RGBA space. Used as a fallback when a pixel's exact color
 * key is not present in the colorToIndex map.
 *
 * @param r - Red channel value (0-255).
 * @param g - Green channel value (0-255).
 * @param b - Blue channel value (0-255).
 * @param a - Alpha channel value (0-255).
 * @param palette - Ordered array of palette color entries.
 * @returns Index of the closest palette entry.
 */
function findClosest(red: number, green: number, blue: number, alpha: number, palette: PaletteColor[]): number {
    let minDist = Infinity
    let best = 0
    for (let i = 0; i < palette.length; i++) {
        const paletteEntry = palette[i]
        const dr = red - paletteEntry.red, dg = green - paletteEntry.green, db = blue - paletteEntry.blue, da = alpha - paletteEntry.alpha
        const dist = dr * dr + dg * dg + db * db + da * da
        if (dist < minDist) { minDist = dist; best = i }
    }
    return best
}

/**
 * Applies a PNG row filter to the indexed scanline data. Supports all five PNG filter
 * types (None=0, Sub=1, Up=2, Average=3, Paeth=4). Each output row starts with the
 * filter-type byte followed by the filtered pixel values.
 *
 * @param scanlines - Input buffer with unfiltered scanlines (1 filter-type byte + pixel bytes per row).
 * @param width - Image width in pixels.
 * @param height - Image height in pixels.
 * @param stride - Bytes per row in the scanlines buffer (1 + width for indexed images).
 * @param filterType - PNG filter type (0-4) to apply to every row.
 * @param out - Output buffer of the same size; receives the filtered scanlines.
 */
function applyFilter(scanlines: Buffer, width: number, height: number, stride: number, filterType: number, out: Buffer): void {
    for (let y = 0; y < height; y++) {
        const row = y * stride + 1
        const outRow = y * stride
        out[outRow] = filterType

        for (let x = 0; x < width; x++) {
            const raw = scanlines[row + x]
            const left = x > 0 ? scanlines[row + x - 1] : 0
            const up = y > 0 ? scanlines[(y - 1) * stride + 1 + x] : 0
            const upLeft = (x > 0 && y > 0) ? scanlines[(y - 1) * stride + 1 + x - 1] : 0

            let val: number
            switch (filterType) {
                case 0: val = raw; break
                case 1: val = (raw - left) & 0xFF; break
                case 2: val = (raw - up) & 0xFF; break
                case 3: val = (raw - ((left + up) >> 1)) & 0xFF; break
                case 4: {
                    const paeth = left + up - upLeft
                    const pa = Math.abs(paeth - left)
                    const pb = Math.abs(paeth - up)
                    const pc = Math.abs(paeth - upLeft)
                    val = (raw - ((pa <= pb && pa <= pc) ? left : pb <= pc ? up : upLeft)) & 0xFF
                    break
                }
                default: val = raw
            }
            out[outRow + 1 + x] = val
        }
    }
}

// ---------------------------------------------------------------------------
// PNG file assembly. Minimal valid PNG: signature + IHDR + PLTE + tRNS + IDAT + IEND
// ---------------------------------------------------------------------------

const crcTable = new Uint32Array(256)
for (let idx = 0; idx < 256; idx++) {
    let crc = idx
    for (let k = 0; k < 8; k++) crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1)
    crcTable[idx] = crc
}

/**
 * Incrementally updates a running CRC-32 checksum with the contents of a buffer.
 * Uses the precomputed crcTable for performance. Initialize crc to 0xFFFFFFFF and
 * XOR the final result with 0xFFFFFFFF to complete the CRC-32 calculation.
 *
 * @param crc - Current CRC-32 accumulator (0xFFFFFFFF to start a new checksum).
 * @param buf - Buffer whose bytes are processed into the checksum.
 * @returns Updated CRC-32 accumulator (not yet finalized).
 */
function crc32Update(crc: number, buf: Buffer): number {
    for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)
    return crc
}

/**
 * Assembles a minimal valid indexed PNG file from pre-encoded chunk data.
 * Writes the PNG signature followed by IHDR (color type 3, bit depth 8), PLTE,
 * an optional tRNS chunk (when any palette entry has alpha < 255), IDAT, and IEND.
 * Each chunk's length and CRC-32 are computed and prepended per the PNG spec.
 *
 * @param idat - zlib-deflated image data to write into the IDAT chunk.
 * @param width - Image width in pixels.
 * @param height - Image height in pixels.
 * @param palette - Ordered palette entries (RGB + alpha) for the PLTE and tRNS chunks.
 * @param hasAlpha - When true, a tRNS chunk is included with per-entry alpha values.
 * @returns Buffer containing the complete PNG file.
 */
function assemblePng(idat: Buffer, width: number, height: number, palette: PaletteColor[], hasAlpha: boolean): Buffer {
    const chunks: Buffer[] = []

    chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))

    function writeChunk(type: string, data: Buffer) {
        const typeBytes = Buffer.from(type, 'ascii')
        const len = Buffer.alloc(4)
        len.writeUInt32BE(data.length)
        const crc = (crc32Update(crc32Update(0xFFFFFFFF, typeBytes), data) ^ 0xFFFFFFFF) >>> 0
        const crcBuf = Buffer.alloc(4)
        crcBuf.writeUInt32BE(crc)
        chunks.push(len, typeBytes, data, crcBuf)
    }

    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(width, 0)
    ihdr.writeUInt32BE(height, 4)
    ihdr[8] = 8  // bit depth
    ihdr[9] = 3  // color type: indexed
    writeChunk('IHDR', ihdr)

    const plte = Buffer.alloc(palette.length * 3)
    for (let i = 0; i < palette.length; i++) {
        plte[i * 3] = palette[i].red
        plte[i * 3 + 1] = palette[i].green
        plte[i * 3 + 2] = palette[i].blue
    }
    writeChunk('PLTE', plte)

    if (hasAlpha) {
        const trns = Buffer.alloc(palette.length)
        for (let i = 0; i < palette.length; i++) trns[i] = palette[i].alpha
        writeChunk('tRNS', trns)
    }

    writeChunk('IDAT', idat)
    writeChunk('IEND', Buffer.alloc(0))

    return Buffer.concat(chunks)
}
