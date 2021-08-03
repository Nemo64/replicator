interface Iteration<T> {
    result: IteratorResult<T>;
    promise: Promise<Iteration<T>>;
    iterator: AsyncIterator<T>;
}

/**
 * Allows you to iterate over multiple async iterators at the same time.
 *
 * Adding an async iterator will instantly advance it by using {@see AsyncIterator.next}.
 * Further calls to an iterator will only happen when the result is returned by {@see next}.
 *
 * The result order between iterators is not preserved, only within iterators.
 * If multiple iterators resolve at the same time, the one, that hasn't resolved for the longest time, wins.
 * That way, no iterator can block others from advancing.
 */
export class AsyncMergeIterator<T> implements AsyncIterableIterator<T> {
    private readonly iterations = new Set<Promise<Iteration<T>>>();

    constructor(iterators?: Iterable<AsyncIterator<T> | AsyncIterable<T>>) {
        for (const iterator of iterators ?? []) {
            this.add(iterator);
        }
    }

    /**
     * Adds an iterator.
     * The {@see AsyncIterator.next} method is immediately called.
     * The resulting promise used in the {@see next} {@see Promise.race}.
     */
    add(iterator: AsyncIterator<T> | AsyncIterable<T>) {
        if (!('next' in iterator)) {
            iterator = iterator[Symbol.asyncIterator]();
        }

        // start iteration
        const promise: Promise<Iteration<T>> = iterator.next()
            // Promise.race() does not tell which promise resolved, so store infos for later
            .then(result => ({result, promise, iterator} as Iteration<T>));

        this.iterations.add(promise);
    }

    /**
     * Starts a {@see Promise.race} between all iterators added though {@see add}.
     */
    async next(): Promise<IteratorResult<T>> {
        while (this.iterations.size > 0) {
            const iteration = await Promise.race(this.iterations);
            const alreadyReturned = !this.iterations.delete(iteration.promise);

            if (alreadyReturned) {
                continue;
            }

            if (!iteration.result.done) {
                this.add(iteration.iterator);
                return iteration.result;
            }
        }

        return {
            done: true,
            value: undefined,
        };
    }

    [Symbol.asyncIterator](): AsyncIterableIterator<T> {
        return this;
    }
}
