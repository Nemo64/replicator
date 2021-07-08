/**
 * The source handler has to perform an update based on a source change.
 */
import {PatternData, PatternObject} from "../pattern.ts";

export interface SourceChange {
    readonly sourceUri: string;
    readonly prevData?: PatternObject;
    readonly nextData?: PatternObject;
}

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
     * Start watching the given patterns for changes.
     * The driver must make sure that the old data stays available until the handler's Promise resolves.
     * After that, the handler must make sure that the new data stays available until the next change.
     */
    start(): AsyncIterable<SourceChange>

    /**
     * Generates an uri for the given data.
     */
    generateUri(data: PatternObject): string;

    /**
     * Updates a view file.
     * View files must always be able to take multiple entries.
     */
    updateEntries(sourceUri: string, viewUri: string, entries: PatternData[]): Promise<ViewUpdate>
}
