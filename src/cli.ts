#!/usr/bin/env node

import {parseConfiguration, processEvent, watchForEvents} from "./index";

execute(process.argv)
    .then(() => {
        process.exit(0);
    })
    .catch(e => {
        console.error(e);
        process.exit(1);
    });

async function execute(argv: string[]) {
    const [process, script, configFile] = argv;
    if (!configFile) {
        throw `No config file given.\nUsage: node ${script} [configFile]`;
    }

    const config = await parseConfiguration(configFile);
    for await (const event of watchForEvents(config)) {
        processEvent(config, event)
            .then(({sourceId, sourceName, type, updateTime, viewIds}) => {
                console.log(`${type} of ${sourceName} ${green(sourceId)} updated in ${updateTime.toFixed(2).padStart(8)}ms: ${viewIds.map(green).join(', ')}`);
            })
            .catch(console.error);
    }
}

function green(text: string): string {
    return `\x1b[32m${text}\x1b[0m`;
}
