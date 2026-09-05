/**
 * storage-maintenance.ts — Streamlined, path-safe maintenance inventory for MinerU storage.
 *
 * Privileged and storage-local. Never follows symlink entries, strictly stays
 * within storageRoot, and exposes summary data for the loopback RPC and settings UI.
 */

import { createHash } from 'node:crypto'
import { type Dirent } from 'node:fs'
import { lstat, readdir, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { throwMinerU } from '../domain/errors.js'
import {
  asCacheKey,
  asOperationId,
  assertSafePathSegment,
  type CacheKey,
  type MinerUResultId,
} from '../domain/ids.js'
import type { SharedOperationRegistry } from '../service/shared-operations.js'
import { StorageAccessGate } from './access-gate.js'
import type { StoragePaths } from './paths.js'
import type { ProcessLock } from './process-lock.js'
import type { ResultRepository } from './result-repository.js'

const DEFAULT_RESULT_SCAN_LIMIT = 10_000
const DEFAULT_DIAGNOSTIC_LIMIT = 100
const DEFAULT_QUARANTINE_LIST_LIMIT = 100
const DEFAULT_GC_CANDIDATE_LIMIT = 100
const MAX_RESULT_SCAN_LIMIT = 50_000
const MAX_DIAGNOSTIC_LIMIT = 1_000
const MAX_QUARANTINE_LIST_LIMIT = 1_000
const MAX_GC_CANDIDATE_LIMIT = 1_000
const MAX_QUARANTINE_CLEANUP_ENTRIES = 100

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
  readonly byteUsageSaturated: boolean
  readonly logicalEntryCount: number
  readonly regularFileCount: number
  readonly directoryCount: number
  readonly skippedSymlinkCount: number
  readonly unexpectedEntryCount: number
  readonly unreadableEntryCount: number
  readonly depthLimitCount: number
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
  readonly byteUsageSaturated: boolean
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
  readonly totalBytesSaturated: boolean
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
  readonly plannedBytesSaturated: boolean
  readonly deletedCount: number
  readonly deletedBytes: number
  readonly deletedBytesSaturated: boolean
  readonly missingCount: number
  readonly skippedCount: number
  readonly entries: readonly QuarantineEntry[]
}

export interface GcDryRunOptions {
  /** Maximum published result directories inspected for this report. */
  readonly resultLimit?: number
  /** Maximum reclaimable result descriptors returned in the response. */
  readonly candidateLimit?: number
  readonly diagnosticLimit?: number
  readonly signal?: AbortSignal
}

export interface GcCandidate {
  readonly cacheKey: CacheKey
  readonly resultId: MinerUResultId
  readonly byteUsage: number
  readonly byteUsageSaturated: boolean
}

export interface GcDryRunReport {
  readonly generatedAt: number
  readonly dryRun: true
  readonly referencePolicy: 'all-published-results'
  readonly eligible: boolean
  readonly candidateCount: number
  readonly candidateBytes: number
  readonly candidateBytesSaturated: boolean
  readonly candidates: readonly GcCandidate[]
  readonly candidatesTruncated: boolean
  readonly candidateTotalsComplete: boolean
  readonly invalidResultCount: number
  readonly unsafeResultCount: number
  readonly scan: ScanMetadata
  readonly diagnostics: readonly StorageMaintenanceDiagnostic[]
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
  readonly plannedBytesSaturated: boolean
  readonly deletedCount: number
  readonly deletedBytes: number
  readonly deletedBytesSaturated: boolean
  readonly skippedCount: number
  readonly scan: ScanMetadata
  readonly diagnostics: readonly StorageMaintenanceDiagnostic[]
}

type NodeKind = 'missing' | 'directory' | 'file' | 'symlink' | 'unexpected' | 'unreadable'

type SafeDirectory =
  | { readonly kind: 'missing' | 'symlink' | 'unexpected' | 'unreadable' }
  | { readonly kind: 'entries'; readonly entries: readonly Dirent[] }

interface UsageCounter {
  bytes: number
  regularFileCount: number
  directoryCount: number
  skippedSymlinkCount: number
  unexpectedEntryCount: number
  unreadableEntryCount: number
}

interface TraversalSummary {
  readonly scanned: number
  readonly truncated: boolean
  readonly complete: boolean
}

interface DiagnosticCollector {
  readonly limit: number
  readonly diagnostics: StorageMaintenanceDiagnostic[]
  truncated: boolean
}

function createUsage(): UsageCounter {
  return {
    bytes: 0,
    regularFileCount: 0,
    directoryCount: 0,
    skippedSymlinkCount: 0,
    unexpectedEntryCount: 0,
    unreadableEntryCount: 0,
  }
}

function boundedLimit(value: number | undefined, fallback: number, maximum: number, label: string): number {
  const resolved = value === undefined ? fallback : value
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum) {
    throw new TypeError(`${label} must be a positive safe integer no greater than ${maximum}`)
  }
  return resolved
}

function isSafeSegment(value: string): boolean {
  try {
    assertSafePathSegment(value, 'storage entry')
    return true
  } catch {
    return false
  }
}

function sanitizeEntry(value: string): string {
  return isSafeSegment(value) ? value : 'unknown'
}

function diagnosticMessage(code: StorageMaintenanceDiagnosticCode): string {
  switch (code) {
    case 'unexpected-entry': return 'Ignored an entry outside the expected storage layout.'
    case 'symlink-skipped': return 'Skipped a symlink without following it.'
    case 'unreadable-entry': return 'Could not read a storage entry.'
    case 'corrupt-result': return 'Published result failed strict manifest or artifact validation.'
    case 'missing-result': return 'Published result was incomplete or disappeared during validation.'
    case 'unsafe-result': return 'Published result contained unsafe or unsupported filesystem data.'
    case 'quarantine-failed': return 'Could not move an invalid result to quarantine.'
  }
}

function createDiagnostics(limit: number): DiagnosticCollector {
  return { limit, diagnostics: [], truncated: false }
}

function addDiagnostic(
  collector: DiagnosticCollector | undefined,
  area: StorageMaintenanceArea,
  entry: string,
  code: StorageMaintenanceDiagnosticCode,
): void {
  if (collector === undefined) return
  if (collector.diagnostics.length >= collector.limit) {
    collector.truncated = true
    return
  }
  collector.diagnostics.push({ area, entry: sanitizeEntry(entry), code, message: diagnosticMessage(code) })
}

async function classifyNode(path: string): Promise<NodeKind> {
  try {
    const details = await lstat(path)
    if (details.isSymbolicLink()) return 'symlink'
    if (details.isDirectory()) return 'directory'
    if (details.isFile()) return 'file'
    return 'unexpected'
  } catch (error) {
    return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT' ? 'missing' : 'unreadable'
  }
}

function isWithinDirectory(target: string, parentDir: string): boolean {
  const rel = relative(resolve(parentDir), resolve(target))
  return !rel.startsWith('..') && !isAbsolute(rel)
}

async function isSafeExistingDirectoryChain(target: string, signal?: AbortSignal): Promise<boolean> {
  const absolute = resolve(target)
  const root = parse(absolute).root
  const segments = absolute.slice(root.length).split(sep).filter(Boolean)
  let current = root
  for (const segment of segments) {
    signal?.throwIfAborted()
    current = join(current, segment)
    if (await classifyNode(current) !== 'directory') return false
  }
  try {
    return await realpath(absolute) === absolute
  } catch {
    return false
  }
}

export function cacheClearConfirmationToken(cacheKeys: readonly CacheKey[]): string {
  const ordered = [...cacheKeys].sort()
  return 'cache-clear-' + createHash('sha256').update(JSON.stringify(ordered), 'utf8').digest('hex')
}
export const confirmationToken = cacheClearConfirmationToken

async function readSafeDirectory(path: string): Promise<SafeDirectory> {
  const kind = await classifyNode(path)
  if (kind !== 'directory') return { kind: kind === 'file' ? 'unexpected' : kind }
  try {
    const entries = await readdir(path, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    return { kind: 'entries', entries }
  } catch (error) {
    return { kind: (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT' ? 'missing' : 'unreadable' }
  }
}

async function collectUsage(root: string, signal?: AbortSignal): Promise<UsageCounter> {
  const usage = createUsage()

  const walk = async (path: string): Promise<void> => {
    signal?.throwIfAborted()
    const kind = await classifyNode(path)
    if (kind === 'missing') return
    if (kind === 'symlink') {
      usage.skippedSymlinkCount++
      return
    }
    if (kind === 'unreadable') {
      usage.unreadableEntryCount++
      return
    }
    if (kind === 'unexpected') {
      usage.unexpectedEntryCount++
      return
    }
    if (kind === 'file') {
      try {
        const details = await lstat(path)
        usage.regularFileCount++
        usage.bytes += details.size
      } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
          usage.unreadableEntryCount++
        }
      }
      return
    }

    usage.directoryCount++
    const directory = await readSafeDirectory(path)
    if (directory.kind !== 'entries') {
      if (directory.kind === 'symlink') usage.skippedSymlinkCount++
      else if (directory.kind === 'unreadable') usage.unreadableEntryCount++
      else if (directory.kind === 'unexpected') usage.unexpectedEntryCount++
      return
    }

    for (const entry of directory.entries) {
      signal?.throwIfAborted()
      if (!isSafeSegment(entry.name)) {
        usage.unexpectedEntryCount++
        continue
      }
      if (entry.isSymbolicLink()) {
        usage.skippedSymlinkCount++
        continue
      }
      await walk(join(path, entry.name))
    }
  }

  await walk(root)
  return usage
}

function toAreaStatistics(usage: UsageCounter, logicalEntryCount: number): StorageAreaStatistics {
  return {
    byteUsage: usage.bytes,
    byteUsageSaturated: false,
    logicalEntryCount,
    regularFileCount: usage.regularFileCount,
    directoryCount: usage.directoryCount,
    skippedSymlinkCount: usage.skippedSymlinkCount,
    unexpectedEntryCount: usage.unexpectedEntryCount,
    unreadableEntryCount: usage.unreadableEntryCount,
    depthLimitCount: 0,
  }
}

/** Storage maintenance is loopback-only and blocks destructive work while parse operations are active. */
export class StorageMaintenanceService {
  constructor(
    public readonly paths: StoragePaths,
    public readonly results: ResultRepository,
    public readonly operations: SharedOperationRegistry,
    public readonly lock: ProcessLock,
    public readonly accessGate: StorageAccessGate = new StorageAccessGate(),
  ) {
    if (paths.root !== results.paths.root || paths.root !== lock.paths.root) {
      throw new TypeError('StorageMaintenanceService paths must match its ResultRepository and ProcessLock')
    }
  }

  static confirmationToken(cacheKeys: readonly CacheKey[]): string {
    return cacheClearConfirmationToken(cacheKeys)
  }

  async getStatistics(signal?: AbortSignal): Promise<StorageStatistics> {
    const [
      publishedUsage,
      stagingUsage,
      quarantineUsage,
      publishedCount,
      stagingCount,
      quarantineCount,
    ] = await Promise.all([
      collectUsage(this.paths.resultsDir(), signal),
      collectUsage(this.paths.stagingDir(), signal),
      collectUsage(this.paths.quarantineDir(), signal),
      this.countPublishedResultDirectories(signal),
      this.countDirectDirectories(this.paths.stagingDir(), value => asOperationId(value), signal),
      this.countDirectDirectories(this.paths.quarantineDir(), value => assertSafePathSegment(value, 'quarantine entry'), signal),
    ])

    return {
      generatedAt: Date.now(),
      publishedResults: toAreaStatistics(publishedUsage, publishedCount),
      staging: toAreaStatistics(stagingUsage, stagingCount),
      quarantine: toAreaStatistics(quarantineUsage, quarantineCount),
    }
  }

  async scanIntegrity(options: IntegrityScanOptions = {}): Promise<CacheIntegrityScanReport> {
    if (options.isolateInvalid !== true) return await this.scanIntegrityInternal(options)

    return await this.lock.withLock(async () => {
      const releaseExclusive = this.acquireDestructiveAccess()
      try {
        return await this.scanIntegrityInternal(options)
      } finally {
        releaseExclusive()
      }
    }, options.signal)
  }

  private async scanIntegrityInternal(options: IntegrityScanOptions): Promise<CacheIntegrityScanReport> {
    const resultLimit = boundedLimit(options.resultLimit, DEFAULT_RESULT_SCAN_LIMIT, MAX_RESULT_SCAN_LIMIT, 'resultLimit')
    const diagnosticLimit = boundedLimit(options.diagnosticLimit, DEFAULT_DIAGNOSTIC_LIMIT, MAX_DIAGNOSTIC_LIMIT, 'diagnosticLimit')
    const isolateInvalid = options.isolateInvalid === true
    const diagnostics = createDiagnostics(diagnosticLimit)
    let validCount = 0
    let corruptCount = 0
    let missingCount = 0
    let unreadableCount = 0
    let quarantinedCount = 0

    const traversal = await this.visitPublishedResults(resultLimit, options.signal, diagnostics, async (cacheKey, resultDir) => {
      const inspection = await this.results.inspectPublished(cacheKey, options.signal)
      if (inspection.status === 'valid') {
        validCount++
        return
      }
      if (inspection.status === 'missing') {
        missingCount++
        addDiagnostic(diagnostics, 'published-results', cacheKey, 'missing-result')
      } else if (inspection.status === 'unreadable') {
        unreadableCount++
        addDiagnostic(diagnostics, 'published-results', cacheKey, 'unreadable-entry')
      } else {
        corruptCount++
        addDiagnostic(
          diagnostics,
          'published-results',
          cacheKey,
          inspection.reason === 'unsafe-entry' ? 'unsafe-result' : 'corrupt-result',
        )
      }

      if (isolateInvalid && inspection.status !== 'unreadable') {
        try {
          await this.results.quarantine(resultDir, 'maintenance_invalid')
          quarantinedCount++
        } catch {
          addDiagnostic(diagnostics, 'published-results', cacheKey, 'quarantine-failed')
        }
      }
    })

    return {
      generatedAt: Date.now(),
      readOnly: !isolateInvalid,
      isolateInvalid,
      validCount,
      corruptCount,
      missingCount,
      unreadableCount,
      quarantinedCount,
      scan: {
        limit: resultLimit,
        scanned: traversal.scanned,
        truncated: traversal.truncated,
        diagnosticsLimit: diagnosticLimit,
        diagnosticsTruncated: diagnostics.truncated,
      },
      diagnostics: diagnostics.diagnostics,
    }
  }

  async listQuarantine(options: QuarantineListOptions = {}): Promise<QuarantineListReport> {
    const limit = boundedLimit(options.limit, DEFAULT_QUARANTINE_LIST_LIMIT, MAX_QUARANTINE_LIST_LIMIT, 'limit')
    const entries: QuarantineEntry[] = []
    let totalBytes = 0
    let totalCount = 0
    let skippedSymlinkCount = 0
    let unexpectedEntryCount = 0
    let unreadableEntryCount = 0

    const root = await readSafeDirectory(this.paths.quarantineDir())
    if (root.kind === 'entries') {
      for (const entry of root.entries) {
        options.signal?.throwIfAborted()
        if (!isSafeSegment(entry.name)) {
          unexpectedEntryCount++
          continue
        }
        if (entry.isSymbolicLink()) {
          skippedSymlinkCount++
          continue
        }
        const entryPath = this.paths.quarantineDir(entry.name)
        const kind = await classifyNode(entryPath)
        if (kind === 'symlink') {
          skippedSymlinkCount++
          continue
        }
        if (kind === 'unreadable') {
          unreadableEntryCount++
          continue
        }
        if (kind !== 'directory') {
          if (kind !== 'missing') unexpectedEntryCount++
          continue
        }

        const usage = await collectUsage(entryPath, options.signal)
        const details = await lstat(entryPath).catch(() => undefined)
        if (details === undefined || details.isSymbolicLink() || !details.isDirectory()) {
          unreadableEntryCount++
          continue
        }
        totalCount++
        totalBytes += usage.bytes
        if (entries.length < limit) {
          entries.push({
            id: entry.name,
            byteUsage: usage.bytes,
            byteUsageSaturated: false,
            regularFileCount: usage.regularFileCount,
            directoryCount: usage.directoryCount,
            modifiedAt: Math.max(0, Math.floor(details.mtimeMs)),
          })
        }
      }
    } else if (root.kind === 'symlink') {
      skippedSymlinkCount++
    } else if (root.kind === 'unreadable') {
      unreadableEntryCount++
    } else if (root.kind === 'unexpected') {
      unexpectedEntryCount++
    }

    return {
      generatedAt: Date.now(),
      entries,
      totalCount,
      totalBytes,
      totalBytesSaturated: false,
      truncated: totalCount > entries.length,
      skippedSymlinkCount,
      unexpectedEntryCount,
      unreadableEntryCount,
    }
  }

  async cleanupQuarantine(options: QuarantineCleanupOptions): Promise<QuarantineCleanupReport> {
    if (options.dryRun !== false) return await this.cleanupQuarantineInternal(options)

    return await this.lock.withLock(async () => {
      const releaseExclusive = this.acquireDestructiveAccess()
      try {
        return await this.cleanupQuarantineInternal(options)
      } finally {
        releaseExclusive()
      }
    }, options.signal)
  }

  private async cleanupQuarantineInternal(options: QuarantineCleanupOptions): Promise<QuarantineCleanupReport> {
    if (!Array.isArray(options.entryIds)) throw new TypeError('entryIds must be an array')
    if (options.entryIds.length > MAX_QUARANTINE_CLEANUP_ENTRIES) {
      throw new TypeError(`entryIds cannot contain more than ${MAX_QUARANTINE_CLEANUP_ENTRIES} entries`)
    }

    const entryIds: string[] = []
    const seen = new Set<string>()
    for (const entryId of options.entryIds) {
      if (typeof entryId !== 'string') throw new TypeError('quarantine entry ID must be a string')
      const safeId = assertSafePathSegment(entryId, 'quarantine entry ID')
      if (!seen.has(safeId)) {
        seen.add(safeId)
        entryIds.push(safeId)
      }
    }

    const dryRun = options.dryRun !== false
    const quarantineRoot = await readSafeDirectory(this.paths.quarantineDir())
    if (quarantineRoot.kind !== 'entries') {
      const rootMissing = quarantineRoot.kind === 'missing'
      return {
        generatedAt: Date.now(),
        dryRun,
        requestedCount: entryIds.length,
        plannedCount: 0,
        plannedBytes: 0,
        plannedBytesSaturated: false,
        deletedCount: 0,
        deletedBytes: 0,
        deletedBytesSaturated: false,
        missingCount: rootMissing ? entryIds.length : 0,
        skippedCount: rootMissing ? 0 : entryIds.length,
        entries: [],
      }
    }

    const plannedEntries: QuarantineEntry[] = []
    let plannedBytes = 0
    let deletedBytes = 0
    let deletedCount = 0
    let missingCount = 0
    let skippedCount = 0

    for (const entryId of entryIds) {
      options.signal?.throwIfAborted()
      const entryPath = this.paths.quarantineDir(entryId)
      if (!isWithinDirectory(entryPath, this.paths.quarantineDir())) {
        skippedCount++
        continue
      }
      const kind = await classifyNode(entryPath)
      if (kind === 'missing') {
        missingCount++
        continue
      }
      if (kind !== 'directory') {
        skippedCount++
        continue
      }

      const usage = await collectUsage(entryPath, options.signal)
      const details = await lstat(entryPath).catch(() => undefined)
      if (details === undefined || details.isSymbolicLink() || !details.isDirectory()) {
        skippedCount++
        continue
      }

      if (usage.skippedSymlinkCount > 0 || usage.unexpectedEntryCount > 0 || usage.unreadableEntryCount > 0) {
        // Preserve malformed quarantine trees for manual investigation.
        skippedCount++
        continue
      }

      const entry: QuarantineEntry = {
        id: entryId,
        byteUsage: usage.bytes,
        byteUsageSaturated: false,
        regularFileCount: usage.regularFileCount,
        directoryCount: usage.directoryCount,
        modifiedAt: Math.max(0, Math.floor(details.mtimeMs)),
      }
      plannedEntries.push(entry)
      plannedBytes += usage.bytes

      if (!dryRun) {
        try {
          if (!await isSafeExistingDirectoryChain(entryPath, options.signal)) {
            skippedCount++
            continue
          }
          await rm(entryPath, { recursive: true, force: true, maxRetries: 2 })
          deletedCount++
          deletedBytes += usage.bytes
        } catch (error) {
          if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') missingCount++
          else skippedCount++
        }
      }
    }

    return {
      generatedAt: Date.now(),
      dryRun,
      requestedCount: entryIds.length,
      plannedCount: plannedEntries.length,
      plannedBytes,
      plannedBytesSaturated: false,
      deletedCount,
      deletedBytes,
      deletedBytesSaturated: false,
      missingCount,
      skippedCount,
      entries: plannedEntries,
    }
  }

  async clearCache(options: CacheClearOptions = {}): Promise<CacheClearReport> {
    const dryRun = options.dryRun !== false
    if (dryRun) {
      return await this.clearCacheInternal(options, false, this.accessGate.activeReaderCount)
    }

    return await this.lock.withLock(async () => {
      const releaseExclusive = this.accessGate.tryAcquireExclusive()
      if (releaseExclusive === undefined) {
        const blocked = await this.clearCacheInternal({ ...options, dryRun: true }, false, this.accessGate.activeReaderCount)
        return { ...blocked, dryRun: false, eligible: false, confirmationToken: undefined }
      }
      try {
        return await this.clearCacheInternal(options, true, 0)
      } finally {
        releaseExclusive()
      }
    }, options.signal)
  }

  private async clearCacheInternal(
    options: CacheClearOptions,
    exclusiveAcquired: boolean,
    activeAccessCount: number,
  ): Promise<CacheClearReport> {
    const resultLimit = boundedLimit(options.resultLimit, DEFAULT_RESULT_SCAN_LIMIT, MAX_RESULT_SCAN_LIMIT, 'resultLimit')
    const diagnosticLimit = boundedLimit(options.diagnosticLimit, DEFAULT_DIAGNOSTIC_LIMIT, MAX_DIAGNOSTIC_LIMIT, 'diagnosticLimit')
    const dryRun = options.dryRun !== false
    const diagnostics = createDiagnostics(diagnosticLimit)
    const planned: Array<{ readonly cacheKey: CacheKey; readonly resultDir: string; readonly byteUsage: number }> = []
    let plannedBytes = 0
    let deletedBytes = 0
    let unsafeResultCount = 0
    let deletedCount = 0
    let skippedCount = 0
    let traversal: TraversalSummary = { scanned: 0, truncated: false, complete: true }

    const resultsKind = await classifyNode(this.paths.resultsDir())
    const safeResultsRoot = resultsKind === 'missing'
      || (resultsKind === 'directory' && await isSafeExistingDirectoryChain(this.paths.resultsDir(), options.signal))
    if (!safeResultsRoot) {
      traversal = { scanned: 0, truncated: false, complete: false }
      addDiagnostic(diagnostics, 'published-results', 'results', resultsKind === 'symlink' ? 'symlink-skipped' : 'unsafe-result')
    } else if (resultsKind === 'directory') {
      traversal = await this.visitPublishedResults(resultLimit, options.signal, diagnostics, async (cacheKey, resultDir) => {
        if (!isWithinDirectory(resultDir, this.paths.resultsDir()) || !await isSafeExistingDirectoryChain(resultDir, options.signal)) {
          unsafeResultCount++
          skippedCount++
          addDiagnostic(diagnostics, 'published-results', cacheKey, 'unsafe-result')
          return
        }
        const usage = await collectUsage(resultDir, options.signal)
        if (usage.skippedSymlinkCount > 0 || usage.unexpectedEntryCount > 0 || usage.unreadableEntryCount > 0) {
          unsafeResultCount++
          skippedCount++
          addDiagnostic(diagnostics, 'published-results', cacheKey, 'unsafe-result')
          return
        }
        planned.push({ cacheKey, resultDir, byteUsage: usage.bytes })
        plannedBytes += usage.bytes
      })
    }

    const token = cacheClearConfirmationToken(planned.map(entry => entry.cacheKey))
    const activeOperationCount = this.operations.activeOperationCount()
    const preflightEligible = activeOperationCount === 0
      && activeAccessCount === 0
      && traversal.complete
      && !traversal.truncated
      && unsafeResultCount === 0
    const tokenMatches = dryRun || (typeof options.confirmationToken === 'string' && options.confirmationToken === token)
    const eligible = preflightEligible && tokenMatches && (dryRun || exclusiveAcquired)

    if (!dryRun && eligible) {
      for (const entry of planned) {
        options.signal?.throwIfAborted()
        try {
          if (!await isSafeExistingDirectoryChain(entry.resultDir, options.signal)) {
            skippedCount++
            continue
          }
          await rm(entry.resultDir, { recursive: true, force: true, maxRetries: 2 })
          deletedCount++
          deletedBytes += entry.byteUsage
        } catch (error) {
          if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
            skippedCount++
          }
        }
      }
    }

    return {
      generatedAt: Date.now(),
      dryRun,
      eligible,
      activeOperationCount,
      activeAccessCount,
      ...(dryRun && preflightEligible && planned.length > 0 ? { confirmationToken: token } : {}),
      plannedCount: planned.length,
      plannedBytes,
      plannedBytesSaturated: false,
      deletedCount,
      deletedBytes,
      deletedBytesSaturated: false,
      skippedCount,
      scan: {
        limit: resultLimit,
        scanned: traversal.scanned,
        truncated: traversal.truncated,
        diagnosticsLimit: diagnosticLimit,
        diagnosticsTruncated: diagnostics.truncated,
      },
      diagnostics: diagnostics.diagnostics,
    }
  }

  async gcDryRun(options: GcDryRunOptions = {}): Promise<GcDryRunReport> {
    const resultLimit = boundedLimit(options.resultLimit, DEFAULT_RESULT_SCAN_LIMIT, MAX_RESULT_SCAN_LIMIT, 'resultLimit')
    const candidateLimit = boundedLimit(options.candidateLimit, DEFAULT_GC_CANDIDATE_LIMIT, MAX_GC_CANDIDATE_LIMIT, 'candidateLimit')
    const diagnosticLimit = boundedLimit(options.diagnosticLimit, DEFAULT_DIAGNOSTIC_LIMIT, MAX_DIAGNOSTIC_LIMIT, 'diagnosticLimit')
    const diagnostics = createDiagnostics(diagnosticLimit)
    const candidates: GcCandidate[] = []
    let candidateBytes = 0
    let candidateCount = 0
    let invalidResultCount = 0
    let unsafeResultCount = 0
    let traversal: TraversalSummary = { scanned: 0, truncated: false, complete: true }

    traversal = await this.visitPublishedResults(resultLimit, options.signal, diagnostics, async (cacheKey, resultDir) => {
      const inspection = await this.results.inspectPublished(cacheKey, options.signal)
      if (inspection.status !== 'valid') {
        invalidResultCount++
        addDiagnostic(
          diagnostics,
          'published-results',
          cacheKey,
          inspection.status === 'missing' ? 'missing-result' : inspection.status === 'unreadable' ? 'unreadable-entry' : 'corrupt-result',
        )
        return
      }

      const usage = await collectUsage(resultDir, options.signal)
      if (usage.skippedSymlinkCount > 0 || usage.unexpectedEntryCount > 0 || usage.unreadableEntryCount > 0) {
        unsafeResultCount++
        addDiagnostic(diagnostics, 'published-results', cacheKey, 'unsafe-result')
        return
      }

      candidateCount++
      candidateBytes += usage.bytes
      if (candidates.length < candidateLimit) {
        candidates.push({
          cacheKey,
          resultId: inspection.manifest.id,
          byteUsage: usage.bytes,
          byteUsageSaturated: false,
        })
      }
    })

    return {
      generatedAt: Date.now(),
      dryRun: true,
      referencePolicy: 'all-published-results',
      eligible: traversal.complete && !traversal.truncated,
      candidateCount,
      candidateBytes,
      candidateBytesSaturated: false,
      candidates,
      candidatesTruncated: candidateCount > candidates.length,
      candidateTotalsComplete: traversal.complete && !traversal.truncated,
      invalidResultCount,
      unsafeResultCount,
      scan: {
        limit: resultLimit,
        scanned: traversal.scanned,
        truncated: traversal.truncated,
        diagnosticsLimit: diagnosticLimit,
        diagnosticsTruncated: diagnostics.truncated,
      },
      diagnostics: diagnostics.diagnostics,
    }
  }

  private acquireDestructiveAccess(): () => void {
    if (this.operations.activeOperationCount() > 0) {
      throwMinerU('STORAGE_LOCKED', 'MinerU storage is in use by an active parse operation')
    }
    const releaseExclusive = this.accessGate.tryAcquireExclusive()
    if (releaseExclusive === undefined) {
      throwMinerU('STORAGE_LOCKED', 'MinerU storage is in use by an active reader')
    }
    if (this.operations.activeOperationCount() > 0) {
      releaseExclusive()
      throwMinerU('STORAGE_LOCKED', 'MinerU storage is in use by an active parse operation')
    }
    return releaseExclusive
  }

  private async countPublishedResultDirectories(signal?: AbortSignal): Promise<number> {
    const traversal = await this.visitPublishedResults(Number.MAX_SAFE_INTEGER, signal, undefined, async () => undefined)
    return traversal.scanned
  }

  private async countDirectDirectories<T>(
    root: string,
    parser: (value: string) => T,
    signal?: AbortSignal,
  ): Promise<number> {
    const directory = await readSafeDirectory(root)
    if (directory.kind !== 'entries') return 0
    let count = 0
    for (const entry of directory.entries) {
      signal?.throwIfAborted()
      if (!isSafeSegment(entry.name) || entry.isSymbolicLink()) continue
      try {
        parser(entry.name)
      } catch {
        continue
      }
      if (await classifyNode(join(root, entry.name)) === 'directory') count++
    }
    return count
  }

  private async visitPublishedResults(
    limit: number,
    signal: AbortSignal | undefined,
    diagnostics: DiagnosticCollector | undefined,
    visitor: (cacheKey: CacheKey, resultDir: string) => Promise<void>,
  ): Promise<TraversalSummary> {
    const root = await readSafeDirectory(this.paths.resultsDir())
    if (root.kind !== 'entries') {
      this.recordDirectoryIssue(diagnostics, 'published-results', 'results', root.kind)
      return { scanned: 0, truncated: false, complete: root.kind === 'missing' }
    }

    let scanned = 0
    let complete = true
    for (const prefixEntry of root.entries) {
      signal?.throwIfAborted()
      if (!isSafeSegment(prefixEntry.name) || !/^[a-f0-9]{2}$/.test(prefixEntry.name)) {
        complete = false
        addDiagnostic(diagnostics, 'published-results', prefixEntry.name, 'unexpected-entry')
        continue
      }
      if (prefixEntry.isSymbolicLink()) {
        complete = false
        addDiagnostic(diagnostics, 'published-results', prefixEntry.name, 'symlink-skipped')
        continue
      }
      const prefixPath = join(this.paths.resultsDir(), prefixEntry.name)
      const prefix = await readSafeDirectory(prefixPath)
      if (prefix.kind !== 'entries') {
        complete = false
        this.recordDirectoryIssue(diagnostics, 'published-results', prefixEntry.name, prefix.kind)
        continue
      }

      for (const resultEntry of prefix.entries) {
        signal?.throwIfAborted()
        if (scanned >= limit) return { scanned, truncated: true, complete: false }
        if (!isSafeSegment(resultEntry.name) || resultEntry.isSymbolicLink()) {
          complete = false
          addDiagnostic(diagnostics, 'published-results', resultEntry.name, resultEntry.isSymbolicLink() ? 'symlink-skipped' : 'unexpected-entry')
          continue
        }
        let cacheKey: CacheKey
        try {
          cacheKey = asCacheKey(resultEntry.name)
        } catch {
          complete = false
          addDiagnostic(diagnostics, 'published-results', resultEntry.name, 'unexpected-entry')
          continue
        }
        if (cacheKey.slice(0, 2) !== prefixEntry.name) {
          complete = false
          addDiagnostic(diagnostics, 'published-results', resultEntry.name, 'unexpected-entry')
          continue
        }
        const resultDir = this.paths.resultDir(cacheKey)
        if (resultDir !== join(prefixPath, resultEntry.name)) {
          complete = false
          addDiagnostic(diagnostics, 'published-results', resultEntry.name, 'unexpected-entry')
          continue
        }
        const kind = await classifyNode(resultDir)
        if (kind !== 'directory') {
          complete = false
          this.recordDirectoryIssue(diagnostics, 'published-results', cacheKey, kind)
          continue
        }
        scanned++
        await visitor(cacheKey, resultDir)
      }
    }

    return { scanned, truncated: false, complete }
  }

  private recordDirectoryIssue(
    diagnostics: DiagnosticCollector | undefined,
    area: StorageMaintenanceArea,
    entry: string,
    kind: Exclude<NodeKind | SafeDirectory['kind'], 'entries'>,
  ): void {
    if (kind === 'missing') return
    if (kind === 'symlink') addDiagnostic(diagnostics, area, entry, 'symlink-skipped')
    else if (kind === 'unreadable') addDiagnostic(diagnostics, area, entry, 'unreadable-entry')
    else addDiagnostic(diagnostics, area, entry, 'unexpected-entry')
  }
}
