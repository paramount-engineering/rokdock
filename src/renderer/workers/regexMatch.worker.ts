/**
 * Regex-match Web Worker.
 *
 * Runs the pure matchers from @shared/regexMatch on its own thread so a
 * catastrophic-backtracking user pattern hangs THIS worker (which the client
 * terminates on a watchdog timeout) instead of freezing the renderer main thread.
 * Stateless: each request carries its own lines, so a terminate + respawn needs no
 * reseed. The worker only knows @shared/regexMatch and the message protocol.
 */
import { findSearchMatches, filterMatchingLineIndices } from '@shared/regexMatch'
import type { RegexMatchRequest, RegexMatchResponse } from './regexMatchProtocol'

// self is the DedicatedWorkerGlobalScope; the DOM Worker type exposes the
// onmessage/postMessage members we need without pulling in the webworker lib.
const workerScope = self as unknown as Worker

function handle(request: RegexMatchRequest): RegexMatchResponse {
    if (request.kind === 'search') {
        const result = findSearchMatches(request.source, request.flags, request.lines)
        return result.status === 'ok'
            ? { requestId: request.requestId, kind: 'search', status: 'ok', matches: result.matches }
            : { requestId: request.requestId, kind: 'search', status: 'invalid' }
    }
    const result = filterMatchingLineIndices(request.source, request.flags, request.lines)
    return result.status === 'ok'
        ? { requestId: request.requestId, kind: 'filter', status: 'ok', keptIndices: result.keptIndices }
        : { requestId: request.requestId, kind: 'filter', status: 'invalid' }
}

workerScope.onmessage = (event: MessageEvent<RegexMatchRequest>) => {
    workerScope.postMessage(handle(event.data))
}
