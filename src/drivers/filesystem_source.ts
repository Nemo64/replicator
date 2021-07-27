import * as chokidar from "chokidar";
import {constants as fs, createReadStream} from "fs";
import {copyFile, stat} from "fs/promises";
import * as globParent from "glob-parent";
import {Stats} from "node:fs";
import {basename, dirname, extname, join, relative} from "path";
import {AsyncMapQueue} from "../util/async_map_queue";
import {ChangeHandler, DriverContext, Format, Source, SourceEvent} from "./types";

export class FilesystemSource implements Source {
    private readonly path: string;
    private readonly root: string;
    private readonly format: Format;

    constructor(options: Record<string, any>, context: DriverContext) {
        if (typeof options.path !== 'string') {
            throw new Error(`Filesystem sources require a path, got ${JSON.stringify(options.path)}`);
        }

        const format = options?.format?.type || extname(options.path);
        if (typeof format !== 'string' || !context.drivers.format.hasOwnProperty(format)) {
            throw new Error(`Format ${JSON.stringify(format)} is unknown`);
        }

        this.path = join(dirname(context.configPath), options.path);
        this.root = globParent(this.path);
        this.format = new context.drivers.format[format](options?.format ?? {}, context);
    }

    watch(): AsyncIterable<SourceEvent> {
        const queue = new AsyncMapQueue<string, SourceEvent>();
        const watcher = chokidar.watch(this.path);
        console.log('now watching', this.path);

        let ready = false;
        watcher.on("ready", () => ready = true);

        watcher.on("add", async (path, stats) => {
            if (!ready && !await this.hasChanged(path, stats)) {
                return;
            }

            queue.add(path, {type: "add", sourceId: this.id(path), sourceDriver: this});
        });

        watcher.on("change", path => {
            queue.add(path, {type: "change", sourceId: this.id(path), sourceDriver: this});
        });

        watcher.on("unlink", path => {
            queue.add(path, {type: "remove", sourceId: this.id(path), sourceDriver: this});
        });

        return queue;
    }

    async process<R>(event: SourceEvent, handler: ChangeHandler<R>): Promise<R> {
        try {
            const sourcePath = join(this.root, event.sourceId);
            const shadowPath = this.shadowPath(sourcePath);

            const [prevData, nextData] = await Promise.all([
                event.type !== 'add' ? this.format.readSource(createReadStream(shadowPath)) : undefined,
                event.type !== 'remove' ? this.format.readSource(createReadStream(sourcePath)) : undefined,
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
        const [prevStat, nextStat] = await Promise.all([
            stat(this.shadowPath(path)).catch(ignoreError('ENOENT')),
            existingStats ?? stat(path).catch(ignoreError('ENOENT')),
        ]);

        return prevStat?.mtime?.getTime() !== nextStat?.mtime?.getTime()
            && prevStat?.size !== nextStat?.size;
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
