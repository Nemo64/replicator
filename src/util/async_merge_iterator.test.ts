import {expect, test} from "@jest/globals";
import {AsyncMergeIterator} from "./async_merge_iterator";

async function* iterator(...list: number[]) {
    yield* list;
}

async function flatten<T>(iterator: AsyncIterable<T>) {
    const result = [];
    for await (const item of iterator) {
        result.push(item);
    }
    return result;
}

test(`async merge iterator single`, async () => {
    const generators = [iterator(1, 2)];
    const result = await flatten(new AsyncMergeIterator(generators));
    expect(result).toEqual([1, 2]);
});

test(`async merge iterator dual`, async () => {
    const generators = [iterator(1, 2), iterator(3, 4)];
    const result = await flatten(new AsyncMergeIterator(generators));
    expect(result).toEqual([1, 3, 2, 4]);
});

test(`async merge iterator triple`, async () => {
    const generators = [iterator(1, 2), iterator(3, 4), iterator(5, 6)];
    const result = await flatten(new AsyncMergeIterator(generators));
    expect(result).toEqual([1, 3, 5, 2, 4, 6]);
});

test(`async merge iterator delayed`, async () => {
    const generators = [];

    const done = new Promise(resolve => {
        generators.push((async function* () {
            yield* [1, 2];
            resolve(null);
        })());
    });

    generators.push((async function* () {
        await done;
        yield* [3, 4];
    })());

    const result = await flatten(new AsyncMergeIterator(generators));
    expect(result).toEqual([1, 2, 3, 4]);
});
