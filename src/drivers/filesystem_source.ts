import * as chokidar from "chokidar";
import {constants as fs, createReadStream} from "fs";
import {copyFile, mkdir, rm, stat} from "fs/promises";
import * as globParent from "glob-parent";
import {Stats} from "node:fs";
import {dirname, extname, join, relative} from "path";
import {performance} from "perf_hooks";
import {AsyncMapQueue} from "../util/async_map_queue";
import {Options} from "../util/options";
import {loadDriver} from "./loader";
import {Change, Environment, Event, Source, SourceFormat} from "./types";

/**
 * This source driver uses the os filesystem.
 * It relies on filesystem events for {@see watch}.
 *
 * You need to add a {@see path} to the options which can be any glob pattern accepted by {@see chokidar}.
 *
 * Due to the nature of filesystem events, it is impossible to figure out the previousious state of a source file.
 * To work around this, clones of all source are made during initial processing. (Called shadow copies)
 * If possible, the clone feature of copy-on-write filesystems is used to minimize the filesize overhead.
 * This makes it possible to detect deletions and execute minimal view updates.
 *
 * This driver does uses binary files so it uses a {@see SourceFormat}.
 * The default format is determined by the file extension of the path option.
 */
export class FilesystemSource implements Source {

    private readonly rootDirectory: string;

    private constructor(
        private readonly name: string,
        private readonly path: string,
        private readonly shadowDirectory: string,
        private readonly format: SourceFormat,
        private readonly lastConfigChange: Date,
    ) {
        this.rootDirectory = globParent(this.path);
    }

    /**
     * Create this driver from configuration.
     */
    static async create(options: Options, environment: Environment): Promise<FilesystemSource> {
        const name = options.require('name');
        const path = join(environment.workingDirectory, options.require('path'));
        const format = options.optional('format') ?? `@nemo64/replicator:${extname(path).slice(1)}`;
        const formatDriver = await loadDriver(format, 'source_format', options, environment);
        const shadowDirectory = options.optional('shadow') ?? join(globParent(path), '.shadow');
        return new FilesystemSource(name, path, shadowDirectory, formatDriver, environment.lastConfigChange);
    }

    watch(): AsyncIterable<Event> {
        const queue = new AsyncMapQueue<string, Event>();
        const watcher = chokidar.watch(this.path, {awaitWriteFinish: true});
        const startTime = performance.now();

        console.log('watch start', this.path);
        watcher.on("ready", () => {
            console.log('watch ready', this.path, (performance.now() - startTime).toFixed(2) + 'ms');
        });

        const update = async (path: string, existingStats?: Stats) => {
            const sourceId = this.id(path);
            const sourceName = this.name;
            const [previousStats, currentStats] = await Promise.all([
                stat(this.shadowPath(path)).catch(ignoreError('ENOENT')),
                existingStats ?? stat(path).catch(ignoreError('ENOENT')),
            ]);

            if (previousStats && currentStats) {
                const configChanged = previousStats.mtime.getTime() < this.lastConfigChange.getTime();
                const modified = previousStats.mtime.getTime() < currentStats.mtime.getTime();
                if (modified || configChanged) {
                    queue.set(path, {type: "update", sourceId, sourceName, configChanged});
                }
            } else if (previousStats) {
                const configChanged = previousStats.mtime.getTime() < this.lastConfigChange.getTime();
                queue.set(path, {type: "delete", sourceId, sourceName, configChanged});
            } else if (currentStats) {
                queue.set(path, {type: "insert", sourceId, sourceName, configChanged: false});
            }
        };

        watcher.on("add", update);
        watcher.on("change", update);
        watcher.on("unlink", update);

        return queue;
    }

    async process<R>(event: Event, handler: (change: Change) => Promise<R>): Promise<R> {
        try {
            const sourcePath = join(this.rootDirectory, event.sourceId);
            const shadowPath = this.shadowPath(sourcePath);

            const [previousData, currentData] = await Promise.all([
                event.type !== 'insert' && this.read(event, shadowPath),
                event.type !== 'delete' && this.read(event, sourcePath),
                event.type === 'insert' && mkdir(dirname(shadowPath), {recursive: true}),
            ]);

            const change = {...event, previousData, currentData} as Change;
            const result = handler(change);

            if (event.type === 'delete') {
                await rm(shadowPath).catch(ignoreError('ENOENT'));
            } else {
                await copyFile(sourcePath, shadowPath, fs.COPYFILE_FICLONE);
            }

            return result;
        } catch (e) {
            e.message = `Failed to process event on ${join(this.rootDirectory, event.sourceId)}\n${e.message}`;
            throw e;
        }
    }

    private async read(event: Event, path: string) {
        const reader = createReadStream(path);
        try {
            return await this.format.readSource(event, reader);
        } finally {
            reader.close();
        }
    }

    private id(path: string): string {
        return relative(this.rootDirectory, path);
    }

    private shadowPath(path: string): string {
        return join(this.shadowDirectory, this.id(path));
    }
}

function ignoreError(code: string): (e: NodeJS.ErrnoException) => Promise<void> {
    return e => e?.code === code ? Promise.resolve() : Promise.reject(e);
}
