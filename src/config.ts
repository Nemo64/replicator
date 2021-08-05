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

export function validate(config: Config, context: DriverContext) {
    const missingSourceNames = config.views
        .map(view => view.source)
        .filter(sourceName => !config.sources.hasOwnProperty(sourceName))
        .filter((sourceName, index, array) => index === array.indexOf(sourceName));
    if (missingSourceNames.length > 0) {
        throw new Error(`The source(s) "${missingSourceNames.join(', ')}" is/are mentioned in views but not declared.`);
    }

    const missingDrivers = Object.values(config.sources)
        .map(source => source.type)
        .filter(type => !context.drivers.source.hasOwnProperty(type))
        .filter((sourceName, index, array) => index === array.indexOf(sourceName));
    if (missingDrivers.length > 0) {
        throw new Error(`The driver(s) "${missingDrivers.join(', ')}" is/are not available.`);
    }
}

export function parse(config: Config, context: DriverContext): Map<string, Mapping> {
    validate(config, context);

    const result = new Map;
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
