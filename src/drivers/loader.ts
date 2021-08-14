import {Options} from "../util/options";
import {DriverType, Environment, Initializer, Source, SourceFormat, Target, TargetFormat} from "./types";

export async function loadDriver(name: string, type: 'source', options: Options, context: Environment): Promise<Source>;
export async function loadDriver(name: string, type: 'target', options: Options, context: Environment): Promise<Target>;
export async function loadDriver(name: string, type: 'source_format', options: Options, context: Environment): Promise<SourceFormat>;
export async function loadDriver(name: string, type: 'target_format', options: Options, context: Environment): Promise<TargetFormat>;
export async function loadDriver(name: string, type: DriverType, options: Options, context: Environment): Promise<any> {
    const match = name.match(/^([a-zA-Z][^:]*):(.+)$/)
    if (!match) {
        throw new Error(`Drivers must not be a relative path. Use an absolute path or a package name instead`);
    }

    try {
        const moduleName = match[1] === 'replicator' ? '../index' : match[1];
        const module = await import(moduleName);
        const initializer = module[match[2]] as Initializer;
        return initializer(type, options, context);
    } catch (e) {
        e.message = `Could not load ${type} driver ${name}.\n${e.message}`;
        throw e;
    }
}
