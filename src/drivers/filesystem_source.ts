import * as chokidar from "chokidar";
import {constants as fs, createReadStream} from "fs";
import {copyFile, stat} from "fs/promises";
import * as globParent from "glob-parent";
import {Stats} from "node:fs";
import {basename, dirname, extname, join, relative} from "path";
import {performance} from "perf_hooks";
import {AsyncMapQueue} from "../util/async_map_queue";
import {Options} from "../util/options";
import {ChangeHandler, DriverContext, Format, Source, SourceEvent} from "./types";

/**
 * This source driver uses the os filesystem.
 * It relies on filesystem events for {@see watch}.
 *
 * You need to add a {@see path} to the options which can be any glob pattern accepted by {@see chokidar}.
 *
 * Due to the nature of filesystem events, it is impossible to figure out the previous state of a source file.
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
    private readonly format: Format;

    constructor(options: Options, context: DriverContext) {
        this.name = options.require('name', {type: 'string'});
        this.path = join(dirname(context.configPath), options.require('path', {type: 'string'}));
        this.root = globParent(this.path);

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

        let ready = false;
        watcher.on("ready", () => {
            ready = true;
            console.log('watch ready', this.path, performance.now() - startTime);
        });

        watcher.on("add", async (path, existingStats) => {
            if (ready || await this.hasChanged(path, existingStats)) {
                queue.set(path, {type: "add", sourceId: this.id(path), sourceName: this.name});
            }
        });

        watcher.on("change", path => {
            queue.set(path, {type: "change", sourceId: this.id(path), sourceName: this.name});
        });

        watcher.on("unlink", path => {
            queue.set(path, {type: "remove", sourceId: this.id(path), sourceName: this.name});
        });

        return queue;
    }

    async process<R>(event: SourceEvent, handler: ChangeHandler<R>): Promise<R> {
        try {
            const sourcePath = join(this.root, event.sourceId);
            const shadowPath = this.shadowPath(sourcePath);

            const [prevData, nextData] = await Promise.all([
                event.type !== 'add' && this.format.readSource(createReadStream(shadowPath)),
                event.type !== 'remove' && this.format.readSource(createReadStream(sourcePath)),
            ]);

            const result = handler({...event, prevData, nextData});

            await copyFile(sourcePath, shadowPath, fs.COPYFILE_FICLONE);
            return result;
        } catch (e) {
            e.message = `Failed to process event on ${join(this.root, event.sourceId)}\n${e.message}`;
            throw e;
        }
    }

    private async hasChanged(path: string, existingStats?: Stats): Promise<boolean> {
        const [prevStats, nextStats] = await Promise.all([
            stat(this.shadowPath(path)).catch(ignoreError('ENOENT')),
            existingStats ?? stat(path).catch(ignoreError('ENOENT')),
        ]);

        return prevStats?.mtime?.getTime() !== nextStats?.mtime?.getTime()
            && prevStats?.size !== nextStats?.size;
    }

    private id(path: string): string {
        return relative(this.root, path);
    }

    private shadowPath(path: string): string {
        return `${dirname(path)}/.${basename(path)}.shadow`;
    }
}

function ignoreError(code: string): (e: NodeJS.ErrnoException) => Promise<void> {
    return e => e?.code === code ? Promise.resolve() : Promise.reject(e);
}
