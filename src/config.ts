import Ajv from "ajv";
import {DriverContext, Source, Target} from "./drivers/types";
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

const ajv = new Ajv({allErrors: true});
const schema = require('../schemas/config.json');
const schemaValidate = ajv.compile<Config>(schema);

export function validate(config: any, context: DriverContext): config is Config {
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

    const missingSourceDrivers = Object.values(config.sources)
        .map(source => source.type)
        .filter(type => !context.drivers.source.hasOwnProperty(type))
        .filter((driverType, index, array) => index === array.indexOf(driverType));
    if (missingSourceDrivers.length > 0) {
        throw new Error(`Unknown source drivers: ${missingSourceDrivers.map(v => JSON.stringify(v)).join(', ')}`);
    }

    const missingTargetDrivers = config.views
        .map(view => view.target.type)
        .filter(type => !context.drivers.target.hasOwnProperty(type))
        .filter((driverType, index, array) => index === array.indexOf(driverType));
    if (missingTargetDrivers.length > 0) {
        throw new Error(`Unknown target drivers: ${missingTargetDrivers.map(v => JSON.stringify(v)).join(', ')}`);
    }

    return true;
}

export function parse(config: any, context: DriverContext): Map<string, Mapping> {
    const result = new Map;
    if (!validate(config, context)) {
        return result;
    }

    for (const sourceName in config.sources) {
        const sourceOptions = new Options({name: sourceName, ...config.sources[sourceName]}, `source ${JSON.stringify(sourceName)}`);
        const sourceType: string = sourceOptions.require('type', {type: 'string'});
        const source = new context.drivers.source[sourceType](sourceOptions, context);

        const views = config.views.filter(view => view.source === sourceName).map(view => {
            const targetOptions = new Options(view.target, `view target`);
            const targetType: string = targetOptions.require('type', {type: 'string'});
            const viewMapping: ViewMapping = {
                target: new context.drivers.target[targetType](targetOptions, context),
                matrix: parseStructure(view.matrix) as unknown as (data: FormatContext) => Record<string, PatternObject[]>,
                format: parseStructure(view.format) as unknown as (data: FormatContext) => PatternObject,
            };
            targetOptions.warnUnused();
            return viewMapping;
        });

        sourceOptions.warnUnused();
        result.set(sourceName, {source, views});
    }

    return result;
}
