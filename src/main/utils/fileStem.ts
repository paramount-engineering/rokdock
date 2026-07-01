import path from 'path'

/**
 * Returns a file's basename without its final extension, e.g. 'foo.rasp' -> 'foo'.
 * Strips only the last extension, so a compound 'a.b.rasp' yields 'a.b'. Used to
 * derive a default script name from a RASP file path.
 */
export function fileStem(filePath: string): string {
    return path.basename(filePath, path.extname(filePath))
}
