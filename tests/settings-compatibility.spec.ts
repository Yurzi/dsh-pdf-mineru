import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { loaderFixture } from './support/loader-fixture.js'
import { defaultMinerUConfig, parseConfig } from '../src/config/parse.js'
import { parseConfigWithMigration } from '../src/config/migrate.js'
import { activateProvider, patchActiveProvider, resetConfigSection } from '../src/client/helpers.js'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'

// Only transport is replaced. Loader, SettingsForms, ConfigEditor, schema
// validation, volatile commits and profile persistence are the published SDK.
vi.mock('../src/loopback-rpc.js', () => ({
  registerLoopbackRpc: (ctx: Context, channel: string, handler: ConnectionRpcHandler) => ctx.connection.rpc.handle(channel, handler),
}))

it('activates with native settings, saves by entry id, updates without remount and restores after restart', async () => {
  const host = await loaderFixture()
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

it('preserves bundle inheritance when a profile overrides only non-config entry options', async () => {
  const host = await loaderFixture({ entryPatch: true })
  const descriptor = host.ctx.settings.describe().find(row => row.ns === 'mineru-custom')!
  expect(descriptor.value).toMatchObject({ output: { maxInlineImages: 12 } })
  const inherited = host.ctx.configEditor.configuration().find(row => row.entry === host.entry)!
  expect(inherited.inherited).toEqual(host.config)
  expect(inherited.override).toEqual({})
  expect(await readFile(host.profile.patchPath, 'utf8')).not.toContain('config')

  const next = { ...host.config, output: { ...host.config.output, maxInlineImages: 6 } }
  expect(await host.call('mineru/config.set', { config: next }))
    .toMatchObject({ ok: true, value: { config: next } })
  await host.ctx.fiber.dispose()
  const restored = await host.start()
  expect(await restored.call('mineru/config.get'))
    .toMatchObject({ ok: true, value: { config: next } })
})

it('rejects invalid domain values and ordinary field writes before persistence', async () => {
  const host = await loaderFixture()
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

it('rejects cross-type provider fields at native persistence and RPC boundaries without changing state', async () => {
  const host = await loaderFixture()
  const fiber = host.entry.fiber
  const before = await readFile(host.profile.patchPath, 'utf8')
  const [legacy, official, v1] = host.config.providers
  const invalidProviders = [
    { ...legacy, tier: 'standard' }, { ...legacy, ocrMode: 'ocr' },
    { ...v1, modelMap: { pipeline: 'pipeline', vlm: 'vlm-engine' } },
    { ...v1, models: ['pipeline'] }, { ...v1, ocrMode: 'text' }, { ...v1, tier: 'fastest' },
    { ...official, ocrMode: 'auto' }, { ...official, tier: 'standard' },
    { ...v1, allowInsecureHttp: false },
    { ...v1, type: ['self', 'hosted', 'v2'].join('-') },
  ]
  for (const provider of invalidProviders) {
    const patch = { activeProvider: provider.id, providers: [provider] }
    await expect(host.ctx.settings.update('mineru-custom', patch)).rejects.toThrow()
    expect(await host.call('mineru/config.set', { config: { ...host.config, ...patch } }))
      .toMatchObject({ ok: false })
    expect(await readFile(host.profile.patchPath, 'utf8')).toBe(before)
    expect(await host.call('mineru/config.get')).toMatchObject({ ok: true, value: { config: host.config } })
  }
  expect(host.entry.fiber).toBe(fiber)
  expect(host.registerTool).toHaveBeenCalledTimes(2)
})

it('persists independent V1 OCR drafts and defaults resets without remounting or losing shared defaults', async () => {
  const host = await loaderFixture()
  const fiber = host.entry.fiber
  const base = parseConfig(host.config)
  const v1 = base.providers.find(p => p.type === 'self-hosted-v1')!
  const sharedDefaults = { ...base.defaults, model: 'vlm' as const, language: 'ja', parseMethod: 'txt' as const }
  const draft = patchActiveProvider(activateProvider({ ...base, defaults: sharedDefaults }, v1.id), {
    tier: 'advanced', ocrMode: 'ocr', baseURL: 'https://mineru.example/v1',
  })
  expect(await host.call('mineru/config.set', { config: draft }))
    .toMatchObject({ ok: true, value: { config: draft } })
  expect(host.entry.fiber).toBe(fiber)
  expect(await readFile(host.profile.patchPath, 'utf8')).toContain('ocrMode: ocr')

  // Native form writes and custom draft saves share the strict domain boundary.
  const nativeDraft = patchActiveProvider(draft, { ocrMode: 'txt' })
  await host.ctx.settings.update('mineru-custom', { providers: nativeDraft.providers })
  expect(await host.call('mineru/config.get')).toMatchObject({ ok: true, value: { config: nativeDraft } })
  const reset = resetConfigSection(nativeDraft, 'defaults')
  expect(reset.defaults).toEqual(sharedDefaults)
  expect(reset.providers.find(p => p.id === v1.id)).toMatchObject({ ocrMode: 'auto', tier: 'advanced' })
  expect(await host.call('mineru/config.set', { config: reset }))
    .toMatchObject({ ok: true, value: { config: reset } })
  expect(host.entry.fiber).toBe(fiber)
  expect(host.registerTool).toHaveBeenCalledTimes(2)

  await host.ctx.fiber.dispose()
  const restored = await host.start()
  expect(await restored.call('mineru/config.get')).toMatchObject({ ok: true, value: { config: reset } })
  const legacy = activateProvider(reset, base.activeProvider)
  expect(legacy.defaults).toEqual(sharedDefaults)
  expect(await restored.call('mineru/config.set', { config: legacy }))
    .toMatchObject({ ok: true, value: { config: legacy } })
})

it('normalizes Provider-based v1 on activation without profile writes', async () => {
  const host = await loaderFixture({ legacy: true })
  expect(await host.call('mineru/config.get')).toMatchObject({ ok: true, value: { config: { schemaVersion: 3 } } })
  const response = await host.call('mineru/config.get') as { value: { config: unknown } }
  expect(await host.call('mineru/config.set', { config: response.value.config })).toMatchObject({ ok: true })
  expect(await readFile(host.profile.patchPath, 'utf8')).toContain('schemaVersion: 3')
})

it.each([false,true])('loads old self-hosted profiles, saves canonical values and restarts (schema1=%s)', async legacy => {
  const host = await loaderFixture({oldSelfHosted:true,legacy})
  const expected = parseConfigWithMigration(host.config).config
  const fiber = host.entry.fiber
  expect(expected.providers[0]).toMatchObject({id:'mp_self_hosted',type:'self-hosted-legacy-v2'})
  expect(expected.providers[0]).not.toHaveProperty('tier')
  expect(host.config.providers[0]?.type).toBe('self-hosted-v2')
  expect(await host.call('mineru/config.get')).toMatchObject({ok:true,value:{config:expected}})
  // Automatic runtime migration is not a hidden profile write during activation.
  const before = await readFile(host.profile.patchPath,'utf8')
  expect(before).not.toContain('config:')
  expect(before).not.toContain('self-hosted-legacy-v2')
  const descriptor = host.ctx.settings.describe().find(row => row.ns === 'mineru-custom')!
  expect(descriptor.value).toMatchObject({providers:expected.providers})
  // The normal save API also accepts historical input but only writes canonical profiles.
  expect(await host.call('mineru/config.set',{config:host.config})).toMatchObject({ok:true,value:{config:expected}})
  expect(host.entry.fiber).toBe(fiber)
  const saved = await readFile(host.profile.patchPath,'utf8')
  expect(saved).toContain('self-hosted-legacy-v2')
  expect(saved).not.toContain('self-hosted-v2')
  expect(saved).not.toContain('tier: standard')
  await host.ctx.fiber.dispose()
  const restored = await host.start()
  expect(await restored.call('mineru/config.get')).toMatchObject({ok:true,value:{config:expected}})
})

it.each([true,false])('persists repaired ordinary fields atomically only on explicit save (hmr=%s)', async hmr => {
  const host = await loaderFixture({oldSelfHosted:true,damagedLegacy:true,hmr})
  const expected = parseConfigWithMigration(host.config).config
  expect(expected.storage.retainSources).toBe(false)
  expect(expected.limits.maxFileBytes).toBe(defaultMinerUConfig().limits.maxFileBytes)
  const before = await readFile(host.profile.patchPath,'utf8')
  expect(before).not.toContain('schemaVersion')
  const failure = vi.spyOn(host.ctx.configEditor,'edit').mockRejectedValueOnce(new Error('simulated write failure'))
  const next = {...expected,output:{...expected.output,maxInlineImages:17}}
  expect(await host.call('mineru/config.set',{config:next})).toMatchObject({ok:false})
  expect(await readFile(host.profile.patchPath,'utf8')).toBe(before)
  expect(await host.call('mineru/config.get')).toMatchObject({ok:true,value:{config:expected}})
  failure.mockRestore()
  expect(await host.call('mineru/config.set',{config:next})).toMatchObject({ok:true,value:{config:next}})
  const saved = await readFile(host.profile.patchPath,'utf8')
  expect(saved).toContain('schemaVersion: 3')
  expect(saved).toContain('retainSources: false')
  expect(saved).not.toContain('bad')
  expect(saved).not.toContain('self-hosted-v2')
  await host.ctx.fiber.dispose()
  const restored = await host.start()
  expect(await restored.call('mineru/config.get')).toMatchObject({ok:true,value:{config:next}})
})

it('reports the host Settings revision and refuses stale saves on the replace path', async () => {
  const host = await loaderFixture()
  const read = await host.call('mineru/config.get') as { ok: true; value: { revision: number } }
  const revision = read.value.revision
  expect(revision).toBe(host.ctx.settings.describe().find(row => row.ns === 'mineru-custom')!.revision)
  const first = { ...host.config, output: { ...host.config.output, maxInlineImages: 5 } }
  const saved = await host.call('mineru/config.set', { config: first, expected_revision: revision }) as { ok: true; value: { revision: number } }
  expect(saved).toMatchObject({ ok: true, value: { config: first } })
  expect(saved.value.revision).toBeGreaterThan(revision)
  const before = await readFile(host.profile.patchPath, 'utf8')
  const stale = { ...host.config, output: { ...host.config.output, maxInlineImages: 4 } }
  expect(await host.call('mineru/config.set', { config: stale, expected_revision: revision }))
    .toMatchObject({ ok: false, error: { code: 'mineru/conflict' } })
  expect(await readFile(host.profile.patchPath, 'utf8')).toBe(before)
  expect(await host.call('mineru/config.get')).toMatchObject({ ok: true, value: { config: first, revision: saved.value.revision } })
})

it('compares the descriptor revision before an explicit historical-entry save', async () => {
  const host = await loaderFixture({ oldSelfHosted: true })
  const expected = parseConfigWithMigration(host.config).config
  const read = await host.call('mineru/config.get') as { ok: true; value: { revision: number } }
  const before = await readFile(host.profile.patchPath, 'utf8')
  expect(await host.call('mineru/config.set', { config: expected, expected_revision: read.value.revision + 1 }))
    .toMatchObject({ ok: false, error: { code: 'mineru/conflict' } })
  expect(await readFile(host.profile.patchPath, 'utf8')).toBe(before)
  expect(await host.call('mineru/config.set', { config: expected, expected_revision: read.value.revision }))
    .toMatchObject({ ok: true, value: { config: expected } })
  expect(await readFile(host.profile.patchPath, 'utf8')).toContain('self-hosted-legacy-v2')
})

it('saves configuration on a host without HMR', async () => {
  const host = await loaderFixture({ hmr: false })
  const next = { ...host.config, output: { ...host.config.output, maxInlineImages: 7 } }
  expect(await host.call('mineru/config.set', { config: next }))
    .toMatchObject({ ok: true, value: { config: next } })
  expect(await host.call('mineru/config.get')).toMatchObject({ ok: true, value: { config: next } })
})

it('updates initially omitted live sections without remounting', async () => {
  const host = await loaderFixture({ sparse: true })
  const fiber = host.entry.fiber
  const next = { ...host.config, output: { ...host.config.output, maxInlineImages: 7 } }
  expect(await host.call('mineru/config.set', { config: next }))
    .toMatchObject({ ok: true, value: { config: next } })
  expect(host.entry.fiber).toBe(fiber)
  expect(host.registerTool).toHaveBeenCalledTimes(2)
})
