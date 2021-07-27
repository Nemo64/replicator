import {DriverContext, FormatConstructor, Source, SourceConstructor, Target, TargetConstructor} from "./drivers/types";
import {parseStructure} from "./formatter";
import {PatternObject} from "./pattern";

export interface DriverConfig extends Record<string, any> {
    readonly type: string;
}

export interface Config {
    readonly version: string;
    readonly sources: Record<string, DriverConfig>;
    readonly views: ViewConfig[];
}

interface ViewConfig {
    readonly source: string;
    readonly matrix: Record<string, string | string[]>;
    readonly target: DriverConfig;
    readonly format: PatternObject;
}

interface FormatContext {
    source: PatternObject;
    matrix: PatternObject;
}

export interface ViewMapping {
    target: Target,
    matrix: (data: FormatContext) => Record<string, PatternObject[]>,
    format: (data: FormatContext) => PatternObject,
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

export function parse(config: Config, context: DriverContext): Map<Source, ViewMapping[]> {
    validate(config, context);

    const result = new Map;
    for (const sourceName in config.sources) {
        const source = config.sources[sourceName];
        const sourceDriver = new context.drivers.source[source.type](source, context);
        const viewMappings = config.views.filter(view => view.source === sourceName).map(view => ({
            target: new context.drivers.source[view.target.type](view.target, context),
            matrix: parseStructure(view.matrix) as unknown as (data: FormatContext) => Record<string, PatternObject[]>,
            format: parseStructure(view.format) as unknown as (data: FormatContext) => PatternObject,
        }));

        result.set(sourceDriver, viewMappings);
    }

    return result;
}
