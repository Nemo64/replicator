import {PatternObject} from "../pattern";

export interface SourceChange {
    sourceId: string;
    prevTime: Date | null,
    nextTime: Date | null,
    prevData: PatternObject | null;
    nextData: PatternObject | null;
}

export type SourceChangeHandler = (change: SourceChange) => Promise<ChangeResult>

export interface ChangeResult {
    viewUpdates: ViewUpdate[];
    computeDuration: number;
}

export interface ViewUpdate {
    viewId: string;
    viewEntries?: number;
    viewSize?: number;
}

export interface Update extends ChangeResult {
    type: 'add' | 'change' | 'unlink';
    sourceId: string;
    duration: number;
}

export interface DriverContext {
    configPath: string;
    configTime: Date;
    concurrency: number;
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
export type DriverList = Record<string, new (options: Record<string, any>, context: DriverContext) => Driver>;
