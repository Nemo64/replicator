import {DriverList} from "./driver/driver";
import {PatternObject} from "./pattern";

export interface Config {
    readonly version: string;
    readonly sources: Record<string, DriverConfig>;
    readonly views: ViewConfig[];
}

export interface ViewConfig {
    readonly source: string;
    readonly matrix: Record<string, string | string[]>;
    readonly target: DriverConfig;
    readonly format: PatternObject
}

export interface DriverConfig {
    readonly type: string;
}

export interface ValidatorConfig {
    config: Config,
    drivers: DriverList,
}

export function validate({config, drivers}: ValidatorConfig) {
    const missingSourceNames = config.views
        .map(view => view.source)
        .filter(sourceName => !(sourceName in config.sources))
        .filter((sourceName, index, array) => index === array.indexOf(sourceName));
    if (missingSourceNames.length > 0) {
        throw new Error(`The source(s) "${missingSourceNames.join(', ')}" is/are mentioned in views but not declared.`);
    }

    const missingDrivers = Object.values(config.sources)
        .map(source => source.type)
        .filter(type => !(type in drivers))
        .filter((sourceName, index, array) => index === array.indexOf(sourceName));
    if (missingDrivers.length > 0) {
        throw new Error(`The driver(s) "${missingDrivers.join(', ')}" is/are not available.`);
    }
}
