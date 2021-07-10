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
const driverContext: DriverContext = {configPath, configTime};

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

    const updateIterator = driver.start(change => {
        const updates: Promise<ViewUpdate>[] = [];

        if (!change.nextData) {
            return Promise.resolve([]);
        }

        for (const view of views) {
            const prevEntriesByRID = new Map<string, Set<string>>();
            const nextEntriesByRID = new Map<string, Map<string, PatternObject>>();

            if (change.prevData) {
                for (const mutation of permuteMatrix(view.matrix({source: change.prevData}))) {
                    const context = {source: change.prevData, matrix: mutation};
                    const rid = view.target.rid(context);
                    const entry = view.format(context);
                    if (!prevEntriesByRID.get(rid)?.add(hash(entry))) {
                        prevEntriesByRID.set(rid, new Set([hash(entry)]));
                    }
                    if (!nextEntriesByRID.has(rid)) {
                        nextEntriesByRID.set(rid, new Map());
                    }
                }
            }

            if (change.nextData) {
                for (const mutation of permuteMatrix(view.matrix({source: change.nextData}))) {
                    const context = {source: change.nextData, matrix: mutation};
                    const rid = view.target.rid(context);
                    const entry = view.format(context);
                    if (!nextEntriesByRID.get(rid)?.set(hash(entry), entry)) {
                        nextEntriesByRID.set(rid, new Map().set(hash(entry), entry));
                    }
                }
            }

            for (const [rid, entries] of nextEntriesByRID.entries()) {
                const prevEntries = prevEntriesByRID.get(rid);
                if (prevEntries && prevEntries.size === entries.size) {
                    if ([...entries.keys()].every(key => prevEntries.has(key))) {
                        continue; // skip this update since nothing changed
                    }
                }
                updates.push(view.target.updateEntries(change.sourceUri, rid, Array.from(entries.values())));
            }
        }

        return Promise.all(updates);
    });

    for await (const updates of updateIterator) {
        console.log(
            'updated',
            updates.map(update => update.sourceUri).filter((uri, index, list) => index === list.indexOf(uri)),
            updates.map(update => update.viewUri).filter((uri, index, list) => index === list.indexOf(uri)),
        );
    }
}
