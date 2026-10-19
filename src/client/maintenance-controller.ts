import { useRef, useState } from 'react'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type {
  CacheClearReport,
  CacheIntegrityScanReport,
  QuarantineCleanupReport,
  QuarantineListReport,
  StorageStatistics,
} from '../contracts/maintenance.js'
import { callRpc, errorMessage } from './helpers.js'
import {
  cacheClearConfirmRequest,
  cacheClearPreviewRequest,
  DIAGNOSTIC_LIMIT,
  QUARANTINE_LIST_LIMIT,
  quarantineConfirmRequest,
  quarantinePreviewRequest,
  toggleSelection,
} from './maintenance.js'

export type MaintenanceTask = 'stats' | 'verify' | 'clearPreview' | 'clear' | 'list' | 'cleanupPreview' | 'cleanup'

/**
 * Storage maintenance flows. Destructive work is always two-step: a dry-run preview opens
 * the dialog, and confirmation sends only what that preview approved.
 */
export function useMaintenance(rpc: ClientConnectionRpc) {
  const [busy, setBusy] = useState<MaintenanceTask>()
  const [error, setError] = useState<string>()
  const [stats, setStats] = useState<StorageStatistics>()
  const [scan, setScan] = useState<CacheIntegrityScanReport>()
  const [clearPreview, setClearPreview] = useState<CacheClearReport>()
  const [cleared, setCleared] = useState<CacheClearReport>()
  const [quarantine, setQuarantine] = useState<QuarantineListReport>()
  const [selected, setSelected] = useState<readonly string[]>([])
  const [cleanupPreview, setCleanupPreview] = useState<QuarantineCleanupReport>()
  const [cleaned, setCleaned] = useState<QuarantineCleanupReport>()
  const running = useRef(false)

  async function run(task: MaintenanceTask, work: () => Promise<void>): Promise<void> {
    if (running.current) return
    running.current = true
    setBusy(task)
    setError(undefined)
    try {
      await work()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      running.current = false
      setBusy(undefined)
    }
  }

  const refresh = () => run('stats', async () => { setStats(await callRpc(rpc, 'mineru/storage.stats', {})) })

  const listQuarantine = () => run('list', async () => {
    setQuarantine(await callRpc(rpc, 'mineru/storage.quarantine.list', { limit: QUARANTINE_LIST_LIMIT }))
    setSelected([])
    setCleaned(undefined)
  })

  return {
    busy,
    error,
    stats,
    scan,
    clearPreview,
    cleared,
    quarantine,
    selected,
    cleanupPreview,
    cleaned,
    refresh,
    verify: () => run('verify', async () => {
      setScan(await callRpc(rpc, 'mineru/storage.integrity.scan', { diagnostic_limit: DIAGNOSTIC_LIMIT }))
    }),
    previewClear: () => run('clearPreview', async () => {
      setCleared(undefined)
      setClearPreview(await callRpc(rpc, 'mineru/storage.cache.clear', cacheClearPreviewRequest()))
    }),
    confirmClear: async () => {
      const request = clearPreview === undefined ? undefined : cacheClearConfirmRequest(clearPreview)
      if (request === undefined) return
      let done = false
      await run('clear', async () => {
        setCleared(await callRpc(rpc, 'mineru/storage.cache.clear', request))
        setClearPreview(undefined)
        done = true
      })
      if (done) await refresh()
    },
    cancelClear: () => { setClearPreview(undefined) },
    listQuarantine,
    toggle: (id: string) => { setSelected(current => toggleSelection(current, id)) },
    selectAll: (all: boolean) => { setSelected(all ? (quarantine?.entries ?? []).map(entry => entry.id) : []) },
    previewCleanup: () => run('cleanupPreview', async () => {
      const request = quarantinePreviewRequest(selected)
      if (request !== undefined) setCleanupPreview(await callRpc(rpc, 'mineru/storage.quarantine.cleanup', request))
    }),
    confirmCleanup: async () => {
      const request = cleanupPreview === undefined ? undefined : quarantineConfirmRequest(cleanupPreview)
      if (request === undefined) return
      let report: QuarantineCleanupReport | undefined
      await run('cleanup', async () => {
        report = await callRpc(rpc, 'mineru/storage.quarantine.cleanup', request)
        setCleanupPreview(undefined)
      })
      if (report === undefined) return
      await listQuarantine()
      setCleaned(report)
      await refresh()
    },
    cancelCleanup: () => { setCleanupPreview(undefined) },
  }
}

export type Maintenance = ReturnType<typeof useMaintenance>