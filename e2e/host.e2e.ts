/**
 * The packed plugin inside a real DSH composition: installed by the plugin
 * manager into a fresh `web` profile (see global-setup.ts, where a successful
 * `dsh plugin add` already proves the compatibility check and the production
 * dependency install), composed with the shipped bundles, and booted
 * in-process through the CLI's own steps. Unit tests cover the plugin's parts;
 * these cover what only the installed package in the real composition shows.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, sep } from 'node:path'
import { load } from 'js-yaml'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-jobs'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-working-directory'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import manifest from '../package.json' with { type: 'json' }
import { composedRows, enterIsolatedEnvironment, pluginRow, repo, run } from './support/environment.js'
import { type Host, bootHost } from './support/host.js'
import { minimalPdf } from './support/pdf.js'

const e2e = inject('e2e')

/** Width and height of a structurally complete PNG. */
function pngSize(data: Uint8Array): { width: number; height: number } {
  const png = Buffer.from(data)
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  expect(png.toString('latin1', 12, 16)).toBe('IHDR')
  expect(png.toString('latin1', png.length - 8, png.length - 4)).toBe('IEND')
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

describe('composition', () => {
  it('adds the plugin row with the first-boot defaults of cordis.patch.yml', () => {
    const [layer] = load(readFileSync(join(repo, 'cordis.patch.yml'), 'utf8')) as [{ insert: [{ config: unknown }] }]
    const row = pluginRow(e2e)
    expect(row).toMatchObject({ name: 'dsh-pdf-mineru', config: { schemaVersion: 3 } })
    expect(row.disabled).toBeUndefined()
    expect(row.config).toEqual(layer.insert[0].config)
  })

  it('has every GUI row the in-process boot disables', () => {
    const overlay = load(readFileSync(join(import.meta.dirname, 'fixtures/host-plane.yml'), 'utf8')) as { id: string }[]
    expect(composedRows(e2e).map(row => row.id)).toEqual(expect.arrayContaining(overlay.map(row => row.id)))
  })
})

describe('host plane', () => {
  let host: Host

  beforeAll(async () => {
    enterIsolatedEnvironment(e2e.env)
    host = await bootHost(e2e)
  })

  afterAll(async () => {
    await host?.dispose()
  })

  it('loads the installed package and resolves its production dependencies inside the profile', () => {
    // The run lives inside the repository, so a dependency missing from the
    // profile would silently resolve from the checkout's node_modules instead.
    const inProfile = expect.stringContaining(host.profileDir + sep)
    expect(host.localPackages).toContain(manifest.name)
    const installed = createRequire(join(host.profileDir, 'node_modules', manifest.name, 'package.json'))
    expect(installed('./package.json')).toMatchObject({ name: manifest.name, version: manifest.version })
    for (const dependency of Object.keys(manifest.dependencies)) {
      expect(installed.resolve(`${dependency}/package.json`)).toEqual(inProfile)
    }
    const canvas = createRequire(installed.resolve('@napi-rs/canvas/package.json'))
    const binaries = Object.keys(canvas('./package.json').optionalDependencies as Record<string, string>)
      .flatMap((name) => { try { return [canvas.resolve(`${name}/package.json`)] } catch { return [] } })
    expect(binaries).toEqual([inProfile])
  })

  it('starts on the composition\'s tools, jobs, settings and working directory and registers both tools', () => {
    // The plugin's `inject`; none of these is provided by the test.
    for (const service of ['tools', 'jobs', 'settings', 'workingDirectory']) expect(host.ctx.get(service), service).toBeDefined()
    expect(host.ctx.get('webServer')).toBeUndefined() // nothing listens: the GUI rows are off
    expect(host.ctx.tools.get('read_pdf')?.name).toBe('read_pdf')
    expect(host.ctx.tools.get('async_parse_pdf')?.name).toBe('async_parse_pdf')
    expect(host.ctx.tools.schemas().map(schema => schema.name)).toEqual(expect.arrayContaining(['read_pdf', 'async_parse_pdf']))
    expect(host.ctx.settings.describe().map(row => row.ns)).toContain('dsh-pdf-mineru')
  })

  it('renders an original page through PDF.js and Canvas from the installed package', async () => {
    const project = join(run, 'project')
    const emptyPath = join(run, 'empty-path')
    mkdirSync(emptyPath, { recursive: true })
    mkdirSync(project, { recursive: true })
    writeFileSync(join(project, 'page.pdf'), minimalPdf('MinerU e2e'))
    // A real Agent on the profile's default route (which accepts images), created like a new session.
    const route = composedRows(e2e).find(row => row.id === 'agent-default-model')?.config as { provider: string; model: string }
    const handle = await host.ctx.agents.create({ sessionId: 'mineru-e2e-page' as SessionId, meta: { cwd: project }, agentOptions: route })
    try {
      const path = process.env.PATH
      process.env.PATH = emptyPath // no pdftoppm on PATH: the renderer must fall back to PDF.js
      const result = await host.ctx.tools.execute({
        callId: 'mineru-e2e-page' as ToolCallId,
        name: 'read_pdf',
        arguments: { file_path: 'page.pdf', pages: 1, view: 'page' },
        agent: handle.agent,
        signal: AbortSignal.timeout(60_000),
      }).finally(() => { process.env.PATH = path })
      expect(result.error).toBeUndefined()
      expect(result.value).toMatchObject({ view: 'page', source: 'local', renderer: 'pdfjs', summary: { page_count: 1, page_count_source: 'pdfjs' } })
      const image = result.content.find(block => block.type === 'image')
      expect(image).toBeDefined()
      const stored = await host.ctx.attachments.readImage(image!.attachment)
      expect(stored.ref.mediaType).toBe('image/png')
      expect(pngSize(stored.data)).toEqual({ width: image!.attachment.width, height: image!.attachment.height })
    } finally {
      await handle.dispose()
    }
  })
})
