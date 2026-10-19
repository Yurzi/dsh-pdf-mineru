/**
 * Boot the real host plane of the isolated `web` profile inside the test
 * process, through the same steps the `dsh` CLI takes: load the profile,
 * resolve its packages, read its bundle and user patch layers, then boot the
 * composed entry list. No service is faked; the plugin is the one the plugin
 * manager installed into the profile.
 *
 * These are exports of the installed DSH packages, but they are the CLI's
 * building blocks (apps/cli/src/profile-boot.ts) rather than a documented
 * embedding API. When a DSH upgrade changes them, adjust this file only.
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { type E2EContext, run } from './environment.js'

/** A booted host plane. */
export interface Host {
  readonly ctx: Context
  /** The profile directory the plugin manager installed into. */
  readonly profileDir: string
  /** Packages the launch loads from the profile's own node_modules. */
  readonly localPackages: readonly string[]
  dispose(): Promise<void>
}

/** The pieces of `@deepseek-ai/dsh-app-boot` the CLI uses to start a profile. */
interface AppBoot {
  loadProfile(binName: string, name: string, installAnchor: string): { dir: string; patchPath: string; layers: { packageName: string }[] }
  createRuntimeResolution(options: { installAnchor: string; profile: unknown }): Promise<{ localPackageNames: readonly string[] }>
  loadOverlayPatches(binName: string, file: string): unknown[]
  readProfilePatches(binName: string, context: object, profile: unknown): unknown[]
  boot(binName: string, configPath: string, patches: unknown[], prepare: (ctx: Context) => Promise<void>): Promise<Context>
  PluginPackages: object
}

const BIN = 'mineru-e2e'

/**
 * @param e2e - the run's install and environment; `process.env` must already be the isolated one.
 * @returns the booted host plane, without the rows that would bind a port.
 */
export async function bootHost(e2e: E2EContext): Promise<Host> {
  const anchor = join(e2e.install, 'node_modules/@deepseek-ai/dsh/package.json')
  const require = createRequire(anchor)
  const app = require('@deepseek-ai/dsh-app-boot') as AppBoot
  const { provideCmdline } = require('@deepseek-ai/dsh-cmdline') as { provideCmdline: (ctx: Context, options: object) => void }
  const { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } = require('@deepseek-ai/dsh-launch-environment') as {
    createLaunchEnvironmentSnapshot: (layers: { source: string; values: NodeJS.ProcessEnv }[]) => unknown
    DSH_LAUNCH_ENVIRONMENT_KEY: string
  }

  const profile = app.loadProfile(BIN, 'web', anchor)
  const resolution = await app.createRuntimeResolution({ installAnchor: anchor, profile })
  // What the launcher knows about the profile it starts; plugins read it as `ctx.profileContext`.
  const context = {
    name: 'web',
    dir: profile.dir,
    patchPath: profile.patchPath,
    installAnchor: anchor,
    startedBundles: profile.layers.map(layer => layer.packageName),
    cwd: run,
    home: e2e.env.DSH_HOME,
    overlays: app.loadOverlayPatches(BIN, join(import.meta.dirname, '../fixtures/host-plane.yml')),
    telemetryDisabledEnv: '1',
  }
  const ctx = await app.boot(BIN, join(profile.dir, 'cordis.yml'), app.readProfilePatches(BIN, context, profile), async (root) => {
    root.provide('profileContext', context)
    root.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env }]))
    await root.plugin(app.PluginPackages as Parameters<Context['plugin']>[0], { resolution })
    provideCmdline(root, { args: [], exit: (code: number) => { throw new Error(`unexpected exit ${code}`) }, ready: { onReady: () => () => {} } })
  })
  return {
    ctx,
    profileDir: profile.dir,
    localPackages: resolution.localPackageNames,
    async dispose() {
      await ctx.fiber.dispose()
    },
  }
}
