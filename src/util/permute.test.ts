import {expect, test} from "@jest/globals";
import {permuteMatrix} from "./permute";

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
    },
];

for (const {structure, expected} of cases) {
    test(`permute ${JSON.stringify(structure)}`, () => {
        expect(Array.from(permuteMatrix(structure as Record<string, number[]>))).toEqual(expected);
    });
}

