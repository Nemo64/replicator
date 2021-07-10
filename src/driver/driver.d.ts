import {PatternObject} from "../pattern.ts";

export interface SourceChange {
    readonly sourceUri: string;
    readonly prevData: PatternObject | null;
    readonly nextData: PatternObject | null;
}

export type SourceChangeHandler = (change: SourceChange) => Promise<ViewUpdate[]>

export interface ViewUpdate {
    readonly sourceUri: string;
    readonly viewUri: string;
    readonly viewEntries?: number;
    readonly viewSize?: number;
}

export interface DriverContext {
    readonly configPath: string;
    readonly configTime: Date;
}

export interface Driver {
    /**
     * Generates an uri for the given data.
     */
    rid(data: PatternObject): string;

    /**
     * Start watching the given patterns for changes.
     * The driver must make sure that the old data stays available until the handler's Promise resolves.
     * After that, the handler must make sure that the new data stays available until the next change.
     */
    start(handler: SourceChangeHandler): AsyncIterable<ViewUpdate[]>

    /**
     * Updates a view file.
     * View files must always be able to take multiple entries.
     */
    updateEntries(sourceUri: string, viewUri: string, entries: PatternObject[]): Promise<ViewUpdate>
}

/**
 * List of driver constructors.
 */
export type DriverList = Record<string, new (options: PatternObject, context: DriverContext) => Driver>;
