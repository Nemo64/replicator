/**
 * This is the interface for a source driver.
 */
import {Options} from "../util/options";

/**
 * A key describing the driver type.
 * Usually only needed for the {@see Initializer}.
 */
export type DriverType = "source" | "target" | "source_format" | "target_format";

/**
 * A method that creates a driver object.
 * If you build a driver package, you want your main file to export initializers with sensible names.
 *
 * @see filesystem
 * @see json
 */
export type Initializer = (type: DriverType, options: Options, context: Environment) => Promise<Source | Target | SourceFormat | TargetFormat>;

/**
 * This is an event, usually created by {@see Source.watch}.
 * But it is intended that an event can be triggered by other means.
 */
export interface Event {
    readonly type: "insert" | "update" | "delete";
    readonly sourceId: string;
    readonly sourceName: string;
    readonly configChanged: boolean;
}

/**
 * Source driver
 */
export interface Source {
    /**
     * Watch the source for changes.
     */
    watch(): AsyncIterable<Event>;

    /**
     * Process a {@see Event} using the given function.
     * The previous data must stay available as long as the change handler has not resolved.
     */
    process<R>(change: Event, handler: (change: Change) => Promise<R>): Promise<R>;
}

/**
 * Target or View driver
 */
export interface Target {
    /**
     * Create a viewId from the given data.
     * This viewId can be anything that identifies the view resource within this target.
     * Multiple sets of data may have the same id.
     * These sets of data are then grouped during the {@see update}.
     */
    id(data: any): string;

    /**
     * Update the specified viewId with the given entries.
     * It is expected that this update replaces all entries from the same {@see Event.sourceId}.
     */
    update(update: ViewUpdate): Promise<void>;
}

/**
 * This is a format for {@see Source} drivers that store binary data.
 * This is usually json.
 */
export interface SourceFormat {
    /**
     * Parses a stream of the given format.
     *
     * @return any structured format that is appropriate for further processing though the pattern formatter.
     */
    readSource(event: Event, reader: NodeJS.ReadableStream): Promise<any>;
}

/**
 * This is a format for {@see Target} drivers that store binary data.
 * This is usually json.
 */
export interface TargetFormat {
    /**
     * Updates a view blob.
     * If the view already existed, then a reader is passed.
     *
     * It is not required that the Format implements view merging but it is strongly expected.
     * If view merging is suppoted, then it is expected that the read stream is copied over to the write stream,
     * but with all entries from the {@see Event.sourceId} replaced with the given entries.
     *
     * @return {Promise<number>} The number of entries in that view after the update.
     *     If this number is 0, then the view is usually deleted after the update.
     */
    updateView(update: ViewUpdate, writer: NodeJS.WritableStream, reader?: NodeJS.ReadableStream): Promise<number>;
}

/**
 * These are context options that tell drivers a few things about the environment they are in.
 */
export interface Environment {
    readonly workingDirectory: string;
    readonly lastConfigChange: Date;
}

/**
 * This is the actual change information you have during the change processing.
 */
export type Change = InsertChange | DeleteChange | UpdateChange

interface InsertChange extends Event {
    readonly type: "insert";
    readonly currentData: any;
}

interface UpdateChange extends Event {
    readonly type: "update";
    readonly previousData: any;
    readonly currentData: any;
}

interface DeleteChange extends Event {
    readonly type: "delete";
    readonly previousData: any;
}

/**
 * All the information needed to execute a view update.
 */
export interface ViewUpdate {
    readonly viewId: string;
    readonly event: Event;
    readonly entries: any[];
}
