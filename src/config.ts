import Ajv from "ajv";
import {loadDriver} from "./drivers/loader";
import {Environment, Source, Target} from "./drivers/types";
import {parseStructure} from "./formatter";
import {PatternObject} from "./pattern";
import {Options} from "./util/options";

interface FormatContext {
    readonly source: PatternObject;
    readonly matrix: PatternObject;
}

export interface Config {
    readonly version: string;
    readonly sources: Record<string, { type: string, [index: string]: any }>;
    readonly views: ViewConfig[];
}

export interface ViewConfig {
    readonly source: string;
    readonly matrix: Record<string, string | string[]>;
    readonly target: { type: string, [index: string]: any };
    readonly format: PatternObject;
}

export interface Mapping {
    readonly source: Source;
    readonly views: ViewMapping[];
}

export interface ViewMapping {
    readonly target: Target,
    readonly matrix: (data: FormatContext) => Record<string, PatternObject[]>,
    readonly format: (data: FormatContext) => PatternObject,
}

export type Mappings = Map<string, Mapping>;

const ajv = new Ajv({allErrors: true});
const schema = require('../schemas/config.json');
const schemaValidate = ajv.compile<Config>(schema);

export function validate(config: any, context: Environment): config is Config {
    if (!schemaValidate(config)) {
        throw new Error(ajv.errorsText(schemaValidate.errors, {dataVar: 'configuration', separator: "\n"}));
    }

    const missingSourceNames = config.views
        .map(view => view.source)
        .filter(sourceName => !config.sources.hasOwnProperty(sourceName))
        .filter((sourceName, index, array) => index === array.indexOf(sourceName));
    if (missingSourceNames.length > 0) {
        throw new Error(`Undefined sources: ${missingSourceNames.map(v => JSON.stringify(v)).join(', ')}`);
    }

    return true;
}

export async function parse(config: any, context: Environment): Promise<Mappings> {
    if (!validate(config, context)) {
        return new Map;
    }

    const result = [] as Promise<[string, Mapping]>[];

    for (const sourceName in config.sources) {
        const sourceOptions = new Options({name: sourceName, ...config.sources[sourceName]}, `source ${JSON.stringify(sourceName)}`);
        const sourceType = sourceOptions.require('type');
        const sourcePromise = loadDriver(sourceType, 'source', sourceOptions, context);

        const viewPromises = config.views
            .filter(view => view.source === sourceName)
            .map(async view => {
                const targetOptions = new Options(view.target, `view target`);
                const targetType = targetOptions.require('type');
                const viewMapping: ViewMapping = {
                    target: await loadDriver(targetType, 'target', targetOptions, context),
                    matrix: parseStructure(view.matrix) as unknown as (data: FormatContext) => Record<string, PatternObject[]>,
                    format: parseStructure(view.format) as unknown as (data: FormatContext) => PatternObject,
                };
                targetOptions.warnUnused();
                return viewMapping;
            });

        result.push((async () => {
            const mapping: Mapping = {
                source: await sourcePromise,
                views: await Promise.all(viewPromises),
            };
            sourceOptions.warnUnused();
            return [sourceName, mapping] as [string, Mapping];
        })());
    }

    return new Map(await Promise.all(result));
}
