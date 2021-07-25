import {SourceEvent} from "./types";

type Entry = any;

export interface Format {
    readSource(reader: NodeJS.ReadableStream): Promise<any>;

    updateView(reader: NodeJS.ReadableStream | void, writer: NodeJS.WritableStream, event: SourceEvent, entries: Entry[]): Promise<number>;
}

export class JsonFormat implements Format {
    async readSource(reader: NodeJS.ReadableStream): Promise<Entry> {
        reader.setEncoding('utf8');

        let string = '';
        for await(const chunk of reader) {
            string += chunk;
        }

        return JSON.parse(string);
    }

    async updateView(reader: NodeJS.ReadableStream | void, writer: NodeJS.WritableStream, event: SourceEvent, entries: Entry[]): Promise<number> {
        const view = reader ? await this.readSource(reader) : [];
        if (!Array.isArray(view)) {
            throw new Error(`Sources besides array are not supported.`);
        }

        const result = view
            .filter(entry => entry._source !== event.sourceId)
            .concat(entries.map(entry => ({_source: event.sourceId, ...entry})));

        return new Promise((resolve, reject) => {
            const string = JSON.stringify(result, null, 2);
            writer.write(string, 'utf8', err => err ? reject(err) : resolve(result.length));
        });
    }
}

export const formats: Record<string, new (options: Record<string, any>) => Format> = {
    'json': JsonFormat,
};
