/**
 * Subprocess adapter. Runs the pre-built command (the model is already interpolated by
 * the CLI registry) through the platform shell so PATH and Windows .cmd/.bat shims
 * resolve, writes the system
 * prompt (if any) plus the folded transcript to stdin, and streams stdout chunks as
 * deltas. Auth is whatever the CLI already has, so no API key is used.
 *
 * Each spawn is bounded by an idle timeout: if the process emits nothing for the timeout
 * window it is killed with a clear error, so a CLI stuck on an interactive or auth prompt
 * fails fast instead of hanging. On abort the whole process tree is killed (taskkill on
 * Windows, process-group kill on POSIX) so no grandchild lingers.
 */
import { spawn } from 'child_process'
import type { AiAdapter, ResolvedRequest, AdapterEvent } from '../types'
import { foldMessages } from '../transcript'

/** Default idle timeout: kill a CLI that has produced no output for this long. Overridable per request. */
const IDLE_TIMEOUT_MS = 120_000

/** Kill the child and any grandchildren across platforms. */
function killTree(pid: number | undefined): void {
    if (pid === undefined) return
    try {
        if (process.platform === 'win32') {
            const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'])
            killer.on('error', () => { /* taskkill failed (pid gone or denied); nothing to do */ })
        } else {
            process.kill(-pid, 'SIGTERM')  // negative pid = the detached process group
        }
    } catch { /* best-effort */ }
}

/** Spawn the command once, write stdin, yield stdout chunks. Throws on a non-zero exit or an idle timeout. */
async function* runOnce(command: string, env: Record<string, string> | undefined, cwd: string | undefined, stdin: string, idleMs: number, signal: AbortSignal): AsyncIterable<string> {
    const child = spawn(command, {
        shell: true,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: env ?? process.env,
        cwd,
    })
    const onAbort = (): void => killTree(child.pid)
    signal.addEventListener('abort', onAbort, { once: true })

    const queue: string[] = []
    let resolveNext: (() => void) | null = null
    let finished = false
    let failure: Error | null = null
    let stderr = ''
    const wake = (): void => { if (resolveNext) { resolveNext(); resolveNext = null } }

    // A generic CLI not in non-interactive mode (or one stuck on an auth/confirm prompt) would hang
    // forever with no output. Kill it once it has been silent for idleMs; any stdout or stderr resets
    // the clock, so a slow-but-productive stream is never cut off.
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    const clearIdle = (): void => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null } }
    const armIdle = (): void => {
        clearIdle()
        idleTimer = setTimeout(() => {
            failure = new Error(`AI CLI produced no output for ${Math.round(idleMs / 1000)}s and was stopped. If this CLI needs a non-interactive flag (for example -p or --print), add it to the command.`)
            finished = true
            killTree(child.pid)
            wake()
        }, idleMs)
    }

    child.stdout.setEncoding('utf-8')
    child.stdout.on('data', (chunk: string) => { armIdle(); queue.push(chunk); wake() })
    child.stderr.setEncoding('utf-8')
    child.stderr.on('data', (chunk: string) => { armIdle(); stderr += chunk })
    child.on('error', (err: Error) => { clearIdle(); failure = err; finished = true; wake() })
    child.on('close', (code: number | null) => {
        clearIdle()
        // Guard on !failure so an idle-timeout kill keeps its own message instead of the exit-code one.
        if (code && code !== 0 && !signal.aborted && !failure) {
            // 127 (POSIX) or the Windows "not recognized" text means the executable was not found.
            const notFound = code === 127 || /not recognized|not found|no such file/i.test(stderr)
            const hint = notFound
                ? ' (command not found: check the command, or use an absolute path, since a GUI-launched app may not see your shell PATH)'
                : ''
            failure = new Error(`AI CLI exited with code ${code}${stderr ? `: ${stderr.trim().slice(-300)}` : ''}${hint}`)
        }
        finished = true
        wake()
    })
    child.stdin.on('error', () => { /* EPIPE or EOF: the process closed stdin early */ })
    if (child.stdin.writable) child.stdin.write(stdin)
    child.stdin.end()
    armIdle()

    try {
        while (true) {
            while (queue.length > 0) yield queue.shift() as string
            if (failure) throw failure
            if (finished) return
            if (signal.aborted) return
            await new Promise<void>(resolve => { resolveNext = resolve })
        }
    } finally {
        clearIdle()
        signal.removeEventListener('abort', onAbort)
        if (!finished) killTree(child.pid)
    }
}

export const cliAdapter: AiAdapter = {
    type: 'cli',
    async *stream(request: ResolvedRequest, signal: AbortSignal): AsyncIterable<AdapterEvent> {
        // The engine builds the variant matching config.transport. A mismatch means the host
        // paired a CLI adapter with an HTTP config (or vice versa). Fail loudly rather than
        // silently treating an HTTP request's missing command as "no command configured".
        if (request.transport !== 'cli') throw new Error('The CLI adapter received a non-CLI request.')
        const command = (request.command ?? '').trim()
        if (!command) throw new Error('No CLI command configured for this profile.')
        const idleMs = request.idleTimeoutMs ?? IDLE_TIMEOUT_MS
        const stdin = request.system ? `${request.system}\n\n${foldMessages(request.messages)}` : foldMessages(request.messages)
        for await (const chunk of runOnce(command, request.env, request.cwd, stdin, idleMs, signal)) yield chunk
    },
}
