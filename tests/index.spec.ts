import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from 'cordis'
import { defaultMinerUConfig } from '../src/config.js'

vi.mock('@deepseek-ai/dsh-tools', () => ({ defineTool: (definition: unknown) => definition }))

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

interface FakeRuntime {
  readonly ctx: Context
  readonly definitions: unknown[]
  readonly effects: Array<() => void | Promise<void>>
  readonly rpc: { authority?: string; disposeCount: number }
}

function fakeContext(config: ReturnType<typeof defaultMinerUConfig>, failToolRegistration = false): FakeRuntime {
  const definitions: unknown[] = []
  const effects: Array<() => void | Promise<void>> = []
  const rpc = { authority: undefined as string | undefined, disposeCount: 0 }
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
        handle: (_channel: string, _handler: unknown, options: { authority: string }) => {
          rpc.authority = options.authority
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

describe('plugin composition lifecycle', () => {
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
