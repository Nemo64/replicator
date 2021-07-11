import {PatternObject} from "../pattern.ts";

export interface SourceChange {
    readonly sourceId: string;
    readonly prevTime: Date | null,
    readonly nextTime: Date | null,
    readonly prevData: PatternObject | null;
    readonly nextData: PatternObject | null;
}

export type SourceChangeHandler = (change: SourceChange) => Promise<ViewUpdate[]>

export interface ViewUpdate {
    readonly viewId: string;
    readonly viewEntries?: number;
    readonly viewSize?: number;
}

export interface Update {
    readonly sourceId: string;
    readonly viewUpdates: ViewUpdate[];
    readonly duration: number;
}

export interface DriverContext {
    readonly configPath: string;
    readonly configTime: Date;
}

export interface Driver {
    /**
     * Generates an id for the given data.
     */
    buildId(data: PatternObject): string;

    /**
     * Start watching the given patterns for changes.
     * The driver must make sure that the old data stays available until the handler's Promise resolves.
     * After that, the handler must make sure that the new data stays available until the next change.
     */
    startWatching(handler: SourceChangeHandler): AsyncIterable<Update>

    /**
     * Updates a view file.
     * View files must always be able to take multiple entries.
     */
    updateEntries(sourceId: string, viewId: string, entries: PatternObject[]): Promise<ViewUpdate>
}

/**
 * List of driver constructors.
 */
export type DriverList = Record<string, new (options: PatternObject, context: DriverContext) => Driver>;
