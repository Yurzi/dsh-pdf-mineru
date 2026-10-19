import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Hmr from '@deepseek-ai/dsh-hmr'
import Settings from '@deepseek-ai/dsh-settings'
import { expect, onTestFinished, vi } from 'vitest'
import { defaultMinerUConfig } from '../../src/config/parse.js'
import * as MinerUPlugin from '../../src/index.js'

export type MinerUPluginModule = Pick<typeof MinerUPlugin, 'name' | 'inject' | 'Config' | 'apply'>

export interface LoaderFixtureOptions {
  readonly oldSelfHosted?: boolean
  readonly damagedLegacy?: boolean
  readonly entryPatch?: boolean
  readonly legacy?: boolean
  readonly hmr?: boolean
  readonly sparse?: boolean
  readonly plugin?: MinerUPluginModule
  /** Provide a fake connection/webServer so the RPC handler is captured (default true). */
  readonly transport?: boolean
  /** Extra Loader builtins inserted before the MinerU entry, in order (real composition). */
  readonly services?: readonly { readonly id: string; readonly name: string; readonly plugin: Plugin; readonly config?: unknown }[]
  /** Replace the default host stand-ins (tools, workingDirectory, jobs) with real services. */
  readonly hostStandIns?: boolean
  /** Provide extra root services before the Loader starts (e.g. minimal stand-ins for uninstalled packages). */
  readonly provide?: (ctx: Context) => void
  /** Adjust the MinerU entry config (e.g. a pre-published storage root). */
  readonly configure?: (config: ReturnType<typeof defaultMinerUConfig>, home: string) => Promise<ReturnType<typeof defaultMinerUConfig>> | ReturnType<typeof defaultMinerUConfig>
}

/**
 * Boot a test-only profile through the published app-boot Loader: ConfigEditor, Settings, profile
 * patches and persistence are real. Only RPC transport (and, unless replaced, tools/jobs/directory)
 * are stand-ins.
 */
export async function loaderFixture(options: LoaderFixtureOptions = {}) {
  const { legacy = false, oldSelfHosted = false, damagedLegacy = false, hmr = true, sparse = false, entryPatch = false, transport = true } = options
  const home = await realpath(await mkdtemp(join(tmpdir(), 'mineru-loader-')))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const dir = join(home, 'profiles', 'test')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(home, 'package.json'), '{"name":"test-installation"}\n')
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  const defaults = defaultMinerUConfig()
  let base = { ...defaults, storage: { ...defaults.storage, storageRoot: join(home, 'store') }, output: { ...defaults.output, maxInlineImages: 12 } }
  if (options.configure) base = await options.configure(base, home)
  const config = {
    ...base,
    ...(oldSelfHosted ? { schemaVersion: 2, providers: base.providers.map(provider => provider.type === 'self-hosted-legacy-v2'
      ? { ...provider, type: 'self-hosted-v2', tier: 'standard' } : provider) } : {}),
    ...(damagedLegacy ? { limits: { ...base.limits, maxFileBytes: 'bad' }, storage: { ...base.storage, retainSources: true } } : {}),
    ...(legacy ? { schemaVersion: 1, defaults: { ...base.defaults, artifacts: ['markdown'] }, limits: { ...base.limits, maxFilesPerRequest: 1 } } : {}),
  }
  const services = options.services ?? []
  await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'config-editor', name: 'cordis:editor' },
    { id: 'settings', name: 'cordis:settings' },
    ...services.map(service => ({ id: service.id, name: 'cordis:' + service.name, ...(service.config === undefined ? {} : { config: service.config }) })),
    { id: 'mineru-custom', name: 'cordis:mineru', config: sparse ? { schemaVersion: config.schemaVersion, activeProvider: config.activeProvider, providers: config.providers, storage: { storageRoot: config.storage.storageRoot } } : config },
  ] }]))
  await writeFile(join(dir, 'cordis.yml'), '[]\n')
  if (entryPatch) await writeFile(join(dir, 'cordis.patch.yml'), JSON.stringify([{ id: 'mineru-custom', disabled: false }]))
  const profile: ProfileContext = {
    name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
  }
  const start = async () => {
    let rpc: ConnectionRpcHandler | undefined
    const registerTool = vi.fn(() => () => undefined)
    const ctx: Context = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), ctx => {
      ctx.provide('profileContext', profile)
      ctx.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
      options.provide?.(ctx)
      if (options.hostStandIns !== false) {
        ctx.provide('tools', { register: registerTool, schemas: () => [] })
        ctx.provide('workingDirectory', { ensure: async () => home })
        ctx.provide('jobs', { start: () => { throw new Error('No jobs expected') } })
      }
      if (transport) {
        ctx.provide('webServer', {})
        ctx.provide('connection', { rpc: { handle: (_channel: string, handler: ConnectionRpcHandler) => {
          rpc = handler
          return () => undefined
        } } })
      }
      Object.assign(ctx.loader.builtins, {
        editor: ConfigEditor, settings: Settings, mineru: options.plugin ?? MinerUPlugin,
        ...Object.fromEntries(services.map(service => [service.name, service.plugin])),
      })
    })
    onTestFinished(() => ctx.fiber.dispose())
    if (hmr) {
      await ctx.plugin(Timer)
      await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 }).await()
      await ctx.hmr.runExclusive(async () => {})
    }
    const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'mineru-custom')!
    expect(entry.fiber).toBeDefined()
    const call = (endpoint: string, payload: unknown = {}) => {
      if (rpc === undefined) throw new Error('RPC transport was not registered')
      return rpc(endpoint, payload, new AbortController().signal, { principal: { kind: 'owner' } } as Parameters<ConnectionRpcHandler>[3])
    }
    return { ctx, entry, registerTool, call }
  }
  return { ...await start(), start, profile, config, home }
}
