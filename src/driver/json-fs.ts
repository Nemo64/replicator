import {readFileSync} from "fs";
import {FileHandle} from "fs/promises";
import {dirname, join} from "path";

import addFormats from 'ajv-formats';
import Ajv, {ValidateFunction} from 'ajv';

import {PatternObject} from "../pattern";
import AbstractFs from "./abstract-fs";
import {DriverContext} from "./driver";

const ajv = new Ajv({
    allErrors: true,
    async loadSchema(uri) {
        throw new Error(`load schema ${uri}`);
        console.log('load schema', uri);
        const schema = await (await fetch(uri)).json();
        schema.$id = uri;
        return schema;
    },
});
addFormats(ajv);

interface ViewEntry {
    _source: string
}

export default class JsonFs extends AbstractFs {
    private validator?: Promise<ValidateFunction> | ValidateFunction;
    private readonly schemaPath?: string;

    constructor(options: PatternObject, context: DriverContext) {
        super(options, context);

        if (typeof options.schema === 'string') {
            this.schemaPath = join(dirname(context.configPath), options.schema);
            try {
                const schema = JSON.parse(readFileSync(this.schemaPath, {encoding: 'utf8'}));
                // schema.$id = new URL(this.schemaPath, `file://${context.configPath}`).href;
                this.validator = ajv.compileAsync(schema);
            } catch (e) {
                e.message = `Cannot read schema ${this.schemaPath}: ${e.message}`;
                throw e;
            }
        }
    }

    protected async readSource(reader: FileHandle): Promise<PatternObject> {
        const data = JSON.parse(await reader.readFile({encoding: 'utf8'}));
        await this.validate(data);
        return data;
    }

    protected async updateView(reader: FileHandle | null, writer: FileHandle, entries: PatternObject[], sourceId: string): Promise<boolean> {
        await this.validate(entries);

        let viewEntries: ViewEntry[] = (reader ? JSON.parse(await reader.readFile({encoding: 'utf8'})) : []);
        viewEntries = viewEntries.filter(entry => entry._source !== sourceId); // remove entries from current source
        viewEntries.push(...entries.map(entry => ({_source: sourceId, ...entry})));
        await writer.writeFile(JSON.stringify(viewEntries, null, 4), {encoding: 'utf8'});

        return viewEntries.length > 0;
    }

    private async validate(data: any) {
        if (!this.validator) {
            return;
        }

        if (this.validator instanceof Promise) {
            try {
                this.validator = await this.validator;
            } catch (e) {
                e.message = `JSON Schema: ${this.schemaPath}\n${e.message}`;
                throw e;
            }
        }

        this.validator(data);

        if (this.validator.errors && this.validator.errors.length > 0) {
            const errors = this.validator.errors.map(error => `${error.message} at path ${error.instancePath}`);
            throw new Error(`JSON Schema: ${this.schemaPath}\n- ${errors.join("\n- ")}`);
        }
    }
}
