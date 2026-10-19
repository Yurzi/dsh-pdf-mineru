import type { StorageMaintenanceArea, StorageMaintenanceDiagnosticCode, StorageMaintenanceDiagnostic } from '../../contracts/maintenance.js'
import { isSafeSegment } from './fs-safety.js'

export interface DiagnosticCollector {
  readonly limit: number
  readonly diagnostics: StorageMaintenanceDiagnostic[]
  truncated: boolean
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

export function createDiagnostics(limit: number): DiagnosticCollector {
  return { limit, diagnostics: [], truncated: false }
}

export function addDiagnostic(
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
