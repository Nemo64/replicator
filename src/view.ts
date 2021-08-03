import * as hash from "object-hash";
import {ViewMapping} from "./config";
import {SourceChange} from "./drivers/types";
import {PatternObject} from "./pattern";
import {MapMap, MapSet} from "./util/map_map";
import {permuteMatrix} from "./util/permute";

export function* generateViews(change: SourceChange, mapping: ViewMapping): Iterable<[string, PatternObject[]]> {
    const prevEntriesByView = new MapSet<string, string>();
    const nextEntriesByView = new MapMap<string, string, PatternObject>();

    if (change.type === 'change' || change.type === 'remove') {
        for (const mutation of permuteMatrix(mapping.matrix({source: change.prevData, matrix: {}}))) {
            const context = {source: change.prevData, matrix: mutation};
            const viewId = mapping.target.id(context);

            // ensure an update on the view to delete previous entries
            nextEntriesByView.set(viewId, new Map());

            // compute the old view's hash to avoid unnecessary updates
            // if (!configChanged) {
            const entry = mapping.format(context);
            prevEntriesByView.add(viewId, hash(entry));
            // }
        }
    }

    if (change.type === 'change' || change.type === 'add') {
        for (const mutation of permuteMatrix(mapping.matrix({source: change.nextData, matrix: {}}))) {
            const context = {source: change.nextData, matrix: mutation};
            const viewId = mapping.target.id(context);
            const entry = mapping.format(context);
            nextEntriesByView.add(viewId, hash(entry), entry);
        }
    }

    for (const [viewId, nextEntries] of nextEntriesByView) {
        const prevEntries = prevEntriesByView.get(viewId);
        if (prevEntries && prevEntries.size === nextEntries.size) {
            const nothingChanged = [...nextEntries.keys()].every(hash => prevEntries.has(hash));
            if (nothingChanged) {
                continue;
            }
        }

        yield [viewId, Array.from(nextEntries.values())];
    }
}
