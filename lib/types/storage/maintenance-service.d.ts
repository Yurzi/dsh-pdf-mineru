/**
 * storage-maintenance.ts - Bounded, path-safe maintenance inventory for MinerU storage.
 *
 * This module is intentionally privileged and storage-local. It never accepts an
 * arbitrary filesystem path, never follows symlink entries, and only exposes
 * bounded summary data for the loopback RPC and settings UI.
 */
import { type CacheKey, type MinerUResultId } from '../domain/ids.js';
import type { ResultRepository } from './result-repository.js';
import type { SharedOperationRegistry } from '../service/shared-operations.js';
import type { ProcessLock } from './process-lock.js';
import { StorageAccessGate } from './access-gate.js';
import type { StoragePaths } from './paths.js';
export type StorageMaintenanceArea = 'published-results' | 'staging' | 'quarantine';
export type StorageMaintenanceDiagnosticCode = 'unexpected-entry' | 'symlink-skipped' | 'unreadable-entry' | 'corrupt-result' | 'missing-result' | 'unsafe-result' | 'malformed-job' | 'inconsistent-job' | 'quarantine-failed';
export interface StorageMaintenanceDiagnostic {
    readonly area: StorageMaintenanceArea;
    readonly entry: string;
    readonly code: StorageMaintenanceDiagnosticCode;
    readonly message: string;
}
/**
 * Byte usage is the sum of regular files reached without crossing a symlink.
 * logicalEntryCount is a safe layout-shaped record/directory count, not a
 * declaration that every persisted record has passed schema validation.
 */
export interface StorageAreaStatistics {
    readonly byteUsage: number;
    readonly byteUsageSaturated: boolean;
    readonly logicalEntryCount: number;
    readonly regularFileCount: number;
    readonly directoryCount: number;
    readonly skippedSymlinkCount: number;
    readonly unexpectedEntryCount: number;
    readonly unreadableEntryCount: number;
    readonly depthLimitCount: number;
}
export interface StorageStatistics {
    readonly generatedAt: number;
    readonly publishedResults: StorageAreaStatistics;
    readonly staging: StorageAreaStatistics;
    readonly quarantine: StorageAreaStatistics;
}
export interface ScanMetadata {
    readonly limit: number;
    readonly scanned: number;
    readonly truncated: boolean;
    readonly diagnosticsLimit: number;
    readonly diagnosticsTruncated: boolean;
}
export interface IntegrityScanOptions {
    /** Maximum published result directories to validate. */
    readonly resultLimit?: number;
    /** Maximum diagnostics returned in the response. */
    readonly diagnosticLimit?: number;
    /**
     * Defaults to false. When true, only invalid result directories found by this
     * scan are moved to quarantine; valid results are never modified.
     */
    readonly isolateInvalid?: boolean;
    readonly signal?: AbortSignal;
}
export interface CacheIntegrityScanReport {
    readonly generatedAt: number;
    readonly readOnly: boolean;
    readonly isolateInvalid: boolean;
    readonly validCount: number;
    readonly corruptCount: number;
    readonly missingCount: number;
    readonly unreadableCount: number;
    readonly quarantinedCount: number;
    readonly scan: ScanMetadata;
    readonly diagnostics: readonly StorageMaintenanceDiagnostic[];
}
export interface QuarantineEntry {
    readonly id: string;
    readonly byteUsage: number;
    readonly byteUsageSaturated: boolean;
    readonly regularFileCount: number;
    readonly directoryCount: number;
    readonly modifiedAt: number;
}
export interface QuarantineListOptions {
    readonly limit?: number;
    readonly signal?: AbortSignal;
}
export interface QuarantineListReport {
    readonly generatedAt: number;
    readonly entries: readonly QuarantineEntry[];
    readonly totalCount: number;
    readonly totalBytes: number;
    readonly totalBytesSaturated: boolean;
    readonly truncated: boolean;
    readonly skippedSymlinkCount: number;
    readonly unexpectedEntryCount: number;
    readonly unreadableEntryCount: number;
}
export interface QuarantineCleanupOptions {
    /** Entries returned from listQuarantine. Arbitrary paths are rejected. */
    readonly entryIds: readonly string[];
    /** Defaults to true. Deletion requires an explicit false value. */
    readonly dryRun?: boolean;
    readonly signal?: AbortSignal;
}
export interface QuarantineCleanupReport {
    readonly generatedAt: number;
    readonly dryRun: boolean;
    readonly requestedCount: number;
    readonly plannedCount: number;
    readonly plannedBytes: number;
    readonly plannedBytesSaturated: boolean;
    readonly deletedCount: number;
    readonly deletedBytes: number;
    readonly deletedBytesSaturated: boolean;
    readonly missingCount: number;
    readonly skippedCount: number;
    readonly entries: readonly QuarantineEntry[];
}
export interface GcDryRunOptions {
    /** Maximum published result directories inspected for this report. */
    readonly resultLimit?: number;
    /** Maximum reclaimable result descriptors returned in the response. */
    readonly candidateLimit?: number;
    readonly diagnosticLimit?: number;
    readonly signal?: AbortSignal;
}
export interface GcCandidate {
    readonly cacheKey: CacheKey;
    readonly resultId: MinerUResultId;
    readonly byteUsage: number;
    readonly byteUsageSaturated: boolean;
}
export interface JobReferenceScan {
    readonly complete: true;
    readonly sessionJobCount: number;
    readonly activeJobCount: number;
    readonly referencedCacheKeyCount: number;
}
/**
 * This operation never deletes data. It reports only fully validated, unreferenced
 * published result directories under the current job-reference retention policy.
 */
export interface GcDryRunReport {
    readonly generatedAt: number;
    readonly dryRun: true;
    readonly referencePolicy: 'no-plugin-job-retention';
    readonly eligible: boolean;
    readonly candidateCount: number;
    readonly candidateBytes: number;
    readonly candidateBytesSaturated: boolean;
    readonly candidates: readonly GcCandidate[];
    readonly candidatesTruncated: boolean;
    readonly candidateTotalsComplete: boolean;
    readonly referencedResultCount: number;
    readonly invalidResultCount: number;
    readonly unsafeResultCount: number;
    readonly jobReferences: JobReferenceScan;
    readonly scan: ScanMetadata;
    readonly diagnostics: readonly StorageMaintenanceDiagnostic[];
}
export interface CacheClearOptions {
    /** Maximum published result directories inspected. The operation fails closed when truncated. */
    readonly resultLimit?: number;
    readonly diagnosticLimit?: number;
    /** Defaults to true. Deletion requires an explicit false value and RPC confirmation. */
    readonly dryRun?: boolean;
    /** Opaque fingerprint returned by an eligible dry run. Required for deletion. */
    readonly confirmationToken?: string;
    readonly signal?: AbortSignal;
}
export interface CacheClearReport {
    readonly generatedAt: number;
    readonly dryRun: boolean;
    readonly eligible: boolean;
    readonly activeJobCount: number;
    readonly activeOperationCount: number;
    readonly activeAccessCount: number;
    readonly confirmationToken?: string;
    readonly plannedCount: number;
    readonly plannedBytes: number;
    readonly plannedBytesSaturated: boolean;
    readonly deletedCount: number;
    readonly deletedBytes: number;
    readonly deletedBytesSaturated: boolean;
    readonly skippedCount: number;
    readonly jobScan: JobReferenceScan;
    readonly scan: ScanMetadata;
    readonly diagnostics: readonly StorageMaintenanceDiagnostic[];
}
/** Storage maintenance is loopback-only and blocks destructive work while parse operations are active. */
export declare class StorageMaintenanceService {
    readonly paths: StoragePaths;
    readonly results: ResultRepository;
    readonly operations: SharedOperationRegistry;
    readonly lock: ProcessLock;
    readonly accessGate: StorageAccessGate;
    constructor(paths: StoragePaths, results: ResultRepository, operations: SharedOperationRegistry, lock: ProcessLock, accessGate?: StorageAccessGate);
    getStatistics(signal?: AbortSignal): Promise<StorageStatistics>;
    scanIntegrity(options?: IntegrityScanOptions): Promise<CacheIntegrityScanReport>;
    listQuarantine(options?: QuarantineListOptions): Promise<QuarantineListReport>;
    cleanupQuarantine(options: QuarantineCleanupOptions): Promise<QuarantineCleanupReport>;
    clearCache(options?: CacheClearOptions): Promise<CacheClearReport>;
    private clearCacheInternal;
    gcDryRun(options?: GcDryRunOptions): Promise<GcDryRunReport>;
    private assertLockHeld;
    private countPublishedResultDirectories;
    private countDirectDirectories;
    private visitPublishedResults;
    private recordDirectoryIssue;
    private collectJobReferences;
}
