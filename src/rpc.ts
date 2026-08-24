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

export interface MineruRpcDeps {
  readonly getConfig: () => MinerUConfig
  readonly setConfig: (value: unknown) => Promise<MinerUConfig>
  readonly probe: (providerDraft: unknown | undefined, signal: AbortSignal) => Promise<ProbeView>
}

export type RpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details?: unknown } }

export const RPC_CHANNEL = '/dsh-pdf-mineru-api'

function ok<T>(value: T): RpcResult<T> {
  return { ok: true, value }
}

function fail<T = unknown>(message: string, code = 'internal'): RpcResult<T> {
  return {
    ok: false,
    error: {
      code,
      message: sanitizeDiagnostic(message),
      details: {},
    },
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
            return ok({ config: deps.getConfig() })
          }

          case 'mineru/config.set': {
            if (payload === undefined || payload === null || typeof payload !== 'object') {
              return fail('payload must be an object with config property', 'invalid-argument')
            }
            const p = payload as { config?: unknown }
            const validated = migrateConfig(p.config)
            const saved = await deps.setConfig(validated)
            return ok({ config: saved })
          }

          case 'mineru/probe': {
            const p = payload as { provider?: unknown } | undefined
            const draft = p?.provider
            const view = await deps.probe(draft, signal)
            return ok(view)
          }

          default: {
            return fail(`unknown endpoint: ${endpoint}`, 'not-found')
          }
        }
      } catch (err: unknown) {
        const rawMsg = err instanceof Error ? err.message : String(err)
        return fail(rawMsg, 'internal')
      }
    },
    { authority: 'loopback' },
  )
  return typeof dispose === 'function'
    ? () => (dispose as () => void | Promise<void>)()
    : () => undefined
}
