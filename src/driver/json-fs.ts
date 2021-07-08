import {ensureDir} from "https://deno.land/std@0.100.0/fs/mod.ts";
import {readAll, writeAll} from "https://deno.land/std@0.100.0/io/util.ts";
import {dirname, join} from "https://deno.land/std@0.100.0/path/mod.ts";

import addFormats from 'https://esm.sh/ajv-formats@2.1.0';
import Ajv, {ValidateFunction} from 'https://esm.sh/ajv@8.6.1';

import {PatternObject} from "../pattern.ts";
import AbstractFs from "./abstract-fs.ts";
import {DriverContext, ViewUpdate} from "./driver.d.ts";

const ajv = new Ajv({allErrors: true});
addFormats(ajv);

interface ViewEntry {
    _source: string
}

export default class JsonFs extends AbstractFs {
    private readonly validator?: ValidateFunction;

    constructor(options: Record<string, string>, context: DriverContext) {
        super(options, context);

        if (typeof options.schema === 'string') {
            const schemaPath = join(dirname(context.configPath), options.schema);
            try {
                const schema = JSON.parse(Deno.readTextFileSync(schemaPath));
                this.validator = ajv.compile(schema);
            } catch (e) {
                throw new Error(`Cannot read schema ${schemaPath}: ${e}`);
            }
        }
    }

    protected async readSourceFile(path: string): Promise<PatternObject> {
        const data = JSON.parse(await Deno.readTextFile(path));

        if (this.validator) {
            this.validator(data);
            if (this.validator.errors && this.validator.errors.length > 0) {
                throw new Error(this.validator.errors.map(error => `${error.message} at path ${error.instancePath}`).join("\n"));
            }
        }

        return data;
    }

    protected async writeViewEntries(sourceUri: string, viewPath: string, entries: PatternObject[]): Promise<ViewUpdate> {
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
            viewUri: this.pathToUri(viewPath),
            viewEntries: viewEntries.length,
            viewSize: buffer.byteLength,
        };
    }
}
