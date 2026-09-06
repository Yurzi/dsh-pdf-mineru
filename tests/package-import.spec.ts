import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

describe('package contract', () => {
  it('ships a current configuration bundle without removed v1 fields', async () => {
    const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    expect(patch).toMatch(/schemaVersion:\s*2/u)
    expect(patch).not.toMatch(/^\s+artifacts:/mu)
    expect(patch).not.toMatch(/^\s+maxFilesPerRequest:/mu)
  })

  it('declares every injected Client package as a runtime peer', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      dsh?: { client?: { inject?: string[] } }
      peerDependencies?: Record<string, string>
    }
    const injected = manifest.dsh?.client?.inject ?? []

    expect(injected).toEqual([
      '@deepseek-ai/dsh-client-connection',
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-api-remotes',
    ])
    for (const name of injected) expect(manifest.peerDependencies).toHaveProperty(name)
    expect(manifest.peerDependencies).not.toHaveProperty('@deepseek-ai/dsh-client-ui-slots')
    expect(manifest.peerDependencies).not.toHaveProperty('@deepseek-ai/dsh-client-ui-primitives')
    expect(manifest.peerDependencies).not.toHaveProperty('react')
  })

  it('imports the built host bundle', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ['--input-type=module', '--eval', "await import('./lib/index.js'); process.stdout.write('ok')"],
      { cwd: process.cwd() },
    )
    expect(stdout).toBe('ok')
  })
})
