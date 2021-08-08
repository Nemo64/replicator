import {performance} from "perf_hooks";
import {Config, Mapping, parse} from "./config";
import {Environment, SourceEvent} from "./drivers/types";
import {AsyncMergeIterator} from "./util/async_merge_iterator";
import {generateViews} from "./view";

/**
 * This method takes a configuration and watches for events.
 *
 * @param config
 * @param environment
 */
export async function* watchForEvents(config: any | Config, environment: Environment): AsyncIterable<Event> {
    const mappings = parse(config, environment);
    const eventIterator = new AsyncMergeIterator<SourceEvent>();

    for (const {source} of mappings.values()) {
        eventIterator.add(source.watch());
    }

    for await (const event of eventIterator) {
        const mapping = mappings.get(event.sourceName);
        if (!mapping) {
            throw new Error(`there is no source named ${event.sourceName}`);
        }

        yield {event, mapping};
    }
}

export function processEvent({event, mapping}: Event): Promise<Update> {
    return mapping.source.process(event, async change => {
        const updates = [];
        const viewIds = [];
        const startTime = performance.now();

        for (const viewMapping of mapping.views) {
            for (const [viewId, entries] of generateViews(change, viewMapping)) {
                updates.push(viewMapping.target.update({viewId, event, entries}));
                viewIds.push(viewId);
            }
        }

        const processTime = performance.now() - startTime;
        await Promise.all(updates);
        const updateTime = performance.now() - startTime - processTime;

        return {...event, viewIds, processTime, updateTime};
    });
}

export interface Event {
    readonly event: SourceEvent;
    readonly mapping: Mapping;
}

export interface Update extends SourceEvent {
    readonly viewIds: string[];
    readonly processTime: number;
    readonly updateTime: number;
}

export {Environment};
