import {Format, ViewUpdate} from "./types";

export class JsonFormat implements Format {
    private readonly spaces: number;

    constructor(options: Record<string, any>) {
        this.spaces = typeof options.spaces === 'number' ? options.spaces : 2;
    }

    async readSource(reader: NodeJS.ReadableStream): Promise<any> {
        reader.setEncoding('utf8');

        let string = '';
        for await(const chunk of reader) {
            string += chunk;
        }

        return JSON.parse(string);
    }

    async updateView(update: ViewUpdate, writer: NodeJS.WritableStream, reader?: NodeJS.ReadableStream): Promise<number> {
        const view = reader ? await this.readSource(reader) : [];
        if (!Array.isArray(view)) {
            throw new Error(`Sources besides array are not supported.`);
        }

        const result = view
            .filter(entry => entry._source !== update.event.sourceId)
            .concat(update.entries.map(entry => ({_source: update.event.sourceId, ...entry})));

        return new Promise((resolve, reject) => {
            const string = JSON.stringify(result, null, this.spaces);
            writer.write(string, 'utf8', err => err ? reject(err) : resolve(result.length));
        });
    }
}
