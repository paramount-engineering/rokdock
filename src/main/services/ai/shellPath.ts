/**
 * Resolves the executable search PATH for CLI subprocesses. A GUI-launched app does NOT
 * inherit the user's interactive-shell PATH on macOS/Linux (Finder and .desktop launchers
 * give a minimal PATH, and /bin/sh -c does not source the login rc), so a bare command
 * like `ollama` fails even though it works in a terminal. This resolves the login shell's
 * PATH once (cached), merges it with the inherited PATH and a few well-known install dirs,
 * and falls back gracefully. On Windows the GUI already inherits the registry PATH, so the
 * inherited value is returned as-is. This is a host concern: the portable core only ever
 * receives a finished env.
 */
import { spawn } from 'child_process'

let cached: string | null = null

/** Test seam: clear the cached resolution. */
export function resetAugmentedPathCache(): void { cached = null }

interface ResolveDeps {
    platform?: NodeJS.Platform
    env?: NodeJS.ProcessEnv
    readLoginShellPath?: () => Promise<string | null>
}

function mergePaths(parts: string[]): string {
    const seen = new Set<string>()
    for (const part of parts) {
        for (const dir of part.split(':')) {
            const trimmed = dir.trim()
            if (trimmed) seen.add(trimmed)
        }
    }
    return Array.from(seen).join(':')
}

/** Spawn the user's login shell and print its PATH. Best-effort, times out after 2s. */
function defaultReadLoginShellPath(env: NodeJS.ProcessEnv): Promise<string | null> {
    return new Promise(resolve => {
        const shell = env.SHELL || '/bin/sh'
        let out = ''
        let settled = false
        const finish = (value: string | null): void => { if (!settled) { settled = true; resolve(value) } }
        try {
            const child = spawn(shell, ['-ilc', 'echo "$PATH"'], { stdio: ['ignore', 'pipe', 'ignore'] })
            const timer = setTimeout(() => { child.kill(); finish(null) }, 2000)
            child.stdout.setEncoding('utf-8')
            child.stdout.on('data', (chunk: string) => { out += chunk })
            child.on('error', () => { clearTimeout(timer); finish(null) })
            child.on('close', () => { clearTimeout(timer); finish(out.trim() || null) })
        } catch { finish(null) }
    })
}

export async function resolveAugmentedPath(deps: ResolveDeps = {}): Promise<string> {
    const platform = deps.platform ?? process.platform
    const env = deps.env ?? process.env
    const basePath = env.PATH ?? ''
    if (platform === 'win32') return basePath
    if (cached !== null) return cached
    const shellPath = deps.readLoginShellPath ? await deps.readLoginShellPath() : await defaultReadLoginShellPath(env)
    const home = env.HOME ?? ''
    const knownDirs = ['/usr/local/bin', '/opt/homebrew/bin', ...(home ? [`${home}/.local/bin`] : [])]
    cached = mergePaths([shellPath ?? '', basePath, ...knownDirs])
    return cached
}
