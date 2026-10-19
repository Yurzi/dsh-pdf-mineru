/**
 * The isolated world an end-to-end run happens in.
 *
 * Everything DSH, npm, or pnpm writes during a run — the DSH home with its
 * profiles, credentials and plugin cache, the OS home, XDG directories, the
 * pnpm store, temp files — lives under `.e2e/run`, which is wiped at the start
 * of every run. A run never reads or changes the developer's own DSH home, a
 * DSH they have running, or its port.
 *
 * The DSH CLI under test is installed once per version under
 * `.e2e/dsh-<version>` and reused afterwards. Point `DSH_E2E_INSTALL` at an
 * existing install to skip that step.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { load } from 'js-yaml'
import manifest from '../../package.json' with { type: 'json' }

/** Repository root. */
export const repo = resolve(import.meta.dirname, '../..')

/** Scratch space for runs, ignored by git. */
export const workspace = join(repo, '.e2e')

/** This run's isolated world; recreated by the global setup. */
export const run = join(workspace, 'run')

/** Screenshots and logs worth keeping after a run. */
export const artifacts = join(workspace, 'artifacts')

/** The DSH release under test: the lower bound of `engines.dsh`, which the dev pins equal. */
export const DSH_VERSION = lowerBound(manifest.engines.dsh)

function lowerBound(range: string): string {
  const match = /^>=\s*(\S+)/.exec(range)
  if (match === null) throw new Error(`engines.dsh "${range}" has no ">=" lower bound to test against`)
  return match[1]!
}

/** What the global setup hands every e2e test file. */
export interface E2EContext {
  /** Directory whose `node_modules` holds `@deepseek-ai/dsh` and its packages. */
  readonly install: string
  /** The `dsh` executable. */
  readonly cli: string
  /** Environment for every DSH process and for the in-process host boot. */
  readonly env: Record<string, string>
  /** The packed plugin tarball installed into the `web` profile. */
  readonly tarball: string
}

declare module 'vitest' {
  export interface ProvidedContext {
    e2e: E2EContext
  }
}

/**
 * Variables a developer (or a DSH they run this from) may have exported that
 * would redirect the run (`DSH_HOME`, `DSH_PROFILE_DIR`, `DSH_SNAPSHOT`, ...),
 * pin a provider, or hand the plugin a real MinerU key. Proxy variables stay:
 * npm and pnpm need them to reach the registry.
 */
function cleared(name: string): boolean {
  return /^(DSH_|MINERU_|DEEPSEEK_)/.test(name) || name === 'NODE_ENV' || name === 'NODE_OPTIONS'
}

/**
 * Build the run's environment and create its directories.
 * @returns the current environment with every home, cache, and temp directory redirected into `.e2e/run`.
 */
export function isolatedEnvironment(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !cleared(name) && !name.startsWith('VITEST')) env[name] = value
  }
  const dirs = {
    HOME: 'os-home', // npm, pnpm, and git read ~/.npmrc, ~/.gitconfig, ...
    DSH_HOME: 'home', // profiles, settings, credentials, sessions, the plugin's cache
    XDG_CACHE_HOME: 'cache',
    XDG_CONFIG_HOME: 'config',
    XDG_DATA_HOME: 'data',
    TMPDIR: 'tmp',
    DSH_AGENTS_HOME: 'agents', // user-level AGENTS.md and agent presets
    DSH_BUNDLED_SKILL_DIR: 'skills',
    COREPACK_HOME: 'corepack',
    npm_config_cache: 'npm-cache',
  }
  for (const [name, dir] of Object.entries(dirs)) {
    env[name] = join(run, dir)
    mkdirSync(env[name], { recursive: true })
  }
  env.DSH_TELEMETRY_DISABLED = '1'
  // `dsh plugin add` runs pnpm, which reads npm_config_*: ride out registry resets.
  env.npm_config_fetch_retries = '5'
  return env
}

const INSTALL_ATTEMPTS = 3

/**
 * Make sure the DSH CLI under test is installed. npm runs with the developer's
 * registry settings but its own cache under `.e2e`, few sockets and extra
 * fetch retries: registry connections reset (ECONNRESET) often enough on some
 * networks to fail an install of this size. Each attempt starts from an empty
 * staging directory that is renamed into place only when complete.
 * @returns the install directory.
 */
export function ensureDsh(): string {
  const install = process.env.DSH_E2E_INSTALL ?? join(workspace, `dsh-${DSH_VERSION}`)
  const pkg = join(install, 'node_modules/@deepseek-ai/dsh/package.json')
  if (!existsSync(pkg)) {
    if (process.env.DSH_E2E_INSTALL !== undefined) throw new Error(`DSH_E2E_INSTALL=${install} has no node_modules/@deepseek-ai/dsh`)
    installDsh(install)
  }
  const { version } = JSON.parse(readFileSync(pkg, 'utf8')) as { version: string }
  if (version !== DSH_VERSION) throw new Error(`${install} has DSH ${version}; the e2e suite targets ${DSH_VERSION} (engines.dsh lower bound)`)
  return install
}

function installDsh(install: string): void {
  const staging = `${install}.staging`
  const env: Record<string, string> = { npm_config_cache: join(workspace, 'npm-cache') }
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined && !cleared(name)) env[name] ??= value
  const args = [
    'install', '--prefix', staging, '--no-audit', '--no-fund', '--save-exact',
    '--maxsockets=4', '--fetch-retries=5', '--fetch-retry-mintimeout=2000', '--fetch-retry-maxtimeout=30000',
    `@deepseek-ai/dsh@${DSH_VERSION}`,
  ]
  let failure = ''
  for (let attempt = 1; attempt <= INSTALL_ATTEMPTS; attempt++) {
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })
    process.stderr.write(`e2e: installing @deepseek-ai/dsh@${DSH_VERSION} into ${install} (attempt ${attempt}/${INSTALL_ATTEMPTS})\n`)
    const result = spawnSync('npm', args, { env, encoding: 'utf8', stdio: ['ignore', 'inherit', 'pipe'] })
    process.stderr.write(result.stderr ?? '')
    if (result.status === 0) {
      rmSync(install, { recursive: true, force: true })
      renameSync(staging, install)
      return
    }
    failure = (result.error?.message ?? result.stderr ?? '').trim().split('\n').slice(-8).join('\n')
  }
  rmSync(staging, { recursive: true, force: true })
  const network = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|network/i.test(failure)
  throw new Error([
    `npm could not install @deepseek-ai/dsh@${DSH_VERSION} after ${INSTALL_ATTEMPTS} attempts.`,
    network
      ? 'The registry connection kept failing (network reset or timeout), not the suite: rerun when the network is stable.'
      : 'Check the npm output above.',
    `To reuse an existing install instead, set DSH_E2E_INSTALL to a directory whose node_modules holds @deepseek-ai/dsh@${DSH_VERSION}.`,
    'Last npm output:',
    failure,
  ].join('\n'))
}

/**
 * Pack the built plugin exactly as npm would publish it.
 * @returns the tarball path.
 */
export function packPlugin(): string {
  execFileSync('pnpm', ['pack', '--pack-destination', run], { cwd: repo, encoding: 'utf8' })
  return join(run, `${manifest.name}-${manifest.version}.tgz`)
}

/**
 * Run the DSH CLI inside the isolated world.
 * @param e2e - the run's install and environment.
 * @param args - CLI arguments.
 * @returns standard output.
 */
export function dsh(e2e: Pick<E2EContext, 'cli' | 'env'>, args: readonly string[]): string {
  return execFileSync(e2e.cli, args, { cwd: run, env: e2e.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** One row of a composed entry list. */
export interface ComposedRow {
  readonly id: string
  readonly name?: string
  readonly disabled?: unknown
  readonly config?: Record<string, unknown>
}

/** The raw `dsh --profile web --dump-config` output. */
export function dumpConfig(e2e: Pick<E2EContext, 'cli' | 'env'>): string {
  return dsh(e2e, ['--profile', 'web', '--dump-config'])
}

/**
 * The `web` profile as DSH composes it: base bundle, plugin bundles, then the
 * user layer the settings page writes.
 * @param e2e - the run's install and environment.
 * @returns the top-level rows of `dsh --profile web --dump-config`.
 */
export function composedRows(e2e: Pick<E2EContext, 'cli' | 'env'>): ComposedRow[] {
  // The dump keeps `!!js` expressions; read it with the dialect the Loader uses.
  return load(dumpConfig(e2e), { schema: entryListSchema }) as ComposedRow[]
}

/** The plugin's composed row. */
export function pluginRow(e2e: Pick<E2EContext, 'cli' | 'env'>): ComposedRow {
  const row = composedRows(e2e).find(entry => entry.id === manifest.name)
  if (row === undefined) throw new Error(`the composed web profile has no ${manifest.name} row`)
  return row
}

/**
 * Make this test process look like the isolated world, for code that reads
 * `process.env` directly (the in-process host boot, the plugin's storage root).
 * @param env - the run's environment.
 */
export function enterIsolatedEnvironment(env: Record<string, string>): void {
  for (const name of Object.keys(process.env)) if (!(name in env) && !name.startsWith('VITEST')) delete process.env[name]
  Object.assign(process.env, env)
}
