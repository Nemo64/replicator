import {assertEquals} from "https://deno.land/std@0.100.0/testing/asserts.ts";
import {permuteMatrix} from "./permute.ts";

const cases = [
    {
        structure: {
            key1: [1],
        },
        expected: [
            {key1: 1},
        ],
    },
    {
        structure: {
            key1: [1, 2],
        },
        expected: [
            {key1: 1},
            {key1: 2},
        ],
    },
    {
        structure: {
            key1: [1, 2],
            key2: [3, 4, 5],
        },
        expected: [
            {key1: 1, key2: 3},
            {key1: 1, key2: 4},
            {key1: 1, key2: 5},
            {key1: 2, key2: 3},
            {key1: 2, key2: 4},
            {key1: 2, key2: 5},
        ],
    },
    {
        structure: {
            key1: [1, 2],
            key2: [3, 4],
            key3: [5, 6],
        },
        expected: [
            {key1: 1, key2: 3, key3: 5},
            {key1: 1, key2: 3, key3: 6},
            {key1: 1, key2: 4, key3: 5},
            {key1: 1, key2: 4, key3: 6},
            {key1: 2, key2: 3, key3: 5},
            {key1: 2, key2: 3, key3: 6},
            {key1: 2, key2: 4, key3: 5},
            {key1: 2, key2: 4, key3: 6},
        ],
    }
];

for (const {structure, expected} of cases) {
    Deno.test(`permute ${JSON.stringify(structure)}`, () => {
        assertEquals(Array.from(permuteMatrix(structure as Record<string, number[]>)), expected);
    });
}

