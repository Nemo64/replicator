import {Driver, DriverContext} from "./driver/driver.d.ts";
import JsonFs from "./driver/json-fs.ts";

export type DriverList = Record<string, new (options: Record<string, string>, context: DriverContext) => Driver>;

export const drivers: DriverList = {
    "json-fs": JsonFs,
};
