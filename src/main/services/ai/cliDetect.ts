/**
 * Probe an augmented PATH for the recognized CLI executables. Filesystem stats only, no
 * subprocess spawns, so it is cheap and cannot hang. A name that is present but not really
 * runnable degrades to the CLI adapter's "command not found" error at send time.
 */
import fs from 'fs'
import path from 'path'
import { CLI_DEFINITIONS, CLI_KINDS } from '../../../ai-core'
import type { CliKind } from '../../../ai-core/types'

// On Windows an executable on PATH is usually <name>.cmd/.exe/.bat/.ps1 or the bare name; on POSIX it is the bare name.
const WIN_EXTS = ['', '.cmd', '.exe', '.bat', '.ps1', '.com']

function existsOnPath(executable: string, dirs: string[]): boolean {
    const candidates = process.platform === 'win32'
        ? WIN_EXTS.map(ext => executable + ext)
        : [executable]
    for (const dir of dirs) {
        if (!dir) continue
        for (const name of candidates) {
            try {
                if (fs.statSync(path.join(dir, name)).isFile()) return true
            } catch { /* not here */ }
        }
    }
    return false
}

export async function detectInstalledClis(pathEnv: string): Promise<CliKind[]> {
    if (!pathEnv) return []
    const dirs = pathEnv.split(path.delimiter)
    return CLI_KINDS.filter(kind => existsOnPath(CLI_DEFINITIONS[kind].executable, dirs))
}
