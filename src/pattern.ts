// @ts-ignore import not detected by php storm
import moo from "https://esm.sh/moo@0.5.1";
import strftime from "./strftime.ts";

export type PatternData = string | number | boolean | null | PatternData[] | PatternObject;
// deno-lint-ignore no-empty-interface https://stackoverflow.com/a/45999529/1973256
export interface PatternObject extends Record<string | number, PatternData> {}

export type PatternFunction = (data: PatternObject, ...args: PatternFunction[]) => PatternData;

const filters: Record<string, PatternFunction> = {
    default(data, arg: PatternFunction) {
        return data[''] ?? arg(data);
    },
    prepend(data, ...args: PatternFunction[]) {
        const list = Array.isArray(data['']) ? data[''] : [];
        return [...args.map(arg => arg(data)), ...list];
    },
    append(data, ...args: PatternFunction[]) {
        const list = Array.isArray(data['']) ? data[''] : [];
        return [...list, ...args.map(arg => arg(data))];
    },
    filter(data, arg: PatternFunction) {
        return Array.isArray(data['']) ? data[''].filter((item: PatternData) => arg({...data, '': item})) : null;
    },
    map(data, arg: PatternFunction) {
        return Array.isArray(data['']) ? data[''].map((item: PatternData) => arg({...data, '': item})) : null;
    },
    pick(data, arg: PatternFunction) {
        const list = data[''];
        if (list === null || typeof list !== 'object') {
            return null;
        }

        let index = arg ? arg(data) : 0;
        if (typeof index === 'number' && index < 0 && Array.isArray(list)) {
            index = list.length + index;
        }

        if (typeof index !== 'number' && typeof index !== 'string') {
            return null;
        }

        // @ts-ignore i don't know what the issue here is
        return list[index] ?? null;
    },
    strftime(data, format: PatternFunction) {
        const formatStr = format(data);
        if (typeof formatStr !== 'string') {
            throw new Error(`The format is not string, got ${JSON.stringify(formatStr)}`);
        }

        if (typeof data[''] !== 'number' && typeof data[''] !== 'string') {
            return null;
        }

        return strftime(new Date(data['']), formatStr);
    }
};

const patternLexer = moo.states({
    main: {
        literal: /[^|\n{}(),]+/,
        placeholder: {match: '{', push: 'placeholder'},
    },
    placeholder: {
        path: {match: /[a-zA-Z_.][\w.]*/},
        filter: {match: '|', push: 'filter'},
        compare: {match: ['==', '>=', '<=', '<>', '!=']},
        string: {match: /'[^']*'/},
        number: {match: /[+-]?(?:\d+(?:\.\d+)?|\.\d+)/},
        space: {match: /\s/, lineBreaks: true},
        next: {match: ','},
        end: {match: [')', '}'], pop: 1},
    },
    filter: {
        name: {match: Object.keys(filters)},
        args: {match: '(', push: 'placeholder'},
        chain: {match: '|'},
        end: {match: /(?=\W)/, pop: 1, lineBreaks: true},
    },
});

export function parse(pattern: string): PatternFunction {
    patternLexer.reset(pattern);
    const parts = Array.from(parsePattern());
    if (parts.length === 1) {
        return parts[0];
    }

    return data => parts.map(part => part(data)).join('');
}

function* parsePattern(): Iterable<PatternFunction> {
    for (const token of patternLexer) {
        switch (token.type) {
            case "literal":
                yield () => token.value;
                break;
            case "placeholder":
                yield* parsePlaceholder();
                break;
            default:
                throw new Error(patternLexer.formatError(token, 'Unknown token'));
        }
    }
}

function* parsePlaceholder(): IterableIterator<PatternFunction> {
    const properties: string[] = [];
    let filter: PatternFunction = data => data[''];

    let accessor: PatternFunction = data => {
        let current: PatternData = data;
        for (const property of properties) {
            if (typeof current === 'object' && current !== null && property in current) {
                // @ts-ignore string property access
                current = current[property];
            } else {
                current = null;
                break;
            }
        }

        return filter({...data, '': current});
    };

    for (const token of patternLexer) {
        switch (token.type) {
            case "path":
                properties.push(...token.value.split('.'));
                break;
            case "filter":
                filter = parseFilter();
                break;
            case "compare": {
                const future = parsePlaceholder();
                const {value: rightAccessor, done} = future.next();
                if (done) {
                    throw new Error(patternLexer.formatError(token, "Right side missing"));
                }

                switch (token.value) {
                    case "==":
                        yield data => accessor(data) === rightAccessor(data);
                        break;
                    case "<>":
                    case "!=":
                        yield data => accessor(data) !== rightAccessor(data);
                        break;
                    case ">=":
                        yield data => {
                            const left = accessor(data), right = rightAccessor(data);
                            return left !== null && right !== null && typeof left === typeof right && left <= right;
                        };
                        break;
                    case "<=":
                        yield data => {
                            const left = accessor(data), right = rightAccessor(data);
                            return left !== null && right !== null && typeof left === typeof right && left >= right;
                        };
                        break;
                }

                for (const item of future) {
                    yield item;
                }

                return;
            }
            case "string": {
                const string = token.value.slice(1, -1);
                accessor = () => string;
                break;
            }
            case "number": {
                const number = Number(token.value);
                accessor = () => number;
                break;
            }
            case "space":
                break;
            case "next":
                yield accessor;
                yield* parsePlaceholder();
                return;
            case "end":
                yield accessor;
                return;
            default:
                throw new Error(patternLexer.formatError(token, 'Unknown token'));
        }
    }

    throw new Error(patternLexer.formatError(null as any, 'Placeholder pattern did not end'));
}

function parseFilter(): PatternFunction {
    let func: (PatternFunction | null) = null;
    const args: PatternFunction[] = [];

    for (const token of patternLexer) {
        switch (token.type) {
            case "name":
                func = filters[token.value];
                break;
            case "args":
                args.push(...parsePlaceholder());
                break;
            case "chain": {
                if (func === null) {
                    throw new Error("filter name missing");
                }

                const next = parseFilter();
                return data => {
                    const result = func ? func(data, ...args) : null;
                    return next({...data, '': result});
                };
            }

            case "end":
                if (func === null) {
                    throw new Error("filter name missing");
                }

                return data => func ? func(data, ...args) : null;
            default:
                throw new Error(patternLexer.formatError(token, 'Unknown token'));
        }
    }

    throw new Error(patternLexer.formatError(null as any, 'Filter pattern did not end'));
}
