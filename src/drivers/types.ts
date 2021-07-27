import {extname} from "path";
import {PatternObject} from "../pattern";

export interface DriverContext {
    configPath: string;
    configTime: Date;
    drivers: {
        source: Record<string, SourceConstructor>,
        target: Record<string, TargetConstructor>,
        format: Record<string, FormatConstructor>,
    }
}

export interface SourceEvent {
    sourceId: string;
    sourceDriver: Source;
    type: "add" | "change" | "remove";
}

export interface SourceAddChange extends SourceEvent {
    type: "add";
    nextData: any;
}

export interface SourceChangeChange extends SourceEvent {
    type: "change";
    prevData: any;
    nextData: any;
}

export interface SourceRemoveChange extends SourceEvent {
    type: "remove";
    prevData: any;
}

export interface TargetUpdate {
    trigger: SourceChange;
    viewId: string;
}

export type SourceChange = SourceAddChange | SourceChangeChange | SourceRemoveChange;
export type ChangeHandler<R> = (change: SourceChange) => Promise<R>;

export interface Source {
    watch(): AsyncIterable<SourceEvent>;

    process<R>(change: SourceEvent, handler: ChangeHandler<R>): Promise<R>;
}

export interface Target {
    id(data: PatternObject): string;

    update(update: TargetUpdate, entries: PatternObject[]): Promise<void>;
}

export interface Format {
    readSource(reader: NodeJS.ReadableStream): Promise<any>;

    updateView(reader: NodeJS.ReadableStream | void, writer: NodeJS.WritableStream, event: SourceEvent, entries: any[]): Promise<number>;
}

export type SourceConstructor = new (options: Record<string, any>, context: DriverContext) => Source;
export type TargetConstructor = new (options: Record<string, any>, context: DriverContext) => Target;
export type FormatConstructor = new (options: Record<string, any>, context: DriverContext) => Format;
