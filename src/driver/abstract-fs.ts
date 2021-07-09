import {deferred, delay, MuxAsyncIterator, pooledMap} from "https://deno.land/std@0.100.0/async/mod.ts";
import {ensureDir, expandGlob} from "https://deno.land/std@0.100.0/fs/mod.ts";
import {globToRegExp} from "https://deno.land/std@0.100.0/path/glob.ts";
import {dirname, join} from "https://deno.land/std@0.100.0/path/mod.ts";

import {parse, PatternFunction, PatternObject} from "../pattern.ts";
import {Driver, DriverContext, SourceChange, ViewUpdate} from "./driver.d.ts";

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

    async* start(): AsyncIterable<SourceChange> {
        const pathPattern = join(dirname(this.configPath), this.generateUri({}));

        const eventIterator = new MuxAsyncIterator<{ path: string }>();
        eventIterator.add(watchFs(pathPattern));
        eventIterator.add(expandGlob(pathPattern));

        const changeIterator = pooledMap(5, eventIterator, async ({path}): Promise<SourceChange> => {
            const sourceUri = this.pathToUri(path);
            try {
                const data = await this.readSourceFile(path);
                return {sourceUri, nextData: data};
            } catch (e) {
                console.error(path, e);
                return {sourceUri};
            }
        });

        for await(const change of changeIterator) {
            if (!change.prevData && !change.nextData) {
                continue;
            }

            yield change;
            // TODO I need to know when processing of the file finished
            // - to prevent the same file from being processed simultaneously
            // - so i know when to update the shadow copy (does not exist yet)
        }
    }

    generateUri(data: PatternObject): string {
        return this.path(data) as string;
    }

    async updateEntries(sourceUri: string, viewUri: string, entries: PatternObject[]): Promise<ViewUpdate> {
        const viewPath = join(dirname(this.configPath), viewUri);
        if (workingFiles[viewPath]) {
            await workingFiles[viewPath].catch(() => {
                // ignore errors from other writes
            });
        }

        workingFiles[viewPath] = this.writeViewFile(sourceUri, viewPath, entries as PatternObject[]);
        try {
            return await workingFiles[viewPath];
        } finally {
            delete workingFiles[viewPath];
        }
    }

    /**
     * Reads and parses a source file.
     * This method is used to read the original source file and may be used to read the shadow-copy.
     */
    protected abstract readSourceFile(path: string): Promise<PatternObject>;

    /**
     * Handles the messy async file opening logic to create a unique write and a reader.
     * Feel free to overwrite this if you have special requirements for your file handling.
     */
    protected async writeViewFile(sourceUri: string, viewPath: string, entries: PatternObject[]): Promise<ViewUpdate> {
        await ensureDir(dirname(viewPath));
        const tmpViewPath = `${viewPath}~`;
        let tmpViewFile: Deno.File | null = null;
        let oldViewFile: Deno.File | null = null;

        try {
            tmpViewFile = await openUniqueWriter(tmpViewPath);
            oldViewFile = await openOptionalReader(viewPath);

            await this.updateView(sourceUri, entries, oldViewFile, tmpViewFile);
            await Deno.rename(tmpViewPath, viewPath);

            const viewUri = this.pathToUri(viewPath);
            return {sourceUri, viewUri};
        } catch (e) {
            // noinspection PointlessBooleanExpressionJS
            if (tmpViewFile !== null) {
                // noinspection ES6MissingAwait
                Deno.remove(tmpViewPath);
            }
            throw e;
        } finally {
            await Promise.all([tmpViewFile, oldViewFile]
                .map(file => file && Deno.close(file.rid)));
        }
    }

    /**
     * Performs the actual view update.
     */
    protected abstract updateView(sourceUri: string, entries: PatternObject[], reader: Deno.Reader | null, writer: Deno.Writer): Promise<any>;

    /**
     * Converts the given absolute path to an id uri.
     */
    protected pathToUri(path: string): string {
        return path.substr(dirname(this.configPath).length + 1);// FIXME substring is unreliable here
    }
}

const uniqueWriterOptions = {
    timeout: 5000,
    retryDelay: 100,
};

/**
 * Creates a writer at the given path.
 * This expects the target to not exist as an alternative to locking files.
 * By convention, name your files with a tilde (~) at the end and then rename it to the target location.
 */
async function openUniqueWriter(path: string, options: Partial<typeof uniqueWriterOptions> = {}): Promise<Deno.File> {
    const resolvedOptions = {...uniqueWriterOptions, ...options} as typeof uniqueWriterOptions;

    while (true) {
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
            if (resolvedOptions.timeout > editTimeAgo) {
                await delay(resolvedOptions.retryDelay);
            } else {
                // file timed out so write over it
                return await Deno.open(path, {write: true, create: true, truncate: true});
            }
        } catch (e) {
            console.warn(`stat of "${path}" failed`, e);
        }
    }
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
