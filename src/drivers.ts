import {DriverList} from "./driver/driver";
import JsonFs from "./driver/json-fs";

export const drivers: DriverList = {
    "json-fs": JsonFs,
};
