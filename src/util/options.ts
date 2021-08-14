import Ajv, {JSONSchemaType} from "ajv";
import addFormats from "ajv-formats";

const ajv = new Ajv({allErrors: true});
addFormats(ajv);

export class Options {
    private readonly options: Record<string, any>;
    private readonly usedKeys = new Set<string>();
    private readonly context: string;

    constructor(options: Record<string, any>, context = 'unknown') {
        this.options = options;
        this.context = context;
    }

    // @ts-ignore
    require<U = string>(key: string, schema: JSONSchemaType<U> = {type: 'string'}): U {
        const value = this.optional(key, schema);
        if (value === undefined) {
            throw new Error(`option ${JSON.stringify(key)} in ${this.context} is missing.`);
        }

        return value;
    }

    // @ts-ignore
    optional<U = string>(key: string, schema: JSONSchemaType<U> = {type: 'string'}): U | undefined {
        if (this.usedKeys.has(key)) {
            console.warn(`Option ${JSON.stringify(key)} in ${this.context} was already used. This is probably an implementation error.`);
        } else {
            this.usedKeys.add(key);
        }

        if (!this.options.hasOwnProperty(key)) {
            return undefined;
        }

        const validate = ajv.compile(schema);
        if (!validate(this.options[key])) {
            throw new Error(`option ${JSON.stringify(key)} in ${this.context} is invalid\n${ajv.errorsText(validate.errors, {separator: "\n", dataVar: key})}`);
        }

        return this.options[key];
    }

    warnUnused() {
        const unusedKeys = Object.keys(this.options).filter(key => !this.usedKeys.has(key));
        if (unusedKeys.length > 0) {
            console.warn(`some options in ${this.context} were not used`, unusedKeys);
        }
    }
}
