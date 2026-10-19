import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'
import type { CacheClearOptions, CacheClearReport } from '../../contracts/maintenance.js'
import type { CacheKey } from '../../domain/ids.js'
import type { StoragePaths } from '../paths.js'
import type { ActiveOperations } from './active-operations.js'
import { boundedLimit, DEFAULT_RESULT_SCAN_LIMIT, MAX_RESULT_SCAN_LIMIT, DEFAULT_DIAGNOSTIC_LIMIT, MAX_DIAGNOSTIC_LIMIT } from './limits.js'
import { createDiagnostics, addDiagnostic } from './diagnostics.js'
import { classifyNode, isSafeExistingDirectoryChain, isWithinDirectory, collectUsage } from './fs-safety.js'
import { visitPublishedResults, type TraversalSummary } from './published-walk.js'

export function cacheClearConfirmationToken(cacheKeys: readonly CacheKey[]): string {
  const ordered = [...cacheKeys].sort()
  return 'cache-clear-' + createHash('sha256').update(JSON.stringify(ordered), 'utf8').digest('hex')
}

export async function clearCache(
  paths: StoragePaths,
  operations: ActiveOperations,
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

  const resultsKind = await classifyNode(paths.resultsDir())
  const safeResultsRoot = resultsKind === 'missing'
    || (resultsKind === 'directory' && await isSafeExistingDirectoryChain(paths.resultsDir(), options.signal))
  if (!safeResultsRoot) {
    traversal = { scanned: 0, truncated: false, complete: false }
    addDiagnostic(diagnostics, 'published-results', 'results', resultsKind === 'symlink' ? 'symlink-skipped' : 'unsafe-result')
  } else if (resultsKind === 'directory') {
    traversal = await visitPublishedResults(paths, resultLimit, options.signal, diagnostics, async (cacheKey, resultDir) => {
      if (!isWithinDirectory(resultDir, paths.resultsDir()) || !await isSafeExistingDirectoryChain(resultDir, options.signal)) {
        unsafeResultCount++
        skippedCount++
        addDiagnostic(diagnostics, 'published-results', cacheKey, 'unsafe-result')
        return
      }
      const usage = await collectUsage(resultDir, options.signal)
      if (usage.truncated || usage.depthLimitCount > 0 || usage.skippedSymlinkCount > 0 || usage.unexpectedEntryCount > 0 || usage.unreadableEntryCount > 0) {
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
  const activeOperationCount = operations.activeOperationCount()
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
    deletedCount,
    deletedBytes,
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
