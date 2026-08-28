import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

describe('built package import', () => {
  it('declares only current dynamic Client package edges', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      dsh?: { client?: { inject?: string[] } }
      peerDependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      exports?: Record<string, unknown>
      scripts?: Record<string, string>
      engines?: Record<string, string>
      packageManager?: string
      types?: string
    }
    expect(manifest.dsh?.client?.inject).toEqual([
      '@deepseek-ai/dsh-client-connection',
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-api-remotes',
    ])
    expect(manifest.dsh?.client?.inject).not.toContain('@deepseek-ai/dsh-client-runtime')
    expect(manifest.dsh?.client?.inject).not.toContain('@deepseek-ai/dsh-client-ui-slots')

    for (const name of [
      '@deepseek-ai/dsh-api-remotes',
      '@deepseek-ai/dsh-client-connection',
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-settings',
    ]) {
      expect(manifest.peerDependencies?.[name]).toContain('0.1.2-alpha.1')
    }
    expect(manifest.peerDependencies).not.toHaveProperty('@deepseek-ai/dsh-client-ui-slots')
    expect(manifest.peerDependencies).not.toHaveProperty('@deepseek-ai/dsh-client-ui-primitives')
    expect(manifest.peerDependencies).not.toHaveProperty('react')
    expect(manifest.types).toBe('./lib/types/index.d.ts')
    expect(manifest.exports).toHaveProperty('./client')
    expect(manifest.exports).toHaveProperty('./cordis.patch.yml')
    expect(manifest.scripts?.build).toContain('build:types')
    expect(manifest.packageManager).toBe('pnpm@11.7.0')
    expect(manifest.engines?.node).toBe('^22.19.0 || >=24.0.0')
  })

  it('resolves runtime peers when installed through a workspace link', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ['--input-type=module', '--eval', "await import('./lib/index.js'); process.stdout.write('ok')"],
      { cwd: process.cwd() },
    )
    expect(stdout).toBe('ok')
  })
})
