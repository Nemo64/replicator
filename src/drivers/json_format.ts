import Ajv, {ValidateFunction} from "ajv";
import addFormats from "ajv-formats";
import {join} from "path";
import {Options} from "../util/options";
import {Environment, SourceEvent, SourceFormat, TargetFormat, ViewUpdate} from "./types";

const ajv = new Ajv({allErrors: true});
addFormats(ajv);

export class JsonFormat implements SourceFormat, TargetFormat {
    private readonly indention: number;
    private readonly validator: ValidateFunction | null;
    private readonly schemaPath: string | null;

    constructor(options: Options, context?: Environment) {
        this.indention = options.optional('indention', {type: 'number'}) ?? 2;

        const schemaPath = options.optional('schema', {type: 'string', nullable: true});
        if (schemaPath && context) {
            this.schemaPath = join(context.workingDirectory, schemaPath);
            try {
                this.validator = ajv.compile(require(this.schemaPath));
            } catch (e) {
                e.message = `${this.schemaPath}\n${e.message}`;
                throw e;
            }
        } else {
            this.schemaPath = null;
            this.validator = null;
        }
    }

    async readSource(event: SourceEvent, reader: NodeJS.ReadableStream): Promise<any> {
        const data = await this.read(reader);
        this.validate(data, `${event.sourceId}#`);
        return data;
    }

    async updateView(update: ViewUpdate, writer: NodeJS.WritableStream, reader?: NodeJS.ReadableStream): Promise<number> {
        this.validate(update.entries, `${update.viewId}#`);

        const view = reader ? await this.read(reader) : [];
        if (!Array.isArray(view)) {
            throw new Error(`Sources besides array are not supported.`);
        }

        const result = view
            .filter(entry => entry._source !== update.event.sourceId)
            .concat(update.entries.map(entry => ({_source: update.event.sourceId, ...entry})))
            .sort((a, b) => a._source.localeCompare(b._source));

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

    private validate(data: any, viewId: string) {
        if (!this.validator) {
            return;
        }

        if (!this.validator(data)) {
            throw new Error(`JSON Schema: ${this.schemaPath}\n${ajv.errorsText(this.validator.errors, {
                separator: "\n",
                dataVar: viewId,
            })}`);
        }
    }
}
