import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

// Package project: runs after `pnpm run build` and exercises the built lib/ and shipped manifest.
describe('package contract', () => {
  it('ships a current configuration bundle without removed v1 fields', async () => {
    const patch = await readFile(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
    expect(patch).toMatch(/schemaVersion:\s*3/u)
    expect(patch).not.toMatch(/^\s+artifacts:/mu)
    expect(patch).not.toMatch(/^\s+maxFilesPerRequest:/mu)
  })

  it('declares every injected Client package as a runtime peer', async () => {
    const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as {
      dsh?: { client?: { inject?: string[] } }
      peerDependencies?: Record<string, string>
    }
    const injected = manifest.dsh?.client?.inject ?? []

    for (const name of injected) expect(manifest.peerDependencies).toHaveProperty(name)
  })

  it('aligns DSH peers and exact development pins with the engine baseline', async () => {
    const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
    const baseline = /^>=(\S+)/.exec(manifest.engines.dsh)![1]
    const dshPackages = (dependencies: Record<string, string>) => Object.entries(dependencies).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
    for (const [name, range] of dshPackages(manifest.peerDependencies)) expect(range, name).toBe(manifest.engines.dsh)
    for (const [name, version] of dshPackages(manifest.devDependencies)) expect(version, name).toBe(baseline)
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
        fileURLToPath(new URL('../../scripts/smoke-reader-local.mjs', import.meta.url)),
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
      { cwd: fileURLToPath(new URL('../../', import.meta.url)) },
    )
    expect(stdout).toBe('ok')
  })
})
