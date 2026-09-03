/**
 * rpc.spec.ts — Unit tests for MinerU RPC handlers, config migration, draft probe, and client UI helpers.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('react/jsx-dev-runtime', () => ({
  jsxDEV: () => null,
  jsxsDEV: () => null,
  Fragment: () => null,
}))

vi.mock('react', () => ({
  useState: vi.fn((init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, vi.fn()]),
  useEffect: vi.fn(),
  useCallback: vi.fn((fn: unknown) => fn),
}))
import type { Context } from 'cordis'
import { defaultMinerUConfig, type MinerUConfig, type OfficialV4Config, type SelfHostedV2Config } from '../src/config.js'
import { asProviderConfigId } from '../src/domain/ids.js'
import { registerRpc, RPC_CHANNEL, type MineruRpcDeps, type RpcResult } from '../src/rpc.js'
import type { ProbeView } from '../src/service/mineru-service.js'
import {
  activateProvider,
  clearCredential,
  credentialReference,
  describeCredential,
  ensureProviderProfiles,
  normalizeProviderDefaults,
  patchActiveProvider,
  storeCredential,
  type CredentialClient,
} from '../src/client/SettingsPage.js'
import { formatBytes } from '../src/client/StorageOperations.js'
import { apply as applyClient, inject as clientInject } from '../src/client/index.js'

type RpcHandler = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>

interface MockContext {
  connection: {
    rpc: {
      handle: ReturnType<typeof vi.fn>
    }
  }
  logger: {
    info: ReturnType<typeof vi.fn>
  }
}

function createMockContext(): { ctx: Context; getHandler: () => RpcHandler; getOptions: () => { authority: string } } {
  let capturedHandler!: RpcHandler
  let capturedOptions!: { authority: string }

  const handleMock = vi.fn((channel: string, handler: RpcHandler, options: { authority: string }) => {
    expect(channel).toBe(RPC_CHANNEL)
    capturedHandler = handler
    capturedOptions = options
  })

  const ctx = {
    connection: {
      rpc: {
        handle: handleMock,
      },
    },
    logger: {
      info: vi.fn(),
    },
  } as unknown as Context

  return {
    ctx,
    getHandler: () => capturedHandler,
    getOptions: () => capturedOptions,
  }
}

function maintenanceDeps(): Pick<MineruRpcDeps, 'maintenance'> {
  return {
    maintenance: {
      getStatistics: vi.fn(),
      scanIntegrity: vi.fn(),
      listQuarantine: vi.fn(),
      cleanupQuarantine: vi.fn(),
      gcDryRun: vi.fn(),
      clearCache: vi.fn(),
    } as unknown as MineruRpcDeps['maintenance'],
  }
}

describe('MinerU RPC (registerRpc)', () => {
  it('registers on /dsh-pdf-mineru-api channel with loopback authority', () => {
    expect(RPC_CHANNEL).toBe('/dsh-pdf-mineru-api')
    const { ctx, getOptions } = createMockContext()
    const deps: MineruRpcDeps = {
      ...maintenanceDeps(),
      getConfig: vi.fn(() => defaultMinerUConfig()),
      setConfig: vi.fn(async c => c as MinerUConfig),
      probe: vi.fn(async () => ({
        available: true,
        provider: 'self-hosted-v2' as const,
        authentication: 'valid' as const,
        protocol_version: '2.0',
      })),
    }

    registerRpc(ctx, deps)
    expect(getOptions().authority).toBe('loopback')
  })

  it('handles mineru/config.get by returning current MinerUConfig', async () => {
    const { ctx, getHandler } = createMockContext()
    const config = defaultMinerUConfig()
    const deps: MineruRpcDeps = {
      ...maintenanceDeps(),
      getConfig: vi.fn(() => config),
      setConfig: vi.fn(async c => c as MinerUConfig),
      probe: vi.fn(async () => ({} as ProbeView)),
    }

    registerRpc(ctx, deps)
    const handler = getHandler()

    const res = await handler('mineru/config.get', {}, new AbortController().signal)
    expect(res).toEqual({
      ok: true,
      value: { config },
    })
    expect(deps.getConfig).toHaveBeenCalledTimes(1)
  })

  it('handles mineru/config.set with validation, migration, and persistence', async () => {
    const { ctx, getHandler } = createMockContext()
    let storedConfig = defaultMinerUConfig()
    const deps: MineruRpcDeps = {
      ...maintenanceDeps(),
      getConfig: vi.fn(() => storedConfig),
      setConfig: vi.fn(async (c: unknown) => {
        storedConfig = c as MinerUConfig
        return storedConfig
      }),
      probe: vi.fn(async () => ({} as ProbeView)),
    }

    registerRpc(ctx, deps)
    const handler = getHandler()

    // 1. Valid modern config patch
    const patchPayload = {
      config: {
        ...storedConfig,
        output: { maxInlineChars: 50000 },
      },
    }
    const res1 = await handler('mineru/config.set', patchPayload, new AbortController().signal)
    expect(res1.ok).toBe(true)
    if (res1.ok) {
      expect((res1.value as { config: MinerUConfig }).config.output.maxInlineChars).toBe(50000)
    }
    expect(deps.setConfig).toHaveBeenCalledTimes(1)

    // 2. Removed flat config and malformed payloads fail without persistence
    const flat = await handler('mineru/config.set', { config: {
      baseURL: 'http://custom-host:18000', defaultBackend: 'vlm-engine',
    } }, new AbortController().signal)
    expect(flat).toMatchObject({ ok: false, error: { code: 'mineru/invalid-argument' } })

    // 3. Invalid or missing config returns failure without persisting defaults
    const invalidRes = await handler('mineru/config.set', { config: { activeProvider: 'invalid-id' } }, new AbortController().signal)
    expect(invalidRes.ok).toBe(false)
    const callsBeforeMissingConfig = vi.mocked(deps.setConfig).mock.calls.length
    for (const payload of [{}, [], { config: undefined }, { config: null }]) {
      const missingRes = await handler('mineru/config.set', payload, new AbortController().signal)
      expect(missingRes).toMatchObject({ ok: false, error: { code: 'mineru/invalid-argument' } })
    }
    expect(deps.setConfig).toHaveBeenCalledTimes(callsBeforeMissingConfig)
  })

  it('handles mineru/probe with unsaved draft provider without calling setConfig', async () => {
    const { ctx, getHandler } = createMockContext()
    const probeMock = vi.fn(async (draft?: unknown, signal?: AbortSignal): Promise<ProbeView> => {
      expect(signal).toBeDefined()
      const d = draft as { baseURL?: string } | undefined
      return {
        available: d?.baseURL !== 'http://bad-host',
        provider: 'official-v4',
        authentication: 'valid',
        protocol_version: '4.0',
        server_version: '4.1.0',
        queue: { queued: 2, processing: 1, max_concurrent: 4 },
      }
    })

    const setConfigMock = vi.fn()
    const deps: MineruRpcDeps = {
      ...maintenanceDeps(),
      getConfig: vi.fn(() => defaultMinerUConfig()),
      setConfig: setConfigMock,
      probe: probeMock,
    }

    registerRpc(ctx, deps)
    const handler = getHandler()

    const draftProvider = {
      id: asProviderConfigId('mp_draft'),
      type: 'official-v4',
      baseURL: 'https://mineru.net/api/v4',
      apiKeyEnv: 'TEST_KEY',
      models: ['pipeline', 'vlm'],
      configuredVersion: 'v4',
    }

    const controller = new AbortController()
    const res = await handler('mineru/probe', { provider: draftProvider }, controller.signal)

    expect(res.ok).toBe(true)
    if (res.ok) {
      const view = res.value as ProbeView
      expect(view.available).toBe(true)
      expect(view.provider).toBe('official-v4')
      expect(view.server_version).toBe('4.1.0')
      expect(view.queue?.queued).toBe(2)
    }

    // Probing a draft MUST NOT persist/call setConfig. Malformed payloads fail before probing.
    expect(setConfigMock).not.toHaveBeenCalled()
    const malformed = await handler('mineru/probe', 'not-an-object', controller.signal)
    expect(malformed).toMatchObject({ ok: false, error: { code: 'mineru/invalid-argument' } })
    expect(probeMock).toHaveBeenCalledTimes(1)
  })

  it('exposes bounded read-only storage statistics and GC preview endpoints', async () => {
    const { ctx, getHandler } = createMockContext()
    const stats = { generatedAt: 1, publishedResults: { byteUsage: 10, logicalEntryCount: 1 } }
    const preview = { generatedAt: 2, dryRun: true, eligible: true, candidateCount: 1, candidateBytes: 10 }
    const maintenance = {
      getStatistics: vi.fn(async () => stats),
      scanIntegrity: vi.fn(),
      listQuarantine: vi.fn(),
      cleanupQuarantine: vi.fn(),
      gcDryRun: vi.fn(async () => preview),
    }
    const deps: MineruRpcDeps = {
      getConfig: vi.fn(() => defaultMinerUConfig()), setConfig: vi.fn(), probe: vi.fn(),
      maintenance: maintenance as unknown as MineruRpcDeps['maintenance'],
    }
    registerRpc(ctx, deps)
    const handler = getHandler()
    const signal = new AbortController().signal

    expect(await handler('mineru/storage.stats', {}, signal)).toEqual({ ok: true, value: stats })
    expect(await handler('mineru/storage.gc.preview', { result_limit: 20, candidate_limit: 5 }, signal))
      .toEqual({ ok: true, value: preview })
    expect(maintenance.getStatistics).toHaveBeenCalledWith(signal)
    expect(maintenance.gcDryRun).toHaveBeenCalledWith(expect.objectContaining({
      resultLimit: 20, candidateLimit: 5, signal,
    }))
  })

  it('requires explicit confirmation for destructive maintenance operations', async () => {
    const { ctx, getHandler } = createMockContext()
    const cleanup = { generatedAt: 1, dryRun: false, requestedCount: 1, deletedCount: 1, deletedBytes: 10 }
    const cacheClear = { generatedAt: 1, dryRun: true, eligible: true, confirmationToken: 'preview-token', plannedCount: 2, deletedCount: 0, deletedBytes: 0 }
    const scan = { generatedAt: 1, readOnly: false, isolateInvalid: true, quarantinedCount: 1, scan: { scanned: 1 } }
    const maintenance = {
      getStatistics: vi.fn(),
      scanIntegrity: vi.fn(async () => scan),
      listQuarantine: vi.fn(),
      cleanupQuarantine: vi.fn(async () => cleanup),
      gcDryRun: vi.fn(),
      clearCache: vi.fn(async () => cacheClear),
    }
    const deps: MineruRpcDeps = {
      getConfig: vi.fn(() => defaultMinerUConfig()), setConfig: vi.fn(), probe: vi.fn(),
      maintenance: maintenance as unknown as MineruRpcDeps['maintenance'],
    }
    registerRpc(ctx, deps)
    const handler = getHandler()
    const signal = new AbortController().signal

    const refusedCleanup = await handler(
      'mineru/storage.quarantine.cleanup', { entry_ids: ['entry_1'], dry_run: false }, signal,
    )
    expect(refusedCleanup).toMatchObject({ ok: false, error: { code: 'mineru/invalid-argument' } })
    expect(maintenance.cleanupQuarantine).not.toHaveBeenCalled()

    const acceptedCleanup = await handler(
      'mineru/storage.quarantine.cleanup', { entry_ids: ['entry_1'], dry_run: false, confirm: true }, signal,
    )
    expect(acceptedCleanup).toEqual({ ok: true, value: cleanup })
    expect(maintenance.cleanupQuarantine).toHaveBeenCalledWith({ entryIds: ['entry_1'], dryRun: false, signal })

    const refusedCacheClear = await handler(
      'mineru/storage.cache.clear', { dry_run: false, confirm: true }, signal,
    )
    expect(refusedCacheClear).toMatchObject({ ok: false, error: { code: 'mineru/invalid-argument' } })
    expect(maintenance.clearCache).not.toHaveBeenCalled()

    const previewCacheClear = await handler(
      'mineru/storage.cache.clear', { dry_run: true, result_limit: 50, diagnostic_limit: 10 }, signal,
    )
    expect(previewCacheClear).toEqual({ ok: true, value: cacheClear })
    expect(maintenance.clearCache).toHaveBeenLastCalledWith({
      resultLimit: 50, diagnosticLimit: 10, dryRun: true, signal,
    })

    const acceptedCacheClear = await handler(
      'mineru/storage.cache.clear', {
        dry_run: false, confirm: true, confirmation_token: 'preview-token',
      }, signal,
    )
    expect(acceptedCacheClear).toEqual({ ok: true, value: cacheClear })
    expect(maintenance.clearCache).toHaveBeenLastCalledWith({
      resultLimit: undefined, diagnosticLimit: undefined, dryRun: false,
      confirmationToken: 'preview-token', signal,
    })

    const refusedIsolation = await handler(
      'mineru/storage.integrity.scan', { isolate_invalid: true }, signal,
    )
    expect(refusedIsolation).toMatchObject({ ok: false, error: { code: 'mineru/invalid-argument' } })
    const acceptedIsolation = await handler(
      'mineru/storage.integrity.scan', { isolate_invalid: true, confirm: true }, signal,
    )
    expect(acceptedIsolation).toEqual({ ok: true, value: scan })
  })

  it('sanitizes error diagnostics in probe failure and does not leak credentials', async () => {
    const { ctx, getHandler } = createMockContext()
    const deps: MineruRpcDeps = {
      ...maintenanceDeps(),
      getConfig: vi.fn(() => defaultMinerUConfig()),
      setConfig: vi.fn(),
      probe: vi.fn(async () => {
        throw new Error('Connection failed: Bearer secret_token_12345 to https://user:p%40ss@secret.host/token/path?token=abc#fragment')
      }),
    }

    registerRpc(ctx, deps)
    const handler = getHandler()

    const res = await handler('mineru/probe', {}, new AbortController().signal)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.message).toContain('Bearer [REDACTED]')
      for (const secret of ['secret_token_12345', 'user', 'p%40ss', '/token/path', 'token=abc', 'fragment']) {
        expect(res.error.message).not.toContain(secret)
      }
    }
  })

  it('returns mineru/not-found for unknown RPC endpoints', async () => {
    const { ctx, getHandler } = createMockContext()
    const deps: MineruRpcDeps = {
      ...maintenanceDeps(),
      getConfig: vi.fn(() => defaultMinerUConfig()),
      setConfig: vi.fn(),
      probe: vi.fn(),
    }

    registerRpc(ctx, deps)
    const handler = getHandler()

    const res = await handler('mineru/unknown_action', {}, new AbortController().signal)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('mineru/not-found')
    }
  })
})

describe('Client UI Pure Helpers (SettingsPage)', () => {
  function clientContext() {
    const rpc = { call: vi.fn() }
    const credentials = { describe: vi.fn(), set: vi.fn(), unset: vi.fn() }
    const register = vi.fn(() => vi.fn())
    const slotInject = vi.fn((_slot: string, factory: () => unknown) => factory())
    const ctx = {
      effect: (factory: () => unknown) => { factory(); return vi.fn() },
      get: (name: string) => name === 'connection' ? { rpc } : undefined,
      locale: {
        register: vi.fn(() => vi.fn()),
        bind: vi.fn(() => (key: string) => key),
      },
      remote: { credentials },
      slots: { inject: slotInject, register },
    } as never
    return { ctx, rpc, credentials, register, slotInject }
  }

  it('registers a dedicated settings section for MinerU configuration and operations', () => {
    const { ctx, rpc, credentials, register, slotInject } = clientContext()
    expect(clientInject).toEqual(['slots', 'locale', 'connection', 'remote', 'remote.credentials'])
    applyClient(ctx)

    expect(slotInject).toHaveBeenCalledWith('settings.section', expect.any(Function))
    const [options] = register.mock.calls[0]!
    expect(options).toMatchObject({
      name: 'settings.section', id: 'dsh-pdf-mineru', order: 40, locale: 'dsh-pdf-mineru',
    })
    expect(options.label()).toBe('nav')
    expect(options.inject()).toEqual({ rpc, credentials })
  })

  it('uses the Harness credential API without exposing stored values', async () => {
    const describe = vi.fn(async () => ({
      ok: true as const,
      value: { MINERU_API_KEY: { configured: true, source: 'file', writable: true } },
    }))
    const set = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const unset = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const credentials = { describe, set, unset } as CredentialClient

    const view = await describeCredential(credentials, 'MINERU_API_KEY')
    expect(view).toEqual({ configured: true, source: 'file', writable: true })
    expect(view).not.toHaveProperty('value')
    expect(describe).toHaveBeenCalledWith(['MINERU_API_KEY'])

    await storeCredential(credentials, 'MINERU_API_KEY', '  secret-mineru-key  ')
    expect(set).toHaveBeenCalledWith('MINERU_API_KEY', 'secret-mineru-key')

    await clearCredential(credentials, 'MINERU_API_KEY')
    expect(unset).toHaveBeenCalledWith('MINERU_API_KEY')
  })

  it('rejects blank or Host-rejected credential writes and keeps references separate', async () => {
    const base = defaultMinerUConfig()
    expect(credentialReference(base.providers[0])).toBe('MINERU_API_KEY')
    expect(credentialReference({ ...base.providers[0]!, apiKeyEnv: undefined })).toBeUndefined()

    const set = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'credential/rejected', message: 'credential is shadowed by a read-only source' },
    }))
    const credentials = {
      describe: vi.fn(),
      set,
      unset: vi.fn(),
    } as unknown as CredentialClient

    await expect(storeCredential(credentials, 'MINERU_API_KEY', '   ')).rejects.toThrow(/must not be empty/)
    expect(set).not.toHaveBeenCalled()
    await expect(storeCredential(credentials, 'MINERU_API_KEY', 'new-secret')).rejects.toThrow(/read-only source/)
  })

  it('formats storage byte counters without unsafe or shifting values', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1024)).toBe('1.00 KiB')
    expect(formatBytes(10 * 1024 * 1024)).toBe('10.0 MiB')
    expect(formatBytes(Number.MAX_SAFE_INTEGER, true)).toMatch(/^>= /)
    expect(formatBytes(-1)).toBe('N/A')
  })

  it('completes legacy single-provider drafts and preserves both profiles across switching', () => {
    const base = defaultMinerUConfig()
    const selfHosted: SelfHostedV2Config = {
      id: asProviderConfigId('mp_primary'),
      type: 'self-hosted-v2',
      baseURL: 'http://gpu-server:18000',
      apiKeyEnv: 'LOCAL_KEY',
      modelMap: { pipeline: 'pipeline', vlm: 'hybrid-engine' },
      allowInsecureHttp: true,
      configuredVersion: 'v2.1',
    }
    const legacySingle = { ...base, activeProvider: selfHosted.id, providers: [selfHosted] }

    const completed = ensureProviderProfiles(legacySingle)
    expect(completed.providers).toHaveLength(2)
    expect(completed.providers[0]).toEqual(selfHosted)
    const official = completed.providers.find(provider => provider.type === 'official-v4')
    expect(official).toMatchObject({
      id: 'mp_official',
      baseURL: 'https://mineru.net/api/v4',
      models: ['pipeline', 'vlm'],
    })

    const officialActive = activateProvider(completed, official!.id)
    const officialEdited = patchActiveProvider(officialActive, {
      baseURL: 'https://gateway.example/api/v4',
      models: ['vlm'],
    })
    const backToSelfHosted = activateProvider(officialEdited, selfHosted.id)

    expect(backToSelfHosted.providers.find(provider => provider.id === selfHosted.id)).toEqual(selfHosted)
    expect(backToSelfHosted.providers.find(provider => provider.id === official!.id)).toMatchObject({
      baseURL: 'https://gateway.example/api/v4',
      models: ['vlm'],
    })
  })

  it('uses a unique ID when completing a legacy profile with a colliding canonical ID', () => {
    const base = defaultMinerUConfig()
    const official = { ...base.providers[1]!, id: asProviderConfigId('mp_self_hosted') } as OfficialV4Config
    const completed = ensureProviderProfiles({ ...base, activeProvider: official.id, providers: [official] })

    expect(completed.providers.map(provider => provider.id)).toEqual(['mp_self_hosted', 'mp_self_hosted_2'])
    expect(completed.providers.map(provider => provider.type)).toEqual(['official-v4', 'self-hosted-v2'])
  })

  it('normalizes defaults to the active official provider capabilities', () => {
    const base = defaultMinerUConfig()
    const provider: OfficialV4Config = {
      id: asProviderConfigId('mp_official'), type: 'official-v4',
      baseURL: 'https://mineru.net/api/v4', apiKeyEnv: 'TOKEN',
      models: ['vlm'], configuredVersion: 'v4',
    }
    const invalidDraft = {
      ...base, activeProvider: provider.id, providers: [provider],
      defaults: { ...base.defaults, model: 'pipeline' as const, parseMethod: 'txt' as const },
    }
    expect(normalizeProviderDefaults(invalidDraft, provider).defaults).toMatchObject({
      model: 'vlm', parseMethod: 'auto', ocr: false,
    })
  })

  it('patchActiveProvider updates the active provider in config.providers', () => {
    const config = defaultMinerUConfig()
    const updated = patchActiveProvider(config, {
      baseURL: 'https://new-endpoint.internal:8443',
    })

    expect(updated.providers[0]?.baseURL).toBe('https://new-endpoint.internal:8443')
    expect(updated.activeProvider).toBe(config.activeProvider)
  })


})
