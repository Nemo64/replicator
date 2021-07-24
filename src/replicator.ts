import * as hash from "object-hash";
import {performance} from "perf_hooks";
import {Config} from "./config";
import {ChangeResult, Driver, DriverContext, SourceChange, Update, ViewUpdate} from "./driver/driver";
import {drivers} from "./drivers";
import {parseStructure} from "./formatter";
import {PatternObject} from "./pattern";
import {AsyncMergeIterator} from "./util/async_merge_iterator";
import {MapMap, MapSet} from "./util/map_map";
import {permuteMatrix} from "./util/permute";

interface FormatContext {
    source: PatternObject;
    matrix?: PatternObject;
}

interface SourceViewMapping {
    driver: Driver,
    views: ViewMapping[],
}

interface ViewMapping {
    target: Driver,
    matrix: (data: FormatContext) => Record<string, PatternObject[]>,
    format: (data: FormatContext) => PatternObject,
}

export class Replicator {
    private readonly driverContext: DriverContext;
    private readonly sourceViews: SourceViewMapping[];

    constructor(config: Config, driverContext: DriverContext) {
        this.driverContext = driverContext;
        this.sourceViews = Object.entries(config.sources)
            .map(([sourceName, source]) => ({
                driver: new drivers[source.type](source, driverContext),
                views: config.views.filter(view => view.source === sourceName).map(view => ({
                    target: new drivers[view.target.type](view.target, driverContext),
                    matrix: parseStructure(view.matrix) as unknown as (data: FormatContext) => Record<string, PatternObject[]>,
                    format: parseStructure(view.format) as unknown as (data: FormatContext) => PatternObject,
                })),
            }));
    }

    start(): AsyncIterable<Update> {
        const iterators = this.sourceViews.map(mapping => {
            return mapping.driver.startWatching(change => {
                return this.handleChange(change, mapping);
            });
        });

        return new AsyncMergeIterator(iterators);
    }

    private handleChange(change: SourceChange, mapping: SourceViewMapping): Promise<ChangeResult> {
        const startTime = performance.now();
        const updates: Promise<ViewUpdate>[] = [];
        const configChanged = change.prevTime && change.prevTime.getTime() < this.driverContext.configTime.getTime();

        for (const view of mapping.views) {
            const prevEntriesByView = new MapSet<string, string>();
            const nextEntriesByView = new MapMap<string, string, PatternObject>();

            if (change.prevData) {
                for (const mutation of permuteMatrix(view.matrix({source: change.prevData}))) {
                    const context = {source: change.prevData, matrix: mutation};
                    const viewId = view.target.buildId(context);

                    // ensure an update on the view to delete previous entries
                    nextEntriesByView.set(viewId, new Map());

                    // compute the old view's hash to avoid unnecessary updates
                    if (!configChanged) {
                        const entry = view.format(context);
                        prevEntriesByView.add(viewId, hash(entry));
                    }
                }
            }

            if (change.nextData) {
                for (const mutation of permuteMatrix(view.matrix({source: change.nextData}))) {
                    const context = {source: change.nextData, matrix: mutation};
                    const viewId = view.target.buildId(context);
                    const entry = view.format(context);
                    nextEntriesByView.add(viewId, hash(entry), entry);
                }
            }

            for (const [viewId, nextEntries] of nextEntriesByView) {
                const prevEntries = prevEntriesByView.get(viewId);
                if (prevEntries && prevEntries.size === nextEntries.size) {
                    if ([...nextEntries.keys()].every(hash => prevEntries.has(hash))) {
                        continue; // skip this update since nothing changed
                    }
                }

                const update = view.target.updateEntries(change.sourceId, viewId, Array.from(nextEntries.values()));
                updates.push(update);
            }
        }

        const computeDuration = performance.now() - startTime;
        return Promise.all(updates).then(viewUpdates => ({
            viewUpdates,
            computeDuration,
        }));
    }
}
