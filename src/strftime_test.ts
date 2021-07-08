import {assertEquals} from "https://deno.land/std@0.100.0/testing/asserts.ts";
import strftime from "./strftime.ts";

const cases = [
    {
        date: new Date('2021-01-03T06:04:08+00:00'),
        tests: [
            ['%d', '03'],
            ['%e', ' 3'],
            ['%u', '7'],
            ['%w', '0'],
            ['%m', '01'],
            ['%y', '21'],
            ['%Y', '2021'],
            ['%H', '06'],
            ['%k', ' 6'],
            ['%M', '04'],
            ['%R', '06:04'],
            ['%S', '08'],
            ['%T', '06:04:08'],
            ['%X', '06:04:08'],
            ['%z', '+0000'],
            ['%Z', 'UTC'],
        ]
    }
]

for (const {date, tests} of cases) {
    for (const [format, expected] of tests) {
        Deno.test(`strftime ${format}`, () => {
            assertEquals(strftime(date, format), expected);
        });
    }
}
