import {deferred, delay, MuxAsyncIterator, pooledMap} from "https://deno.land/std@0.100.0/async/mod.ts";
import {expandGlob} from "https://deno.land/std@0.100.0/fs/mod.ts";
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

    protected constructor(options: Record<string, string>, context: DriverContext) {
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
        eventIterator.add(watchFs(pathPattern, 100));
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

        workingFiles[viewPath] = this.writeViewEntries(sourceUri, viewPath, entries as PatternObject[]);
        const result = await workingFiles[viewPath];
        delete workingFiles[viewPath];
        return result;
    }

    /**
     * Reads and parses a source file.
     * This method is used to read the original source file and may be used to read the shadow-copy.
     */
    protected abstract readSourceFile(path: string): Promise<PatternObject>;

    /**
     * Updates a view file with the specified entries.
     */
    protected abstract writeViewEntries(sourceUri: string, viewPath: string, entries: PatternObject[]): Promise<ViewUpdate>;

    /**
     * Converts the given absolute path to an id uri.
     */
    protected pathToUri(path: string): string {
        return path.substr(dirname(this.configPath).length + 1);// FIXME substring is unreliable here
    }
}

interface DelayedFsEvent {
    readonly path: string;
    readonly kind: string;
    readonly time: number;
}

async function* watchFs(pathPattern: string, waitTime: number): AsyncIterable<DelayedFsEvent> {
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
            const {value, done} = events.values().next();
            if (done) {
                await nextEventPromise;
                continue;
            }

            const timePassed = Date.now() - value.time;
            if (waitTime > timePassed) {
                await delay(waitTime - timePassed);
                continue;
            }

            events.delete(value.path);
            yield value;
        }
    } finally {
        // @ts-ignore phpstorm does not know this exists
        watcher.close();
    }
}
