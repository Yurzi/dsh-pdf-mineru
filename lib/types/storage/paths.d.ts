/**
 * paths.ts — Validated filesystem layout and path derivation for MinerU storage.
 *
 * Enforces:
 *   - Strict identifier validation before path concatenation (prevents path traversal)
 *   - Relative POSIX artifact path containment within result/staging roots
 *   - Safe, deterministic directory layout documented in ARCHITECTURE.md
 */
import { type CacheKey, type MinerUFileId, type OperationId } from '../domain/ids.js';
export declare function defaultStorageRoot(): string;
export declare class StoragePaths {
    readonly root: string;
    constructor(root?: string);
    resultsDir(): string;
    resultDir(cacheKey: CacheKey | string): string;
    manifestFile(cacheKey: CacheKey | string): string;
    filesDir(cacheKey: CacheKey | string): string;
    fileDir(cacheKey: CacheKey | string, fileId: MinerUFileId | string): string;
    stagingDir(operationId?: OperationId | string): string;
    stagingFilesDir(operationId: OperationId | string): string;
    stagingFileDir(operationId: OperationId | string, fileId: MinerUFileId | string): string;
    stagingTempDir(operationId: OperationId | string): string;
    stagingManifestFile(operationId: OperationId | string): string;
    quarantineDir(name?: string): string;
    processLockFile(): string;
    /** v2 bakery lock state directory (<root>/.lock). */
    lockDir(): string;
    /** v2 bakery claim directory (<root>/.lock/claims). */
    lockClaimsDir(): string;
    /** Cross-process storage use records (<root>/.lock/users). */
    lockUsersDir(): string;
    resolveArtifactPath(cacheKey: CacheKey | string, relativePath: string): string;
    resolveStagingArtifactPath(operationId: OperationId | string, relativePath: string): string;
}
