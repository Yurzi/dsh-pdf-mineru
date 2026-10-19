/** Unit harness for the MinerU RPC handler: typed dependency mocks and owner/non-owner peers. */
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import { vi, type Mock } from 'vitest'
import { defaultMinerUConfig } from '../../src/config/parse.js'
import type { CacheClearReport, CacheIntegrityScanReport, QuarantineCleanupReport, ScanMetadata } from '../../src/contracts/maintenance.js'
import { RPC_CHANNEL, type RpcResult } from '../../src/contracts/rpc.js'
import { registerRpc, type MineruRpcDeps } from '../../src/rpc.js'

declare module '@deepseek-ai/dsh-typert-protocol' {
  /** Test-only non-owner principal (e.g. an API operator); the published map declares only owner. */
  interface PrincipalMap { 'test-api-operator': { readonly kind: 'api-operator' } }
}

type Maintenance = MineruRpcDeps['maintenance']
export interface RpcHarnessDeps {
  readonly settings: { readonly current: Mock<MineruRpcDeps['settings']['current']>; readonly save: Mock<MineruRpcDeps['settings']['save']> }
  readonly probe: Mock<MineruRpcDeps['probe']>
  readonly maintenance: { readonly [K in keyof Maintenance]: Mock<Maintenance[K]> }
}
export interface RpcHarnessOverrides {
  readonly settings?: Partial<RpcHarnessDeps['settings']>
  readonly probe?: RpcHarnessDeps['probe']
  readonly maintenance?: Partial<RpcHarnessDeps['maintenance']>
}

function peer(principal: PeerScope['principal']): PeerScope {
  return {
    // PeerId is a published brand without a public constructor; real peers come from HostConnectionService.
    id: ('rpc-test-' + principal.kind) as PeerScope['id'], ctx: new Context(), principal,
    signal: new AbortController().signal, interactions: 'none', dispose: async () => undefined,
  }
}
export const ownerPeer = (): PeerScope => peer({ kind: 'owner' })
export const nonOwnerPeer = (): PeerScope => peer({ kind: 'api-operator' })

/**
 * Register the real RPC table on a root Context whose connection service captures the handler.
 * Transport trust (loopback authority, authentication) is covered by host-compatibility.spec.ts.
 */
export function rpcHarness(overrides: RpcHarnessOverrides = {}) {
  const deps: RpcHarnessDeps = {
    settings: {
      current: vi.fn<MineruRpcDeps['settings']['current']>(() => ({ config: defaultMinerUConfig(), revision: 0 })),
      save: vi.fn<MineruRpcDeps['settings']['save']>(),
      ...overrides.settings,
    },
    probe: overrides.probe ?? vi.fn<MineruRpcDeps['probe']>(),
    maintenance: {
      getStatistics: vi.fn<Maintenance['getStatistics']>(),
      scanIntegrity: vi.fn<Maintenance['scanIntegrity']>(),
      listQuarantine: vi.fn<Maintenance['listQuarantine']>(),
      cleanupQuarantine: vi.fn<Maintenance['cleanupQuarantine']>(),
      clearCache: vi.fn<Maintenance['clearCache']>(),
      ...overrides.maintenance,
    },
  }
  let handler: ConnectionRpcHandler | undefined
  const ctx = new Context()
  ctx.provide('webServer', { register: () => () => undefined })
  ctx.provide('connection', {
    rpc: {
      handle(channel: string, registered: ConnectionRpcHandler) {
        if (channel !== RPC_CHANNEL) throw new Error('unexpected RPC channel ' + channel)
        handler = registered
        return async () => undefined
      },
    },
  })
  registerRpc(ctx, deps)
  const controller = new AbortController()
  return {
    deps,
    /** Signal passed to every call; dependencies must receive it unchanged. */
    signal: controller.signal,
    call: async (endpoint: string, payload: unknown = {}, caller: PeerScope = ownerPeer()): Promise<RpcResult<unknown>> => {
      if (handler === undefined) throw new Error('RPC handler was not registered')
      return await handler(endpoint, payload, controller.signal, caller) as RpcResult<unknown>
    },
  }
}

const scan = (): ScanMetadata => ({ limit: 100, scanned: 1, truncated: false, diagnosticsLimit: 10, diagnosticsTruncated: false })
export const cacheClearReport = (o: Partial<CacheClearReport> = {}): CacheClearReport => ({
  generatedAt: 1, dryRun: true, eligible: true, activeOperationCount: 0, activeAccessCount: 0, confirmationToken: 'preview-token',
  plannedCount: 2, plannedBytes: 20, deletedCount: 0, deletedBytes: 0, skippedCount: 0, scan: scan(), diagnostics: [], ...o,
})
export const integrityReport = (o: Partial<CacheIntegrityScanReport> = {}): CacheIntegrityScanReport => ({
  generatedAt: 1, readOnly: false, isolateInvalid: true, validCount: 0, corruptCount: 1, missingCount: 0, unreadableCount: 0,
  quarantinedCount: 1, scan: scan(), diagnostics: [], ...o,
})
export const cleanupReport = (o: Partial<QuarantineCleanupReport> = {}): QuarantineCleanupReport => ({
  generatedAt: 1, dryRun: false, requestedCount: 1, plannedCount: 1, plannedBytes: 10, deletedCount: 1, deletedBytes: 10,
  missingCount: 0, skippedCount: 0, entries: [], ...o,
})
