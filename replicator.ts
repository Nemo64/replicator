import {parse as parseArgs} from "https://deno.land/std@0.100.0/flags/mod.ts";
import hash from "https://esm.sh/object-hash@2.2.0";

import {Config, validate} from "./src/config.ts";
import {DriverContext, ViewUpdate} from "./src/driver/driver.d.ts";
import {drivers} from "./src/drivers.ts";
import {parseStructure} from "./src/formatter.ts";
import {PatternObject} from "./src/pattern.ts";
import {permuteMatrix} from "./src/permute.ts";

const {_, configFile} = parseArgs(Deno.args);
if (!configFile) {
    throw new Error("Config file missing.");
}

const configPath = `${Deno.cwd()}/${configFile}`;
const config = JSON.parse(await Deno.readTextFile(configPath)) as Config;
validate({config, drivers});

const configTime = (await Deno.stat(configPath)).mtime ?? new Date;
const driverContext: DriverContext = {
    configPath,
    configTime,
    concurrency: 8, // v8 has up to 8 worker threads
};

interface FormatContext {
    source: PatternObject;
    matrix?: PatternObject;
}

for (const [sourceName, source] of Object.entries(config.sources)) {
    const driver = new drivers[source.type]({...source}, driverContext);
    const views = config.views
        .filter(view => view.source === sourceName)
        .map(view => ({
            target: new drivers[view.target.type]({...view.target}, driverContext),
            matrix: parseStructure(view.matrix) as unknown as (data: FormatContext) => Record<string, PatternObject[]>,
            format: parseStructure(view.format) as unknown as (data: FormatContext) => PatternObject,
        }));

    // TODO parse all views before starting

    const updateIterator = driver.startWatching(change => {
        const updates: Promise<ViewUpdate>[] = [];
        const configChanged = change.prevTime && change.prevTime.getTime() < configTime.getTime();

        for (const view of views) {
            const prevEntriesById = new Map<string, Set<string>>();
            const nextEntriesById = new Map<string, Map<string, PatternObject>>();

            if (change.prevData) {
                for (const mutation of permuteMatrix(view.matrix({source: change.prevData}))) {
                    const context = {source: change.prevData, matrix: mutation};
                    const id = view.target.buildId(context);

                    if (!configChanged) {
                        const entry = view.format(context);
                        if (!prevEntriesById.get(id)?.add(hash(entry))) {
                            prevEntriesById.set(id, new Set([hash(entry)]));
                        }
                    }

                    if (!nextEntriesById.has(id)) {
                        nextEntriesById.set(id, new Map());
                    }
                }
            }

            if (change.nextData) {
                for (const mutation of permuteMatrix(view.matrix({source: change.nextData}))) {
                    const context = {source: change.nextData, matrix: mutation};
                    const id = view.target.buildId(context);
                    const entry = view.format(context);
                    if (!nextEntriesById.get(id)?.set(hash(entry), entry)) {
                        nextEntriesById.set(id, new Map().set(hash(entry), entry));
                    }
                }
            }

            for (const [id, entries] of nextEntriesById.entries()) {
                const prevEntries = prevEntriesById.get(id);
                if (prevEntries && prevEntries.size === entries.size) {
                    if ([...entries.keys()].every(hash => prevEntries.has(hash))) {
                        continue; // skip this update since nothing changed
                    }
                }
                updates.push(view.target.updateEntries(change.sourceId, id, Array.from(entries.values())));
            }
        }

        return Promise.all(updates);
    });

    for await (const update of updateIterator) {
        console.log(
            `process "${update.sourceId}" (${update.kind}) in ${update.duration} ms`,
            update.viewUpdates.map(view => view.viewId),
        );
    }
}
