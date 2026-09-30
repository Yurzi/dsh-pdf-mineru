import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
      '@deepseek-ai/dsh-client-ui-plugin-manager',
      '@deepseek-ai/dsh-api-remotes',
    ])
    for (const name of injected) expect(manifest.peerDependencies).toHaveProperty(name)
    expect(manifest.peerDependencies).not.toHaveProperty('@deepseek-ai/dsh-client-ui-slots')
    expect(manifest.peerDependencies).not.toHaveProperty('@deepseek-ai/dsh-client-ui-primitives')
    expect(manifest.peerDependencies).not.toHaveProperty('react')
  })

  it('targets DSH 0.2.0-rc.2 consistently across engine, peers, and development packages', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    expect(manifest.engines.dsh).toBe('>=0.2.0-rc.2')
    expect(manifest.engines.node).toBe('^22.19.0 || >=24.0.0')
    for (const dependencies of [manifest.peerDependencies, manifest.devDependencies]) {
      const dshPackages = Object.entries(dependencies).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
      expect(dshPackages.length).toBeGreaterThan(0)
      for (const [, range] of dshPackages) expect(range).toBe(dependencies === manifest.devDependencies ? '0.2.0-rc.2' : '^0.2.0-rc.2')
    }
    for (const name of manifest.dsh.client.inject) {
      expect(manifest.devDependencies[name]).toBe('0.2.0-rc.2')
    }
    const workspace = await readFile(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8')
    const exclusions = [...workspace.matchAll(/'(@deepseek-ai\/dsh-[^']+)'/gu)].map(match => match[1]!)
    expect(exclusions.length).toBeGreaterThan(0)
    for (const exclusion of exclusions) expect(exclusion).toMatch(/@0\.2\.0-rc\.2$/u)
    for (const name of Object.keys(manifest.devDependencies).filter(name => name.startsWith('@deepseek-ai/dsh-'))) {
      expect(exclusions).toContain(`${name}@0.2.0-rc.2`)
    }
  })

  it('runs the offline page smoke through built apply and optional attachment injection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mineru-built-smoke-'))
    try {
      const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << >> /Contents 4 0 R >>',
        '<< /Length 0 >>\nstream\n\nendstream',
      ]
      let pdf = '%PDF-1.7\n'
      const offsets = objects.map((object, index) => {
        const offset = Buffer.byteLength(pdf)
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
        return offset
      })
      const xref = Buffer.byteLength(pdf)
      pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
      pdf += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
      const source = join(root, 'fixture.pdf')
      await writeFile(source, pdf)
      const { stdout } = await execFileAsync(process.execPath, [
        fileURLToPath(new URL('../scripts/smoke-reader-local.mjs', import.meta.url)),
        source, '1', '--backend=pdfjs', '--expect-renderer=pdfjs',
      ], { cwd: root, timeout: 10_000 })
      expect(JSON.parse(stdout)).toMatchObject({
        renderer: 'pdfjs', total_pages: 1, path_mode: 'empty', network: 'forbidden',
        schema: 'passed', changed_source_guard: 'passed', page_range_guard: 'passed',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)

  it('imports the built host bundle', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ['--input-type=module', '--eval', "await import('./lib/index.js'); process.stdout.write('ok')"],
      { cwd: process.cwd() },
    )
    expect(stdout).toBe('ok')
  })
})
