import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RegexMatchClient } from '@renderer/components/terminal/regexMatchClient'
import type { RegexWorkerLike } from '@renderer/components/terminal/regexMatchClient'
import type { RegexMatchRequest, RegexMatchResponse } from '@renderer/workers/regexMatchProtocol'

/** A controllable worker double: records posts, lets the test reply or stay silent (to trip the watchdog). */
class FakeWorker implements RegexWorkerLike {
    onmessage: ((event: MessageEvent<RegexMatchResponse>) => void) | null = null
    onerror: ((event: unknown) => void) | null = null
    posted: RegexMatchRequest[] = []
    terminated = false

    postMessage(message: RegexMatchRequest): void {
        this.posted.push(message)
    }
    terminate(): void {
        this.terminated = true
    }

    /** Deliver a reply for the most recent request. */
    reply(response: Omit<RegexMatchResponse, 'requestId'>): void {
        const last = this.posted[this.posted.length - 1]!
        this.onmessage?.({ data: { ...response, requestId: last.requestId } as RegexMatchResponse } as MessageEvent<RegexMatchResponse>)
    }
}

let workers: FakeWorker[]
let client: RegexMatchClient

beforeEach(() => {
    vi.useFakeTimers()
    workers = []
    client = new RegexMatchClient(() => {
        const worker = new FakeWorker()
        workers.push(worker)
        return worker
    }, 250)
})

afterEach(() => {
    client.dispose()
    vi.useRealTimers()
})

describe('RegexMatchClient', () => {
    it('resolves ok with the matches from the worker', async () => {
        const promise = client.search('ab', 'g', ['abab'])
        workers[0]!.reply({ kind: 'search', status: 'ok', matches: [{ lineIndex: 0, start: 0, end: 2 }] })
        await expect(promise).resolves.toEqual({ status: 'ok', value: [{ lineIndex: 0, start: 0, end: 2 }] })
    })

    it('resolves invalid when the worker reports an uncompilable pattern', async () => {
        const promise = client.search('(', 'g', ['x'])
        workers[0]!.reply({ kind: 'search', status: 'invalid' })
        await expect(promise).resolves.toEqual({ status: 'invalid' })
    })

    it('terminates and respawns the worker when a request exceeds the timeout', async () => {
        const promise = client.search('(a+)+b', 'g', ['aaaaaaaaaaaaaaaaX'])
        // Worker never replies (simulating catastrophic backtracking).
        vi.advanceTimersByTime(250)
        await expect(promise).resolves.toEqual({ status: 'timeout' })
        expect(workers[0]!.terminated).toBe(true)

        // The next request must spin up a fresh worker and work normally.
        const next = client.search('x', 'g', ['x'])
        expect(workers).toHaveLength(2)
        workers[1]!.reply({ kind: 'search', status: 'ok', matches: [{ lineIndex: 0, start: 0, end: 1 }] })
        await expect(next).resolves.toEqual({ status: 'ok', value: [{ lineIndex: 0, start: 0, end: 1 }] })
    })

    it('queues a request behind an in-flight one and supersedes an older waiter (latest-wins)', async () => {
        const first = client.search('a', 'g', ['a']) // in-flight
        const second = client.search('b', 'g', ['b']) // queued
        const third = client.search('c', 'g', ['c']) // supersedes second

        await expect(second).resolves.toEqual({ status: 'superseded' })

        // Only the first request has been dispatched so far.
        expect(workers[0]!.posted).toHaveLength(1)
        workers[0]!.reply({ kind: 'search', status: 'ok', matches: [] })
        await expect(first).resolves.toEqual({ status: 'ok', value: [] })

        // Completing the first promotes the pending third onto the same worker.
        expect(workers[0]!.posted).toHaveLength(2)
        workers[0]!.reply({ kind: 'search', status: 'ok', matches: [{ lineIndex: 0, start: 0, end: 1 }] })
        await expect(third).resolves.toEqual({ status: 'ok', value: [{ lineIndex: 0, start: 0, end: 1 }] })
    })

    it('filter() returns kept indices', async () => {
        const promise = client.filter('err', '', ['ok', 'err'])
        workers[0]!.reply({ kind: 'filter', status: 'ok', keptIndices: [1] })
        await expect(promise).resolves.toEqual({ status: 'ok', value: [1] })
    })

    it('ignores a stale reply whose requestId does not match the in-flight job', async () => {
        const promise = client.search('a', 'g', ['a'])
        // A reply with a mismatched requestId must be dropped, leaving the job pending.
        workers[0]!.onmessage?.({ data: { requestId: 9999, kind: 'search', status: 'ok', matches: [] } } as MessageEvent<RegexMatchResponse>)
        workers[0]!.reply({ kind: 'search', status: 'ok', matches: [{ lineIndex: 0, start: 0, end: 1 }] })
        await expect(promise).resolves.toEqual({ status: 'ok', value: [{ lineIndex: 0, start: 0, end: 1 }] })
    })
})
