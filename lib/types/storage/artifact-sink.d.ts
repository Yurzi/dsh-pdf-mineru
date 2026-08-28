/**
 * artifact-sink.ts — Staging-backed ArtifactSink implementation for MinerU providers.
 *
 * Enforces:
 *   - Streaming I/O with on-the-fly SHA-256 and byte accounting
 *   - Per-artifact byte limit enforcement (throws RESULT_TOO_LARGE on breach)
 *   - Clean POSIX relative artifact paths within staging and result boundaries
 *   - Automatic temporary file cleanup on stream failure
 */
import { type MinerUFileId, type OperationId } from '../domain/ids.js';
import type { ArtifactKind } from '../domain/request.js';
import type { ArtifactRef } from '../domain/result.js';
import type { ArtifactInput, ArtifactSink, ArtifactWriteOptions, TemporaryArtifact } from '../providers/provider.js';
import type { StoragePaths } from './paths.js';
export declare class StagingArtifactSink implements ArtifactSink {
    readonly paths: StoragePaths;
    private readonly signal?;
    private readonly defaultMaxBytes?;
    private imageCounter;
    readonly operationId: OperationId;
    constructor(operationId: OperationId | string, paths: StoragePaths, signal?: AbortSignal | undefined, defaultMaxBytes?: number | undefined);
    writeArtifact(fileId: MinerUFileId, kind: ArtifactKind, input: ArtifactInput, options: ArtifactWriteOptions): Promise<ArtifactRef>;
    writeTemporary(name: string, input: ArtifactInput, maxBytes: number): Promise<TemporaryArtifact>;
}
