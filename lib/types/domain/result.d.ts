import type { CacheKey, MinerUFileId, MinerUResultId, ProviderConfigId } from './ids.js';
import type { MinerUProviderId } from './errors.js';
import type { ArtifactKind, CanonicalParseRequest } from './request.js';
export declare const MINERU_RESULT_MANIFEST_SCHEMA_VERSION: 1;
export interface ArtifactRef {
    readonly kind: ArtifactKind | 'manifest';
    readonly relativePath: string;
    readonly mediaType: string;
    readonly bytes: number;
    readonly sha256: string;
}
export interface ParsedDocumentManifest {
    readonly fileId: MinerUFileId;
    readonly name: string;
    readonly artifacts: readonly ArtifactRef[];
}
export interface ResultProducer {
    readonly providerId: MinerUProviderId;
    readonly providerConfigId: ProviderConfigId;
    readonly compatibilityKey: string;
}
/** A published manifest is one immutable source-file result. */
export interface MinerUResultManifest {
    readonly schemaVersion: typeof MINERU_RESULT_MANIFEST_SCHEMA_VERSION;
    readonly id: MinerUResultId;
    readonly cacheKey: CacheKey;
    readonly sourceSha256: string;
    readonly request: CanonicalParseRequest;
    readonly producer: ResultProducer;
    readonly files: readonly [ParsedDocumentManifest];
    readonly createdAt: number;
}
