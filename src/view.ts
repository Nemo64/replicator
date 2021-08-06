import * as hash from "object-hash";
import {ViewMapping} from "./config";
import {SourceChange} from "./drivers/types";
import {PatternObject} from "./pattern";
import {MapMap, MapSet} from "./util/map_map";
import {permuteMatrix} from "./util/permute";

export function* generateViews(change: SourceChange, mapping: ViewMapping): Iterable<[string, PatternObject[]]> {
    const prevEntriesByView = new MapSet<string, string>();
    const nextEntriesByView = new MapMap<string, string, PatternObject>();

    if (change.type === 'update' || change.type === 'delete') {
        const matrix = mapping.matrix({source: change.previousData, matrix: {}});
        for (const mutation of matrix ? permuteMatrix(matrix) : [{}]) {
            const context = {source: change.previousData, matrix: mutation};
            const viewId = mapping.target.id(context);

            // ensure an update on the view to delete previous entries
            nextEntriesByView.set(viewId, new Map());

            // compute the old view's hash to avoid unnecessary updates unless:
            // - the change is a delete, in which case everything will be deleted anyways
            // - the change is suspicious, eg. when the configuration has changed
            if (change.type !== 'delete' && !change.suspicious) {
                const entry = mapping.format(context);
                prevEntriesByView.add(viewId, hash(entry));
            }
        }
    }

    if (change.type === 'update' || change.type === 'insert') {
        const matrix = mapping.matrix({source: change.currentData, matrix: {}});
        for (const mutation of matrix ? permuteMatrix(matrix) : [{}]) {
            const context = {source: change.currentData, matrix: mutation};
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
