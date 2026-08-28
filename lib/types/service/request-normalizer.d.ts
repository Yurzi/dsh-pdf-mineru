import { type ParseDefaults, type ParseRequestInput, type PreparedParseRequest, type PreparedSourceFile } from '../domain/request.js';
export interface RequestNormalizerOptions {
    readonly defaults: ParseDefaults;
    readonly cwd?: string;
    readonly maxFiles?: number;
    readonly maxFileBytes?: number;
}
export declare function normalizePages(input: string): string;
export declare function assertSourcesUnchanged(sources: readonly PreparedSourceFile[], signal: AbortSignal): Promise<void>;
export declare class RequestNormalizer {
    private readonly options;
    constructor(options: RequestNormalizerOptions);
    normalize(input: ParseRequestInput, signal: AbortSignal): Promise<PreparedParseRequest>;
}
