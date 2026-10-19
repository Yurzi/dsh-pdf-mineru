import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { MinerUConfig } from '../src/config/model.js'
import { defaultMinerUConfig } from '../src/config/parse.js'
import { apply, inject, name } from '../src/index.js'
import { credentialResolver } from '../src/plugin/credentials.js'
import { SharedOperationRegistry } from '../src/service/shared-operations.js'
import { ResultRepository } from '../src/storage/result-repository.js'
import { ownerPeer } from './support/rpc-harness.js'
import { tempRoot } from './support/storage-fixtures.js'

vi.mock('@deepseek-ai/dsh-tools', () => ({ defineTool: (definition: unknown) => definition }))
// The real scoped transport, trust fence, and route lifecycle are covered by host-compatibility.spec.ts.
vi.mock('../src/loopback-rpc.js', () => ({
  registerLoopbackRpc: (ctx: Context, channel: string, handler: ConnectionRpcHandler) => ctx.connection.rpc.handle(channel, handler),
}))

async function storedConfig(): Promise<MinerUConfig> {
  const base = defaultMinerUConfig()
  return { ...base, storage: { ...base.storage, storageRoot: join(await tempRoot('mineru-index-'), 'store') } }
}

/** Minimal Cordis surface used by apply(); the real Loader composition lives in settings-compatibility.spec.ts. */
function fakeContext(config: MinerUConfig) {
  const order: string[] = []
  const effects: Array<() => unknown> = []
  let inactive = false
  let rpc: ConnectionRpcHandler | undefined
  let rpcDisposals = 0
  const guard = () => { if (inactive) throw new Error('cannot create effect on inactive context') }
  const settingsReplace = vi.fn(async (_namespace: string, section: object) => {
    Object.assign(config, section, { storage: { ...config.storage, ...(section as Partial<MinerUConfig>).storage } })
  })
  const settings = { configure: vi.fn(() => () => undefined), replace: settingsReplace, describe: () => [{ ns: 'mineru-custom', revision: 0 }] }
  const value = {
    fiber: { entry: { options: { id: 'mineru-custom' } } },
    tools: {
      register: (definition: { name: string }) => {
        guard()
        order.push('register ' + definition.name)
        return () => { order.push('dispose ' + definition.name) }
      },
    },
    connection: {
      rpc: {
        handle: (_channel: string, handler: ConnectionRpcHandler) => {
          rpc = handler
          return () => { rpcDisposals++ }
        },
      },
    },
    get: (service: string) => service === 'settings' ? settings : undefined,
    effect: (factory: () => unknown) => {
      guard()
      const cleanup = factory()
      if (typeof cleanup === 'function') effects.push(cleanup as () => unknown)
      return () => undefined
    },
    inject: (_deps: string[], callback: (ctx: unknown) => unknown) => {
      guard()
      const cleanup = callback(value)
      if (typeof cleanup === 'function') effects.push(cleanup as () => unknown)
      return () => undefined
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
  }
  return {
    // Fixture boundary: apply() needs only the members above, not a full Cordis Context.
    ctx: value as unknown as Context,
    order, settingsReplace,
    rpcDisposals: () => rpcDisposals,
    call: async (endpoint: string, payload: unknown = {}) => {
      if (rpc === undefined) throw new Error('RPC was not registered')
      return await rpc(endpoint, payload, new AbortController().signal, ownerPeer())
    },
    /** Mirror Cordis fiber disposal: invalidate first, then run effect cleanups. */
    disposeContext: async () => {
      inactive = true
      for (const cleanup of effects.splice(0).reverse()) await cleanup()
    },
  }
}

describe('plugin composition lifecycle', () => {
  it('declares its package identity and required services', () => {
    expect(name).toBe('dsh-pdf-mineru')
    expect(inject).toEqual(expect.arrayContaining(['tools', 'jobs', 'settings', 'workingDirectory']))
  })

  it('aborts startup when the fiber is disposed during staging cleanup and never resumes into it', async () => {
    const config = await storedConfig()
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const seen = new Promise<void>(resolve => { started = resolve })
    vi.spyOn(ResultRepository.prototype, 'cleanupStaging').mockImplementation(async (_ttl, _active, signal) => {
      started()
      await gate
      signal?.throwIfAborted()
      return 0
    })
    const runtime = fakeContext(config)
    const applying = apply(runtime.ctx, config)
    await seen
    await runtime.disposeContext()
    release()
    const dispose = await applying
    await dispose()
    expect(runtime.order).toEqual([])
  })

  it('registers both tools and RPC, then disposes tools before shutting down shared producers', async () => {
    const config = await storedConfig()
    const runtime = fakeContext(config)
    const shutdown = vi.spyOn(SharedOperationRegistry.prototype, 'shutdown').mockImplementation(async () => { runtime.order.push('shutdown operations') })
    const dispose = await apply(runtime.ctx, config)
    expect(await stat(config.storage.storageRoot)).toBeDefined()
    expect(runtime.order).toEqual(['register async_parse_pdf', 'register read_pdf'])
    expect(await runtime.call('mineru/config.get')).toMatchObject({ ok: true, value: { config, revision: 0 } })

    await runtime.disposeContext()
    await dispose() // idempotent after the lifecycle effect already ran
    expect(runtime.order.slice(2)).toEqual(['dispose async_parse_pdf', 'dispose read_pdf', 'shutdown operations'])
    expect(shutdown).toHaveBeenCalledOnce()
    expect(runtime.rpcDisposals()).toBe(1)
  })

  it.each([
    ['storageRoot', (config: MinerUConfig) => ({ ...config, storage: { ...config.storage, storageRoot: config.storage.storageRoot + '-other' } })],
    ['limits', (config: MinerUConfig) => ({ ...config, limits: { ...config.limits, maxZipEntryBytes: config.limits.maxZipEntryBytes + 1 } })],
  ])('refuses runtime %s changes without persisting', async (_field, change) => {
    const config = await storedConfig()
    const runtime = fakeContext(config)
    const dispose = await apply(runtime.ctx, config)
    expect(await runtime.call('mineru/config.set', { config: change(config) })).toMatchObject({ ok: false, error: { code: 'mineru/invalid-argument' } })
    expect(runtime.settingsReplace).not.toHaveBeenCalled()
    await dispose()
  })

  it('saves complete live values to the actual entry id and keeps runtime config when persistence fails', async () => {
    const config = await storedConfig()
    const runtime = fakeContext(config)
    const dispose = await apply(runtime.ctx, config)
    const before = structuredClone(config)
    runtime.settingsReplace.mockRejectedValueOnce(new Error('write failed'))
    const next = { ...config, output: { ...config.output, maxInlineImages: 9 } }
    expect(await runtime.call('mineru/config.set', { config: next })).toMatchObject({ ok: false })
    expect(await runtime.call('mineru/config.get')).toMatchObject({ ok: true, value: { config: before } })
    expect(await runtime.call('mineru/config.set', { config: next })).toMatchObject({ ok: true, value: { config: next } })
    const { limits: _limits, storage, ...live } = next
    expect(runtime.settingsReplace).toHaveBeenLastCalledWith('mineru-custom', {
      ...live, storage: { cacheEnabled: storage.cacheEnabled, stagingTtlMs: storage.stagingTtlMs },
    }, undefined)
    await dispose()
  })

  it('allows concurrent plugin instances on the same storageRoot', async () => {
    const config = await storedConfig()
    const first = fakeContext(config)
    const second = fakeContext(config)
    const disposers = [await apply(first.ctx, config), await apply(second.ctx, config)]
    expect(second.order).toEqual(['register async_parse_pdf', 'register read_pdf'])
    for (const dispose of disposers) await dispose()
  })
})

describe('credential service precedence', () => {
  it.each([
    { mounted: true, stored: 'stored-secret', expected: 'stored-secret' },
    { mounted: true, stored: undefined, expected: undefined },
    { mounted: false, stored: undefined, expected: 'environment-secret' },
  ])('resolves once and falls back to process.env only without a service: %j', async ({ mounted, stored, expected }) => {
    const credentials = {
      resolve: vi.fn(async () => stored === undefined ? undefined : ({ value: stored, source: 'file' as const })),
    } satisfies Pick<CredentialProvider, 'resolve'>
    // Fixture boundary: credentialResolver reads only ctx.get('credentials').
    const ctx = { get: (service: string) => service === 'credentials' && mounted ? credentials : undefined } as unknown as Context
    vi.stubEnv('MINERU_API_KEY', 'environment-secret')
    await expect(credentialResolver(ctx)('MINERU_API_KEY', new AbortController().signal)).resolves.toBe(expected)
    expect(credentials.resolve).toHaveBeenCalledTimes(mounted ? 1 : 0)
  })
})
