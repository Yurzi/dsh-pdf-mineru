import { type CacheKey, type MinerUFileId, type MinerUResultId, type OperationId } from '../domain/ids.js';
import type { ArtifactKind, CanonicalParseRequest, CanonicalSourceFile } from '../domain/request.js';
import type { ArtifactRef, MinerUResultManifest, ResultProducer } from '../domain/result.js';
import type { ArtifactInput, ArtifactSink, ArtifactWriteOptions, TemporaryArtifact } from '../providers/provider.js';
import type { StoragePaths } from './paths.js';
import { ProcessLock, type ProcessLockScope } from './process-lock.js';
type ResultInspectionStatus = 'valid' | 'missing' | 'corrupt' | 'unreadable';
type ResultInspectionReason = 'absent' | 'missing-entry' | 'unsafe-entry' | 'manifest-invalid' | 'artifact-invalid' | 'io-error';
/**
 * A non-mutating verification outcome for one published content-addressed result.
 * inspectPublished never quarantines; callers that need isolation must invoke it
 * separately after receiving a non-valid outcome.
 */
export type PublishedResultInspection = {
    readonly status: 'valid';
    readonly manifest: MinerUResultManifest;
} | {
    readonly status: Exclude<ResultInspectionStatus, 'valid'>;
    readonly reason: ResultInspectionReason;
};
export declare class ResultTransaction implements ArtifactSink {
    readonly request: CanonicalParseRequest;
    readonly producer: ResultProducer;
    readonly paths: StoragePaths;
    readonly operationId: OperationId;
    readonly stagingDir: string;
    private readonly sink;
    constructor(operationId: OperationId | string, request: CanonicalParseRequest, producer: ResultProducer, paths: StoragePaths, signal?: AbortSignal, maxArtifactBytes?: number);
    writeArtifact(fileId: MinerUFileId, kind: ArtifactKind, input: ArtifactInput, options: ArtifactWriteOptions): Promise<ArtifactRef>;
    writeTemporary(name: string, input: ArtifactInput, maxBytes: number): Promise<TemporaryArtifact>;
    buildManifest(file: CanonicalSourceFile, artifacts: readonly ArtifactRef[]): MinerUResultManifest;
    abort(): Promise<void>;
}
export interface ResultRepositoryOptions {
    readonly maxJsonValidationBytes?: number;
    readonly maxManifestBytes?: number;
    readonly maxArtifactBytes?: number;
}
export declare class ResultRepository {
    readonly paths: StoragePaths;
    readonly lock?: ProcessLock | undefined;
    private readonly maxJsonValidationBytes;
    private readonly maxManifestBytes;
    private readonly maxArtifactBytes;
    private readonly mutationLock;
    constructor(paths: StoragePaths, options?: ResultRepositoryOptions, lock?: ProcessLock | undefined);
    beginTransaction(operationId: OperationId | string, request: CanonicalParseRequest, producer: ResultProducer, signal?: AbortSignal): ResultTransaction;
    private assertManifestConsistency;
    private verifyArtifact;
    private verifyManifestArtifacts;
    private assertPublishedTreeContents;
    commitTransaction(tx: ResultTransaction, manifest: MinerUResultManifest, signal?: AbortSignal): Promise<{
        resultId: MinerUResultId;
        cacheKey: CacheKey;
        manifest: MinerUResultManifest;
    }>;
    /** Strictly verifies one published result without moving or modifying it. */
    inspectPublished(cacheKey: CacheKey | string, signal?: AbortSignal): Promise<PublishedResultInspection>;
    get(cacheKey: CacheKey | string, requiredArtifacts?: readonly ArtifactKind[], signal?: AbortSignal): Promise<MinerUResultManifest | undefined>;
    resolveArtifactAbsolutePath(cacheKey: CacheKey | string, relativePath: string): string;
    manifestAbsolutePath(cacheKey: CacheKey | string): string;
    quarantine(sourcePath: string, reason?: string): Promise<string>;
    /** Mutation helper for callers already holding the exact authority lock. */
    quarantineScoped(authority: ProcessLock, scope: ProcessLockScope, sourcePath: string, reason?: string): Promise<string>;
    private ensureResultParentScoped;
    cleanupStaging(ttlMs: number, activeOperationIds?: ReadonlySet<OperationId | string>, signal?: AbortSignal): Promise<number>;
}
export {};
