import type { CacheKey, MinerUFileId, MinerUJobId, MinerUResultId, OperationId, ProviderConfigId, SessionId } from './ids.js'
import type { MinerUFailure, MinerUProviderId } from './errors.js'
import type { CanonicalParseRequest } from './request.js'
import type { ProviderJobRef } from '../providers/provider.js'

export const MINERU_JOB_SCHEMA_VERSION = 1 as const

export type MinerUFileState = 'queued' | 'uploading' | 'processing' | 'completed' | 'failed'
export type MinerUJobState = MinerUFileState | 'collecting' | 'partially-completed'

export type JobResolution =
  | { readonly kind: 'cache-hit' }
  | { readonly kind: 'shared-operation'; readonly operationId: OperationId; readonly ref?: ProviderJobRef }
  | { readonly kind: 'provider'; readonly ref?: ProviderJobRef }

export interface JobSourceFile {
  readonly fileId: MinerUFileId
  readonly name: string
  readonly bytes: number
  readonly sha256: string
}

export interface MinerUFileStatus {
  readonly fileId: MinerUFileId
  readonly name: string
  readonly cacheKey: CacheKey
  readonly state: MinerUFileState
  readonly resultId?: MinerUResultId
  readonly failure?: MinerUFailure
  readonly progress?: { readonly completed: number; readonly total: number }
}

export interface MinerUJobRecord {
  readonly schemaVersion: typeof MINERU_JOB_SCHEMA_VERSION
  readonly id: MinerUJobId
  readonly sessionId: SessionId
  readonly providerId: MinerUProviderId
  readonly providerConfigId: ProviderConfigId
  readonly providerCompatibilityKey: string
  readonly sourceFiles: readonly JobSourceFile[]
  readonly request: CanonicalParseRequest
  readonly cacheKey: CacheKey
  readonly state: MinerUJobState
  readonly resolution: JobResolution
  readonly files: readonly MinerUFileStatus[]
  readonly resultId?: MinerUResultId
  readonly failure?: MinerUFailure
  readonly createdAt: number
  readonly updatedAt: number
}

const TERMINAL = new Set<MinerUJobState>(['completed', 'partially-completed', 'failed'])
const ORDER: Record<Exclude<MinerUJobState, 'failed' | 'partially-completed'>, number> = {
  queued: 0,
  uploading: 1,
  processing: 2,
  collecting: 3,
  completed: 4,
}

export function isTerminalJobState(state: MinerUJobState): boolean {
  return TERMINAL.has(state)
}

export function assertJobTransition(previous: MinerUJobState, next: MinerUJobState): void {
  if (previous === next) return
  if (TERMINAL.has(previous)) throw new TypeError(`terminal MinerU job cannot transition from ${previous} to ${next}`)
  if (next === 'failed' || next === 'partially-completed') return
  const from = ORDER[previous as keyof typeof ORDER]
  const to = ORDER[next as keyof typeof ORDER]
  if (from === undefined || to === undefined || to < from) {
    throw new TypeError(`invalid MinerU job transition from ${previous} to ${next}`)
  }
}
