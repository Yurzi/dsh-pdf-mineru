import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import Hmr from '@deepseek-ai/dsh-hmr'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import { afterEach, expect, it, vi } from 'vitest'
import * as mineru from '../src/index.js'
import { defaultMinerUConfig } from '../src/config.js'
import type { ConnectionRpcHandler } from '../src/loopback-rpc.js'

// Only transport is replaced. Loader, SettingsForms, ConfigEditor, schema
// validation, volatile commits and profile persistence are the published SDK.
vi.mock('../src/loopback-rpc.js', () => ({
  registerLoopbackRpc: (ctx: Context, channel: string, handler: ConnectionRpcHandler) => ctx.connection.rpc.handle(channel, handler),
}))

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function fixture({ legacy = false, hmr = true, sparse = false, plugin = mineru, transport = true }: {
  legacy?: boolean
  hmr?: boolean
  sparse?: boolean
  plugin?: typeof mineru
  transport?: boolean
} = {}) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'mineru-settings-')))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  const dir = join(home, 'profiles', 'test')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(home, 'package.json'), '{"name":"test-installation"}\n')
  await writeFile(join(bundle, 'package.json'), JSON.stringify({
    name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } },
  }))
  const defaults = defaultMinerUConfig()
  const config = {
    ...defaults,
    storage: { ...defaults.storage, storageRoot: join(home, 'store') },
    output: { ...defaults.output, maxInlineImages: 12 },
    ...(legacy ? {
      schemaVersion: 1,
      defaults: { ...defaults.defaults, artifacts: ['markdown'] },
      limits: { ...defaults.limits, maxFilesPerRequest: 1 },
    } : {}),
  }
  await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'config-editor', name: 'cordis:editor' },
    { id: 'settings', name: 'cordis:settings' },
    { id: 'mineru-custom', name: 'cordis:mineru', config: sparse ? { activeProvider: config.activeProvider, providers: config.providers, storage: { storageRoot: config.storage.storageRoot } } : config },
  ] }]))
  await writeFile(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = {
    name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
  }
  const start = async () => {
    let rpc!: ConnectionRpcHandler
    const registerTool = vi.fn(() => () => undefined)
    const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), ctx => {
      ctx.provide('profileContext', profile)
      ctx.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
      ctx.provide('tools', { register: registerTool, schemas: () => [] })
      ctx.provide('jobs', { start: () => { throw new Error('No jobs expected') } })
      if (transport) {
        ctx.provide('webServer', {})
        ctx.provide('connection', { rpc: { handle: (_channel: string, handler: ConnectionRpcHandler) => {
          rpc = handler
          return () => undefined
        } } })
      }
      Object.assign(ctx.loader.builtins, { editor: ConfigEditor, settings: Settings, mineru: plugin })
    })
    cleanups.push(() => ctx.fiber.dispose())
    if (hmr) {
      await ctx.plugin(Timer)
      await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 }).await()
      await ctx.hmr.runExclusive(async () => {})
    }
    const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'mineru-custom')!
    expect(entry.fiber).toBeDefined()
    expect(registerTool).toHaveBeenCalledTimes(2)
    const call = (endpoint: string, payload: unknown = {}) => rpc(endpoint, payload, new AbortController().signal)
    return { ctx, entry, registerTool, call }
  }
  return { ...await start(), start, profile, config }
}

it('activates with native settings, saves by entry id, updates without remount and restores after restart', async () => {
  const host = await fixture()
  expect('register' in host.ctx.settings).toBe(false)
  const descriptor = host.ctx.settings.describe().find(row => row.ns === 'mineru-custom')!
  expect(descriptor.autoGenerate).toBe(false)
  expect(descriptor.value).not.toHaveProperty('limits')
  expect(descriptor.value).not.toHaveProperty('storage.storageRoot')
  const fiber = host.entry.fiber
  // Package default 6 must override the inherited value 12 on explicit save.
  const next = { ...host.config, output: { ...host.config.output, maxInlineImages: 6 } }
  const saved = await host.call('mineru/config.set', { config: next })
  expect(saved)
    .toMatchObject({ ok: true, value: { config: next } })
  expect(host.entry.fiber).toBe(fiber)
  expect(host.registerTool).toHaveBeenCalledTimes(2)
  expect(await readFile(host.profile.patchPath, 'utf8')).toContain('maxInlineImages: 6')
  await host.ctx.settings.update('mineru-custom', { output: { maxInlineImages: 9 } })
  expect(await host.call('mineru/config.get')).toMatchObject({ ok: true, value: { config: { output: { maxInlineImages: 9 } } } })
  expect(host.entry.fiber).toBe(fiber)
  await host.ctx.fiber.dispose()
  const restored = await host.start()
  expect(await restored.call('mineru/config.get')).toMatchObject({ ok: true, value: { config: { output: { maxInlineImages: 9 } } } })
})

it('rejects invalid domain values and ordinary field writes before persistence', async () => {
  const host = await fixture()
  const before = await readFile(host.profile.patchPath, 'utf8')
  for (const patch of [
    { output: { maxInlineImages: 101 } },
    { activeProvider: 'mp_missing' },
    { retry: { maxAttempts: 0 } },
    { storage: { storageRoot: '/tmp/other' } },
    { limits: { maxFileBytes: 1 } },
  ]) await expect(host.ctx.settings.update('mineru-custom', patch)).rejects.toThrow()
  expect(await readFile(host.profile.patchPath, 'utf8')).toBe(before)
  expect(await host.call('mineru/config.get')).toMatchObject({ ok: true, value: { config: host.config } })
})

it('normalizes Provider-based v1 on activation without profile writes', async () => {
  const host = await fixture({ legacy: true })
  expect(await host.call('mineru/config.get')).toMatchObject({ ok: true, value: { config: { schemaVersion: 2 } } })
  const response = await host.call('mineru/config.get') as { value: { config: unknown } }
  expect(await host.call('mineru/config.set', { config: response.value.config })).toMatchObject({ ok: true })
  expect(await readFile(host.profile.patchPath, 'utf8')).toContain('schemaVersion: 2')
})

it('saves configuration on a host without HMR', async () => {
  const host = await fixture({ hmr: false })
  const next = { ...host.config, output: { ...host.config.output, maxInlineImages: 7 } }
  expect(await host.call('mineru/config.set', { config: next }))
    .toMatchObject({ ok: true, value: { config: next } })
  expect(await host.call('mineru/config.get')).toMatchObject({ ok: true, value: { config: next } })
})

it('updates initially omitted live sections without remounting', async () => {
  const host = await fixture({ sparse: true })
  const fiber = host.entry.fiber
  const next = { ...host.config, output: { ...host.config.output, maxInlineImages: 7 } }
  expect(await host.call('mineru/config.set', { config: next }))
    .toMatchObject({ ok: true, value: { config: next } })
  expect(host.entry.fiber).toBe(fiber)
  expect(host.registerTool).toHaveBeenCalledTimes(2)
})

it('activates the built bundle against native SettingsForms', async () => {
  const built = await import('../lib/index.js')
  const host = await fixture({ plugin: built, transport: false })
  const getDescriptor = () => host.ctx.settings.describe().find(row => row.ns === 'mineru-custom')!
  expect(getDescriptor().autoGenerate).toBe(false)
  await host.ctx.settings.update('mineru-custom', { output: { maxInlineImages: 8 } })
  expect(getDescriptor().value).toMatchObject({ output: { maxInlineImages: 8 } })
  expect(host.registerTool).toHaveBeenCalledTimes(2)
})
