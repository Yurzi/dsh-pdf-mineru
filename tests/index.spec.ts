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
}

function fakeContext(config: ReturnType<typeof defaultMinerUConfig>, failToolRegistration = false): FakeRuntime {
  const definitions: unknown[] = []
  const effects: Array<() => void | Promise<void>> = []
  const rpc: FakeRuntime['rpc'] = { authority: undefined, disposeCount: 0 }
  const scope = {
    get: () => config,
    watch: (_callback: (next: unknown) => void) => () => undefined,
    replace: (_section: object) => Promise.resolve(),
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
      ? { register: () => scope }
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
  return { ctx: value as unknown as Context, definitions, effects, rpc }
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
  it('cancels before lock acquisition resumes into an inactive Cordis fiber', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mineru-index-cancel-lock-'))
    roots.push(root)
    const base = defaultMinerUConfig()
    const config = { ...base, storage: { ...base.storage, storageRoot: join(root, 'store') } }
    let releaseAcquire!: () => void
    let acquireStarted!: () => void
    const acquireGate = new Promise<void>(resolve => { releaseAcquire = resolve })
    const acquireSeen = new Promise<void>(resolve => { acquireStarted = resolve })
    const acquire = vi.spyOn(ProcessLock.prototype, 'acquire').mockImplementation(async function (signal) {
      acquireStarted()
      await acquireGate
      signal?.throwIfAborted()
    })
    const release = vi.spyOn(ProcessLock.prototype, 'release').mockResolvedValue(undefined)
    const runtime = cancellableContext(config)
    const applying = (await import('../src/index.js')).apply(runtime.ctx, config)
    await acquireSeen
    await runtime.disposeContext()
    releaseAcquire()

    await expect(applying).resolves.toEqual(expect.any(Function))
    expect(runtime.definitions).toHaveLength(0)
    expect(release).toHaveBeenCalled()
    acquire.mockRestore()
    release.mockRestore()
  })

  it('cancels while staging cleanup is pending and releases the lock', async () => {
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
    const release = vi.spyOn(ProcessLock.prototype, 'release')
    const runtime = cancellableContext(config)
    const applying = (await import('../src/index.js')).apply(runtime.ctx, config)
    await cleanupSeen
    await runtime.disposeContext()
    releaseCleanup()

    await expect(applying).resolves.toEqual(expect.any(Function))
    expect(runtime.definitions).toHaveLength(0)
    expect(release).toHaveBeenCalled()
    cleanup.mockRestore()
    release.mockRestore()
  })

  it('registers five tools and loopback RPC only after acquiring storage lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mineru-index-'))
    roots.push(root)
    const base = defaultMinerUConfig()
    const config = { ...base, storage: { ...base.storage, storageRoot: join(root, 'store') } }
    const runtime = fakeContext(config)
    const { apply, name } = await import('../src/index.js')
    expect(name).toBe('dsh-pdf-mineru')
    const dispose = await apply(runtime.ctx, config)
    expect(runtime.definitions).toHaveLength(5)
    expect(runtime.rpc.authority).toBe('loopback')
    expect(await stat(join(config.storage.storageRoot, '.process.lock'))).toBeDefined()
    expect(runtime.effects.length).toBeGreaterThan(0)

    const otherRoot = join(root, 'other-store')
    const changed = { ...config, storage: { ...config.storage, storageRoot: otherRoot } }
    const response = await runtime.rpc.handler?.(
      'mineru/config.set', { config: changed }, new AbortController().signal,
    ) as { ok: boolean; error?: { code: string } }
    expect(response).toMatchObject({ ok: false })
    await expect(stat(join(otherRoot, '.process.lock'))).rejects.toThrow()

    for (const eff of runtime.effects) await eff()
    await dispose()
    await expect(stat(join(config.storage.storageRoot, '.process.lock'))).rejects.toThrow()
    expect(runtime.rpc.disposeCount).toBe(1)
  })

  it('releases the process lock when initialization fails after lock acquisition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mineru-index-fail-'))
    roots.push(root)
    const base = defaultMinerUConfig()
    const config = { ...base, storage: { ...base.storage, storageRoot: join(root, 'store') } }
    const runtime = fakeContext(config, true)
    const { apply } = await import('../src/index.js')
    await expect(apply(runtime.ctx, config)).rejects.toThrow(/simulated tool registration failure/)
    await expect(stat(join(config.storage.storageRoot, '.process.lock'))).rejects.toThrow()
  })
})
