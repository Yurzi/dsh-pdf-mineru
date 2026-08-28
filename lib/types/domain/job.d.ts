import type { CacheKey, MinerUFileId, MinerUJobId, MinerUResultId, OperationId, ProviderConfigId, SessionId } from './ids.js';
import type { MinerUFailure, MinerUProviderId } from './errors.js';
import type { CanonicalParseRequest } from './request.js';
import type { ProviderJobRef } from '../providers/provider.js';
export declare const MINERU_JOB_SCHEMA_VERSION: 1;
export type MinerUFileState = 'queued' | 'uploading' | 'processing' | 'completed' | 'failed';
export type MinerUJobState = MinerUFileState | 'collecting' | 'partially-completed';
export type JobResolution = {
    readonly kind: 'cache-hit';
} | {
    readonly kind: 'shared-operation';
    readonly operationId: OperationId;
    readonly ref?: ProviderJobRef;
} | {
    readonly kind: 'provider';
    readonly ref?: ProviderJobRef;
};
export interface JobSourceFile {
    readonly fileId: MinerUFileId;
    readonly name: string;
    readonly bytes: number;
    readonly sha256: string;
}
export interface MinerUFileStatus {
    readonly fileId: MinerUFileId;
    readonly name: string;
    readonly cacheKey: CacheKey;
    readonly state: MinerUFileState;
    readonly resultId?: MinerUResultId;
    readonly failure?: MinerUFailure;
    readonly progress?: {
        readonly completed: number;
        readonly total: number;
    };
}
export interface MinerUJobRecord {
    readonly schemaVersion: typeof MINERU_JOB_SCHEMA_VERSION;
    readonly id: MinerUJobId;
    readonly sessionId: SessionId;
    readonly providerId: MinerUProviderId;
    readonly providerConfigId: ProviderConfigId;
    readonly providerCompatibilityKey: string;
    readonly sourceFiles: readonly JobSourceFile[];
    readonly request: CanonicalParseRequest;
    readonly cacheKey: CacheKey;
    readonly state: MinerUJobState;
    readonly resolution: JobResolution;
    readonly files: readonly MinerUFileStatus[];
    readonly resultId?: MinerUResultId;
    readonly failure?: MinerUFailure;
    readonly createdAt: number;
    readonly updatedAt: number;
}
export declare function isTerminalJobState(state: MinerUJobState): boolean;
export declare function assertJobTransition(previous: MinerUJobState, next: MinerUJobState): void;
