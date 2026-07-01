import path from 'path'

/**
 * Builds the user-facing message shown when a standalone (CLI) tool launch
 * cannot read the file it was given. Kept in one place so every tool reports
 * the failure identically.
 *
 * @param filePath - The path that failed to open (only its basename is shown).
 * @param err - The thrown error (or any value) from the read/parse attempt.
 * @returns A message like "Couldn't open foo.json: ENOENT ...".
 */
export function fileOpenError(filePath: string, err: unknown): string {
    return `Couldn't open ${path.basename(filePath)}: ${err instanceof Error ? err.message : 'open failed'}`
}
