import {parse, PatternData, PatternFunction, PatternObject} from "./pattern";

export type ParsedPatternData =
    string
    | number
    | boolean
    | null
    | ParsedPatternData[]
    | ParsedPatternObject
    | PatternFunction;

// deno-lint-ignore no-empty-interface https://stackoverflow.com/a/45999529/1973256
export interface ParsedPatternObject extends Record<string | number, ParsedPatternData> {
}

export function parseStructure(structure: PatternObject): (data: PatternObject) => PatternData {
    const parsedStructure = _parseStructure(structure);
    return data => _executeStructure(parsedStructure, data);
}

function _parseStructure(structure: PatternData): ParsedPatternData {
    if (typeof structure === 'string') {
        return parse(structure);
    }

    if (Array.isArray(structure)) {
        return structure.map(value => _parseStructure(value));
    }

    if (structure !== null && typeof structure === 'object') {
        const result = {} as Record<string, ParsedPatternData>;
        for (const key in structure) {
            result[key] = _parseStructure(structure[key]);
        }
        return result;
    }

    return structure;
}

function _executeStructure(structure: ParsedPatternData, data: PatternObject): PatternData {
    if (typeof structure === 'function') {
        return structure(data);
    }

    if (Array.isArray(structure)) {
        return structure.map(value => _executeStructure(value, data));
    }

    if (structure !== null && typeof structure === 'object') {
        const result = {} as Record<string, PatternData>;
        for (const key in structure) {
            result[key] = _executeStructure(structure[key], data);
        }
        return result;
    }

    return structure as unknown as PatternData;
}
