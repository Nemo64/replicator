import {FilesystemSource} from "./filesystem_source";
import {FilesystemTarget} from "./filesystem_target";
import {SourceConstructor, TargetConstructor} from "./types";

export const sourceDrivers: Record<string, SourceConstructor> = {
    filesystem: FilesystemSource,
};

export const targetDrivers: Record<string, TargetConstructor> = {
    filesystem: FilesystemTarget,
};
