import {deferred, delay, MuxAsyncIterator, pooledMap} from "https://deno.land/std@0.100.0/async/mod.ts";
import {ensureDir, expandGlob} from "https://deno.land/std@0.100.0/fs/mod.ts";
import {readAll, writeAll} from "https://deno.land/std@0.100.0/io/util.ts";
import {globToRegExp} from "https://deno.land/std@0.100.0/path/glob.ts";
import {dirname, join} from "https://deno.land/std@0.100.0/path/mod.ts";

import addFormats from 'https://esm.sh/ajv-formats@2.1.0';
import Ajv, {ValidateFunction} from 'https://esm.sh/ajv@8.6.1';

import {parse, PatternData, PatternFunction, PatternObject} from "../pattern.ts";
import {Driver, DriverContext, SourceChange, ViewUpdate} from "./driver.d.ts";

const ajv = new Ajv({allErrors: true});
addFormats(ajv);

interface ViewEntry {
    _source: string
}

/**
 * This is a list of all files that are currently being written to.
 * This is to reduce the collision overhead within the same process.
 */
const workingFiles: Record<string, Promise<ViewUpdate>> = {};

export default class JsonFs implements Driver {
    private readonly path: PatternFunction;
    private readonly configPath: string;
    private readonly configTime: Date;
    private readonly validator?: ValidateFunction;

    constructor(options: Record<string, string>, context: DriverContext) {
        if (typeof options.path !== 'string') {
            throw new Error(`options path must be defined`);
        }

        this.path = parse(options.path);
        this.configPath = context.configPath;
        this.configTime = context.configTime;

        if (typeof options.schema === 'string') {
            const schemaPath = join(dirname(this.configPath), options.schema);
            try {
                const schema = JSON.parse(Deno.readTextFileSync(schemaPath));
                this.validator = ajv.compile(schema);
            } catch (e) {
                throw new Error(`Cannot read schema ${schemaPath}: ${e}`);
            }
        }
    }

    async* start(): AsyncIterable<SourceChange> {
        const pathPattern = join(dirname(this.configPath), this.generateUri({}));

        const eventIterator = new MuxAsyncIterator<{ path: string }>();
        eventIterator.add(watchFs(pathPattern, 100));
        eventIterator.add(expandGlob(pathPattern));

        const changeIterator = pooledMap(5, eventIterator, ({path}) => this.readChange(path));
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

    async updateEntries(sourceUri: string, viewUri: string, entries: PatternData[]): Promise<ViewUpdate> {
        const badEntries = entries.filter(entry => entry === null || typeof entry !== 'object');
        if (badEntries.length > 0) {
            throw new Error(`json-fs only supports object entries, got \n${badEntries.map(item => JSON.stringify(item)).join("\n")}`);
        }

        const viewPath = join(dirname(this.configPath), viewUri);
        if (workingFiles[viewPath]) {
            await workingFiles[viewPath].catch(() => {
                // ignore errors from other writes
            });
        }

        workingFiles[viewPath] = this._updateEntries(sourceUri, viewPath, entries as PatternObject[]);
        const result = await workingFiles[viewPath];
        delete workingFiles[viewPath];
        return result;
    }

    private async readChange(path: string): Promise<SourceChange> {
        try {
            const data = JSON.parse(await Deno.readTextFile(path));
            if (this.validator) {
                this.validator(data);
                if (this.validator.errors && this.validator.errors.length > 0) {
                    throw new Error(this.validator.errors.map(error => `${error.message} at path ${error.instancePath}`).join("\n"));
                }
            }

            return {
                sourceUri: this.pathToSourceUri(path),
                //prevData: null,
                nextData: data,
            };
        } catch (e) {
            console.error(path, e);
            return {
                sourceUri: this.pathToSourceUri(path),
            };
        }
    }

    private pathToSourceUri(path: string): string {
        return path.substr(dirname(this.configPath).length + 1);// FIXME substring is unreliable here
    }

    private async _updateEntries(sourceUri: string, viewPath: string, entries: PatternObject[]): Promise<ViewUpdate> {
        await ensureDir(dirname(viewPath));
        // TODO create file besides this one to avoid write conflict
        const file = await Deno.open(viewPath, {read: true, write: true, create: true});

        let viewEntries: ViewEntry[] = [];

        // read old content
        const oldContent = await readAll(file);
        if (oldContent.length > 0) {
            viewEntries = (JSON.parse(new TextDecoder().decode(oldContent)) as ViewEntry[])
                .filter(entry => entry._source !== sourceUri);
        }

        // prepare new output
        viewEntries.push(...entries.map(entry => ({_source: sourceUri, ...entry})));
        const buffer = new TextEncoder().encode(JSON.stringify(viewEntries, null, 4));

        await Deno.ftruncate(file.rid);
        await Deno.seek(file.rid, 0, Deno.SeekMode.Start);
        await writeAll(file, buffer);
        await Deno.fdatasync(file.rid);
        await Deno.close(file.rid);
        return {
            sourceUri: sourceUri,
            viewUri: this.pathToSourceUri(viewPath),
            viewEntries: viewEntries.length,
            viewSize: buffer.byteLength,
        };
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
        watcher.close();
    }
}
