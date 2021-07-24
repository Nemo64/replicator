import {readFileSync, statSync} from "fs";
import {cwd} from "process";
import {Config, validate} from "./config";
import {DriverContext} from "./driver/driver";
import {drivers} from "./drivers";
import {Replicator} from "./replicator";

const [configFile] = process.argv.slice(2);
if (!configFile) {
    throw new Error("Config file missing.");
}

const configPath = `${cwd()}/${configFile}`;
const driverContext: DriverContext = {
    configPath: configPath,
    configTime: (statSync(configPath)).mtime ?? new Date,
    concurrency: 8, // v8 has up to 8 worker threads
};

const config = JSON.parse(readFileSync(configPath, {encoding: 'utf8'})) as Config;
validate({config, drivers});

const replicator = new Replicator(config, driverContext);
const updateIterator = replicator.start();

(async () => {
    for await (const update of updateIterator) {
        const compute = update.computeDuration.toFixed(2).padStart(6);
        const total = update.duration.toFixed(2).padStart(6);
        console.log(
            `process "${update.sourceId}" (${update.type}) in ${compute} /${total} ms`,
            update.viewUpdates.map(view => view.viewId),
        );
    }
})();
