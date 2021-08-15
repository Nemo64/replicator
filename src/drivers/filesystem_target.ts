import {createReadStream, createWriteStream} from "fs";
import {FileHandle, mkdir, open, rename, rm, rmdir, stat} from "fs/promises";
import * as globParent from "glob-parent";
import {basename, dirname, extname, resolve, relative} from "path";
import {parse, PatternFunction} from "../pattern";
import {Options} from "../util/options";
import {loadDriver} from "./loader";
import {Environment, Target, TargetFormat, ViewUpdate} from "./types";

/**
 * This target driver uses the os filesystem.
 *
 * It expects that a single file can be the target of multiple sources.
 * It expects that multiple process might write to the same view at the same time and uses primitive locking.
 * It uses atomic writing (creating a new file and rename it) so it should be robust against interruptions.
 *
 * This driver does uses binary files so it uses a {@see Format}.
 * The default format is determined by the file extension of the path option.
 */
export class FilesystemTarget implements Target {
    private readonly path: PatternFunction;
    private readonly root: string;
    private readonly format: TargetFormat;

    private constructor(path: string, format: TargetFormat) {
        this.root = globParent(path);
        this.path = parse(relative(this.root, path));
        this.format = format;
    }

    /**
     * Create this driver from configuration.
     */
    static async create(options: Options, environment: Environment): Promise<FilesystemTarget> {
        const path = resolve(environment.workingDirectory, options.require('path'));
        const format = options.optional('format') ?? `@nemo64/replicator:${extname(path).slice(1)}`;
        const formatDriver = await loadDriver(format, 'target_format', options, environment);
        return new FilesystemTarget(path, formatDriver);
    }

    id(data: any): string {
        const path = this.path(data);
        if (typeof path !== 'string') {
            throw new Error(`The path pattern generated ${JSON.stringify(path)}, which is not a string`);
        }

        return path;
    }

    async update(update: ViewUpdate): Promise<void> {
        const path = resolve(this.root, update.viewId);
        const tmpPath = `${dirname(path)}/.${basename(path)}~`;

        // TODO, if just 1 succeeds, than this file descriptor won't be explicitly closed (node will do it on gc though)
        const tmpFile = await openExclusive(tmpPath); // open this first to ensure the lock is valid
        const file = await open(path, 'r').catch(ignoreError('ENOENT'));
        const closeFiles = (notice: string) => Promise.all([
            file?.close().catch(e => console.error(`failed to close ${path} ${notice}`, e)),
            tmpFile.close().catch(e => console.error(`failed to close ${tmpPath} ${notice}`, e)),
        ]);

        try {
            const reader = file ? createReadStream(path, {fd: file.fd, autoClose: false}) : undefined;
            const writer = createWriteStream(tmpPath, {fd: tmpFile.fd, autoClose: false});
            const entryCount = await this.format.updateView(update, writer, reader);

            if (entryCount > 0) {
                await new Promise(resolve => writer.end(resolve));
                await tmpFile.datasync();
                await closeFiles('after update');
                await rename(tmpPath, path);
            } else {
                await closeFiles('before delete');
                await rm(path);
                await rm(tmpPath); // must be deleted after the real file, since this is also the write lock
                await deleteEmptyDirs(this.root, path);
            }
        } catch (e) {
            await closeFiles('after failure');
            await rm(tmpPath).catch(e => console.error(`failed to cleanup ${tmpPath}`, e));
            e.message = `Failed to update view ${JSON.stringify(path)} from source ${JSON.stringify(update.event.sourceId)}\n${e.message}`;
            throw e;
        }
    }
}

/**
 * Deletes all directories up to (excluding) the root bath.
 * If the directory isn't empty, then the directory stays.
 */
async function deleteEmptyDirs(root: string, path: string): Promise<boolean> {
    if (!path.startsWith(root)) {
        throw new Error(`The given path ${JSON.stringify(path)} is not within ${JSON.stringify(root)}`);
    }

    try {
        while ((path = dirname(path)).length > root.length) {
            await rmdir(path);
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * Creates a file at the given path in exclusive mode.
 *
 * If the file already exists, then this implementation will wait up to "maxWait" milliseconds for it to be deleted.
 * If this does not happen, then the file will just be opened for write.
 */
async function openExclusive(path: string, maxWait = 60000): Promise<FileHandle> {
    let timeout = Date.now() + maxWait;

    do {
        try {

            return await open(path, 'wx');

        } catch (e) {

            // ErrorNoEntity usually means the directory did not exist so try to create it
            if (e?.code === 'ENOENT') {
                await mkdir(dirname(path), {recursive: true});
                continue;
            }

            // ErrorExists means someone else is writing at this point so retry later
            if (e?.code === 'EEXIST') {
                try {
                    // get the mtime from the existing file and adjust the timeout accordingly.
                    // If the file existed for longer than maxWait, then we can timeout immediately.
                    // If the file gets updated constantly, then it is actively used and we must not open it.
                    const stats = await stat(path);
                    timeout = stats.mtime.getTime() + maxWait;

                    // wait for a somewhat random time to try again
                    await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 100));
                    continue;

                } catch (e) {
                    // The file can disappear between trying to open it and checking it's stats.
                    // In that case just try again immediately (since the file is presumably gone).
                    if (e?.code === 'ENOENT') {
                        continue;
                    } else {
                        e.message = `Failure after attempt to open.\n${e.message}`;
                        throw e;
                    }
                }
            }

            throw e;
        }
    } while (timeout > Date.now());

    // give up, try to open normally and accept errors.
    // this usually just means that the file was stranded from another process.
    return await open(path, 'w');
}

function ignoreError(code: string): (e: NodeJS.ErrnoException) => Promise<void> {
    return e => e?.code === code ? Promise.resolve() : Promise.reject(e);
}
