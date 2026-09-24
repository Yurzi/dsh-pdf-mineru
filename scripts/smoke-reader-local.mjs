#!/usr/bin/env node
/**
 * Explicit offline original-page smoke through a built plugin's complete apply/read_pdf chain.
 *
 * Local build:
 *   pnpm run smoke:reader-local -- <pdf> [page=1] [.vitest-cache/evidence]
 *     [--backend=auto|pdfjs] [--expect-renderer=poppler|pdfjs]
 * Packed build (normally driven by smoke-reader-package.mjs after pack/install):
 *   node scripts/smoke-reader-local.mjs <pdf> [page=1]
 *     --plugin=/path/to/unpacked/package [--backend=pdfjs]
 *
 * --backend=pdfjs temporarily gives the plugin an empty PATH, proving real automatic
 * fallback rather than changing persistent plugin configuration. --backend=auto leaves
 * PATH untouched and records the renderer actually selected. Keep optional PNG/JSON
 * evidence under the repository's ignored .vitest-cache directory.
 */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'

const rawArgs = process.argv.slice(2).filter(arg => arg !== '--')
const positional = []
let backend = 'auto'
let expectedRenderer
let pluginArgument
for (const arg of rawArgs) {
  if (arg.startsWith('--backend=')) backend = arg.slice('--backend='.length)
  else if (arg.startsWith('--expect-renderer=')) expectedRenderer = arg.slice('--expect-renderer='.length)
  else if (arg.startsWith('--plugin=')) pluginArgument = arg.slice('--plugin='.length)
  else if (arg.startsWith('--')) {
    console.error('Unknown option: ' + arg)
    process.exitCode = 1
  } else positional.push(arg)
}

const file = positional[0]
const page = Number(positional[1] ?? 1)
const outputDirectory = positional[2] === undefined ? undefined : resolve(positional[2])
const validRenderer = value => value === 'poppler' || value === 'pdfjs'
if (!file || !Number.isSafeInteger(page) || page < 1 || positional.length > 3
  || !['auto', 'pdfjs'].includes(backend)
  || (expectedRenderer !== undefined && !validRenderer(expectedRenderer))
  || process.exitCode) {
  console.error('Usage: pnpm run smoke:reader-local -- <pdf> [page=1] [.vitest-cache/output-directory] [--backend=auto|pdfjs] [--expect-renderer=poppler|pdfjs] [--plugin=/built/package-or-entry]')
  process.exitCode = 1
} else {
  const resolvePluginEntry = async argument => {
    if (argument === undefined) return new URL('../lib/index.js', import.meta.url)
    const candidate = resolve(argument)
    const details = await stat(candidate)
    if (details.isFile()) return pathToFileURL(candidate)
    if (!details.isDirectory()) throw new Error('--plugin must name a built entry file or unpacked package directory')
    const manifest = JSON.parse(await readFile(join(candidate, 'package.json'), 'utf8'))
    assert.equal(typeof manifest.main, 'string', 'packed package main must be a string')
    return pathToFileURL(join(candidate, manifest.main))
  }

  const pluginEntry = await resolvePluginEntry(pluginArgument)
  const plugin = await import(pluginEntry.href)
  const root = await mkdtemp(join(tmpdir(), 'mineru-local-smoke-'))
  const emptyPath = join(root, 'empty-path')
  await mkdir(emptyPath)
  const definitions = []
  const noop = () => undefined
  const defaults = plugin.defaultMinerUConfig()
  const config = plugin.parseConfig({ ...defaults, storage: { ...defaults.storage, storageRoot: root } })
  let attachmentBytes
  const ctx = {
    tools: { register(definition) { definitions.push(definition); return noop }, schemas() { return [] } },
    get(name) {
      if (name === 'settings') return { configure() { return noop }, mutate: async () => undefined }
      if (name === 'llm') return { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }) }
      if (name === 'attachments') return { saveImage: async ({ data, mediaType, name }) => {
        const buffer = Buffer.from(data)
        assert.equal(buffer.subarray(1, 4).toString(), 'PNG')
        attachmentBytes = buffer
        return { attachmentId: 'sha256:' + createHash('sha256').update(buffer).digest('hex'), mediaType, name, bytes: buffer.length, width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
      } }
      return undefined
    },
    inject: () => noop, effect: () => noop, on: () => noop,
    logger: { debug: noop, info: noop, warn: noop, error: noop },
  }
  const nativeFetch = globalThis.fetch
  const nativePath = process.env.PATH
  globalThis.fetch = async () => { throw new Error('Network is forbidden in the local reader smoke') }
  if (backend === 'pdfjs') process.env.PATH = emptyPath
  let dispose
  try {
    dispose = await plugin.apply(ctx, config)
    const tool = definitions.find(definition => definition.name === 'read_pdf')
    assert.ok(tool)
    const input = { file_path: resolve(file), pages: page, view: 'page' }
    const exec = { signal: new AbortController().signal, callId: randomUUID(), name: 'read_pdf', arguments: input, agent: { options: { provider: 'local-test', model: 'image-test' }, session: { header: { id: 'local-smoke', cwd: process.cwd() } } } }
    const start = performance.now()
    const result = await tool.execute(input, exec)
    assert.deepEqual(validateJsonSchemaValue(tool.output.schema, result, 'value'), [])
    assert.equal(result.source, 'local')
    assert.equal(result.view, 'page')
    assert.equal(result.cursor, null)
    assert.ok(validRenderer(result.renderer), 'read_pdf page result must report its renderer')
    assert.equal(result.summary.page_count_source, result.renderer === 'poppler' ? 'pdfinfo' : 'pdfjs')
    if (backend === 'pdfjs') assert.equal(result.renderer, 'pdfjs', 'empty PATH must select automatic PDF.js fallback')
    if (expectedRenderer !== undefined) assert.equal(result.renderer, expectedRenderer)
    assert.equal(result.inlined_images.length, 1)
    assert.equal(tool.output.render(input, result).filter(block => block.type === 'image').length, 1)
    assert.ok(attachmentBytes)
    const elapsed_ms = Math.round(performance.now() - start)
    await assert.rejects(tool.execute({ ...input, expected_sha256: '0'.repeat(64) }, exec), /changed|SHA-256|match/i)
    await assert.rejects(tool.execute({ ...input, pages: result.summary.page_count + 1 }, exec), /range|page/i)
    const summary = {
      file: basename(file), page, total_pages: result.summary.page_count,
      renderer: result.renderer, page_count_source: result.summary.page_count_source,
      requested_backend: backend, path_mode: backend === 'pdfjs' ? 'empty' : 'inherited',
      source_sha256: result.source_sha256, width: result.inlined_images[0].width,
      height: result.inlined_images[0].height, png_bytes: attachmentBytes.length, elapsed_ms,
      plugin_entry: pluginArgument === undefined ? 'local-build' : 'explicit-built-artifact',
      network: 'forbidden', schema: 'passed', changed_source_guard: 'passed', page_range_guard: 'passed',
    }
    if (outputDirectory) {
      await mkdir(outputDirectory, { recursive: true })
      await writeFile(join(outputDirectory, 'page-' + page + '-' + result.renderer + '.png'), attachmentBytes)
      await writeFile(join(outputDirectory, 'result-' + backend + '.json'), JSON.stringify(summary, null, 2) + '\n')
    }
    console.log(JSON.stringify(summary, null, 2))
  } finally {
    await dispose?.()
    globalThis.fetch = nativeFetch
    if (nativePath === undefined) delete process.env.PATH
    else process.env.PATH = nativePath
    await rm(root, { recursive: true, force: true })
  }
}
