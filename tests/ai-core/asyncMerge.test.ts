import { describe, it, expect } from 'vitest'
import { createMergedIterable } from '@ai-core/asyncMerge'

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
    const items: T[] = []
    for await (const item of iterable) items.push(item)
    return items
}

async function* fromArray<T>(items: T[]): AsyncIterable<T> {
    for (const item of items) yield item
}

describe('createMergedIterable', () => {
    it('yields all source items when the queue is never pushed to', async () => {
        const { iterable } = createMergedIterable<string, number>(fromArray(['a', 'b', 'c']))
        const result = await collect(iterable)
        expect(result).toEqual(['a', 'b', 'c'])
    })

    it('items pushed before iteration are yielded alongside source items', async () => {
        const { iterable, queue } = createMergedIterable<string, number>(fromArray(['a', 'b']))
        queue.push(1)
        queue.push(2)
        const result = await collect(iterable)
        // All four items must appear; order between source and queue is not guaranteed.
        expect(result).toHaveLength(4)
        expect(result).toContain('a')
        expect(result).toContain('b')
        expect(result).toContain(1)
        expect(result).toContain(2)
    })

    it('items pushed to the queue after the source finishes are still yielded', async () => {
        // Use a source that resolves asynchronously so we can push after it ends.
        let resolveSource!: () => void
        const sourcePromise = new Promise<void>((resolve) => { resolveSource = resolve })

        async function* slowSource(): AsyncIterable<string> {
            await sourcePromise
            yield 'from-source'
        }

        const { iterable, queue } = createMergedIterable<string, number>(slowSource())

        // Finish the source, then push a queue item before any consumer iteration.
        resolveSource()
        // Push after the source resolves but before the merged iterable drains.
        queue.push(42)

        const result = await collect(iterable)
        expect(result).toContain('from-source')
        expect(result).toContain(42)
    })

    it('an empty source with no queue pushes yields nothing', async () => {
        const { iterable } = createMergedIterable<string, number>(fromArray([]))
        const result = await collect(iterable)
        expect(result).toEqual([])
    })

    it('queue items pushed during async source delays are interleaved', async () => {
        // Source that yields items with a tick of delay between them.
        async function* tickSource(): AsyncIterable<string> {
            yield 'first'
            await Promise.resolve()
            yield 'second'
        }

        const { iterable, queue } = createMergedIterable<string, number>(tickSource())

        // Push a queue item right away; it should appear somewhere in the output.
        queue.push(99)

        const result = await collect(iterable)
        expect(result).toContain('first')
        expect(result).toContain('second')
        expect(result).toContain(99)
        expect(result).toHaveLength(3)
    })

    it('a source that yields one item then throws propagates the error after yielding the item', async () => {
        const boom = new Error('source exploded')

        async function* faultySource(): AsyncIterable<string> {
            yield 'before-error'
            throw boom
        }

        const { iterable } = createMergedIterable<string, never>(faultySource())

        const collected: string[] = []
        // The merged iterable must yield the item before the error and then reject.
        // Using a manual loop so we can observe the yielded item even on error.
        let thrown: unknown
        try {
            for await (const item of iterable) {
                collected.push(item)
            }
        } catch (error) {
            thrown = error
        }

        expect(collected).toEqual(['before-error'])
        expect(thrown).toBe(boom)
    })

    it('a never-ending source has its iterator cancelled when the consumer breaks early', async () => {
        let returnCalled = false

        // A source whose iterator.return() we can observe.
        const neverEndingSource: AsyncIterable<number> = {
            [Symbol.asyncIterator]() {
                let counter = 0
                return {
                    async next() {
                        // Yield an incrementing counter indefinitely.
                        await Promise.resolve()
                        return { value: counter++, done: false as const }
                    },
                    async return() {
                        returnCalled = true
                        return { value: undefined, done: true as const }
                    },
                }
            },
        }

        const { iterable } = createMergedIterable<number, never>(neverEndingSource)

        // Consumer that breaks after the first item.
        for await (const _ of iterable) {
            break
        }

        // Give the drainSource microtask a tick to settle after iterator.return() is called.
        await Promise.resolve()

        expect(returnCalled).toBe(true)
    })
})
