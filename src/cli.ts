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
    const events = watchForEvents(config);
    for await (const event of events) {
        processEvent(config, event)
            .then(update => console.log(`${update.type} of ${update.sourceName} ${green(update.sourceId)} updated in ${update.updateTime.toFixed(2).padStart(8)}ms: ${update.viewIds.map(green).join(', ')}`))
            .catch(console.error);
    }
}

function green(text: string): string {
    return `\x1b[32m${text}\x1b[0m`;
}
