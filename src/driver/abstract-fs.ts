import {deferred, delay, MuxAsyncIterator, pooledMap} from "https://deno.land/std@0.100.0/async/mod.ts";
import {ensureDir} from "https://deno.land/std@0.100.0/fs/ensure_dir.ts"; // importing fs/mod.ts requires --unstable
import {expandGlob, ExpandGlobOptions} from "https://deno.land/std@0.100.0/fs/expand_glob.ts"; // importing fs/mod.ts requires --unstable
import {GlobOptions, globToRegExp} from "https://deno.land/std@0.100.0/path/glob.ts";
import {basename, dirname, join, relative} from "https://deno.land/std@0.100.0/path/mod.ts";

import {parse, PatternFunction, PatternObject} from "../pattern.ts";
import {Driver, DriverContext, SourceChangeHandler, Update, ViewUpdate} from "./driver.d.ts";

/**
 * This is a list of all files that are currently being written to.
 * This is to reduce the collision overhead within the same process.
 */
const workingFiles: Record<string, Promise<ViewUpdate>> = {};

const globOptions: ExpandGlobOptions = {
    extended: false,
    globstar: false,
    caseInsensitive: false,
    includeDirs: false,
};

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
        const patternPath = pathFromPattern(options.path);

        this.id = parse(options.path.slice(patternPath.length + 1));
        this.basePath = join(configDir, patternPath);
        this.configTime = context.configTime;
        this.concurrency = context.concurrency;
    }

    buildId(data: PatternObject): string {
        return this.id(data) as string;
    }

    startWatching(changeHandler: SourceChangeHandler): AsyncIterable<Update> {
        const pathPattern = join(this.basePath, this.buildId({}));

        const eventIterator = new MuxAsyncIterator<{ path: string }>();
        eventIterator.add(watchFs(pathPattern, globOptions));
        eventIterator.add(expandGlob(pathPattern, globOptions));
        // TODO also check shadow files

        // TODO the pooledMap implementation preserves order which could lead to congestion
        return pooledMap(this.concurrency, eventIterator, async ({path: nextPath, kind = 'scan'}) => {
            const eventStart = performance.now();
            const sourceId = relative(this.basePath, nextPath);
            const viewUpdates = [] as ViewUpdate[];
            try {
                const prevPath = `${dirname(nextPath)}/.${basename(nextPath)}.shadow`;

                const [nextStat, prevStat] = await Promise.all([
                    Deno.stat(nextPath).catch(e => e instanceof Deno.errors.NotFound ? null : Promise.reject(e)),
                    Deno.stat(prevPath).catch(e => e instanceof Deno.errors.NotFound ? null : Promise.reject(e)),
                ]);

                const prevTime = prevStat?.mtime ?? null;
                const nextTime = nextStat?.mtime ?? null;
                // @ts-ignore greater than with undefined is false, which is expected here
                if (prevTime?.getTime() > nextTime?.getTime() && prevTime?.getTime() > this.configTime.getTime()) {
                    const duration = performance.now() - eventStart;
                    return {sourceId, viewUpdates, duration};
                }

                const [nextData, prevData] = await Promise.all([
                    this.readSourceFile(nextPath),
                    this.readSourceFile(prevPath),
                ]);

                viewUpdates.push(...await changeHandler({sourceId, prevData, nextData, prevTime, nextTime}));
                await Deno.copyFile(nextPath, prevPath);

                const duration = performance.now() - eventStart;
                return {sourceId, viewUpdates, duration};
            } catch (e) {
                console.error(e);
                const duration = performance.now() - eventStart;
                return {sourceId, viewUpdates, duration};
            }
        });
    }

    async updateEntries(sourceId: string, viewId: string, entries: PatternObject[]): Promise<ViewUpdate> {
        const viewPath = join(this.basePath, viewId);
        if (workingFiles[viewPath]) {
            await workingFiles[viewPath].catch(() => {
                // ignore errors from other writes
            });
        }

        workingFiles[viewPath] = this.updateViewFile(viewPath, entries, sourceId);
        try {
            return await workingFiles[viewPath];
        } catch (e) {
            e.message = `View: ${viewPath}\n${e.message}`;
            throw e;
        } finally {
            delete workingFiles[viewPath];
        }
    }

    /**
     * Reads and parses a source file.
     * This method is used to read the original source file and may be used to read the shadow-copy.
     */
    protected async readSourceFile(path: string): Promise<PatternObject | null> {
        try {
            const reader = await openOptionalReader(path);
            if (reader !== null) {
                const data = await this.readSource(reader);
                Deno.close(reader.rid);
                return data;
            } else {
                return null;
            }
        } catch (e) {
            if (e instanceof Deno.errors.NotFound) {
                return null;
            } else {
                e.message = `File: ${path}\n${e.message}`;
                throw e;
            }
        }
    }

    /**
     * Handles the messy async file opening logic to create a unique write and a reader.
     * Feel free to overwrite this if you have special requirements for your file handling.
     */
    protected async updateViewFile(viewPath: string, entries: PatternObject[], sourceId: string): Promise<ViewUpdate> {
        await ensureDir(dirname(viewPath));
        const tmpViewPath = `${viewPath}~`;
        let tmpViewFile: Deno.File | null = null;
        let viewFile: Deno.File | null = null;

        try {
            tmpViewFile = await openUniqueWriter(tmpViewPath);
            viewFile = await openOptionalReader(viewPath);

            const hasContent = await this.updateView(viewFile, tmpViewFile, entries, sourceId);
            if (hasContent) {
                await Deno.rename(tmpViewPath, viewPath);
            } else {
                await Deno.remove(viewPath);
                await Deno.remove(tmpViewPath); // delete the lock last
            }
        } catch (e) {
            tmpViewFile && await Deno.remove(tmpViewPath);
            throw e;
        } finally {
            tmpViewFile && Deno.close(tmpViewFile.rid);
            viewFile && Deno.close(viewFile.rid);
        }

        return {viewId: relative(this.basePath, viewPath)};
    }

    /**
     * Parses the content of a source file.
     */
    protected abstract readSource(reader: Deno.Reader): Promise<PatternObject>;

    /**
     * Performs the actual view update.
     */
    protected abstract updateView(reader: Deno.Reader | null, writer: Deno.Writer, entries: PatternObject[], sourceId: string): Promise<boolean>;
}

const uniqueWriterOptions = {
    failureTimeout: 30000,
    writeThroughTimeout: 5000,
    retryDelay: 100,
};

type UniqueWriterOptions = typeof uniqueWriterOptions;

/**
 * Creates a writer at the given path.
 * This expects the target to not exist as an alternative to locking files.
 * By convention, name your files with a tilde (~) at the end and then rename it to the target location.
 */
async function openUniqueWriter(path: string, options: Partial<UniqueWriterOptions> = {}): Promise<Deno.File> {
    const resolvedOptions = {...uniqueWriterOptions, ...options} as UniqueWriterOptions;
    const startTime = Date.now();

    do {
        try {
            return await Deno.open(path, {write: true, createNew: true});
        } catch (e) {
            if (!(e instanceof Deno.errors.AlreadyExists)) {
                throw e;
            }
        }

        try {
            const mtime = (await Deno.stat(path)).mtime?.getTime() ?? 0;
            const editTimeAgo = Date.now() - mtime;
            if (resolvedOptions.writeThroughTimeout > editTimeAgo) {
                await delay(resolvedOptions.retryDelay);
            } else {
                // file timed out so write over it
                return await Deno.open(path, {write: true, create: true, truncate: true});
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
async function openOptionalReader(path: string): Promise<Deno.File | null> {
    try {
        return await Deno.open(path, {read: true});
    } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) {
            throw e;
        }
    }

    return null;
}

/**
 * Extracts a clear path from a pattern.
 * - /some/folder = /some/folder
 * - /some/*.json = /some
 * This method assumes that `extended` and `globstar` are `false`
 *
 * @see https://doc.deno.land/https/deno.land/std@0.100.0/path/glob.ts#globToRegExp
 */
function pathFromPattern(pattern: string): string {
    return pattern.replace(/\/[\/]*[*?{}[\]][\s\S]*$/, '');
}

/**
 * Represents a filesystem event.
 * You usually get this from watchFs.
 */
interface DelayedFsEvent {
    readonly path: string;
    readonly kind: string;
    readonly time: number;
}

const watchFsOptions = {
    waitTime: 100,
};

type WatchFsOptions = typeof watchFsOptions & GlobOptions;

/**
 * Watches the given glob pattern for changes.
 * Events are queued and will be emitted if nothing happened with a file after waitTime.
 */
async function* watchFs(pathPattern: string, options: Partial<WatchFsOptions> = {}): AsyncIterable<DelayedFsEvent> {
    const resolvedOptions = {...watchFsOptions, ...options} as WatchFsOptions;
    const highestClearPath = pathFromPattern(pathPattern);
    const pathRegExp = globToRegExp(pathPattern, resolvedOptions);

    const events = new Map<string, DelayedFsEvent>();
    let nextEventPromise = deferred();

    console.log('watch', highestClearPath, pathPattern);
    const watcher = Deno.watchFs(highestClearPath);
    queueMicrotask(async () => {
        for await (const {kind, paths} of watcher) {
            for (const path of paths) {
                if (!pathRegExp.test(path)) {
                    continue;
                }

                // remove path first so it is appended to the list at the end
                events.delete(path);
                events.set(path, {path, kind, time: Date.now()});

                // resolve next event promise to trigger possible waiters
                nextEventPromise.resolve();
                nextEventPromise = deferred();
            }
        }
    });

    try {
        while (true) {
            const {value: event, done} = events.values().next();
            if (done) {
                await nextEventPromise;
                continue;
            }

            const timePassed = Date.now() - event.time;
            if (resolvedOptions.waitTime > timePassed) {
                await delay(resolvedOptions.waitTime - timePassed);
                continue;
            }

            events.delete(event.path);
            yield event;
        }
    } finally {
        // @ts-ignore phpstorm does not know this exists
        watcher.close();
    }
}
