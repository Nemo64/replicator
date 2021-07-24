import * as chokidar from "chokidar";
import {constants, Stats} from "fs";
import {copyFile, FileHandle, mkdir, open, rename, rm, stat, utimes} from "fs/promises";
import * as globParent from "glob-parent";
import {basename, dirname, join, relative} from "path";
import {performance} from "perf_hooks";
import {parse, PatternFunction, PatternObject} from "../pattern";
import {ChangeResult, Driver, DriverContext, SourceChangeHandler, Update, ViewUpdate} from "./driver";

// https://nodejs.org/api/errors.html#errors_common_system_errors
const NOT_FOUND = 'ENOENT';
const ALREADY_EXISTS = 'EEXIST';

/**
 * This is a list of all files that are currently being written to.
 * This is to reduce the collision overhead within the same process.
 */
const workingFiles = new Map<string, Promise<ViewUpdate>>();

export default abstract class AbstractFs implements Driver {
    private readonly id: PatternFunction;
    private readonly basePath: string;
    private readonly configTime: Date;
    private readonly concurrency: number;

    protected constructor(options: PatternObject, context: DriverContext) {
        if (typeof options.path !== 'string') {
            throw new Error(`options path must be defined`);
        }

        const configDir = dirname(context.configPath);
        const patternPath = globParent(options.path);

        this.id = parse(options.path.slice(patternPath.length + 1));
        this.basePath = join(configDir, patternPath);
        this.configTime = context.configTime;
        this.concurrency = context.concurrency;
    }

    buildId(data: PatternObject): string {
        return this.id(data) as string;
    }

    async* startWatching(changeHandler: SourceChangeHandler): AsyncIterable<Update> {
        const pathPattern = join(this.basePath, this.buildId({}));

        // TODO add concurrency
        for await(const event of watchFileChanges(pathPattern)) {
            yield this.handleEvent(event, changeHandler);
        }
    }

    async handleEvent({path, type, stats}: FileEvent, changeHandler: SourceChangeHandler): Promise<Update> {
        const eventStart = performance.now();
        const nextPath = path;
        const prevPath = `${dirname(nextPath)}/.${basename(nextPath)}.shadow`;
        const sourceId = relative(this.basePath, nextPath);
        const masterChangeResult = {viewUpdates: [], computeDuration: 0} as ChangeResult;

        try {
            const [nextStat, prevStat] = await Promise.all([
                type === 'unlink' ? null : (stats ?? stat(nextPath)),
                stat(prevPath).catch(e => e?.code === NOT_FOUND ? null : Promise.reject(e)),
            ]);

            const nextTime = nextStat?.mtime ?? null;
            const prevTime = prevStat?.mtime ?? null;
            // @ts-ignore undefined === false comparison
            const fileUntouched = prevTime?.getTime() >= nextTime?.getTime() && prevTime?.getTime() >= this.configTime.getTime();
            if (fileUntouched) {
                const duration = performance.now() - eventStart;
                return {...masterChangeResult, sourceId, type, duration};
            }

            const [nextData, prevData] = await Promise.all([
                nextStat ? this.readSourceFile(nextPath) : null,
                prevStat ? this.readSourceFile(prevPath) : null,
            ]);

            const change = {sourceId, prevData, nextData, prevTime, nextTime};
            const changeResult = await changeHandler(change);
            masterChangeResult.viewUpdates.push(...changeResult.viewUpdates);
            masterChangeResult.computeDuration += changeResult.computeDuration;

            if (nextStat) {
                await copyFile(nextPath, prevPath, constants.COPYFILE_FICLONE);
                // if the next time older than the config file, "touch" the new shadow to mark it as newer
                // @ts-ignore undefined === false comparison
                if (nextTime?.getTime() < this.configTime.getTime()) {
                    await utimes(prevPath, new Date, this.configTime);
                }
            } else if (prevStat) {
                await rm(prevPath);
            }

            const duration = performance.now() - eventStart;
            return {...masterChangeResult, sourceId, type, duration};
        } catch (e) {
            console.error(e);
            const duration = performance.now() - eventStart;
            return {...masterChangeResult, sourceId, type, duration};
        }
    }

    async updateEntries(sourceId: string, viewId: string, entries: PatternObject[]): Promise<ViewUpdate> {
        const viewPath = join(this.basePath, viewId);
        const workingFile = workingFiles.get(viewPath);
        if (workingFile) {
            await workingFile.catch(() => {
                // ignore errors from other writes
            });
        }

        const update = this.updateViewFile(viewPath, entries, sourceId);
        workingFiles.set(viewPath, update);
        try {
            return await update;
        } finally {
            workingFiles.delete(viewPath);
        }
    }

    /**
     * Reads and parses a source file.
     * This method is used to read the original source file and may be used to read the shadow-copy.
     */
    protected async readSourceFile(path: string): Promise<PatternObject | null> {
        try {
            const reader = await openOptionalReader(path);
            if (reader === null) {
                return null;
            }

            const data = await this.readSource(reader);
            await reader.close();
            return data;
        } catch (e) {
            e.message = `File: ${path}\n${e.message}`;
            throw e;
        }
    }

    /**
     * Handles the messy async file opening logic to create a unique write and a reader.
     * Feel free to overwrite this if you have special requirements for your file handling.
     */
    protected async updateViewFile(viewPath: string, entries: PatternObject[], sourceId: string): Promise<ViewUpdate> {
        await mkdir(dirname(viewPath), {recursive: true});
        const tmpViewPath = `${viewPath}~`;
        let tmpViewFile: FileHandle | null = null;
        let viewFile: FileHandle | null = null;

        try {
            tmpViewFile = await openUniqueWriter(tmpViewPath);
            viewFile = await openOptionalReader(viewPath);

            const hasContent = await this.updateView(viewFile, tmpViewFile, entries, sourceId);
            if (hasContent) {
                await rename(tmpViewPath, viewPath);
            } else {
                await rm(viewPath);
                await rm(tmpViewPath); // delete the lock last
            }
        } catch (e) {
            tmpViewFile && await rm(tmpViewPath);
            e.message = `View: ${viewPath}\n${e.message}`;
            throw e;
        } finally {
            tmpViewFile && await tmpViewFile.close();
            viewFile && await viewFile.close();
        }

        return {viewId: relative(this.basePath, viewPath)};
    }

    /**
     * Parses the content of a source file.
     */
    protected abstract readSource(reader: FileHandle): Promise<PatternObject>;

    /**
     * Performs the actual view update.
     */
    protected abstract updateView(reader: FileHandle | null, writer: FileHandle, entries: PatternObject[], sourceId: string): Promise<boolean>;
}

const uniqueWriterOptions = {
    failureTimeout: 30000,
    writeThroughTimeout: 5000,
    retryDelay: 100,
};

/**
 * Creates a writer at the given path.
 * This expects the target to not exist as an alternative to locking files.
 * By convention, name your files with a tilde (~) at the end and then rename it to the target location.
 */
async function openUniqueWriter(path: string, options: Partial<typeof uniqueWriterOptions> = {}): Promise<FileHandle> {
    const resolvedOptions = {...uniqueWriterOptions, ...options} as typeof uniqueWriterOptions;
    const startTime = Date.now();

    do {
        try {
            return await open(path, 'wx');
        } catch (e) {
            if (e?.code !== ALREADY_EXISTS) {
                throw e;
            }
        }

        try {
            const mtime = (await stat(path)).mtime.getTime();
            const editTimeAgo = Date.now() - mtime;
            if (resolvedOptions.writeThroughTimeout > editTimeAgo) {
                await new Promise(resolve => setTimeout(resolve, resolvedOptions.retryDelay, null));
            } else {
                // file timed out so write over it
                return await open(path, 'w');
            }
        } catch (e) {
            console.warn(`stat of "${path}" failed, try again.`, e);
        }

    } while (Date.now() - startTime < resolvedOptions.failureTimeout);

    throw new Error(`Unable to open unique reader on ${path} after ${Date.now() - startTime}ms`);
}

/**
 * Opens a reader and returns null if the target does not exist.
 */
async function openOptionalReader(path: string): Promise<FileHandle | null> {
    try {
        return await open(path, 'r');
    } catch (e) {
        if (e?.code === NOT_FOUND) {
            return null;
        }

        throw e;
    }
}

interface FileEvent {
    type: 'add' | 'change' | 'unlink';
    path: string;
    stats?: Stats;
}

function watchFileChanges(pattern: string): AsyncIterable<FileEvent> {
    const queue = new Map<string, FileEvent>();
    const waiters = [] as ((value: FileEvent) => void)[];

    function add(type: FileEvent["type"], path: FileEvent["path"], stats: FileEvent["stats"]) {
        const event = {type, path, stats};
        const waiter = waiters.shift();
        if (waiter) {
            waiter(event);
        } else {
            queue.delete(path); // remove existing entry so it gets pushed to the end of the queue
            queue.set(path, event);
        }
    }

    const watcher = chokidar.watch(pattern);
    watcher.on('add', add.bind(null, 'add'));
    watcher.on('change', add.bind(null, 'change'));
    watcher.on('unlink', add.bind(null, 'unlink'));

    return {
        [Symbol.asyncIterator]: () => ({
            async next() {
                // noinspection LoopStatementThatDoesntLoopJS
                for (const [path, event] of queue) {
                    queue.delete(path);
                    return {
                        value: event,
                        done: false,
                    };
                }

                return {
                    value: await new Promise(resolve => waiters.push(resolve)),
                    done: false,
                };
            },
        }),
    };
}
