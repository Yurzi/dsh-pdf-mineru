/**
 * storage-maintenance.ts - Bounded, path-safe maintenance inventory for MinerU storage.
 *
 * This module is intentionally privileged and storage-local. It never accepts an
 * arbitrary filesystem path, never follows symlink entries, and only exposes
 * bounded summary data for the loopback RPC and settings UI.
 */

import { chmod, lstat, readdir, realpath, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { type Dirent } from 'node:fs'
import { join, parse, resolve, sep } from 'node:path'
import {
  asCacheKey,
  asOperationId,
  assertSafePathSegment,
  type CacheKey,
  type MinerUResultId,
} from '../domain/ids.js'
import { throwMinerU } from '../domain/errors.js'
import type { ResultRepository } from './result-repository.js'
import type { SharedOperationRegistry } from '../service/shared-operations.js'
import type { ProcessLock } from './process-lock.js'
import { StorageAccessGate } from './access-gate.js'
import type { StoragePaths } from './paths.js'

const DEFAULT_RESULT_SCAN_LIMIT = 10_000
const DEFAULT_DIAGNOSTIC_LIMIT = 100
const DEFAULT_QUARANTINE_LIST_LIMIT = 100
const DEFAULT_GC_CANDIDATE_LIMIT = 100
const MAX_RESULT_SCAN_LIMIT = 50_000
const MAX_DIAGNOSTIC_LIMIT = 1_000
const MAX_QUARANTINE_LIST_LIMIT = 1_000
const MAX_GC_CANDIDATE_LIMIT = 1_000
const MAX_QUARANTINE_CLEANUP_ENTRIES = 100
const MAX_WALK_DEPTH = 64

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

/**
 * Byte usage is the sum of regular files reached without crossing a symlink.
 * logicalEntryCount is a safe layout-shaped record/directory count, not a
 * declaration that every persisted record has passed schema validation.
 */
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

/**
 * This operation never deletes data. It reports only fully validated published
 * result directories that are eligible under the current retention policy.
 */
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
  bytesSaturated: boolean
  regularFileCount: number
  directoryCount: number
  skippedSymlinkCount: number
  unexpectedEntryCount: number
  unreadableEntryCount: number
  depthLimitCount: number
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
    bytesSaturated: false,
    regularFileCount: 0,
    directoryCount: 0,
    skippedSymlinkCount: 0,
    unexpectedEntryCount: 0,
    unreadableEntryCount: 0,
    depthLimitCount: 0,
  }
}

function addBytes(counter: UsageCounter, amount: number): void {
  if (!Number.isSafeInteger(amount) || amount < 0 || counter.bytes > Number.MAX_SAFE_INTEGER - amount) {
    counter.bytes = Number.MAX_SAFE_INTEGER
    counter.bytesSaturated = true
    return
  }
  counter.bytes += amount
}

function addTotal(current: { value: number; saturated: boolean }, amount: number, saturated: boolean): void {
  if (saturated || !Number.isSafeInteger(amount) || amount < 0 || current.value > Number.MAX_SAFE_INTEGER - amount) {
    current.value = Number.MAX_SAFE_INTEGER
    current.saturated = true
    return
  }
  current.value += amount
}

function boundedLimit(value: number | undefined, fallback: number, maximum: number, label: string): number {
  const resolved = value === undefined ? fallback : value
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum) {
    throw new TypeError(label + ' must be a positive safe integer no greater than ' + String(maximum))
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

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code
}

function isMissing(error: unknown): boolean {
  return errnoCode(error) === 'ENOENT'
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
    return isMissing(error) ? 'missing' : 'unreadable'
  }
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

function cacheClearConfirmationToken(cacheKeys: readonly CacheKey[]): string {
  const ordered = [...cacheKeys].sort()
  return 'cache-clear-' + createHash('sha256').update(JSON.stringify(ordered), 'utf8').digest('hex')
}

async function readSafeDirectory(path: string): Promise<SafeDirectory> {
  const kind = await classifyNode(path)
  if (kind !== 'directory') return { kind: kind === 'file' ? 'unexpected' : kind }
  try {
    const entries = await readdir(path, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    return { kind: 'entries', entries }
  } catch (error) {
    return { kind: isMissing(error) ? 'missing' : 'unreadable' }
  }
}

async function collectUsage(root: string, signal?: AbortSignal): Promise<UsageCounter> {
  const usage = createUsage()

  const walk = async (path: string, depth: number): Promise<void> => {
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
        addBytes(usage, details.size)
      } catch (error) {
        if (!isMissing(error)) usage.unreadableEntryCount++
      }
      return
    }

    usage.directoryCount++
    if (depth >= MAX_WALK_DEPTH) {
      usage.depthLimitCount++
      return
    }

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
      await walk(join(path, entry.name), depth + 1)
    }
  }

  await walk(root, 0)
  return usage
}

async function makeTreeWritable(root: string, signal?: AbortSignal): Promise<boolean> {
  const files: string[] = []
  const directories: string[] = []
  const validate = async (path: string, depth: number): Promise<boolean> => {
    signal?.throwIfAborted()
    if (depth > MAX_WALK_DEPTH) return false
    const kind = await classifyNode(path)
    if (kind === 'file') { files.push(path); return true }
    if (kind !== 'directory') return false
    const directory = await readSafeDirectory(path)
    if (directory.kind !== 'entries') return false
    directories.push(path)
    for (const entry of directory.entries) {
      if (!isSafeSegment(entry.name) || entry.isSymbolicLink()) return false
      if (!await validate(join(path, entry.name), depth + 1)) return false
    }
    return true
  }

  if (!await validate(root, 0)) return false
  try {
    for (const file of files) {
      signal?.throwIfAborted()
      if (await classifyNode(file) !== 'file') throw new TypeError('cache file changed during deletion')
      await chmod(file, 0o600)
    }
    for (const directory of [...directories].reverse()) {
      signal?.throwIfAborted()
      if (await classifyNode(directory) !== 'directory') throw new TypeError('cache directory changed during deletion')
      await chmod(directory, 0o700)
    }
    return true
  } catch {
    for (const file of files) await chmod(file, 0o400).catch(() => undefined)
    for (const directory of directories) await chmod(directory, directory === root ? 0o500 : 0o555).catch(() => undefined)
    return false
  }
}

async function restoreTreeReadOnly(root: string): Promise<void> {
  if (!await isSafeExistingDirectoryChain(root)) return
  const restore = async (path: string, isRoot: boolean): Promise<void> => {
    const kind = await classifyNode(path)
    if (kind === 'file') { await chmod(path, 0o400).catch(() => undefined); return }
    if (kind !== 'directory') return
    const directory = await readSafeDirectory(path)
    if (directory.kind !== 'entries') return
    for (const entry of directory.entries) {
      if (!isSafeSegment(entry.name) || entry.isSymbolicLink()) continue
      await restore(join(path, entry.name), false)
    }
    await chmod(path, isRoot ? 0o500 : 0o555).catch(() => undefined)
  }
  await restore(root, true)
}

function toAreaStatistics(usage: UsageCounter, logicalEntryCount: number): StorageAreaStatistics {
  return {
    byteUsage: usage.bytes,
    byteUsageSaturated: usage.bytesSaturated,
    logicalEntryCount,
    regularFileCount: usage.regularFileCount,
    directoryCount: usage.directoryCount,
    skippedSymlinkCount: usage.skippedSymlinkCount,
    unexpectedEntryCount: usage.unexpectedEntryCount,
    unreadableEntryCount: usage.unreadableEntryCount,
    depthLimitCount: usage.depthLimitCount,
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

  async getStatistics(signal?: AbortSignal): Promise<StorageStatistics> {
    this.assertLockHeld()
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
    this.assertLockHeld()
    if (options.isolateInvalid !== true) return await this.scanIntegrityInternal(options)

    const releaseExclusive = this.acquireDestructiveAccess()
    try {
      return await this.scanIntegrityInternal(options)
    } finally {
      releaseExclusive()
    }
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
    this.assertLockHeld()
    const limit = boundedLimit(options.limit, DEFAULT_QUARANTINE_LIST_LIMIT, MAX_QUARANTINE_LIST_LIMIT, 'limit')
    const entries: QuarantineEntry[] = []
    const totals = { value: 0, saturated: false }
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
        addTotal(totals, usage.bytes, usage.bytesSaturated)
        if (entries.length < limit) {
          entries.push({
            id: entry.name,
            byteUsage: usage.bytes,
            byteUsageSaturated: usage.bytesSaturated,
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
      totalBytes: totals.value,
      totalBytesSaturated: totals.saturated,
      truncated: totalCount > entries.length,
      skippedSymlinkCount,
      unexpectedEntryCount,
      unreadableEntryCount,
    }
  }

  async cleanupQuarantine(options: QuarantineCleanupOptions): Promise<QuarantineCleanupReport> {
    this.assertLockHeld()
    if (options.dryRun !== false) return await this.cleanupQuarantineInternal(options)

    const releaseExclusive = this.acquireDestructiveAccess()
    try {
      return await this.cleanupQuarantineInternal(options)
    } finally {
      releaseExclusive()
    }
  }

  private async cleanupQuarantineInternal(options: QuarantineCleanupOptions): Promise<QuarantineCleanupReport> {
    if (!Array.isArray(options.entryIds)) throw new TypeError('entryIds must be an array')
    if (options.entryIds.length > MAX_QUARANTINE_CLEANUP_ENTRIES) {
      throw new TypeError('entryIds cannot contain more than ' + String(MAX_QUARANTINE_CLEANUP_ENTRIES) + ' entries')
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
    const plannedTotals = { value: 0, saturated: false }
    const deletedTotals = { value: 0, saturated: false }
    let deletedCount = 0
    let missingCount = 0
    let skippedCount = 0

    for (const entryId of entryIds) {
      options.signal?.throwIfAborted()
      const entryPath = this.paths.quarantineDir(entryId)
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

      if (usage.skippedSymlinkCount > 0 || usage.unexpectedEntryCount > 0 || usage.unreadableEntryCount > 0 || usage.depthLimitCount > 0) {
        // Preserve malformed quarantine trees for manual investigation.
        skippedCount++
        continue
      }

      const entry: QuarantineEntry = {
        id: entryId,
        byteUsage: usage.bytes,
        byteUsageSaturated: usage.bytesSaturated,
        regularFileCount: usage.regularFileCount,
        directoryCount: usage.directoryCount,
        modifiedAt: Math.max(0, Math.floor(details.mtimeMs)),
      }
      plannedEntries.push(entry)
      addTotal(plannedTotals, usage.bytes, usage.bytesSaturated)

      if (!dryRun) {
        try {
          if (!await makeTreeWritable(entryPath, options.signal)) {
            skippedCount++
            continue
          }
          // entryPath is derived solely from a validated quarantine segment.
          await rm(entryPath, { recursive: true, force: false, maxRetries: 1 })
          deletedCount++
          addTotal(deletedTotals, usage.bytes, usage.bytesSaturated)
        } catch (error) {
          if (isMissing(error)) missingCount++
          else skippedCount++
        }
      }
    }

    return {
      generatedAt: Date.now(),
      dryRun,
      requestedCount: entryIds.length,
      plannedCount: plannedEntries.length,
      plannedBytes: plannedTotals.value,
      plannedBytesSaturated: plannedTotals.saturated,
      deletedCount,
      deletedBytes: deletedTotals.value,
      deletedBytesSaturated: deletedTotals.saturated,
      missingCount,
      skippedCount,
      entries: plannedEntries,
    }
  }

  async clearCache(options: CacheClearOptions = {}): Promise<CacheClearReport> {
    this.assertLockHeld()
    const dryRun = options.dryRun !== false
    if (dryRun) {
      return await this.clearCacheInternal(options, false, this.accessGate.activeReaderCount)
    }

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
    const planned: Array<{ readonly cacheKey: CacheKey; readonly resultDir: string; readonly byteUsage: number; readonly byteUsageSaturated: boolean }> = []
    const plannedTotals = { value: 0, saturated: false }
    const deletedTotals = { value: 0, saturated: false }
    let unsafeResultCount = 0
    let deletedCount = 0
    const deletedCacheKeys = new Set<CacheKey>()
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
        if (!await isSafeExistingDirectoryChain(resultDir, options.signal)) {
          unsafeResultCount++
          skippedCount++
          addDiagnostic(diagnostics, 'published-results', cacheKey, 'unsafe-result')
          return
        }
        const usage = await collectUsage(resultDir, options.signal)
        if (usage.skippedSymlinkCount > 0 || usage.unexpectedEntryCount > 0 || usage.unreadableEntryCount > 0 || usage.depthLimitCount > 0) {
          unsafeResultCount++
          skippedCount++
          addDiagnostic(diagnostics, 'published-results', cacheKey, 'unsafe-result')
          return
        }
        planned.push({ cacheKey, resultDir, byteUsage: usage.bytes, byteUsageSaturated: usage.bytesSaturated })
        addTotal(plannedTotals, usage.bytes, usage.bytesSaturated)
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
          if (!await isSafeExistingDirectoryChain(entry.resultDir, options.signal)
            || !await makeTreeWritable(entry.resultDir, options.signal)) {
            skippedCount++
            continue
          }
          const revalidated = await collectUsage(entry.resultDir, options.signal)
          const stillSafe = await isSafeExistingDirectoryChain(entry.resultDir, options.signal)
            && revalidated.skippedSymlinkCount === 0
            && revalidated.unexpectedEntryCount === 0
            && revalidated.unreadableEntryCount === 0
            && revalidated.depthLimitCount === 0
          if (!stillSafe) {
            skippedCount++
            await restoreTreeReadOnly(entry.resultDir)
            continue
          }
          await rm(entry.resultDir, { recursive: true, force: false, maxRetries: 1 })
          deletedCount++
          deletedCacheKeys.add(entry.cacheKey)
          addTotal(deletedTotals, entry.byteUsage, entry.byteUsageSaturated)
        } catch (error) {
          if (!isMissing(error)) {
            skippedCount++
            await restoreTreeReadOnly(entry.resultDir)
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
      plannedBytes: plannedTotals.value,
      plannedBytesSaturated: plannedTotals.saturated,
      deletedCount,
      deletedBytes: deletedTotals.value,
      deletedBytesSaturated: deletedTotals.saturated,
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
    this.assertLockHeld()
    const resultLimit = boundedLimit(options.resultLimit, DEFAULT_RESULT_SCAN_LIMIT, MAX_RESULT_SCAN_LIMIT, 'resultLimit')
    const candidateLimit = boundedLimit(options.candidateLimit, DEFAULT_GC_CANDIDATE_LIMIT, MAX_GC_CANDIDATE_LIMIT, 'candidateLimit')
    const diagnosticLimit = boundedLimit(options.diagnosticLimit, DEFAULT_DIAGNOSTIC_LIMIT, MAX_DIAGNOSTIC_LIMIT, 'diagnosticLimit')
    const diagnostics = createDiagnostics(diagnosticLimit)
    const candidates: GcCandidate[] = []
    const candidateTotals = { value: 0, saturated: false }
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
        if (usage.skippedSymlinkCount > 0 || usage.unexpectedEntryCount > 0 || usage.unreadableEntryCount > 0 || usage.depthLimitCount > 0) {
          unsafeResultCount++
          addDiagnostic(diagnostics, 'published-results', cacheKey, 'unsafe-result')
          return
        }

        candidateCount++
        addTotal(candidateTotals, usage.bytes, usage.bytesSaturated)
        if (candidates.length < candidateLimit) {
          candidates.push({
            cacheKey,
            resultId: inspection.manifest.id,
            byteUsage: usage.bytes,
            byteUsageSaturated: usage.bytesSaturated,
          })
        }
    })

    return {
      generatedAt: Date.now(),
      dryRun: true,
      referencePolicy: 'all-published-results',
      eligible: traversal.complete && !traversal.truncated,
      candidateCount,
      candidateBytes: candidateTotals.value,
      candidateBytesSaturated: candidateTotals.saturated,
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

  private assertLockHeld(): void {
    if (!this.lock.isHeld()) {
      throwMinerU('STORAGE_LOCKED', 'MinerU storage maintenance requires the active process lock')
    }
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
