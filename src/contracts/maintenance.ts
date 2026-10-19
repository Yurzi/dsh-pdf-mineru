export type StorageMaintenanceArea = 'published-results' | 'staging' | 'quarantine'

export type StorageMaintenanceDiagnosticCode =
  | 'unexpected-entry'
  | 'symlink-skipped'
  | 'unreadable-entry'
  | 'corrupt-result'
  | 'missing-result'
  | 'unsafe-result'
  | 'quarantine-failed'

export interface StorageMaintenanceDiagnostic {
  readonly area: StorageMaintenanceArea
  readonly entry: string
  readonly code: StorageMaintenanceDiagnosticCode
  readonly message: string
}

export interface StorageAreaStatistics {
  readonly byteUsage: number
  readonly logicalEntryCount: number
  readonly regularFileCount: number
  readonly directoryCount: number
  readonly skippedSymlinkCount: number
  readonly unexpectedEntryCount: number
  readonly unreadableEntryCount: number
  readonly depthLimitCount: number
  readonly truncated: boolean
  readonly complete: boolean
}

export interface StorageStatistics {
  readonly generatedAt: number
  readonly publishedResults: StorageAreaStatistics
  readonly staging: StorageAreaStatistics
  readonly quarantine: StorageAreaStatistics
}

export interface ScanMetadata {
  readonly limit: number
  readonly scanned: number
  readonly truncated: boolean
  readonly diagnosticsLimit: number
  readonly diagnosticsTruncated: boolean
}

export interface IntegrityScanOptions {
  /** Maximum published result directories to validate. */
  readonly resultLimit?: number
  /** Maximum diagnostics returned in the response. */
  readonly diagnosticLimit?: number
  /**
   * Defaults to false. When true, only invalid result directories found by this
   * scan are moved to quarantine; valid results are never modified.
   */
  readonly isolateInvalid?: boolean
  readonly signal?: AbortSignal
}

export interface CacheIntegrityScanReport {
  readonly generatedAt: number
  readonly readOnly: boolean
  readonly isolateInvalid: boolean
  readonly validCount: number
  readonly corruptCount: number
  readonly missingCount: number
  readonly unreadableCount: number
  readonly quarantinedCount: number
  readonly scan: ScanMetadata
  readonly diagnostics: readonly StorageMaintenanceDiagnostic[]
}

export interface QuarantineEntry {
  readonly id: string
  readonly byteUsage: number
  readonly regularFileCount: number
  readonly directoryCount: number
  readonly modifiedAt: number
}

export interface QuarantineListOptions {
  readonly limit?: number
  readonly signal?: AbortSignal
}

export interface QuarantineListReport {
  readonly generatedAt: number
  readonly entries: readonly QuarantineEntry[]
  readonly totalCount: number
  readonly totalBytes: number
  readonly truncated: boolean
  readonly skippedSymlinkCount: number
  readonly unexpectedEntryCount: number
  readonly unreadableEntryCount: number
}

export interface QuarantineCleanupOptions {
  /** Entries returned from listQuarantine. Arbitrary paths are rejected. */
  readonly entryIds: readonly string[]
  /** Defaults to true. Deletion requires an explicit false value. */
  readonly dryRun?: boolean
  readonly signal?: AbortSignal
}

export interface QuarantineCleanupReport {
  readonly generatedAt: number
  readonly dryRun: boolean
  readonly requestedCount: number
  readonly plannedCount: number
  readonly plannedBytes: number
  readonly deletedCount: number
  readonly deletedBytes: number
  readonly missingCount: number
  readonly skippedCount: number
  readonly entries: readonly QuarantineEntry[]
}

export interface CacheClearOptions {
  /** Maximum published result directories inspected. The operation fails closed when truncated. */
  readonly resultLimit?: number
  readonly diagnosticLimit?: number
  /** Defaults to true. Deletion requires an explicit false value and RPC confirmation. */
  readonly dryRun?: boolean
  /** Opaque fingerprint returned by an eligible dry run. Required for deletion. */
  readonly confirmationToken?: string
  readonly signal?: AbortSignal
}

export interface CacheClearReport {
  readonly generatedAt: number
  readonly dryRun: boolean
  readonly eligible: boolean
  readonly activeOperationCount: number
  readonly activeAccessCount: number
  readonly confirmationToken?: string
  readonly plannedCount: number
  readonly plannedBytes: number
  readonly deletedCount: number
  readonly deletedBytes: number
  readonly skippedCount: number
  readonly scan: ScanMetadata
  readonly diagnostics: readonly StorageMaintenanceDiagnostic[]
}
