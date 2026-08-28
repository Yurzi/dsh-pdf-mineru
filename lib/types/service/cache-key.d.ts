import { type CacheKey } from '../domain/ids.js';
import { type CanonicalParseRequest, type CanonicalSourceFile } from '../domain/request.js';
export declare function canonicalJson(value: unknown): string;
export declare function computeCacheKey(request: CanonicalParseRequest, file: CanonicalSourceFile, providerCompatibilityKey: string, versions?: {
    readonly cacheKey?: number;
    readonly result?: number;
}): CacheKey;
