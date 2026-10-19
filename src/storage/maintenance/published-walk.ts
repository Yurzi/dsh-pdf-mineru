import { join } from 'node:path'
import { asCacheKey, type CacheKey } from '../../domain/ids.js'
import type { StorageMaintenanceArea } from '../../contracts/maintenance.js'
import type { StoragePaths } from '../paths.js'
import { addDiagnostic, type DiagnosticCollector } from './diagnostics.js'
import { classifyNode, isSafeSegment, readSafeDirectory, MAX_STATS_ENTRIES, MAX_STATS_TIME_MS, type NodeKind, type SafeDirectory } from './fs-safety.js'

export interface TraversalSummary {
  readonly scanned: number
  readonly truncated: boolean
  readonly complete: boolean
}

export async function visitPublishedResults(
  paths: StoragePaths,
  limit: number,
  signal: AbortSignal | undefined,
  diagnostics: DiagnosticCollector | undefined,
  visitor: (cacheKey: CacheKey, resultDir: string) => Promise<void>,
): Promise<TraversalSummary> {
  const root = await readSafeDirectory(paths.resultsDir(), signal)
  if (root.kind !== 'entries') {
    recordDirectoryIssue(diagnostics, 'published-results', 'results', root.kind)
    return { scanned: 0, truncated: false, complete: root.kind === 'missing' }
  }

  let scanned = 0
  let inspected = 0
  const deadline = Date.now() + MAX_STATS_TIME_MS
  let complete = !root.truncated
  let truncated = root.truncated
  for (const prefixEntry of root.entries) {
    signal?.throwIfAborted()
    if (inspected++ >= MAX_STATS_ENTRIES || Date.now() > deadline) {
      return { scanned, truncated: true, complete: false }
    }
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
    const prefixPath = join(paths.resultsDir(), prefixEntry.name)
    const prefix = await readSafeDirectory(prefixPath, signal)
    if (prefix.kind !== 'entries') {
      complete = false
      recordDirectoryIssue(diagnostics, 'published-results', prefixEntry.name, prefix.kind)
      continue
    }
    if (prefix.truncated) { complete = false; truncated = true }

    for (const resultEntry of prefix.entries) {
      signal?.throwIfAborted()
      if (inspected++ >= MAX_STATS_ENTRIES || Date.now() > deadline) {
        return { scanned, truncated: true, complete: false }
      }
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
      const resultDir = paths.resultDir(cacheKey)
      if (resultDir !== join(prefixPath, resultEntry.name)) {
        complete = false
        addDiagnostic(diagnostics, 'published-results', resultEntry.name, 'unexpected-entry')
        continue
      }
      const kind = await classifyNode(resultDir)
      if (kind !== 'directory') {
        complete = false
        recordDirectoryIssue(diagnostics, 'published-results', cacheKey, kind)
        continue
      }
      scanned++
      await visitor(cacheKey, resultDir)
    }
  }

  return { scanned, truncated, complete }
}

function recordDirectoryIssue(
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
