/**
 * Message contract between the regex-match Web Worker and its renderer-side client.
 *
 * Kept in its own module (types only) so both the worker and the client import the
 * same shapes without the client pulling in the worker module. Requests carry a
 * requestId the client uses to discard stale responses; the worker echoes it back.
 */
import type { RegexLineMatch } from '@shared/regexMatch'

/** A unit of work posted to the worker: match (search highlight) or filter (line indices). */
export type RegexMatchRequest =
    | { requestId: number; kind: 'search'; source: string; flags: string; lines: string[] }
    | { requestId: number; kind: 'filter'; source: string; flags: string; lines: string[] }

/** The worker's reply, echoing requestId and kind, with the result or an invalid-pattern signal. */
export type RegexMatchResponse =
    | { requestId: number; kind: 'search'; status: 'ok'; matches: RegexLineMatch[] }
    | { requestId: number; kind: 'search'; status: 'invalid' }
    | { requestId: number; kind: 'filter'; status: 'ok'; keptIndices: number[] }
    | { requestId: number; kind: 'filter'; status: 'invalid' }
