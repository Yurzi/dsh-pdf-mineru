/**
 * rpc.ts — host-side RPC handler for MinerU config CRUD and draft probe.
 *
 * Endpoints (on the `/dsh-pdf-mineru-api` channel, loopback authority):
 *   - `mineru/config.get`  payload: {} → { config: MinerUConfig }
 *   - `mineru/config.set`  payload: { config: unknown } → { config: MinerUConfig }
 *   - `mineru/probe`       payload: { provider?: unknown } → ProbeView
 *
 * Security:
 *   - Authority: strictly 'loopback'
 *   - Credential values and tokens are never returned or leaked in responses/errors.
 *   - Errors sanitized via sanitizeDiagnostic.
 */

import type { Context } from 'cordis'
import type { MinerUConfig } from './config.js'
import { migrateConfig } from './config.js'
import { sanitizeDiagnostic } from './domain/errors.js'
import type { ProbeView } from './service/mineru-service.js'
import type { StorageMaintenanceService } from './storage/maintenance-service.js'

export interface MineruRpcDeps {
  readonly getConfig: () => MinerUConfig
  readonly setConfig: (value: unknown) => Promise<MinerUConfig>
  readonly probe: (providerDraft: unknown | undefined, signal: AbortSignal) => Promise<ProbeView>
  readonly maintenance: Pick<StorageMaintenanceService,
    'getStatistics' | 'scanIntegrity' | 'listQuarantine' | 'cleanupQuarantine' | 'gcDryRun' | 'clearCache'>
}

export type RpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

export const RPC_CHANNEL = '/dsh-pdf-mineru-api'

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

function fail<T = unknown>(message: string, code = 'internal'): RpcResult<T> {
  return {
    ok: false,
    error: { code, message: sanitizeDiagnostic(message) },
  }
}

export function registerRpc(ctx: Context, deps: MineruRpcDeps): () => void | Promise<void> {
  ctx.logger?.info('dsh-pdf-mineru: registering RPC channel /dsh-pdf-mineru-api')
  const connection = ctx.connection as {
    readonly rpc: {
      readonly handle: (
        channel: '/dsh-pdf-mineru-api',
        handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>,
        options: { readonly authority: 'trusted-host' | 'loopback' },
      ) => unknown
    }
  }

  const dispose = connection.rpc.handle(
    RPC_CHANNEL,
    async (endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult<unknown>> => {
      try {
        switch (endpoint) {
          case 'mineru/config.get': {
            payloadRecord(payload)
            return ok({ config: deps.getConfig() })
          }

          case 'mineru/config.set': {
            const p = payloadRecord(payload)
            if (!Object.prototype.hasOwnProperty.call(p, 'config') || p.config === undefined || p.config === null) {
              throw new TypeError('payload.config must be a non-null configuration object')
            }
            const saved = await deps.setConfig(migrateConfig(p.config))
            return ok({ config: saved })
          }

          case 'mineru/probe': {
            const p = payloadRecord(payload)
            const view = await deps.probe(p.provider, signal)
            return ok(view)
          }

          case 'mineru/storage.stats': {
            payloadRecord(payload)
            const report = await deps.maintenance.getStatistics(signal)
            ctx.logger?.info('dsh-pdf-mineru', { phase: 'maintenance', operation: 'stats' })
            return ok(report)
          }

          case 'mineru/storage.integrity.scan': {
            const p = payloadRecord(payload)
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
          }

          case 'mineru/storage.quarantine.list': {
            const p = payloadRecord(payload)
            return ok(await deps.maintenance.listQuarantine({ limit: optionalLimit(p, 'limit'), signal }))
          }

          case 'mineru/storage.quarantine.cleanup': {
            const p = payloadRecord(payload)
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
          }

          case 'mineru/storage.cache.clear': {
            const p = payloadRecord(payload)
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
          }

          case 'mineru/storage.gc.preview': {
            const p = payloadRecord(payload)
            const report = await deps.maintenance.gcDryRun({
              resultLimit: optionalLimit(p, 'result_limit'),
              candidateLimit: optionalLimit(p, 'candidate_limit'),
              diagnosticLimit: optionalLimit(p, 'diagnostic_limit'),
              signal,
            })
            ctx.logger?.info('dsh-pdf-mineru', {
              phase: 'maintenance', operation: 'gc-preview', eligible: report.eligible,
              candidates: report.candidateCount, bytes: report.candidateBytes,
            })
            return ok(report)
          }

          default: {
            return fail(`unknown endpoint: ${endpoint}`, 'not-found')
          }
        }
      } catch (err: unknown) {
        const rawMsg = err instanceof Error ? err.message : String(err)
        return fail(rawMsg, err instanceof TypeError ? 'invalid-argument' : 'internal')
      }
    },
    { authority: 'loopback' },
  )
  return typeof dispose === 'function'
    ? () => (dispose as () => void | Promise<void>)()
    : () => undefined
}
