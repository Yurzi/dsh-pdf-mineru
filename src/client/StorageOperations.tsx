import { useState } from 'react'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type {
  CacheClearReport,
  CacheIntegrityScanReport,
  GcDryRunReport,
  QuarantineCleanupReport,
  QuarantineListReport,
  StorageAreaStatistics,
  StorageStatistics,
} from '../storage/maintenance-service.js'
import type { MineruKey } from './locales.js'
import css from './SettingsPage.module.css'

export interface StorageOperationsProps {
  readonly rpc: ClientConnectionRpc
  readonly t: (key: MineruKey) => string
}

type MaintenanceAction = 'stats' | 'scan' | 'gc' | 'cache-clear-preview' | 'cache-clear-delete' | 'quarantine' | 'cleanup-preview' | 'cleanup-delete'

interface MaintenanceState {
  readonly busy?: MaintenanceAction
  readonly error?: string
  readonly stats?: StorageStatistics
  readonly scan?: CacheIntegrityScanReport
  readonly gc?: GcDryRunReport
  readonly cacheClear?: CacheClearReport
  readonly quarantine?: QuarantineListReport
  readonly cleanup?: QuarantineCleanupReport
}

export function formatBytes(bytes: number, saturated = false): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'N/A'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const precision = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2
  return (saturated ? '>= ' : '') + value.toFixed(precision) + ' ' + units[unit]
}

async function callMaintenance<T>(
  rpc: ClientConnectionRpc, endpoint: string, payload: unknown = {},
): Promise<T> {
  const result = await rpc.call<T>('/dsh-pdf-mineru-api', endpoint, payload)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function isPartialArea(area: StorageAreaStatistics): boolean {
  return area.complete === false || area.truncated === true || area.depthLimitCount > 0
}

function AreaMetric({ label, area }: { readonly label: string; readonly area: StorageAreaStatistics }) {
  const partial = isPartialArea(area)
  return (
    <div className={css.metric}>
      <dt>{label}</dt>
      <dd>{formatBytes(area.byteUsage, area.byteUsageSaturated || partial)}</dd>
      <dd>{partial ? '>= ' : ''}{area.logicalEntryCount}</dd>
    </div>
  )
}

export function StorageOperations({ rpc, t }: StorageOperationsProps) {
  const [state, setState] = useState<MaintenanceState>({})
  const [selected, setSelected] = useState<readonly string[]>([])
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmingCacheClear, setConfirmingCacheClear] = useState(false)

  const run = async <T,>(
    action: MaintenanceAction, endpoint: string, payload: unknown,
    apply: (value: T) => MaintenanceState,
  ): Promise<T | undefined> => {
    if (action !== 'cache-clear-preview' && action !== 'cache-clear-delete') setConfirmingCacheClear(false)
    setState(current => ({ ...current, busy: action, error: undefined }))
    try {
      const value = await callMaintenance<T>(rpc, endpoint, payload)
      setState(current => ({ ...current, ...apply(value), busy: undefined, error: undefined }))
      return value
    } catch (error) {
      setState(current => ({
        ...current, busy: undefined,
        error: error instanceof Error ? error.message : String(error),
      }))
      return undefined
    }
  }

  const refreshStats = async (): Promise<void> => {
    await run<StorageStatistics>('stats', 'mineru/storage.stats', {}, stats => ({ stats }))
  }

  const scanIntegrity = async (): Promise<void> => {
    await run<CacheIntegrityScanReport>(
      'scan', 'mineru/storage.integrity.scan', { diagnostic_limit: 50 }, scan => ({ scan }),
    )
  }

  const previewGc = async (): Promise<void> => {
    await run<GcDryRunReport>(
      'gc', 'mineru/storage.gc.preview', { candidate_limit: 100, diagnostic_limit: 50 }, gc => ({ gc }),
    )
  }

  const clearCache = async (): Promise<void> => {
    setConfirmingDelete(false)
    if (!confirmingCacheClear) {
      const preview = await run<CacheClearReport>(
        'cache-clear-preview', 'mineru/storage.cache.clear',
        { dry_run: true, diagnostic_limit: 50 }, cacheClear => ({ cacheClear }),
      )
      if (preview?.eligible === true && preview.plannedCount > 0 && preview.confirmationToken !== undefined) {
        setConfirmingCacheClear(true)
      }
      return
    }

    const report = await run<CacheClearReport>(
      'cache-clear-delete', 'mineru/storage.cache.clear',
      {
        dry_run: false, confirm: true, diagnostic_limit: 50,
        confirmation_token: state.cacheClear?.confirmationToken,
      },
      cacheClear => ({ cacheClear }),
    )
    setConfirmingCacheClear(false)
    if (report !== undefined) await refreshStats()
  }

  const listQuarantine = async (): Promise<QuarantineListReport | undefined> => {
    const report = await run<QuarantineListReport>(
      'quarantine', 'mineru/storage.quarantine.list', { limit: 100 }, quarantine => ({ quarantine }),
    )
    if (report !== undefined) {
      const available = new Set(report.entries.map(entry => entry.id))
      setSelected(current => current.filter(id => available.has(id)))
      setConfirmingDelete(false)
    }
    return report
  }

  const toggleSelected = (id: string): void => {
    setConfirmingCacheClear(false)
    setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
    setConfirmingDelete(false)
  }

  const toggleAll = (): void => {
    setConfirmingCacheClear(false)
    const entries = state.quarantine?.entries ?? []
    setSelected(current => current.length === entries.length ? [] : entries.map(entry => entry.id))
    setConfirmingDelete(false)
  }

  const previewCleanup = async (): Promise<void> => {
    if (selected.length === 0) return
    setConfirmingDelete(false)
    await run<QuarantineCleanupReport>(
      'cleanup-preview', 'mineru/storage.quarantine.cleanup',
      { entry_ids: selected, dry_run: true }, cleanup => ({ cleanup }),
    )
  }

  const deleteSelected = async (): Promise<void> => {
    setConfirmingCacheClear(false)
    if (selected.length === 0) return
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    const cleanup = await run<QuarantineCleanupReport>(
      'cleanup-delete', 'mineru/storage.quarantine.cleanup',
      { entry_ids: selected, dry_run: false, confirm: true }, value => ({ cleanup: value }),
    )
    setConfirmingDelete(false)
    if (cleanup !== undefined) {
      setSelected([])
      await Promise.all([listQuarantine(), refreshStats()])
    }
  }

  const busy = state.busy !== undefined
  const quarantineEntries = state.quarantine?.entries ?? []
  const allSelected = quarantineEntries.length > 0 && selected.length === quarantineEntries.length

  return (
    <div className={css.editorGroup}>
      <h3 className={css.groupTitle}>{t('section.operations')}</h3>
      <div className={css.operationToolbar}>
        <button type="button" className={css.secondaryButton} disabled={busy} onClick={() => void refreshStats()}>
          {state.busy === 'stats' ? t('action.running') : t('action.storageStats')}
        </button>
        <button type="button" className={css.secondaryButton} disabled={busy} onClick={() => void scanIntegrity()}>
          {state.busy === 'scan' ? t('action.running') : t('action.integrityScan')}
        </button>
        <button type="button" className={css.secondaryButton} disabled={busy} onClick={() => void previewGc()}>
          {state.busy === 'gc' ? t('action.running') : t('action.gcPreview')}
        </button>
        <button
          type="button" className={confirmingCacheClear ? css.dangerButton : css.secondaryButton}
          disabled={busy} onClick={() => void clearCache()}
        >
          {state.busy === 'cache-clear-preview' || state.busy === 'cache-clear-delete'
            ? t('action.running')
            : confirmingCacheClear ? t('action.cacheClearConfirm') : t('action.cacheClear')}
        </button>
        <button type="button" className={css.secondaryButton} disabled={busy} onClick={() => void listQuarantine()}>
          {state.busy === 'quarantine' ? t('action.running') : t('action.quarantineList')}
        </button>
      </div>

      {state.error !== undefined && <div className={css.operationError}>{state.error}</div>}

      {state.stats !== undefined && (
        <div className={css.operationResult}>
          <div className={css.resultTitle}>{t('action.storageStats')}</div>
          <div className={css.metricHeaders}><span /> <span>{t('ops.bytes')}</span><span>{t('ops.entries')}</span></div>
          <dl className={css.metrics}>
            <AreaMetric label={t('ops.results')} area={state.stats.publishedResults} />
            <AreaMetric label={t('ops.staging')} area={state.stats.staging} />
            <AreaMetric label={t('ops.quarantine')} area={state.stats.quarantine} />
          </dl>
          {[state.stats.publishedResults, state.stats.staging, state.stats.quarantine].some(isPartialArea) && (
            <p role="status" className={css.fieldHint}>{t('ops.statsIncomplete')}</p>
          )}
        </div>
      )}

      {state.scan !== undefined && (
        <div className={css.operationResult}>
          <div className={css.resultTitle}>{t('action.integrityScan')} · {t('ops.readOnly')}</div>
          <div className={css.summaryLine}>
            <span>{t('ops.valid')}: {state.scan.validCount}</span>
            <span>{t('ops.corrupt')}: {state.scan.corruptCount}</span>
            <span>{t('ops.missing')}: {state.scan.missingCount}</span>
            <span>{t('ops.unreadable')}: {state.scan.unreadableCount}</span>
          </div>
        </div>
      )}

      {state.gc !== undefined && (
        <div className={css.operationResult}>
          <div className={css.resultTitle}>{t('action.gcPreview')}</div>
          <div className={css.summaryLine}>
            <span>{state.gc.eligible ? t('ops.gcEligible') : t('ops.gcBlocked')}</span>
            <span>{t('ops.gcCandidates')}: {state.gc.candidateCount}</span>
            <span>{formatBytes(state.gc.candidateBytes, state.gc.candidateBytesSaturated)}</span>
          </div>
        </div>
      )}

      {state.cacheClear !== undefined && (
        <div className={css.operationResult}>
          <div className={css.resultTitle}>{t('action.cacheClear')}</div>
          <div className={css.summaryLine}>
            <span>{state.cacheClear.eligible ? t('ops.clearReady') : t('ops.clearBlocked')}</span>
            <span>{t('ops.cleanupPlanned')}: {state.cacheClear.plannedCount}</span>
            <span>{t('ops.cleanupDeleted')}: {state.cacheClear.deletedCount}</span>
            <span>{formatBytes(state.cacheClear.dryRun ? state.cacheClear.plannedBytes : state.cacheClear.deletedBytes)}</span>
            <span>{t('ops.activeOperations')}: {state.cacheClear.activeOperationCount}</span>
          </div>
        </div>
      )}

      {state.quarantine !== undefined && (
        <div className={css.operationResult}>
          <div className={css.resultTitle}>{t('ops.quarantine')} · {state.quarantine.totalCount}</div>
          {quarantineEntries.length > 0 && (
            <>
              <div className={css.tableWrap}>
                <table className={css.operationTable}>
                  <thead>
                    <tr>
                      <th>
                        <input type="checkbox" aria-label={t('ops.selectAll')} checked={allSelected} onChange={toggleAll} />
                      </th>
                      <th>ID</th>
                      <th>{t('ops.bytes')}</th>
                      <th>{t('ops.modified')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quarantineEntries.map(entry => (
                      <tr key={entry.id}>
                        <td>
                          <input
                            type="checkbox" aria-label={entry.id}
                            checked={selected.includes(entry.id)} onChange={() => toggleSelected(entry.id)}
                          />
                        </td>
                        <td><code title={entry.id}>{entry.id}</code></td>
                        <td>{formatBytes(entry.byteUsage, entry.byteUsageSaturated)}</td>
                        <td>{new Date(entry.modifiedAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={css.operationToolbar}>
                <button
                  type="button" className={css.secondaryButton}
                  disabled={busy || selected.length === 0} onClick={() => void previewCleanup()}
                >
                  {state.busy === 'cleanup-preview' ? t('action.running') : t('action.cleanupPreview')}
                </button>
                <button
                  type="button" className={confirmingDelete ? css.dangerButton : css.secondaryButton}
                  disabled={busy || selected.length === 0} onClick={() => void deleteSelected()}
                >
                  {state.busy === 'cleanup-delete'
                    ? t('action.running')
                    : confirmingDelete ? t('action.cleanupConfirm') : t('action.cleanupDelete')}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {state.cleanup !== undefined && (
        <div className={css.operationResult}>
          <div className={css.summaryLine}>
            <span>{t('ops.cleanupPlanned')}: {state.cleanup.plannedCount}</span>
            <span>{t('ops.cleanupDeleted')}: {state.cleanup.deletedCount}</span>
            <span>{formatBytes(state.cleanup.dryRun ? state.cleanup.plannedBytes : state.cleanup.deletedBytes)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
