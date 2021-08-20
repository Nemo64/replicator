export class AsyncMapQueue<K, V> implements AsyncIterableIterator<V> {
    private values = new Map<K, V>();
    private consumers = [] as ((value: IteratorResult<V>) => void)[];

    /**
     * false = the {@see next} method will block until there is another item
     * true = the {@see next} method will indicate that the iteration is {done: true}
     */
    private ended = false;

    set(key: K, value: V) {
        const consumer = this.consumers.shift();
        if (consumer) {
            consumer({value});
        } else {
            this.values.set(key, value);
        }
    }

    next(): Promise<IteratorResult<V>> {
        const iterator = this.values.entries();
        const result = iterator.next();
        iterator.return?.();

        if (!result.done) {
            this.values.delete(result.value[0]);
            return Promise.resolve({done: false, value: result.value[1]});
        }

        if (this.ended) {
            return Promise.resolve({done: true, value: undefined});
        }

        return new Promise(resolve => this.consumers.push(resolve));
    }

    terminate() {
        this.ended = true;
        for (const consumer of this.consumers) {
            consumer({done: true, value: undefined});
        }
    }

    [Symbol.asyncIterator](): AsyncIterableIterator<V> {
        return this;
    }
}
