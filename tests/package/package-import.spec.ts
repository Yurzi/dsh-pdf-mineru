import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { satisfies } from 'semver'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)

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
    expect(manifest.engines).toEqual({ node: '>=24.9.0', dsh: '>=0.2.2-rc.1 <0.3.0-0' })
    const baseline = /^>=(\S+)/.exec(manifest.engines.dsh)![1]
    const dshPackages = (dependencies: Record<string, string>) => Object.entries(dependencies).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
    for (const [name, range] of dshPackages(manifest.peerDependencies)) expect(range, name).toBe(manifest.engines.dsh)
    for (const [name, version] of dshPackages(manifest.devDependencies)) expect(version, name).toBe(baseline)
  })

  it('uses one target vendor version and keeps executors test-only', async () => {
    const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
    const vendors = {
      '@deepseek-ai/cordis': '4.1.0',
      '@deepseek-ai/cosmokit': '1.9.0',
      '@deepseek-ai/schemastery': '3.19.0',
    }
    for (const [name, version] of Object.entries(vendors)) {
      expect(manifest.peerDependencies[name], name).toBe('~' + version)
      expect(manifest.devDependencies[name], name).toBe(version)
      const installed = JSON.parse(await readFile(require.resolve(name + '/package.json'), 'utf8'))
      expect(installed.version, name).toBe(version)
      expect(satisfies(installed.version, manifest.peerDependencies[name]), name).toBe(true)
    }
    for (const name of ['group', 'include', 'loader', 'timer']) {
      expect(manifest.devDependencies['@deepseek-ai/cordis-plugin-' + name], name).toBe(name === 'timer' ? '1.2.0' : '1.1.0')
    }
    for (const name of ['tool-executor-native', 'tool-executor-ptc', 'tool-jobs', 'output-retention']) {
      const packageName = '@deepseek-ai/dsh-' + name
      expect(manifest.devDependencies[packageName], packageName).toBe('0.2.2-rc.1')
      expect(manifest.dependencies, packageName).not.toHaveProperty(packageName)
      expect(manifest.peerDependencies, packageName).not.toHaveProperty(packageName)
    }
  })

  it.each([
    ['0.2.1-rc.2', false, false],
    ['0.2.2-rc.0', false, false],
    ['0.2.2-rc.1', true, true],
    ['0.2.2-rc.2', true, true],
    ['0.2.2', true, true],
    ['0.2.3-rc.1', false, true],
    ['0.2.99', true, true],
    ['0.3.0-rc.1', false, false],
    ['0.3.0', false, false],
  ])('distinguishes external peers from the host prerelease gate for %s', async (version, external, host) => {
    const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(satisfies(version, manifest.engines.dsh)).toBe(external)
    expect(satisfies(version, manifest.engines.dsh, { includePrerelease: true })).toBe(host)
    for (const [name, range] of Object.entries(manifest.peerDependencies) as [string, string][]) {
      if (name.startsWith('@deepseek-ai/dsh-')) expect(satisfies(version, range), name).toBe(external)
    }
  })

  it.each([
    ['22.19.0', false], ['24.8.0', false], ['24.9.0', true], ['26.0.0', true],
  ])('enforces the Node runtime floor for %s', async (version, allowed) => {
    const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(satisfies(version, manifest.engines.node)).toBe(allowed)
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
