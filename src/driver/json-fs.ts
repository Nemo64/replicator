import {readAll, writeAll} from "https://deno.land/std@0.100.0/io/util.ts";
import {dirname, join} from "https://deno.land/std@0.100.0/path/mod.ts";

import addFormats from 'https://esm.sh/ajv-formats@2.1.0';
import Ajv, {ValidateFunction} from 'https://esm.sh/ajv@8.6.1';

import {PatternObject} from "../pattern.ts";
import AbstractFs from "./abstract-fs.ts";
import {DriverContext} from "./driver.d.ts";

const ajv = new Ajv({allErrors: true});
addFormats(ajv);

interface ViewEntry {
    _source: string
}

export default class JsonFs extends AbstractFs {
    private readonly validator?: ValidateFunction;

    constructor(options: PatternObject, context: DriverContext) {
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

    protected async updateView(sourceUri: string, entries: PatternObject[], reader: Deno.Reader | null, writer: Deno.Writer): Promise<any> {
        let viewEntries: ViewEntry[] = (reader ? JSON.parse(new TextDecoder().decode(await readAll(reader))) : []);

        viewEntries = viewEntries.filter(entry => entry._source !== sourceUri); // remove entries from current source
        viewEntries.push(...entries.map(entry => ({_source: sourceUri, ...entry})));

        await writeAll(writer, new TextEncoder().encode(JSON.stringify(viewEntries, null, 4)));
    }
}
