import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import type { MinerUConfig } from '../config/model.js'
import type { ProbeView } from './probe.js'
import type {
  CacheClearReport, CacheIntegrityScanReport,
  QuarantineCleanupReport, QuarantineListReport, StorageStatistics,
} from './maintenance.js'

export const RPC_CHANNEL = '/dsh-pdf-mineru-api'

export const RPC_ENDPOINTS = {
  configGet: 'mineru/config.get',
  configSet: 'mineru/config.set',
  probe: 'mineru/probe',
  storageStats: 'mineru/storage.stats',
  storageIntegrityScan: 'mineru/storage.integrity.scan',
  storageQuarantineList: 'mineru/storage.quarantine.list',
  storageQuarantineCleanup: 'mineru/storage.quarantine.cleanup',
  storageCacheClear: 'mineru/storage.cache.clear',
} as const

export type RpcEndpoint = typeof RPC_ENDPOINTS[keyof typeof RPC_ENDPOINTS]
export type RpcResult<T> = ConnectionRpcResult<T>

/** Live configuration and the host Settings revision it was read at; null when the descriptor is unavailable. */
export interface ConfigResponse {
  readonly config: MinerUConfig
  readonly revision: number | null
}

export interface RpcPayloads {
  'mineru/config.get': Record<string, never>
  /** expected_revision: the revision from config.get; a stale value is refused with mineru/conflict. */
  'mineru/config.set': { config: unknown; expected_revision?: number }
  'mineru/probe': { provider?: unknown }
  'mineru/storage.stats': Record<string, never>
  'mineru/storage.integrity.scan': { result_limit?: number; diagnostic_limit?: number; isolate_invalid?: boolean; confirm?: boolean }
  'mineru/storage.quarantine.list': { limit?: number }
  'mineru/storage.quarantine.cleanup': { entry_ids: readonly string[]; dry_run?: boolean; confirm?: boolean }
  'mineru/storage.cache.clear': { result_limit?: number; diagnostic_limit?: number; dry_run?: boolean; confirm?: boolean; confirmation_token?: string }
}

export interface RpcResponses {
  'mineru/config.get': ConfigResponse
  'mineru/config.set': ConfigResponse
  'mineru/probe': ProbeView
  'mineru/storage.stats': StorageStatistics
  'mineru/storage.integrity.scan': CacheIntegrityScanReport
  'mineru/storage.quarantine.list': QuarantineListReport
  'mineru/storage.quarantine.cleanup': QuarantineCleanupReport
  'mineru/storage.cache.clear': CacheClearReport
}
