import {createReadStream, createWriteStream} from "fs";
import {FileHandle, mkdir, open, rename, rm, rmdir, stat} from "fs/promises";
import {basename, dirname, extname, join, relative} from "path";
import {parse, PatternFunction, PatternObject} from "../pattern";
import {DriverContext, Format, Target, TargetUpdate} from "./types";
import globParent = require("glob-parent");

export class FilesystemTarget implements Target {
    private readonly path: PatternFunction;
    private readonly root: string;
    private readonly format: Format;

    constructor(options: Record<string, any>, context: DriverContext) {
        if (typeof options.path !== 'string') {
            throw new Error(`Filesystem targets require a path, got ${JSON.stringify(options.path)}`);
        }

        const format = options?.format?.type || extname(options.path);
        if (typeof format !== 'string' || !context.drivers.format.hasOwnProperty(format)) {
            throw new Error(`Format ${JSON.stringify(format)} is unknown`);
        }

        const path = join(dirname(context.configPath), options.path);
        this.root = globParent(path);
        this.path = parse(relative(this.root, path));
        this.format = new context.drivers.format[format](options?.format ?? {}, context);
    }

    id(data: PatternObject): string {
        return this.path(data) as string;
    }

    async update(update: TargetUpdate, entries: PatternObject[]): Promise<void> {
        const path = join(this.root, update.viewId);
        const tmpPath = `${dirname(path)}/${basename(path)}~`;

        const [file, tmpFile] = await Promise.all([
            open(path, 'r').catch(ignoreError('ENOENT')),
            openExclusive(tmpPath),
        ]);

        try {
            const reader = file ? createReadStream(path, {fd: file, autoClose: false}) : undefined;
            const writer = createWriteStream(tmpPath, {fd: tmpFile, autoClose: false});
            const entryCount = await this.format.updateView(reader, writer, update.trigger, entries);
            if (entryCount > 0) {
                await rename(tmpPath, path);
            } else {
                await rm(path);
                await rm(tmpPath);
                await deleteEmptyDirs(this.root, path);
            }
        } catch (e) {
            rm(tmpPath).catch(e => console.error(e));
            throw e;
        } finally {
            file && file.close().catch(e => console.error(e));
            tmpFile.close().catch(e => console.error(e));
        }
    }
}

async function deleteEmptyDirs(root: string, path: string): Promise<boolean> {
    if (!path.startsWith(root)) {
        throw new Error(`The given path ${JSON.stringify(path)} is not within ${JSON.stringify(root)}`);
    }

    try {
        while ((path = dirname(path)).length > root.length) {
            await rmdir(path);
        }
        return true;
    } catch (e) {
        if (e?.code !== 'ENOTEMPTY') {
            throw e;
        }
        return false;
    }
}

async function openExclusive(path: string): Promise<FileHandle> {
    let timeout = Date.now() + 10000;

    while (timeout > Date.now()) {
        try {
            return await open(path, 'wx');
        } catch (e) {

            // ErrorNoEntity means the directory did not exist so try to create it
            if (e?.code === 'ENOENT') {
                await mkdir(dirname(path), {recursive: true});
                continue;
            }

            // ErrorExists means someone else is writing at this point so retry later
            if (e?.code === 'EEXIST') {
                const stats = await stat(path);
                timeout = stats.mtime.getTime() + 10000;
                await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
                continue;
            }

            throw e;
        }
    }

    // give up, try to open normally and accept errors
    return open(path, 'w');
}

function ignoreError(code: string): (e: NodeJS.ErrnoException) => Promise<void> {
    return e => e?.code === code ? Promise.resolve() : Promise.reject(e);
}
