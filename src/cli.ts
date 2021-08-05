#!/usr/bin/env node

import {readFileSync, statSync} from "fs";
import {join} from 'path';
import {performance} from "perf_hooks";
import {cwd} from "process";
import {Config, parse} from "./config";
import {drivers} from "./drivers/lists";
import {DriverContext, SourceEvent} from "./drivers/types";
import {AsyncMergeIterator} from "./util/async_merge_iterator";
import {generateViews} from "./view";

execute(process.argv.slice(2))
    .then(() => {
        process.exit(0);
    })
    .catch(e => {
        console.error(e);
        process.exit(1);
    });

export async function execute(args: string[]) {
    const [configFile] = args;
    if (!configFile) {
        throw new Error("Config file option missing.");
    }

    const configPath = join(cwd(), configFile);
    const environment: DriverContext = {
        configPath: configPath,
        configTime: (statSync(configPath)).mtime,
        drivers,
    };

    // const config = parse(JSON.parse(readFileSync(configPath, {encoding: 'utf8'})) as Config, environment);
    const config = parse(require(configPath), environment);
    const eventIterator = new AsyncMergeIterator<SourceEvent>();

    for (const {source} of config.values()) {
        eventIterator.add(source.watch());
    }

    for await (const event of eventIterator) {
        const mapping = config.get(event.sourceName);
        if (!mapping) {
            console.error(`there is no source named ${event.sourceName}`);
            continue;
        }

        try {
            const update = await mapping.source.process(event, async change => {
                const updates = [];
                const viewIds = [];
                const startTime = performance.now();

                for (const viewMapping of mapping.views) {
                    for (const [viewId, entries] of generateViews(change, viewMapping)) {
                        updates.push(viewMapping.target.update({viewId, event, entries}));
                        viewIds.push(viewId);
                    }
                }

                const processTime = performance.now() - startTime;
                await Promise.all(updates);
                const updateTime = performance.now() - startTime - processTime;

                return {...event, viewIds, processTime, updateTime};
            });
            console.log(update);
        } catch (e) {
            console.error(e);
        }
    }
}
