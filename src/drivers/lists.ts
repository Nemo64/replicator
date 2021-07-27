import {Environment} from "../config";
import {FilesystemSource} from "./filesystem_source";
import {FilesystemTarget} from "./filesystem_target";
import {JsonFormat} from "./json_format";

export const drivers: Environment["drivers"] = {
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
