import {readFileSync, statSync} from "fs";
import {performance} from "perf_hooks";
import {cwd} from "process";
import {Config, Environment, parse} from "./config";
import {sourceDrivers, targetDrivers} from "./drivers/list";
import {SourceEvent} from "./drivers/types";
import {AsyncMergeIterator} from "./util/async_merge_iterator";
import {generateViews} from "./view";

const [configFile] = process.argv.slice(2);
if (!configFile) {
    throw new Error("Config file missing.");
}

const configPath = `${cwd()}/${configFile}`;
const environment: Environment = {
    configPath: configPath,
    configTime: (statSync(configPath)).mtime,
    sourceDrivers,
    targetDrivers,
};

const config = parse(JSON.parse(readFileSync(configPath, {encoding: 'utf8'})) as Config, environment);
const events = new AsyncMergeIterator<SourceEvent>();

for (const source of config.keys()) {
    events.add(source.watch());
}

(async () => {
    for await (const event of events) {
        const mappings = config.get(event.sourceDriver) ?? [];
        const update = await event.sourceDriver.process(event, async change => {
            const updates = [];
            const viewIds = [];
            const startTime = performance.now();

            for (const mapping of mappings) {
                for (const [viewId, entries] of generateViews(change, mapping)) {
                    updates.push(mapping.target.update({viewId, trigger: change}, entries));
                    viewIds.push(viewId);
                }
            }

            const processTime = performance.now() - startTime;
            await Promise.all(updates);
            const updateTime = performance.now() - startTime - processTime;

            return {...event, viewIds, processTime, updateTime};
        });

        console.log(update);
    }
})().catch(e => {
    console.error(e);
    process.exit(1);
});
