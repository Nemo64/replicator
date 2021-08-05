import Ajv, {ValidateFunction} from "ajv";
import addFormats from "ajv-formats";
import {readFileSync} from "fs";
import {dirname, join} from "path";
import {Options} from "../util/options";
import {DriverContext, Format, ViewUpdate} from "./types";

export class JsonFormat implements Format {
    private readonly indention: number;
    private readonly validator: ValidateFunction | null;
    private readonly schemaPath: string | null;

    constructor(options: Options, context?: DriverContext) {
        this.indention = options.optional('indention', {type: 'number'}, 2);

        const schemaPath = options.optional('schema', {type: 'string', nullable: true}, null);
        if (schemaPath && context) {
            const ajv = new Ajv({allErrors: true});
            addFormats(ajv);
            this.schemaPath = join(dirname(context.configPath), schemaPath);
            try {
                this.validator = ajv.compile(JSON.parse(readFileSync(this.schemaPath, {encoding: 'utf8'})));
            } catch (e) {
                e.message = `${this.schemaPath}\n${e.message}`;
                throw e;
            }
        } else {
            this.schemaPath = null;
            this.validator = null;
        }
    }

    async readSource(reader: NodeJS.ReadableStream): Promise<any> {
        const data = await this.read(reader);
        this.validate(data);
        return data;
    }

    async updateView(update: ViewUpdate, writer: NodeJS.WritableStream, reader?: NodeJS.ReadableStream): Promise<number> {
        this.validate(update.entries);

        const view = reader ? await this.read(reader) : [];
        if (!Array.isArray(view)) {
            throw new Error(`Sources besides array are not supported.`);
        }

        const result = view
            .filter(entry => entry._source !== update.event.sourceId)
            .concat(update.entries.map(entry => ({_source: update.event.sourceId, ...entry})));

        return new Promise((resolve, reject) => {
            const string = JSON.stringify(result, null, this.indention);
            writer.write(string, 'utf8', err => err ? reject(err) : resolve(result.length));
        });
    }

    private async read(reader: NodeJS.ReadableStream): Promise<any> {
        reader.setEncoding('utf8');

        let string = '';
        for await(const chunk of reader) {
            string += chunk;
        }

        return JSON.parse(string);
    }

    private validate(data: any) {
        if (!this.validator) {
            return;
        }

        this.validator(data);

        if (this.validator.errors && this.validator.errors.length > 0) {
            const errors = this.validator.errors.map(error => `- ${error.instancePath}: ${error.message}`);
            throw new Error(`JSON Schema: ${this.schemaPath}\n${errors.join("\n")}`);
        }
    }
}
