import {test} from "@jest/globals";
import {Readable, Writable} from "stream";
import {JsonFormat} from "./json_format";
import {SourceEvent} from "./types";

test(`parse json`, async () => {
    const stream = Readable.from('{"data": "value"}');
    const result = await new JsonFormat({}).readSource(stream);
    expect(result).toEqual({data: 'value'});
});

test(`modify view`, async () => {
    const readable = Readable.from('[{"_source":"foobar.json","value":1},{"_source":"barfoo.json","value":2}]');
    const writable = new Writable();
    writable._write = (chunk, encoding, next) => {
        expect(chunk.toString()).toEqual('[{"_source":"foobar.json","value":1},{"_source":"barfoo.json","value":3}]');
        next();
    };

    const event = {type: "change", sourceId: 'barfoo.json', sourceDriver: {} as any} as SourceEvent;
    await new JsonFormat({spaces: 0}).updateView(readable, writable, event, [{value: 3}]);
});
