import type { IntegrityScanOptions, CacheIntegrityScanReport } from '../../contracts/maintenance.js'
import type { StoragePaths } from '../paths.js'
import type { ResultRepository } from '../result-repository.js'
import type { ProcessLock, ProcessLockScope } from '../process-lock.js'
import { boundedLimit, DEFAULT_RESULT_SCAN_LIMIT, MAX_RESULT_SCAN_LIMIT, DEFAULT_DIAGNOSTIC_LIMIT, MAX_DIAGNOSTIC_LIMIT } from './limits.js'
import { createDiagnostics, addDiagnostic } from './diagnostics.js'
import { visitPublishedResults } from './published-walk.js'

export async function scanIntegrity(
  paths: StoragePaths,
  results: ResultRepository,
  lock: ProcessLock,
  options: IntegrityScanOptions,
  scope?: ProcessLockScope,
): Promise<CacheIntegrityScanReport> {
  const resultLimit = boundedLimit(options.resultLimit, DEFAULT_RESULT_SCAN_LIMIT, MAX_RESULT_SCAN_LIMIT, 'resultLimit')
  const diagnosticLimit = boundedLimit(options.diagnosticLimit, DEFAULT_DIAGNOSTIC_LIMIT, MAX_DIAGNOSTIC_LIMIT, 'diagnosticLimit')
  const isolateInvalid = options.isolateInvalid === true
  const diagnostics = createDiagnostics(diagnosticLimit)
  let validCount = 0
  let corruptCount = 0
  let missingCount = 0
  let unreadableCount = 0
  let quarantinedCount = 0

  const traversal = await visitPublishedResults(paths, resultLimit, options.signal, diagnostics, async (cacheKey, resultDir) => {
    const inspection = await results.inspectPublished(cacheKey, options.signal)
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
        if (scope === undefined) throw new TypeError('Integrity isolation requires maintenance scope')
        await results.quarantineScoped(lock, scope, resultDir, 'maintenance_invalid')
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
