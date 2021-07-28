import {FilesystemSource} from "./filesystem_source";
import {FilesystemTarget} from "./filesystem_target";
import {JsonFormat} from "./json_format";
import {DriverContext} from "./types";

export const drivers: DriverContext["drivers"] = {
    source: {
        filesystem: FilesystemSource,
    },

    target: {
        filesystem: FilesystemTarget,
    },

    format: {
        json: JsonFormat,
    },
};
