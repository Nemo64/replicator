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
    private readonly schemaPath?: string;

    constructor(options: PatternObject, context: DriverContext) {
        super(options, context);

        if (typeof options.schema === 'string') {
            this.schemaPath = join(dirname(context.configPath), options.schema);
            try {
                const schema = JSON.parse(Deno.readTextFileSync(this.schemaPath));
                this.validator = ajv.compile(schema);
            } catch (e) {
                e.message = `Cannot read schema ${this.schemaPath}: ${e.message}`;
                throw e;
            }
        }
    }

    protected async readSource(reader: Deno.Reader): Promise<PatternObject> {
        const data = JSON.parse(new TextDecoder().decode(await readAll(reader)));
        this.validate(data);
        return data;
    }

    protected async updateView(reader: Deno.Reader | null, writer: Deno.Writer, entries: PatternObject[], sourceUri: string): Promise<any> {
        this.validate(entries);

        let viewEntries: ViewEntry[] = (reader ? JSON.parse(new TextDecoder().decode(await readAll(reader))) : []);
        viewEntries = viewEntries.filter(entry => entry._source !== sourceUri); // remove entries from current source
        viewEntries.push(...entries.map(entry => ({_source: sourceUri, ...entry})));
        await writeAll(writer, new TextEncoder().encode(JSON.stringify(viewEntries, null, 4)));
    }

    private validate(data: any) {
        if (!this.validator) {
            return;
        }

        this.validator(data);
        if (this.validator.errors && this.validator.errors.length > 0) {
            const errors = this.validator.errors.map(error => `${error.message} at path ${error.instancePath}`);
            throw new Error(`JSON Schema: ${this.schemaPath}\n- ${errors.join("\n- ")}`);
        }
    }
}
