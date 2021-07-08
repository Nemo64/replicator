import {pooledMap} from "https://deno.land/std@0.100.0/async/mod.ts";
import {parse as parseArgs} from "https://deno.land/std@0.100.0/flags/mod.ts";

import {Config, validate} from "./src/config.ts";
import {DriverContext, ViewUpdate} from "./src/driver/driver.d.ts";
import {drivers} from "./src/drivers.ts";
import {parseStructure} from "./src/formatter.ts";
import {PatternData, PatternObject} from "./src/pattern.ts";
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

for (const [sourceName, source] of Object.entries(config.sources)) {
    const driver = new drivers[source.type]({...source}, driverContext);
    const views = config.views
        .filter(view => view.source === sourceName)
        .map(view => ({
            target: new drivers[view.target.type]({...view.target}, driverContext),
            matrix: parseStructure(view.matrix),
            format: parseStructure(view.format),
        }));

    const eventIterator = driver.start();
    const updateIterator = pooledMap(5, eventIterator, change => {
        const updates: Promise<ViewUpdate>[] = [];

        if (!change.nextData) {
            return Promise.resolve([]);
        }

        for (const view of views) {
            const entriesByViewUri = new Map<string, PatternData[]>();

            const matrix = view.matrix({source: change.nextData}) as Record<string, PatternData[]>;
            if (matrix === null || typeof matrix !== 'object' || !Object.values(matrix).every(entry => Array.isArray(entry))) {
                throw new Error(`Any matrix must result in an object of arrays.`);
            }

            for (const mutation of permuteMatrix(matrix)) {
                const context = {source: change.nextData, matrix: mutation};
                const viewUri = view.target.generateUri(context);
                const entry = view.format(context);

                const entries = entriesByViewUri.get(viewUri);
                if (entries) {
                    entries.push(entry);
                } else {
                    entriesByViewUri.set(viewUri, [entry]);
                }
            }

            for (const [viewUri, entries] of entriesByViewUri.entries()) {
                updates.push(view.target.updateEntries(change.sourceUri, viewUri, entries));
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
