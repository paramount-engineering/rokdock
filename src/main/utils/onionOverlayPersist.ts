/**
 * Persistent storage for onion-skin overlay images used in the screenshot viewer.
 *
 * When the user picks a design overlay image, it is copied into userData so the
 * overlay history keeps working even if the original file is moved or deleted.
 * Copies are keyed by content hash + sanitized original filename to avoid duplicates.
 *
 * The persist directory is: <userData>/onion-overlays/
 * Only images with recognized extensions (.png, .jpg, .webp, .gif, .bmp) are copied.
 *
 * Built-in overlays use the 'rokdock-builtin:<id>' URI scheme and are not stored here.
 */

import crypto from 'node:crypto'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { ONION_OVERLAY_USERDATA_SUBDIR } from '../constants/preview'

/**
 * Normalizes a file extension to an allowed image format. JPEG variants (.jpeg)
 * are normalized to .jpg. Unrecognized extensions fall back to .png.
 *
 * @param ext - File extension including the leading dot (e.g. '.JPEG').
 * @returns Normalized, lowercase extension: '.jpg', '.png', '.webp', '.gif', or '.bmp'.
 */
function allowedImageExt(ext: string): string {
    const e = ext.toLowerCase()
    if (e === '.jpeg' || e === '.jpg') return '.jpg'
    if (['.png', '.webp', '.gif', '.bmp'].includes(e)) return e
    return '.png'
}

/**
 * Extracts and sanitizes the base filename (without extension) from a file path for use
 * as part of the persisted overlay filename. Replaces path-unsafe characters with
 * underscores, trims whitespace, and truncates to 60 characters.
 *
 * @param filePath - Full path to the source overlay image file.
 * @returns Sanitized base name string safe for use in a filesystem filename.
 */
function sanitizeBaseName(filePath: string): string {
    const base = path.basename(filePath, path.extname(filePath))
    const sanitized = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim()
    return (sanitized || 'overlay').slice(0, 60)
}

/**
 * Returns the path to the onion-overlay persist directory inside Electron's userData
 * folder, creating it (recursively) if it does not exist.
 *
 * @returns Absolute path to the persist directory.
 */
export function getOnionOverlayPersistDir(): string {
    const dir = path.join(app.getPath('userData'), ONION_OVERLAY_USERDATA_SUBDIR)
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
    }
    return dir
}

/**
 * Returns true when filePath is located inside the onion-overlay persist directory.
 * Used to avoid copying files that are already managed by this module and to guard
 * deletion so only owned files are removed.
 *
 * @param filePath - Absolute path to check.
 * @returns True if filePath is the persist dir itself or a direct descendant of it.
 */
export function isPathUnderOnionPersistDir(filePath: string): boolean {
    let root: string
    let resolved: string
    try {
        root = path.resolve(getOnionOverlayPersistDir())
        resolved = path.resolve(filePath)
    } catch {
        return false
    }
    return resolved === root || resolved.startsWith(root + path.sep)
}

/**
 * Copy an overlay image into userData so history survives if the original file is removed.
 * Uses content hash + sanitized original name; returns the same path if an identical copy already exists.
 */
export function persistOnionOverlayFile(sourcePath: string): { path: string; copied: boolean } {
    if (!fs.existsSync(sourcePath)) {
        return { path: sourcePath, copied: false }
    }
    if (isPathUnderOnionPersistDir(sourcePath)) {
        return { path: sourcePath, copied: true }
    }
    let buf: Buffer
    try {
        buf = fs.readFileSync(sourcePath)
    } catch {
        return { path: sourcePath, copied: false }
    }
    const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
    const ext = allowedImageExt(path.extname(sourcePath))
    const base = sanitizeBaseName(sourcePath)
    const dir = getOnionOverlayPersistDir()
    let dest = path.join(dir, `${hash}_${base}${ext}`)

    if (fs.existsSync(dest)) {
        try {
            const existing = fs.readFileSync(dest)
            if (
                existing.length === buf.length
                && (existing.length === 0 || crypto.timingSafeEqual(existing, buf))
            ) {
                return { path: dest, copied: true }
            }
        } catch {
            // fall through to unique name
        }
        let counter = 1
        while (fs.existsSync(dest)) {
            dest = path.join(dir, `${hash}_${base}_${counter}${ext}`)
            counter += 1
        }
    }

    try {
        fs.writeFileSync(dest, buf)
        return { path: dest, copied: true }
    } catch {
        return { path: sourcePath, copied: false }
    }
}

/**
 * Deletes a persisted overlay file only if it is located inside the onion-overlay
 * persist directory. Files outside the persist dir (e.g. user-selected originals)
 * are never touched. Errors during deletion are silently swallowed (best-effort).
 *
 * @param filePath - Absolute path of the overlay file to delete.
 */
export function deletePersistedOnionFileIfOwned(filePath: string): void {
    if (!isPathUnderOnionPersistDir(filePath)) return
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath)
        }
    } catch {
        // best-effort
    }
}

/** Deletes all files in the onion-overlay persist folder (e.g. Reset to Defaults). Does not create the directory. */
export function clearOnionOverlayPersistDir(): void {
    try {
        const dir = path.join(app.getPath('userData'), ONION_OVERLAY_USERDATA_SUBDIR)
        if (!fs.existsSync(dir)) return
        for (const name of fs.readdirSync(dir)) {
            try {
                const filePath = path.join(dir, name)
                if (fs.statSync(filePath).isFile()) fs.unlinkSync(filePath)
            } catch {
                // best-effort
            }
        }
    } catch {
        // best-effort
    }
}
