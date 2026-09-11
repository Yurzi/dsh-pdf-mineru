#!/usr/bin/env node
/** Explicit, offline smoke through the built plugin. Never uploads the source. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'

const args = process.argv.slice(2).filter(arg => arg !== '--')
const file = args[0]
const page = Number(args[1] ?? 1)
const outputDirectory = args[2] === undefined ? undefined : resolve(args[2])
if (!file || !Number.isSafeInteger(page) || page < 1 || args.length > 3) {
  console.error('Usage: pnpm run smoke:reader-local -- <pdf> [page=1] [output-directory]')
  process.exitCode = 1
} else {
  const plugin = await import('../lib/index.js')
  const root = await mkdtemp(join(tmpdir(), 'mineru-local-smoke-'))
  const definitions = []
  const noop = () => undefined
  const defaults = plugin.defaultMinerUConfig()
  const config = plugin.parseConfig({ ...defaults, storage: { ...defaults.storage, storageRoot: root } })
  let attachmentBytes
  const ctx = {
    tools: { register(definition) { definitions.push(definition); return noop }, schemas() { return [] } },
    get(name) {
      if (name === 'settings') return { register() { return { get: () => config, watch: () => noop, replace: async () => undefined } }, mutate: async () => undefined }
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
  globalThis.fetch = async () => { throw new Error('Network is forbidden in the local reader smoke') }
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
    assert.equal(result.inlined_images.length, 1)
    assert.equal(tool.output.render(input, result).filter(block => block.type === 'image').length, 1)
    assert.ok(attachmentBytes)
    const elapsed_ms = Math.round(performance.now() - start)
    await assert.rejects(tool.execute({ ...input, expected_sha256: '0'.repeat(64) }, exec), /changed|SHA-256|match/i)
    await assert.rejects(tool.execute({ ...input, pages: result.summary.page_count + 1 }, exec), /range|page/i)
    const summary = { file: basename(file), page, total_pages: result.summary.page_count, source_sha256: result.source_sha256, width: result.inlined_images[0].width, height: result.inlined_images[0].height, png_bytes: attachmentBytes.length, elapsed_ms, network: 'forbidden', schema: 'passed', changed_source_guard: 'passed', page_range_guard: 'passed' }
    if (outputDirectory) {
      await mkdir(outputDirectory, { recursive: true })
      await writeFile(join(outputDirectory, 'page-' + page + '.png'), attachmentBytes)
      await writeFile(join(outputDirectory, 'result.json'), JSON.stringify(summary, null, 2) + '\n')
    }
    console.log(JSON.stringify(summary, null, 2))
  } finally {
    await dispose?.()
    globalThis.fetch = nativeFetch
    await rm(root, { recursive: true, force: true })
  }
}
