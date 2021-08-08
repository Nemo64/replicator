#!/usr/bin/env node

import {stat} from "fs/promises";
import {dirname, join} from 'path';
import {cwd} from "process";
import {FilesystemSource} from "./drivers/filesystem_source";
import {FilesystemTarget} from "./drivers/filesystem_target";
import {JsonFormat} from "./drivers/json_format";
import {Environment} from "./drivers/types";
import {processEvent, watchForEvents} from "./index";

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

    const configPath = join(cwd(), configFile);
    const environment: Environment = {
        workingDirectory: dirname(configPath),
        lastConfigChange: (await stat(configPath)).mtime,
        drivers: {
            source: {
                "filesystem": FilesystemSource,
            },
            target: {
                "filesystem": FilesystemTarget,
            },
            format: {
                "json": JsonFormat,
            },
        },
    };

    const events = watchForEvents(require(configPath), environment);
    for await (const event of events) {
        processEvent(event).then(console.log, console.error);
    }
}
