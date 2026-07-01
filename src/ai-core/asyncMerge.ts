/**
 * Portable async merge helper. No Electron, Node, or RokDock imports.
 *
 * Merges a primary AsyncIterable<T> with a side-channel pushable queue of U
 * into a single AsyncIterable<T | U>. Items from the primary iterable and the
 * queue are interleaved as they arrive. After the primary iterable completes,
 * any items already buffered in the queue are yielded before the merged
 * iterable finishes. Items pushed after the merged iterable has ended are
 * silently discarded.
 *
 * Typical use: merge the engine's text-delta stream with MCP tool-activity
 * breadcrumbs pushed by the endpoint session into the same output stream.
 */

/** A queue you push items into from one side and drain from the other. */
export interface AsyncQueue<T> {
    /** Push an item to be yielded by the merged iterable. */
    push(item: T): void
}

/**
 * Create a merged AsyncIterable that interleaves items from `source` and items
 * pushed into the returned queue.
 *
 * The merged iterable ends when `source` is exhausted AND the queue is empty.
 * Items pushed while the source is running are always yielded before the merged
 * iterable finishes. Items pushed after the merged iterable ends are discarded.
 */
export function createMergedIterable<T, U>(source: AsyncIterable<T>): {
    iterable: AsyncIterable<T | U>
    queue: AsyncQueue<U>
} {
    // Shared output buffer: both source items and side-channel items land here.
    // The consumer drains this buffer on each notification.
    const outputBuffer: Array<T | U> = []

    // Notify the consumer that new items are available. The consumer sets this
    // when it is waiting. The producer (source runner or push()) calls it.
    let notifyAvailable: (() => void) | null = null

    // Whether the source has finished (successfully or with an error).
    let sourceDone = false

    // An error thrown by the source mid-stream. Set alongside sourceDone so
    // the consumer can rethrow it after draining whatever the source emitted
    // before the throw, rather than hanging forever on the notify promise.
    let sourceError: unknown = undefined

    // Set to true by the consumer's finally block to tell drainSource to stop
    // pulling from the iterator. This is the cooperative cancellation signal
    // used when the consumer exits early (break/return/throw) before the
    // source finishes. The flag is checked between each iterator.next() call,
    // so at most one in-flight next() completes after the flag is set.
    let cancelled = false

    // Safely wake the consumer if it is waiting.
    function wake(): void {
        if (notifyAvailable) {
            const notify = notifyAvailable
            notifyAvailable = null
            notify()
        }
    }

    const queue: AsyncQueue<U> = {
        push(item: U): void {
            outputBuffer.push(item)
            wake()
        },
    }

    async function* merged(): AsyncIterable<T | U> {
        // Obtain an explicit iterator so we can call iterator.return() to signal
        // cancellation to the source when the consumer exits early. This is
        // important for sources that hold open resources (e.g. network connections).
        const iterator = source[Symbol.asyncIterator]()

        // Drive the source in a concurrent microtask that feeds into outputBuffer.
        // On any throw, capture the error and always mark the source done so the
        // consumer is woken and never blocks on the notify promise forever.
        // The cancelled flag lets the consumer short-circuit this loop without
        // waiting for a long-running or infinite source to end naturally.
        const drainSource = (async () => {
            try {
                while (!cancelled) {
                    const result = await iterator.next()
                    if (result.done || cancelled) break
                    outputBuffer.push(result.value)
                    wake()
                }
            } catch (error) {
                if (!cancelled) {
                    sourceError = error
                }
            } finally {
                sourceDone = true
                wake()
            }
        })()

        try {
            // Consumer loop: wait for items, drain the buffer, stop when the source
            // is done and the buffer is empty.
            while (true) {
                while (outputBuffer.length > 0) {
                    yield outputBuffer.shift()!
                }
                if (sourceDone) {
                    // The inner drain above already emptied the buffer in this tick,
                    // so no second drain is needed. Propagate any source error last
                    // so callers receive everything the source emitted before throwing.
                    if (sourceError !== undefined) throw sourceError
                    return
                }
                // Wait for the next push or source item.
                await new Promise<void>((resolve) => { notifyAvailable = resolve })
            }
        } finally {
            // Signal the drain loop to stop pulling from the source. This is the
            // primary cancellation mechanism when the consumer exits early.
            cancelled = true
            // Also invoke iterator.return() so the source can release its resources
            // (close file handles, abort fetches, etc.). The pending next() call may
            // still complete one more time before the loop observes cancelled, which
            // is acceptable. The item is discarded rather than re-enqueued.
            await iterator.return?.()
            await drainSource
        }
    }

    return { iterable: merged(), queue }
}
