/**
 * Renderer-side client for the regex-match Web Worker.
 *
 * Owns one worker and makes it freeze-proof: every request runs under a watchdog,
 * and if the worker does not answer within timeoutMs (the signature of a
 * catastrophic-backtracking pattern) it is hard-terminated and respawned, and the
 * request resolves with { status: 'timeout' }. terminate() on a dedicated worker is
 * an OS-thread kill, so it stops a mid-backtrack RegExp.exec unconditionally.
 *
 * Concurrency is single-in-flight with a one-slot latest-wins queue: a request that
 * arrives while the worker is busy waits in `pending` (overwriting and superseding
 * any earlier waiter), so a stuck job never blocks the newest query beyond one
 * terminate cycle. The worker factory is injected so the client is unit-tested
 * without a real Worker.
 */
import type { RegexLineMatch } from '@shared/regexMatch'
import type { RegexMatchRequest, RegexMatchResponse } from '../../workers/regexMatchProtocol'

/** The subset of the Worker interface the client depends on (injectable for tests). */
export interface RegexWorkerLike {
    postMessage(message: RegexMatchRequest): void
    terminate(): void
    onmessage: ((event: MessageEvent<RegexMatchResponse>) => void) | null
    onerror: ((event: unknown) => void) | null
}

/** Outcome of a match request. `superseded` means a newer request replaced this one while queued. */
export type MatchOutcome<T> =
    | { status: 'ok'; value: T }
    | { status: 'invalid' }
    | { status: 'timeout' }
    | { status: 'superseded' }

const DEFAULT_TIMEOUT_MS = 250

type PendingJob = {
    request: RegexMatchRequest
    resolve: (outcome: MatchOutcome<never>) => void
}

export class RegexMatchClient {
    private worker: RegexWorkerLike | null = null
    private nextRequestId = 1
    private inflight: { job: PendingJob; timer: ReturnType<typeof setTimeout> } | null = null
    private pending: PendingJob | null = null

    constructor(
        private readonly createWorker: () => RegexWorkerLike,
        private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS
    ) {}

    /** Find every match of source/flags across lines. flags must include 'g'. */
    search(source: string, flags: string, lines: string[]): Promise<MatchOutcome<RegexLineMatch[]>> {
        return this.enqueue('search', source, flags, lines) as Promise<MatchOutcome<RegexLineMatch[]>>
    }

    /** Return the indices of lines matching source/flags. */
    filter(source: string, flags: string, lines: string[]): Promise<MatchOutcome<number[]>> {
        return this.enqueue('filter', source, flags, lines) as Promise<MatchOutcome<number[]>>
    }

    /** Tear down the worker and settle any outstanding jobs. Call on unmount. */
    dispose(): void {
        if (this.inflight) {
            clearTimeout(this.inflight.timer)
            this.inflight.job.resolve({ status: 'timeout' })
            this.inflight = null
        }
        if (this.pending) {
            this.pending.resolve({ status: 'superseded' })
            this.pending = null
        }
        this.killWorker()
    }

    private enqueue(kind: RegexMatchRequest['kind'], source: string, flags: string, lines: string[]): Promise<MatchOutcome<never>> {
        return new Promise<MatchOutcome<never>>((resolve) => {
            const request = { requestId: this.nextRequestId++, kind, source, flags, lines } as RegexMatchRequest
            const job: PendingJob = { request, resolve }
            if (this.inflight) {
                // Latest-wins: a queued-but-not-yet-run waiter is superseded by this newer one.
                if (this.pending) this.pending.resolve({ status: 'superseded' })
                this.pending = job
            } else {
                this.dispatch(job)
            }
        })
    }

    private ensureWorker(): RegexWorkerLike {
        if (this.worker) return this.worker
        const worker = this.createWorker()
        worker.onmessage = (event) => this.onMessage(event.data)
        worker.onerror = () => this.onWorkerFailure()
        this.worker = worker
        return worker
    }

    private dispatch(job: PendingJob): void {
        const worker = this.ensureWorker()
        const timer = setTimeout(() => this.onTimeout(), this.timeoutMs)
        this.inflight = { job, timer }
        worker.postMessage(job.request)
    }

    private onMessage(response: RegexMatchResponse): void {
        // Ignore a response that does not match the in-flight request (e.g. a late reply).
        if (!this.inflight || response.requestId !== this.inflight.job.request.requestId) return
        clearTimeout(this.inflight.timer)
        const { job } = this.inflight
        this.inflight = null
        job.resolve(toOutcome(response))
        this.promotePending()
    }

    private onTimeout(): void {
        // The worker is stuck (or its reply was lost). Hard-kill it so the runaway
        // regex stops, then respawn lazily on the next dispatch.
        const job = this.inflight?.job
        this.killWorker()
        this.inflight = null
        job?.resolve({ status: 'timeout' })
        this.promotePending()
    }

    private onWorkerFailure(): void {
        const job = this.inflight?.job
        if (this.inflight) clearTimeout(this.inflight.timer)
        this.killWorker()
        this.inflight = null
        job?.resolve({ status: 'timeout' })
        this.promotePending()
    }

    private promotePending(): void {
        if (!this.pending) return
        const job = this.pending
        this.pending = null
        this.dispatch(job)
    }

    private killWorker(): void {
        if (!this.worker) return
        try {
            this.worker.terminate()
        } catch {
            // The worker may already be gone; nothing to reclaim.
        }
        this.worker = null
    }
}

function toOutcome(response: RegexMatchResponse): MatchOutcome<never> {
    if (response.status === 'invalid') return { status: 'invalid' }
    if (response.kind === 'search') return { status: 'ok', value: response.matches as never }
    return { status: 'ok', value: response.keptIndices as never }
}

/** Builds a client backed by the real regex-match Web Worker (Vite same-origin module worker). */
export function createRegexMatchClient(timeoutMs?: number): RegexMatchClient {
    return new RegexMatchClient(
        () => new Worker(new URL('../../workers/regexMatch.worker.ts', import.meta.url), { type: 'module' }) as unknown as RegexWorkerLike,
        timeoutMs
    )
}
