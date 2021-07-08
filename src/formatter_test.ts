import {assertEquals, assertNotStrictEquals} from "https://deno.land/std@0.100.0/testing/asserts.ts";
import {parseStructure} from "./formatter.ts";

const cases = [
    [
        {key: 'value'},
        {},
        {key: 'value'},
    ],
    [
        {key: 'hello {name}'},
        {name: 'world'},
        {key: 'hello world'},
    ],
    [
        {key: '{list}'},
        {list: [1, 2]},
        {key: [1, 2]},
    ],
    [
        {key: {key: "{list}"}},
        {list: [1, 2]},
        {key: {key: [1, 2]}},
    ],
    [
        {key: ['{list|pick(-1)}', '{list|pick(0)}']},
        {list: [1, 2]},
        {key: [2, 1]},
    ],
];

for (const [structure, data, expected] of cases) {
    Deno.test(`format ${JSON.stringify(structure)}`, () => {
        const result = parseStructure(structure as any)(data as any);
        assertEquals(result, expected);
        assertNotStrictEquals(result, structure);
    });
}

