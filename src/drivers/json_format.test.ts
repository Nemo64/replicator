import {expect, test} from "@jest/globals";
import {Readable, Writable} from "stream";
import {Options} from "../util/options";
import {JsonFormat} from "./json_format";
import {Event} from "./types";

test(`parse.json`, async () => {
    const stream = Readable.from('{"data": "value"}');
    const jsonFormat = new JsonFormat(new Options({}));
    const event: Event = {type: "insert", sourceId: "test", sourceName: "test", configChanged: false};
    const result = await jsonFormat.readSource(event, stream);
    expect(result).toEqual({data: 'value'});
});

const modifyCases = [
    {
        sourceId: "update.json",
        original: '[{"_source":"existing.json","value":1},{"_source":"update.json","value":2}]',
        expected: '[{"_source":"existing.json","value":1},{"_source":"update.json","value":3}]',
        entries: [{value: 3}],
    },
    {
        sourceId: "create.json",
        original: null,
        expected: '[{"_source":"create.json","value":1}]',
        entries: [{value: 1}],
    },
    {
        sourceId: "delete.json",
        original: '[{"_source":"delete.json","value":1}]',
        expected: '[]',
        entries: [],
    },
];

for (const {sourceId, original, expected, entries} of modifyCases) {
    test(sourceId, async () => {

        const readable = typeof original === 'string'
            ? Readable.from(original)
            : undefined;

        const writable = new Writable();
        writable._write = jest.fn((chunk, encoding, next) => {
            expect(chunk.toString()).toEqual(expected);
            next();
        });

        const event = {type: "update", sourceId, sourceName: 'test'} as Event;
        const update = {event, viewId: '', entries};
        await new JsonFormat(new Options({indention: 0})).updateView(update, writable, readable);
        expect(writable._write).toHaveBeenCalled();
    });
}
