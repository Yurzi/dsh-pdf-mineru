import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from 'cordis'
import { defaultMinerUConfig } from '../src/config.js'
import { ProcessLock, ResultRepository } from '../src/storage/index.js'

vi.mock('@deepseek-ai/dsh-tools', () => ({ defineTool: (definition: unknown) => definition }))

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

interface FakeRuntime {
  readonly ctx: Context
  readonly definitions: unknown[]
  readonly effects: Array<() => void | Promise<void>>
  readonly rpc: {
    authority?: string
    disposeCount: number
    handler?: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>
  }
  readonly settingsReplace: ReturnType<typeof vi.fn>
}

function fakeContext(
  config: ReturnType<typeof defaultMinerUConfig>,
  failToolRegistration = false,
  storedConfig: ReturnType<typeof defaultMinerUConfig> = config,
): FakeRuntime {
  const definitions: unknown[] = []
  const effects: Array<() => void | Promise<void>> = []
  const rpc: FakeRuntime['rpc'] = { authority: undefined, disposeCount: 0 }
  const settingsReplace = vi.fn((_section: object) => Promise.resolve())
  const scope = {
    get: () => storedConfig,
    watch: (_callback: (next: unknown) => void) => () => undefined,
    replace: settingsReplace,
  }
  const value = {
    tools: {
      register: (definition: unknown) => {
        if (failToolRegistration) throw new Error('simulated tool registration failure')
        definitions.push(definition)
        return () => undefined
      },
      schemas: () => [],
    },
    connection: {
      rpc: {
        handle: (
          _channel: string,
          handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>,
          options: { authority: string },
        ) => {
          rpc.authority = options.authority
          rpc.handler = handler
          return () => { rpc.disposeCount++ }
        },
      },
    },
    get: (name: string) => name === 'settings'
      ? {
          register: (_namespace: string, _schema: unknown, options: { validate(value: unknown): void }) => {
            options.validate(storedConfig)
            return scope
          },
        }
      : undefined,
    effect: (factory: () => unknown) => {
      const cleanup = factory()
      if (typeof cleanup === 'function') effects.push(cleanup as () => void | Promise<void>)
      return () => undefined
    },
    on: () => () => undefined,
    inject: (_deps: string[], callback: (ctx: unknown) => unknown) => {
      const res = callback(value)
      if (typeof res === 'function') effects.push(res as () => void | Promise<void>)
      return () => undefined
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
  }
  return { ctx: value as unknown as Context, definitions, effects, rpc, settingsReplace }
}

function cancellableContext(config: ReturnType<typeof defaultMinerUConfig>): FakeRuntime & { disposeContext(): Promise<void> } {
  const runtime = fakeContext(config)
  let disposed = false
  const context = runtime.ctx as unknown as {
    readonly tools: { register(definition: unknown): () => void }
    inject(services: readonly string[], callback: (ctx: Context) => unknown): unknown
    effect(factory: () => unknown, label?: string): () => void
  }
  const register = context.tools.register
  context.tools.register = definition => {
    if (disposed) throw new Error('cannot create effect on inactive context')
    return register(definition)
  }
  const inject = context.inject
  context.inject = (services, callback) => {
    if (disposed) throw new Error('cannot create effect on inactive context')
    return inject(services, callback)
  }
  const effect = context.effect
  context.effect = (factory, label) => {
    if (disposed) throw new Error('cannot create effect on inactive context')
    return effect(factory, label)
  }
  return {
    ...runtime,
    disposeContext: async () => {
      disposed = true
      await Promise.all(runtime.effects.map(effect => effect()))
    },
  }
}

describe('plugin composition lifecycle', () => {
  it('cancels before initialization resumes into an inactive Cordis fiber', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mineru-index-cancel-lock-'))
    roots.push(root)
    const base = defaultMinerUConfig()
    const config = { ...base, storage: { ...base.storage, storageRoot: join(root, 'store') } }
    let releaseCleanup!: () => void
    let cleanupStarted!: () => void
    const cleanupGate = new Promise<void>(resolve => { releaseCleanup = resolve })
    const cleanupSeen = new Promise<void>(resolve => { cleanupStarted = resolve })
    const cleanup = vi.spyOn(ResultRepository.prototype, 'cleanupStaging').mockImplementation(async function (_ttl, _active, signal) {
      cleanupStarted()
      await cleanupGate
      signal?.throwIfAborted()
      return 0
    })
    const runtime = cancellableContext(config)
    const applying = (await import('../src/index.js')).apply(runtime.ctx, config)
    await cleanupSeen
    await runtime.disposeContext()
    releaseCleanup()

    await expect(applying).resolves.toEqual(expect.any(Function))
    expect(runtime.definitions).toHaveLength(0)
    cleanup.mockRestore()
  })

  it('cancels while staging cleanup is pending and shuts down operations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mineru-index-cancel-cleanup-'))
    roots.push(root)
    const base = defaultMinerUConfig()
    const config = { ...base, storage: { ...base.storage, storageRoot: join(root, 'store') } }
    let releaseCleanup!: () => void
    let cleanupStarted!: () => void
    const cleanupGate = new Promise<void>(resolve => { releaseCleanup = resolve })
    const cleanupSeen = new Promise<void>(resolve => { cleanupStarted = resolve })
    const cleanup = vi.spyOn(ResultRepository.prototype, 'cleanupStaging').mockImplementation(async function (_ttl, _active, signal) {
      cleanupStarted()
      await cleanupGate
      signal?.throwIfAborted()
      return 0
    })
    const runtime = cancellableContext(config)
    const applying = (await import('../src/index.js')).apply(runtime.ctx, config)
    await cleanupSeen
    await runtime.disposeContext()
    releaseCleanup()

    await expect(applying).resolves.toEqual(expect.any(Function))
    expect(runtime.definitions).toHaveLength(0)
    cleanup.mockRestore()
  })

  it('registers two tools and loopback RPC upon startup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mineru-index-'))
    roots.push(root)
    const base = defaultMinerUConfig()
    const config = { ...base, storage: { ...base.storage, storageRoot: join(root, 'store') } }
    const runtime = fakeContext(config)
    const { apply, name } = await import('../src/index.js')
    expect(name).toBe('dsh-pdf-mineru')
    const dispose = await apply(runtime.ctx, config)
    expect(runtime.definitions).toHaveLength(2)
    expect(runtime.rpc.authority).toBe('loopback')
    expect(await stat(config.storage.storageRoot)).toBeDefined()
    expect(runtime.effects.length).toBeGreaterThan(0)

    const otherRoot = join(root, 'other-store')
    const changed = { ...config, storage: { ...config.storage, storageRoot: otherRoot } }
    const response = await runtime.rpc.handler?.(
      'mineru/config.set', { config: changed }, new AbortController().signal,
    ) as { ok: boolean; error?: { code: string } }
    expect(response).toMatchObject({ ok: false })

    for (const eff of runtime.effects) await eff()
    await dispose()
    expect(runtime.rpc.disposeCount).toBe(1)
  })

  it('resolves persisted settings before fixing the storage root and persists RPC updates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mineru-index-settings-'))
    roots.push(root)
    const base = defaultMinerUConfig()
    const entryConfig = { ...base, storage: { ...base.storage, storageRoot: join(root, 'new-default') } }
    const storedConfig = {
      ...base,
      storage: { ...base.storage, storageRoot: join(root, 'persisted-user-root') },
      output: { maxInlineChars: 123456 },
    }
    const runtime = fakeContext(entryConfig, false, storedConfig)
    const { apply, inject } = await import('../src/index.js')

    expect(inject).toContain('settings')
    const dispose = await apply(runtime.ctx, entryConfig)
    expect(await stat(storedConfig.storage.storageRoot)).toBeDefined()
    await expect(stat(entryConfig.storage.storageRoot)).rejects.toThrow()

    const next = { ...storedConfig, output: { maxInlineChars: 234567 } }
    const response = await runtime.rpc.handler?.(
      'mineru/config.set', { config: next }, new AbortController().signal,
    ) as { ok: boolean; value?: { config: typeof next } }
    expect(response).toMatchObject({ ok: true, value: { config: next } })
    expect(runtime.settingsReplace).toHaveBeenCalledOnce()
    expect(runtime.settingsReplace).toHaveBeenCalledWith(next)

    await dispose()
  })

  it('keeps provider schema branches discriminated by type', async () => {
    const { Config } = await import('../src/index.js')
    const validate = Config as unknown as (value: unknown) => Record<string, unknown>
    const base = defaultMinerUConfig()
    const parsed = validate(base) as unknown as typeof base

    expect(parsed.providers).toHaveLength(2)
    expect(parsed.providers[1]).toEqual(base.providers[1])
    expect(parsed.providers[1]).not.toHaveProperty('modelMap')
    expect(() => validate({
      ...base,
      providers: [{ ...base.providers[0], type: 'unsupported-provider' }],
    })).toThrow()
  })

  it('allows multiple concurrent plugin instances on the same storageRoot without throwing STORAGE_LOCKED', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mineru-concurrent-'))
    roots.push(root)
    const base = defaultMinerUConfig()
    const config = { ...base, storage: { ...base.storage, storageRoot: join(root, 'store') } }
    const runtime1 = fakeContext(config)
    const runtime2 = fakeContext(config)
    const { apply } = await import('../src/index.js')
    const dispose1 = await apply(runtime1.ctx, config)
    const dispose2 = await apply(runtime2.ctx, config)
    expect(runtime1.definitions).toHaveLength(2)
    expect(runtime2.definitions).toHaveLength(2)
    await dispose1()
    await dispose2()
  })
})
