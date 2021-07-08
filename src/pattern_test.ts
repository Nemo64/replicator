import {assertEquals} from "https://deno.land/std@0.100.0/testing/asserts.ts";
import {parse, PatternData} from "./pattern.ts";

const data = {
    person: {
        name: "Max Mustermann",
        firstName: "Max",
        lastName: "Mustermann",
        roles: ['manager', 'user'],
        emails: [
            {value: 'max1@example.com', type: 'private', primary: true},
            {value: 'max2@example.com', type: 'private'},
            {value: 'work@example.com', type: 'work'},
        ],
    },
};

const cases = [
    {
        pattern: "hello world",
        expected: 'hello world',
    },
    {
        pattern: "{person.name}",
        expected: 'Max Mustermann',
    },
    {
        pattern: "{person.roles}",
        expected: ['manager', 'user'],
    },
    {
        pattern: "{person.roles|pick(0)}",
        expected: 'manager',
    },
    {
        pattern: "{person.roles|pick(-1)}",
        expected: 'user',
    },
    {
        pattern: "hello {person.firstName}!",
        expected: 'hello Max!',
    },
    {
        pattern: "{person.emails|map(.value)}",
        expected: ['max1@example.com', 'max2@example.com', 'work@example.com'],
    },
    {
        pattern: "{person.emails|filter(.primary)}",
        expected: [{value: 'max1@example.com', type: 'private', primary: true}],
    },
    {
        pattern: "{person.emails|filter(.type == 'work')|map(.value)}",
        expected: ['work@example.com'],
    },
    {
        pattern: "{person.roles|prepend('person')}",
        expected: ['person', ...data.person.roles],
    },
    {
        pattern: "{person.roles|append('person')}",
        expected: [...data.person.roles, 'person'],
    },
    {
        pattern: "{person.middleName|default('')}",
        expected: '',
    },
    {
        pattern: "{person.middleName}",
        expected: null,
    },
];

for (const {pattern, expected} of cases) {
    Deno.test(`pattern "${pattern}"`, () => {
        assertEquals(parse(pattern)(data as any), expected);
    });
}
