import {expect, test} from "@jest/globals";
import {MapMap} from "./map_map";

test(`map map add`, async () => {
    const mapmap = new MapMap<string, string, string>();
    mapmap.add('foo', 'bar', 'baz');
    mapmap.add('foo', 'baz', 'bar');
    expect(mapmap.size).toEqual(1);
    expect(mapmap.get('foo')?.size).toEqual(2);
});
