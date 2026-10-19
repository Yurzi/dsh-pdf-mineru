/** Owner-only config, probe, and maintenance RPC behind loopback Host authority. */

import type { Context } from '@deepseek-ai/cordis'
import type { PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import { RPC_CHANNEL, RPC_ENDPOINTS, type ConfigResponse, type RpcEndpoint, type RpcResult } from './contracts/rpc.js'
import { registerLoopbackRpc } from './loopback-rpc.js'
import { MinerUError, type MinerUErrorCode, sanitizeDiagnostic } from './domain/errors.js'
import type { ProbeView } from './contracts/probe.js'
import type { StorageMaintenanceService } from './storage/maintenance/service.js'

export interface MineruRpcDeps {
  readonly settings: {
    current(): ConfigResponse
    /** Validates and persists; a stale expectedRevision fails with SETTINGS_CONFLICT. */
    save(value: unknown, expectedRevision?: number): Promise<ConfigResponse>
  }
  readonly probe: (providerDraft: unknown | undefined, signal: AbortSignal) => Promise<ProbeView>
  readonly maintenance: Pick<StorageMaintenanceService,
    'getStatistics' | 'scanIntegrity' | 'listQuarantine' | 'cleanupQuarantine' | 'clearCache'>
}

const MINERU_TO_RPC_ERROR_CODE: Readonly<Record<MinerUErrorCode, string>> = {
  INVALID_REQUEST: 'mineru/invalid-argument',
  FILE_NOT_FOUND: 'mineru/not-found',
  FILE_TOO_LARGE: 'mineru/file-too-large',
  UNSUPPORTED_OPTION: 'mineru/unsupported-option',
  CREDENTIAL_MISSING: 'mineru/credential-missing',
  AUTHENTICATION_FAILED: 'mineru/auth-failed',
  PROVIDER_UNAVAILABLE: 'mineru/provider-unavailable',
  PROVIDER_CONFIG_MISSING: 'mineru/provider-config-missing',
  PROVIDER_RATE_LIMITED: 'mineru/provider-rate-limited',
  PROVIDER_QUOTA_EXHAUSTED: 'mineru/quota-exhausted',
  UPLOAD_FAILED: 'mineru/upload-failed',
  REMOTE_PARSE_FAILED: 'mineru/remote-parse-failed',
  RESULT_NOT_READY: 'mineru/result-not-ready',
  RESULT_DOWNLOAD_FAILED: 'mineru/download-failed',
  RESULT_ARCHIVE_INVALID: 'mineru/archive-invalid',
  RESULT_TOO_LARGE: 'mineru/result-too-large',
  CACHE_CORRUPT: 'mineru/cache-corrupt',
  CACHE_CONFLICT: 'mineru/cache-conflict',
  CACHE_EVICTED: 'mineru/cache-evicted',
  INTERRUPTED_UPLOAD: 'mineru/interrupted-upload',
  POLL_TIMEOUT: 'mineru/timeout',
  CANCELLED: 'mineru/cancelled',
  UNAUTHENTICATED_SESSION: 'mineru/unauthenticated',
  JOB_NOT_FOUND: 'mineru/not-found',
  STORAGE_LOCKED: 'mineru/storage-locked',
  SETTINGS_CONFLICT: 'mineru/conflict',
}

function ok<T>(value: T): RpcResult<T> {
  return { ok: true, value }
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  if (payload === undefined) return {}
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new TypeError('payload must be an object')
  }
  return payload as Record<string, unknown>
}

function optionalLimit(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key]
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new TypeError(key + ' must be a positive safe integer')
  return value as number
}

function optionalBoolean(payload: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = payload[key]
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new TypeError(key + ' must be a boolean')
  return value
}

function fail<T = unknown>(message: string, code = 'mineru/internal'): RpcResult<T> {
  return {
    ok: false,
    error: { code, message: sanitizeDiagnostic(message), details: {} },
  }
}

export function mapRpcError(err: unknown): { code: string; message: string } {
  if (err instanceof MinerUError) {
    const code = MINERU_TO_RPC_ERROR_CODE[err.failure.code] ?? 'mineru/internal'
    return {
      code,
      message: err.failure.message,
    }
  }
  if (err instanceof TypeError) {
    return {
      code: 'mineru/invalid-argument',
      message: sanitizeDiagnostic(err.message),
    }
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return {
      code: 'mineru/cancelled',
      message: sanitizeDiagnostic(err.message),
    }
  }
  const rawMsg = err instanceof Error ? err.message : String(err)
  return {
    code: 'mineru/internal',
    message: sanitizeDiagnostic(rawMsg),
  }
}

export function registerRpc(ctx: Context, deps: MineruRpcDeps): () => void | Promise<void> {
  ctx.logger?.info('dsh-pdf-mineru: registering RPC channel /dsh-pdf-mineru-api')
  const handlers: Record<RpcEndpoint, (payload: Record<string, unknown>, signal: AbortSignal) => Promise<RpcResult<unknown>>> = {
    [RPC_ENDPOINTS.configGet]: async (_payload, _signal) => {
      return ok(deps.settings.current())
    },
    [RPC_ENDPOINTS.configSet]: async (p, _signal) => {
      if (!Object.hasOwn(p, 'config') || p.config === undefined || p.config === null) {
        throw new TypeError('payload.config must be a non-null configuration object')
      }
      const expected = p.expected_revision
      if (expected !== undefined && (!Number.isSafeInteger(expected) || (expected as number) < 0)) {
        throw new TypeError('expected_revision must be a non-negative safe integer')
      }
      return ok(await deps.settings.save(p.config, expected as number | undefined))
    },
    [RPC_ENDPOINTS.probe]: async (p, signal) => {
      const view = await deps.probe(p.provider, signal)
      return ok(view)
    },
    [RPC_ENDPOINTS.storageStats]: async (_payload, signal) => {
      const report = await deps.maintenance.getStatistics(signal)
      ctx.logger?.info('dsh-pdf-mineru', { phase: 'maintenance', operation: 'stats' })
      return ok(report)
    },
    [RPC_ENDPOINTS.storageIntegrityScan]: async (p, signal) => {
      const isolateInvalid = optionalBoolean(p, 'isolate_invalid', false)
      if (isolateInvalid && p.confirm !== true) {
        throw new TypeError('confirm must be true when isolating invalid results')
      }
      const report = await deps.maintenance.scanIntegrity({
        resultLimit: optionalLimit(p, 'result_limit'),
        diagnosticLimit: optionalLimit(p, 'diagnostic_limit'),
        isolateInvalid,
        signal,
      })
      ctx.logger?.info('dsh-pdf-mineru', {
        phase: 'maintenance', operation: isolateInvalid ? 'integrity-isolate' : 'integrity-scan',
        scanned: report.scan.scanned, quarantined: report.quarantinedCount,
      })
      return ok(report)
    },
    [RPC_ENDPOINTS.storageQuarantineList]: async (p, signal) => {
      return ok(await deps.maintenance.listQuarantine({ limit: optionalLimit(p, 'limit'), signal }))
    },
    [RPC_ENDPOINTS.storageQuarantineCleanup]: async (p, signal) => {
      if (!Array.isArray(p.entry_ids) || p.entry_ids.some(entry => typeof entry !== 'string')) {
        throw new TypeError('entry_ids must be an array of strings')
      }
      const dryRun = optionalBoolean(p, 'dry_run', true)
      if (!dryRun && p.confirm !== true) {
        throw new TypeError('confirm must be true when deleting quarantine entries')
      }
      const report = await deps.maintenance.cleanupQuarantine({
        entryIds: p.entry_ids as string[], dryRun, signal,
      })
      ctx.logger?.info('dsh-pdf-mineru', {
        phase: 'maintenance', operation: dryRun ? 'quarantine-cleanup-preview' : 'quarantine-cleanup',
        requested: report.requestedCount, deleted: report.deletedCount, bytes: report.deletedBytes,
      })
      return ok(report)
    },
    [RPC_ENDPOINTS.storageCacheClear]: async (p, signal) => {
      const dryRun = optionalBoolean(p, 'dry_run', true)
      if (!dryRun && p.confirm !== true) {
        throw new TypeError('confirm must be true when clearing published cache results')
      }
      if (!dryRun && (typeof p.confirmation_token !== 'string' || p.confirmation_token.length === 0)) {
        throw new TypeError('confirmation_token from a cache clear preview is required')
      }
      const report = await deps.maintenance.clearCache({
        resultLimit: optionalLimit(p, 'result_limit'),
        diagnosticLimit: optionalLimit(p, 'diagnostic_limit'),
        dryRun,
        ...(typeof p.confirmation_token === 'string' ? { confirmationToken: p.confirmation_token } : {}),
        signal,
      })
      ctx.logger?.info('dsh-pdf-mineru', {
        phase: 'maintenance', operation: dryRun ? 'cache-clear-preview' : 'cache-clear',
        eligible: report.eligible, planned: report.plannedCount,
        deleted: report.deletedCount, bytes: report.deletedBytes,
      })
      return ok(report)
    },
  }
  return registerLoopbackRpc(
    ctx, RPC_CHANNEL,
    async (endpoint: string, payload: unknown, signal: AbortSignal, peer: PeerScope): Promise<RpcResult<unknown>> => {
      if (peer.principal.kind !== 'owner') {
        return { ok: false, error: { code: 'mineru/forbidden', message: 'Owner access required', details: {} } }
      }
      try {
        if (!Object.hasOwn(handlers, endpoint)) return fail(`unknown endpoint: ${endpoint}`, 'mineru/not-found')
        return await handlers[endpoint as RpcEndpoint](payloadRecord(payload), signal)
      } catch (err: unknown) {
        const { code, message } = mapRpcError(err)
        return { ok: false, error: { code, message, details: {} } }
      }
    },
  )
}
