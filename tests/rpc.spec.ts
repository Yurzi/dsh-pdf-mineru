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
  patchActiveProvider,
  switchProviderType,
  updateConfigSection,
} from '../src/client/SettingsPage.js'

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

describe('MinerU RPC (registerRpc)', () => {
  it('registers on /dsh-pdf-mineru-api channel with loopback authority', () => {
    expect(RPC_CHANNEL).toBe('/dsh-pdf-mineru-api')
    const { ctx, getOptions } = createMockContext()
    const deps: MineruRpcDeps = {
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

    // 2. Legacy config migration (baseURL + defaultBackend)
    const legacyPayload = {
      config: {
        baseURL: 'http://custom-host:18000',
        defaultBackend: 'vlm-engine',
        apiKeyEnv: 'MY_KEY',
      },
    }
    const res2 = await handler('mineru/config.set', legacyPayload, new AbortController().signal)
    expect(res2.ok).toBe(true)
    if (res2.ok) {
      const cfg = (res2.value as { config: MinerUConfig }).config
      expect(cfg.providers[0]?.baseURL).toBe('http://custom-host:18000')
      expect(cfg.providers[0]?.apiKeyEnv).toBe('MY_KEY')
      expect(cfg.defaults.model).toBe('vlm')
    }

    // 3. Invalid payload returns failure without crashing
    const invalidRes = await handler('mineru/config.set', { config: { activeProvider: 'invalid-id' } }, new AbortController().signal)
    expect(invalidRes.ok).toBe(false)
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

    // Probing a draft MUST NOT persist/call setConfig
    expect(setConfigMock).not.toHaveBeenCalled()
  })

  it('sanitizes error diagnostics in probe failure and does not leak credentials', async () => {
    const { ctx, getHandler } = createMockContext()
    const deps: MineruRpcDeps = {
      getConfig: vi.fn(() => defaultMinerUConfig()),
      setConfig: vi.fn(),
      probe: vi.fn(async () => {
        throw new Error('Connection failed: Bearer secret_token_12345 to https://secret.host/api?token=abc')
      }),
    }

    registerRpc(ctx, deps)
    const handler = getHandler()

    const res = await handler('mineru/probe', {}, new AbortController().signal)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.message).toContain('Bearer [REDACTED]')
      expect(res.error.message).not.toContain('secret_token_12345')
      expect(res.error.message).not.toContain('token=abc')
    }
  })

  it('returns not-found for unknown RPC endpoints', async () => {
    const { ctx, getHandler } = createMockContext()
    const deps: MineruRpcDeps = {
      getConfig: vi.fn(() => defaultMinerUConfig()),
      setConfig: vi.fn(),
      probe: vi.fn(),
    }

    registerRpc(ctx, deps)
    const handler = getHandler()

    const res = await handler('mineru/unknown_action', {}, new AbortController().signal)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('not-found')
    }
  })
})

describe('Client UI Pure Helpers (SettingsPage)', () => {
  it('switchProviderType converts between self-hosted-v2 and official-v4 preserving IDs and cleaning invalid fields', () => {
    const selfHosted: SelfHostedV2Config = {
      id: asProviderConfigId('mp_primary'),
      type: 'self-hosted-v2',
      baseURL: 'http://localhost:18000',
      apiKeyEnv: 'CUSTOM_KEY',
      modelMap: { pipeline: 'pipeline', vlm: 'vlm-engine' },
      allowInsecureHttp: true,
      configuredVersion: 'v2.1',
    }

    // 1. Switch self-hosted -> official-v4
    const official = switchProviderType(selfHosted, 'official-v4')
    expect(official.id).toBe(selfHosted.id)
    expect(official.type).toBe('official-v4')
    expect(official.baseURL).toBe('https://mineru.net/api/v4')
    expect(official.apiKeyEnv).toBe('CUSTOM_KEY')
    expect((official as OfficialV4Config).models).toEqual(['pipeline', 'vlm'])
    expect((official as OfficialV4Config).configuredVersion).toBe('v4')
    // Old fields cleaned
    expect('modelMap' in official).toBe(false)
    expect('allowInsecureHttp' in official).toBe(false)

    // 2. Switch official-v4 -> self-hosted-v2
    const backToSelfHosted = switchProviderType(official, 'self-hosted-v2')
    expect(backToSelfHosted.id).toBe(official.id)
    expect(backToSelfHosted.type).toBe('self-hosted-v2')
    expect(backToSelfHosted.baseURL).toBe('http://localhost:18000')
    expect((backToSelfHosted as SelfHostedV2Config).modelMap).toEqual({ pipeline: 'pipeline', vlm: 'vlm-engine' })
    expect((backToSelfHosted as SelfHostedV2Config).allowInsecureHttp).toBe(true)
    // Official-only fields cleaned
    expect('models' in backToSelfHosted).toBe(false)

    // 3. Idempotent on same type
    expect(switchProviderType(selfHosted, 'self-hosted-v2')).toBe(selfHosted)
  })

  it('patchActiveProvider updates the active provider in config.providers', () => {
    const config = defaultMinerUConfig()
    const updated = patchActiveProvider(config, {
      baseURL: 'https://new-endpoint.internal:8443',
    })

    expect(updated.providers[0]?.baseURL).toBe('https://new-endpoint.internal:8443')
    expect(updated.activeProvider).toBe(config.activeProvider)
  })

  it('updateConfigSection updates a specific subsection immutably', () => {
    const config = defaultMinerUConfig()

    const withStorage = updateConfigSection(config, 'storage', {
      cacheEnabled: false,
      stagingTtlMs: 7200000,
    })
    expect(withStorage.storage.cacheEnabled).toBe(false)
    expect(withStorage.storage.stagingTtlMs).toBe(7200000)
    expect(withStorage.storage.storageRoot).toBe(config.storage.storageRoot)

    const withPolling = updateConfigSection(config, 'polling', {
      pollIntervalMs: 5000,
    })
    expect(withPolling.polling.pollIntervalMs).toBe(5000)
    expect(withPolling.polling.pollTimeoutMs).toBe(config.polling.pollTimeoutMs)
  })
})
