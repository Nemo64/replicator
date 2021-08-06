import * as chokidar from "chokidar";
import {constants as fs, createReadStream} from "fs";
import {copyFile, mkdir, stat} from "fs/promises";
import * as globParent from "glob-parent";
import {Stats} from "node:fs";
import {basename, dirname, extname, join, relative} from "path";
import {performance} from "perf_hooks";
import {AsyncMapQueue} from "../util/async_map_queue";
import {Options} from "../util/options";
import {ChangeHandler, DriverContext, Format, Source, SourceChange, SourceEvent} from "./types";

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
 * This driver does uses binary files so it uses a {@see Format}.
 * The default format is determined by the file extension of the path option.
 */
export class FilesystemSource implements Source {
    private readonly name: string;
    private readonly path: string;
    private readonly root: string;
    private readonly configPath: string;
    private readonly configTime: Date;
    private readonly format: Format;

    constructor(options: Options, context: DriverContext) {
        this.name = options.require('name', {type: 'string'});
        this.path = join(dirname(context.configPath), options.require('path', {type: 'string'}));
        this.root = globParent(this.path);
        this.configPath = context.configPath;
        this.configTime = context.configTime;

        const format = options.optional('format', {type: 'string'}, () => extname(this.path).slice(1));
        if (!context.drivers.format.hasOwnProperty(format)) {
            throw new Error(`Format ${JSON.stringify(format)} is unknown. You might want to specify the format option explicitly.`);
        }
        this.format = new context.drivers.format[format](options, context);
    }

    watch(): AsyncIterable<SourceEvent> {
        const queue = new AsyncMapQueue<string, SourceEvent>();
        const watcher = chokidar.watch(this.path);
        const startTime = performance.now();
        console.log('watch start', this.path);
        watcher.on("ready", () => {
            console.log('watch ready', this.path, performance.now() - startTime);
        });

        const update = async (path: string, existingStats?: Stats) => {
            const [previousStats, currentStats] = await Promise.all([
                stat(this.shadowPath(path)).catch(ignoreError('ENOENT')),
                existingStats ?? stat(path).catch(ignoreError('ENOENT')),
            ]);

            if (previousStats && currentStats) {
                const suspicious = previousStats.mtime.getTime() < this.configTime.getTime();
                const modified = previousStats.mtime.getTime() < currentStats.mtime.getTime();
                if (modified || suspicious) {
                    queue.set(path, {
                        type: "update",
                        sourceId: this.id(path),
                        sourceName: this.name,
                        suspicious,
                    });
                }
            } else if (previousStats) {
                queue.set(path, {
                    type: "delete",
                    sourceId: this.id(path),
                    sourceName: this.name,
                });
            } else if (currentStats) {
                queue.set(path, {
                    type: "insert",
                    sourceId: this.id(path),
                    sourceName: this.name,
                });
            }
        };

        watcher.on("add", update);
        watcher.on("change", update);
        watcher.on("unlink", update);

        return queue;
    }

    async process<R>(event: SourceEvent, handler: ChangeHandler<R>): Promise<R> {
        try {
            const sourcePath = join(this.root, event.sourceId);
            const shadowPath = this.shadowPath(sourcePath);

            const [previousData, currentData] = await Promise.all([
                event.type !== 'insert' && this.format.readSource(createReadStream(shadowPath)),
                event.type !== 'delete' && this.format.readSource(createReadStream(sourcePath)),
                event.type === 'insert' && mkdir(dirname(shadowPath), {recursive: true}),
            ]);

            const change = {...event, previousData, currentData} as SourceChange;
            const result = handler(change);

            await copyFile(sourcePath, shadowPath, fs.COPYFILE_FICLONE);

            return result;
        } catch (e) {
            e.message = `Failed to process event on ${join(this.root, event.sourceId)}\n${e.message}`;
            throw e;
        }
    }

    private id(path: string): string {
        return relative(this.root, path);
    }

    private shadowPath(path: string): string {
        return `${dirname(this.configPath)}/.shadow/${this.name}/${relative(this.root, path)}`;
    }
}

function ignoreError(code: string): (e: NodeJS.ErrnoException) => Promise<void> {
    return e => e?.code === code ? Promise.resolve() : Promise.reject(e);
}
