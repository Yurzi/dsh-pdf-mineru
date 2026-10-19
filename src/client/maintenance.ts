import type {
  CacheClearReport,
  QuarantineCleanupReport,
  StorageAreaStatistics,
  StorageStatistics,
} from '../contracts/maintenance.js'
import type { RpcPayloads } from '../contracts/rpc.js'

export const DIAGNOSTIC_LIMIT = 50
export const QUARANTINE_LIST_LIMIT = 100

type CacheClearPayload = RpcPayloads['mineru/storage.cache.clear']
type QuarantineCleanupPayload = RpcPayloads['mineru/storage.quarantine.cleanup']

/** Read-only preview; the server answers with a confirmation token when deletion would be allowed. */
export function cacheClearPreviewRequest(): CacheClearPayload {
  return { dry_run: true, diagnostic_limit: DIAGNOSTIC_LIMIT }
}

/** Deletion bound to one eligible preview, or undefined when that preview does not permit it. */
export function cacheClearConfirmRequest(preview: CacheClearReport): CacheClearPayload | undefined {
  if (!preview.dryRun || !preview.eligible || preview.confirmationToken === undefined) return undefined
  return { dry_run: false, confirm: true, confirmation_token: preview.confirmationToken, diagnostic_limit: DIAGNOSTIC_LIMIT }
}

export function quarantinePreviewRequest(entryIds: readonly string[]): QuarantineCleanupPayload | undefined {
  return entryIds.length === 0 ? undefined : { entry_ids: [...entryIds], dry_run: true }
}

/** Deletion limited to the entries the preview actually planned. */
export function quarantineConfirmRequest(preview: QuarantineCleanupReport): QuarantineCleanupPayload | undefined {
  if (!preview.dryRun || preview.entries.length === 0) return undefined
  return { entry_ids: preview.entries.map(entry => entry.id), dry_run: false, confirm: true }
}

export function isPartialArea(area: StorageAreaStatistics): boolean {
  return !area.complete || area.truncated || area.depthLimitCount > 0
}

export function isPartialStatistics(stats: StorageStatistics): boolean {
  return [stats.publishedResults, stats.staging, stats.quarantine].some(isPartialArea)
}

export function toggleSelection(selected: readonly string[], id: string): readonly string[] {
  return selected.includes(id) ? selected.filter(candidate => candidate !== id) : [...selected, id]
}
