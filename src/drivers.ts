import {DriverList} from "./driver/driver.d.ts";
import JsonFs from "./driver/json-fs.ts";

export const drivers: DriverList = {
    "json-fs": JsonFs,
};
