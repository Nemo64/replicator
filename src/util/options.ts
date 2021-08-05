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

    require<U>(key: string, schema: JSONSchemaType<U>): U {
        return this.optional(key, schema, () => {
            throw new Error(`option ${JSON.stringify(key)} in ${this.context} is missing.`);
        });
    }

    optional<U>(key: string, schema: JSONSchemaType<U>, defaultValue: (() => U) | U): U {
        if (this.usedKeys.has(key)) {
            console.warn(`Option ${JSON.stringify(key)} in ${this.context} was already used. This is probably an implementation error.`);
        } else {
            this.usedKeys.add(key);
        }

        if (!this.options.hasOwnProperty(key)) {
            if (defaultValue instanceof Function) {
                return defaultValue.call(this);
            } else {
                return defaultValue;
            }
        }

        const validate = ajv.compile(schema);
        validate(this.options[key]);
        if (validate.errors?.length) {
            throw new Error(`option ${JSON.stringify(key)} in ${this.context} is invalid\n${ajv.errorsText(validate.errors)}`);
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
