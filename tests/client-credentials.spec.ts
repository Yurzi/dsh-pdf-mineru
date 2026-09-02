// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { URL as NodeURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.js'
import { adaptLegacyCredentials, type LegacyCredentialClient } from '../src/client/legacy-credentials.js'
import { describeCredential, storeCredential, clearCredential, type CredentialClient, type MineruSettingsInjected } from '../src/client/SettingsPage.js'

function legacyFixture() {
  return {
    describe: vi.fn(async (_payload: { refs: string[] }) => ({ result: { ok: true as const, value: {
      credentials: { TEST: { configured: true, writable: false, source: 'environment' } },
    } } })),
    set: vi.fn(async (_payload: { ref: string; value: string }) => ({ result: { ok: true as const, value: {} } })),
    unset: vi.fn(async (_payload: { ref: string }) => ({ result: { ok: true as const, value: {} } })),
  }
}

describe('RC2 credential adapter', () => {
  it('normalizes metadata and sends exact legacy payloads', async () => {
    const legacy = legacyFixture()
    const client = adaptLegacyCredentials(legacy)
    expect(await describeCredential(client, 'TEST')).toEqual({ configured: true, writable: false, source: 'environment' })
    expect(await describeCredential(client, 'MISSING')).toEqual({ configured: false, writable: true })
    await storeCredential(client, 'TEST', ' fixture-key ')
    await clearCredential(client, 'TEST')
    expect(legacy.describe.mock.calls).toEqual([[{ refs: ['TEST'] }], [{ refs: ['MISSING'] }]])
    expect(legacy.set.mock.calls).toEqual([[{ ref: 'TEST', value: 'fixture-key' }]])
    expect(legacy.unset.mock.calls).toEqual([[{ ref: 'TEST' }]])
  })

  it('rejects a blank key before making a write', async () => {
    const legacy = legacyFixture()
    await expect(storeCredential(adaptLegacyCredentials(legacy), 'TEST', '   ')).rejects.toThrow('must not be empty')
    expect(legacy.set).not.toHaveBeenCalled()
  })

  it.each(['describe', 'set', 'unset'] as const)('preserves %s failures without retry or API fallback', async method => {
    const failed = { ok: false as const, error: { code: 'READ_ONLY', message: 'fixture denied', details: { writable: false } } }
    const call = vi.fn(async () => ({ result: failed }))
    const client = adaptLegacyCredentials({ ...legacyFixture(), [method]: call })
    const result = method === 'describe' ? await client.describe(['TEST'])
      : method === 'set' ? await client.set('TEST', 'fixture-key') : await client.unset('TEST')
    expect(result).toBe(failed)
    expect(call).toHaveBeenCalledTimes(1)
    const operation = method === 'describe' ? describeCredential(client, 'TEST')
      : method === 'set' ? storeCredential(client, 'TEST', 'fixture-key') : clearCredential(client, 'TEST')
    await expect(operation).rejects.toThrow('fixture denied')
    expect(call).toHaveBeenCalledTimes(2)
  })

  it.each(['describe', 'set', 'unset'] as const)('propagates %s transport errors without retry', async method => {
    const error = new Error('fixture offline')
    const call = vi.fn(async () => { throw error })
    const client = adaptLegacyCredentials({ ...legacyFixture(), [method]: call })
    const operation = method === 'describe' ? client.describe(['TEST'])
      : method === 'set' ? client.set('TEST', 'fixture-key') : client.unset('TEST')
    await expect(operation).rejects.toBe(error)
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('keeps the legacy method receiver', async () => {
    const legacy: LegacyCredentialClient = {
      async describe() { expect(this).toBe(legacy); return { result: { ok: true, value: { credentials: {} } } } },
      async set() { expect(this).toBe(legacy); return { result: { ok: true, value: {} } } },
      async unset() { expect(this).toBe(legacy); return { result: { ok: true, value: {} } } },
    }
    const client = adaptLegacyCredentials(legacy)
    await client.describe(['TEST'])
    await client.set('TEST', 'fixture-key')
    await client.unset('TEST')
  })
})

describe('credential service activation with real Cordis', () => {
  const roots: Context[] = []
  afterEach(async () => { for (const root of roots.splice(0)) await root.fiber.dispose() })

  async function entry(built: boolean): Promise<{ apply: typeof apply; inject: typeof inject }> {
    if (!built) return { apply, inject }
    let exported: { apply: typeof apply; inject: typeof inject } | undefined
    const require = createRequire(import.meta.url)
    runInNewContext(await readFile(new NodeURL('../lib/client.js', import.meta.url), 'utf8'), {
      window: { __ModuleLoader__: { load: ({ id, factory }: { id: string; factory: (require: (name: string) => unknown) => typeof exported }) => {
        expect(id).toBe('dsh-pdf-mineru')
        exported = factory(name => {
          expect(['react', 'react/jsx-runtime']).toContain(name)
          return require(name)
        })
      } } },
    })
    expect(exported).toBeDefined()
    return exported!
  }

  function runtime(connection: object) {
    const root = new Context()
    roots.push(root)
    const entries = new Set<{ inject(): MineruSettingsInjected }>()
    class Slots extends Service {
      constructor(ctx: Context) { super(ctx, 'slots') }
      spec() { return {} }
      inject(_name: string, factory: () => () => void) { this.ctx.effect(factory) }
      register(options: { inject(): MineruSettingsInjected }) {
        entries.add(options)
        return () => { entries.delete(options) }
      }
    }
    new Slots(root)
    root.provide('locale', { register: () => () => {}, bind: () => (key: string) => key })
    root.provide('connection', connection)
    return { root, entries }
  }

  it.each([false, true])('activates on RC2 without declaring or waiting for remote services (built: %s)', async built => {
    const plugin = await entry(built)
    expect(plugin.inject).toEqual(['slots', 'locale', 'connection'])
    const legacy = legacyFixture()
    const { root, entries } = runtime({ rpc: {}, api: { credentials: legacy } })
    const fiber = root.plugin(plugin)
    await fiber.await()
    expect(entries.size).toBe(1)
    expect(root.get('remote.credentials')).toBeUndefined()
    const props = [...entries][0].inject()
    await describeCredential(props.credentials, 'TEST')
    await storeCredential(props.credentials, 'TEST', 'fixture-key')
    await clearCredential(props.credentials, 'TEST')
    expect(legacy.set).toHaveBeenCalledWith({ ref: 'TEST', value: 'fixture-key' })
    expect(legacy.unset).toHaveBeenCalledWith({ ref: 'TEST' })
    await fiber.dispose()
    expect(entries.size).toBe(0)
  })

  it.each([
    { built: false, initiallyReady: false }, { built: false, initiallyReady: true },
    { built: true, initiallyReady: false }, { built: true, initiallyReady: true },
  ])('tracks native Remote calls and replacement ($built, $initiallyReady)', async ({ built, initiallyReady }) => {
    const plugin = await entry(built)
    const modern: CredentialClient = {
      describe: vi.fn(async () => ({ ok: true, value: { TEST: { configured: true, writable: true } } })),
      set: vi.fn(async () => ({ ok: true, value: undefined })),
      unset: vi.fn(async () => ({ ok: true, value: undefined })),
    }
    const { root, entries } = runtime({ rpc: {} })
    const publish = (credentials: CredentialClient) => root.plugin(scope => {
      scope.provide('remote', { credentials })
      scope.provide('remote.credentials', credentials)
    })
    let provider = initiallyReady ? publish(modern) : undefined
    if (provider) await provider.await()
    const fiber = root.plugin(plugin)
    await fiber.await()
    if (!initiallyReady) {
      expect(entries.size).toBe(0)
      provider = publish(modern)
      await provider.await()
    }
    await vi.waitFor(() => expect(entries.size).toBe(1))
    const props = [...entries][0].inject()
    await describeCredential(props.credentials, 'TEST')
    await storeCredential(props.credentials, 'TEST', ' fixture-key ')
    await clearCredential(props.credentials, 'TEST')
    expect(modern.describe).toHaveBeenCalledWith(['TEST'])
    expect(modern.set).toHaveBeenCalledWith('TEST', 'fixture-key')
    expect(modern.unset).toHaveBeenCalledWith('TEST')
    await provider!.dispose()
    await vi.waitFor(() => expect(entries.size).toBe(0))
    const replacement = { ...modern, describe: vi.fn(async () => ({ ok: true as const, value: {} })) }
    const nextProvider = publish(replacement)
    await nextProvider.await()
    await vi.waitFor(() => expect(entries.size).toBe(1))
    await describeCredential([...entries][0].inject().credentials, 'TEST')
    expect(replacement.describe).toHaveBeenCalledTimes(1)
    await fiber.dispose()
    expect(entries.size).toBe(0)
  })
})
