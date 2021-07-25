export class AsyncMapQueue<K, V> implements AsyncIterableIterator<V> {
    private values = new Map<K, V>();
    private consumers = [] as ((value: IteratorResult<V>) => void)[];

    add(key: K, value: V) {
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
            return Promise.resolve({value: result.value[1]});
        } else {
            return new Promise(resolve => this.consumers.push(resolve));
        }
    }

    [Symbol.asyncIterator](): AsyncIterableIterator<V> {
        return this;
    }
}
