import {deferred, delay, MuxAsyncIterator, pooledMap} from "https://deno.land/std@0.100.0/async/mod.ts";
import {ensureDir} from "https://deno.land/std@0.100.0/fs/ensure_dir.ts"; // importing fs/mod.ts requires --unstable
import {expandGlob} from "https://deno.land/std@0.100.0/fs/expand_glob.ts"; // importing fs/mod.ts requires --unstable
import {globToRegExp} from "https://deno.land/std@0.100.0/path/glob.ts";
import {basename, dirname, join} from "https://deno.land/std@0.100.0/path/mod.ts";

import {parse, PatternFunction, PatternObject} from "../pattern.ts";
import {Driver, DriverContext, SourceChangeHandler, ViewUpdate} from "./driver.d.ts";

/**
 * This is a list of all files that are currently being written to.
 * This is to reduce the collision overhead within the same process.
 */
const workingFiles: Record<string, Promise<ViewUpdate>> = {};

export default abstract class AbstractFs implements Driver {
    private readonly path: PatternFunction;
    private readonly configPath: string;
    private readonly configTime: Date;

    protected constructor(options: PatternObject, context: DriverContext) {
        if (typeof options.path !== 'string') {
            throw new Error(`options path must be defined`);
        }

        this.path = parse(options.path);
        this.configPath = context.configPath;
        this.configTime = context.configTime;
    }

    rid(data: PatternObject): string {
        return this.path(data) as string;
    }

    start(changeHandler: SourceChangeHandler): AsyncIterable<ViewUpdate[]> {
        const pathPattern = join(dirname(this.configPath), this.rid({}));

        const eventIterator = new MuxAsyncIterator<{ path: string }>();
        eventIterator.add(watchFs(pathPattern));
        eventIterator.add(expandGlob(pathPattern));
        // TODO also check shadow files

        // TODO the pooledMap implementation preserves order which could lead to congestion
        return pooledMap(5, eventIterator, async ({path: nextPath}) => {
            try {
                const shadowPath = `${dirname(nextPath)}/.${basename(nextPath)}~shadow`;

                const [nextStat, prevStat] = await Promise.all([
                    Deno.stat(nextPath),
                    Deno.stat(shadowPath),
                ]);

                if (prevStat.mtime && nextStat.mtime && prevStat.mtime.getTime() >= nextStat.mtime.getTime()) {
                    return [];
                }

                const [nextData, prevData] = await Promise.all([
                    this.readSourceFile(nextPath),
                    this.readSourceFile(shadowPath),
                ]);

                const sourceUri = this.pathToUri(nextPath);
                const viewUpdates = await changeHandler({sourceUri, prevData, nextData});
                await Deno.copyFile(nextPath, shadowPath);
                return viewUpdates;
            } catch (e) {
                console.error(e);
                return [];
            }
        });
    }

    async updateEntries(sourceUri: string, viewUri: string, entries: PatternObject[]): Promise<ViewUpdate> {
        const viewPath = join(dirname(this.configPath), viewUri);
        if (workingFiles[viewPath]) {
            await workingFiles[viewPath].catch(() => {
                // ignore errors from other writes
            });
        }

        workingFiles[viewPath] = this.updateViewFile(viewPath, entries, sourceUri);
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
    protected async updateViewFile(viewPath: string, entries: PatternObject[], sourceUri: string): Promise<ViewUpdate> {
        await ensureDir(dirname(viewPath));
        const tmpViewPath = `${viewPath}~`;
        let tmpViewFile: Deno.File | null = null;
        let viewFile: Deno.File | null = null;

        try {
            tmpViewFile = await openUniqueWriter(tmpViewPath);
            viewFile = await openOptionalReader(viewPath);

            const hasContent = await this.updateView(viewFile, tmpViewFile, entries, sourceUri);
            if (hasContent) {
                await Deno.rename(tmpViewPath, viewPath);
            } else {
                await Deno.remove(viewPath);
                await Deno.remove(tmpViewPath); // delete the lock last
            }
        } catch (e) {
            tmpViewFile && Deno.remove(tmpViewPath);
            throw e;
        } finally {
            tmpViewFile && Deno.close(tmpViewFile.rid);
            viewFile && Deno.close(viewFile.rid);
        }

        const viewUri = this.pathToUri(viewPath);
        return {sourceUri, viewUri};
    }

    /**
     * Parses the content of a source file.
     */
    protected abstract readSource(reader: Deno.Reader): Promise<PatternObject>;

    /**
     * Performs the actual view update.
     */
    protected abstract updateView(reader: Deno.Reader | null, writer: Deno.Writer, entries: PatternObject[], sourceUri: string): Promise<boolean>;

    /**
     * Converts the given absolute path to an id uri.
     */
    private pathToUri(path: string): string {
        return path.substr(dirname(this.configPath).length + 1);// FIXME substring is unreliable here
    }
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
async function openUniqueWriter(path: string, options: Partial<typeof uniqueWriterOptions> = {}): Promise<Deno.File> {
    const resolvedOptions = {...uniqueWriterOptions, ...options} as typeof uniqueWriterOptions;
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

/**
 * Watches the given glob pattern for changes.
 * Events are queued and will be emitted if nothing happened with a file after waitTime.
 */
async function* watchFs(pathPattern: string, options: Partial<typeof watchFsOptions> = {}): AsyncIterable<DelayedFsEvent> {
    const resolvedOptions = {...watchFsOptions, ...options} as typeof watchFsOptions;
    const highestClearPath = pathPattern.replace(/\/[\/]*[*?][\s\S]*$/, '');
    const pathRegExp = globToRegExp(pathPattern);

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
