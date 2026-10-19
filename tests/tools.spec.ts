import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { isJsonValue } from '@deepseek-ai/dsh-util-values'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { defaultMinerUConfig } from '../src/config/parse.js'
import { cursorForRemainder, decodeReadCursor } from '../src/reader/read-cursor.js'
import { fitsReadBudget } from '../src/reader/read-delivery.js'
import type { ImageCandidateView } from '../src/reader/views.js'
import { parseAsyncArguments } from '../src/tools/async-parse-pdf.js'
import { parseReadArguments } from '../src/tools/read-pdf.js'
import { renderResult } from '../src/tools/render.js'
import { projectedReader, selectQuery, toolHarness, withOutput } from './support/tool-harness.js'
import { deepFreeze, imageCandidate, jsonValue, maximalResultView, resultFile, resultView } from './support/views.js'

const invalidRequest = expect.objectContaining({ failure: expect.objectContaining({ code: 'INVALID_REQUEST' }) })

async function pngFiles(count: number): Promise<string[]> {
  const directory = await mkdtemp(join(tmpdir(), 'mineru-tool-images-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  return await Promise.all(Array.from({ length: count }, async (_, index) => {
    const path = join(directory, 'figure-' + String(index + 1) + '.png')
    await writeFile(path, Buffer.from('fake-png-data'))
    return path
  }))
}

const withImages = (images: readonly ImageCandidateView[]) => projectedReader(() => resultView({ ordered_images: images }))

describe('tool admission', () => {
  it.each(['read_pdf', 'async_parse_pdf'] as const)('%s requires an authenticated agent session before any work', async name => {
    const h = await toolHarness()
    await expect(h.tool(name).execute({ file_path: 'paper.pdf' }, h.exec({ agent: undefined })))
      .rejects.toMatchObject({ failure: { code: 'UNAUTHENTICATED_SESSION' } })
    expect(h.ensure).not.toHaveBeenCalled()
    expect(h.reader.readContent).not.toHaveBeenCalled()
    expect(h.ctx.jobs.list(h.session.id)).toEqual([])
  })

  it('reports PROVIDER_UNAVAILABLE for async parsing on hosts without the jobs registry', async () => {
    const h = await toolHarness({ jobs: false })
    await expect(h.submit({ file_path: 'paper.pdf' })).rejects.toMatchObject({ failure: { code: 'PROVIDER_UNAVAILABLE' } })
    expect(h.reader.summarize).not.toHaveBeenCalled()
  })

  it('registers no job when the call is already cancelled', async () => {
    const h = await toolHarness()
    const controller = new AbortController()
    controller.abort(new Error('cancelled before submission'))
    await expect(h.submit({ file_path: 'paper.pdf' }, h.exec({ signal: controller.signal }))).rejects.toThrow('cancelled before submission')
    expect(h.ctx.jobs.list(h.session.id)).toEqual([])
  })
})

describe('read_pdf argument boundary', () => {
  const cursor = cursorForRemainder('mr_fixture', undefined, new Set(['all']), 4, { inline_images: false })

  it.each([
    [{ file_path: 'paper.pdf' }, selectQuery()],
    [{ file_path: 'paper.pdf', pages: '1-3, 5', focus: 'table' }, selectQuery({ pages: new Set([1, 2, 3, 5]), focus: new Set(['table']) })],
    [{ file_path: 'paper.pdf', focus: ['toc', 'text'] }, selectQuery({ focus: new Set(['toc', 'text']) })],
    [{ file_path: 'paper.pdf', query: '  equation  ', inline_images: false }, selectQuery({ target: { kind: 'query', text: 'equation' } }, { inlineImages: false })],
    [{ file_path: 'paper.pdf', block_id: 'mr_fixture:b1', poll_timeout_ms: 1234 }, selectQuery({ target: { kind: 'block', blockId: 'mr_fixture:b1' } }, { pollTimeoutMs: 1234 })],
    [{ file_path: 'paper.pdf', cursor }, { kind: 'continue', cursor: decodeReadCursor(cursor), inlineImages: false }],
    [{ file_path: 'paper.pdf', cursor, inline_images: true }, { kind: 'continue', cursor: decodeReadCursor(cursor), inlineImages: true }],
  ])('parses %j into one ReadQuery', (args, query) => {
    expect(parseReadArguments(args)).toEqual({ source: { file_path: 'paper.pdf' }, query })
  })

  it.each([
    ...['model', 'ocr', 'formula', 'table', 'language', 'artifacts', 'max_inline_images', 'unexpected'].map(key => ({ [key]: 'x' })),
    ...[-1, 0, 86_400_001, 1.5, Number.NaN].map(poll_timeout_ms => ({ poll_timeout_ms })),
    { cursor: '' }, { cursor: '   ' }, { cursor: 'opaque' },
    { cursor, pages: 1 }, { cursor, focus: 'text' }, { cursor, query: 'x' }, { cursor, block_id: 'mr_fixture:b1' },
    { block_id: 'mr_fixture:b1', query: 'x' }, { block_id: 'not-a-block' }, { query: '' }, { query: 'x'.repeat(257) },
    { query: 'x', focus: 'toc' }, { block_id: 'mr_fixture:b1', focus: 'artifacts' },
    { focus: 'pictures' }, { pages: '0' }, { pages: [] }, { inline_images: 'yes' }, { expected_sha256: 'a'.repeat(64) },
    { view: 'outline' },
  ])('rejects %j as INVALID_REQUEST', extra => {
    expect(() => parseReadArguments({ file_path: 'paper.pdf', ...extra })).toThrow(invalidRequest)
  })

  it('rejects unknown async parameters with the same boundary', () => {
    expect(() => parseAsyncArguments({ file_path: 'paper.pdf', pages: 1 })).toThrow(invalidRequest)
  })

  it('never reaches the reader with invalid arguments', async () => {
    const h = await toolHarness()
    for (const args of [{ file_path: 'paper.pdf', model: 'vlm' }, { file_path: 'paper.pdf', poll_timeout_ms: 0 }, { pages: 1 }]) {
      await expect(h.read(args)).rejects.toThrow()
    }
    expect(h.reader.readContent).not.toHaveBeenCalled()
    expect(h.ensure).not.toHaveBeenCalled()
  })

  it('passes the resolved absolute path, query, live config snapshot and caller signal to the reader', async () => {
    let maxInlineChars = 2000
    const h = await toolHarness({ config: () => withOutput({ maxInlineChars }) })
    const exec = h.exec()
    await h.read({ file_path: 'docs/paper.pdf', pages: 2 }, exec)
    maxInlineChars = 3000
    await h.read({ file_path: '/abs/paper.pdf' }, exec)
    expect(h.reader.readContent).toHaveBeenNthCalledWith(1, '/workspace/docs/paper.pdf', selectQuery({ pages: new Set([2]) }),
      expect.objectContaining({ output: expect.objectContaining({ maxInlineChars: 2000 }) }), undefined, exec.signal)
    expect(h.reader.readContent).toHaveBeenNthCalledWith(2, '/abs/paper.pdf', selectQuery(),
      expect.objectContaining({ output: expect.objectContaining({ maxInlineChars: 3000 }) }), undefined, exec.signal)
  })
})

describe('calling model image capability', () => {
  const header = (provider: string, model: string) => ({ header: { config: { provider, model } }, reason: 'initial' as const })

  it.each([
    { name: 'routed image model overrides text-only options', routed: ['routed', 'image-model'], options: { provider: 'opt', model: 'text-model' }, expected: ['routed', 'image-model'], inline: true },
    { name: 'routed text-only model overrides image options', routed: ['routed', 'text-model'], options: { provider: 'opt', model: 'image-model' }, expected: ['routed', 'text-model'], inline: false },
    { name: 'agent options apply without a request header', options: { provider: 'opt', model: 'image-model' }, expected: ['opt', 'image-model'], inline: true },
    { name: 'an incomplete route fails closed', options: { provider: 'opt' }, inline: false },
  ] as const)('$name', async ({ routed, options, expected, inline }) => {
    const [path] = await pngFiles(1)
    const h = await toolHarness({ imageModel: true, route: options, reader: { readContent: withImages([imageCandidate({ path: path! })]) } })
    h.resolveModelInfo.mockImplementation(async (provider, model) => ({
      provider, id: model, name: model, inputModalities: model === 'text-model' ? ['text'] : ['text', 'image'],
    }))
    if (routed) h.session.append('request/header', header(routed[0], routed[1]))
    const value = await h.read({ file_path: 'paper.pdf', focus: 'image' })
    if (expected) expect(h.resolveModelInfo).toHaveBeenCalledExactlyOnceWith(expected[0], expected[1], expect.any(AbortSignal))
    else expect(h.resolveModelInfo).not.toHaveBeenCalled()
    expect(h.saveImage).toHaveBeenCalledTimes(inline ? 1 : 0)
    expect(renderResult(value).map(block => block.type)).toEqual(inline ? ['text', 'image'] : ['text'])
    expect(value.ordered_images).toHaveLength(1)
  })

  it.each(['no llm service', 'unknown modalities', 'resolver rejection'] as const)('fails closed with %s even when inline_images is true', async mode => {
    const [path] = await pngFiles(1)
    const h = await toolHarness({ imageModel: mode === 'no llm service' ? undefined : true, reader: { readContent: withImages([imageCandidate({ path: path! })]) } })
    if (mode === 'unknown modalities') h.resolveModelInfo.mockResolvedValue({ provider: 'mock', id: 'vision', name: 'vision' })
    if (mode === 'resolver rejection') h.resolveModelInfo.mockRejectedValue(new Error('resolver unavailable'))
    const value = await h.read({ file_path: 'paper.pdf', focus: 'image', inline_images: true })
    expect(h.saveImage).not.toHaveBeenCalled()
    expect(value.inlined_images).toBeUndefined()
    expect(value.ordered_images).toHaveLength(1)
  })

  it('preserves caller cancellation raised during model resolution', async () => {
    const h = await toolHarness({ imageModel: true })
    const controller = new AbortController()
    const reason = new Error('caller cancelled during model resolution')
    h.resolveModelInfo.mockImplementation(async (_provider, _model, signal) => {
      controller.abort(reason)
      signal!.throwIfAborted()
      throw new Error('unreachable')
    })
    await expect(h.read({ file_path: 'paper.pdf' }, h.exec({ signal: controller.signal }))).rejects.toBe(reason)
    expect(h.reader.readContent).not.toHaveBeenCalled()
  })
})

describe('inline image delivery', () => {
  it('applies the live image budget per invocation and marks the rest omitted', async () => {
    const paths = await pngFiles(8)
    let maxInlineImages = 2
    const h = await toolHarness({
      imageModel: true, config: () => withOutput({ maxInlineChars: 20_000, maxInlineImages }),
      reader: { readContent: projectedReader(() => { maxInlineImages = 8; return resultView({ output_limit_chars: 20_000, ordered_images: paths.map(path => imageCandidate({ path })) }) }) },
    })
    const first = await h.read({ file_path: 'paper.pdf', focus: 'image' })
    expect(first.inlined_images).toHaveLength(2)
    expect(first.ordered_images?.map(image => image.status)).toEqual(['available', 'available', ...Array(6).fill('omitted')])
    expect(first.visuals).toEqual({ listed: 8, attached: 2, omitted: 6, scope: 'chunk' })
    expect((await h.read({ file_path: 'paper.pdf', focus: 'image' })).inlined_images).toHaveLength(8)
  })

  it.each([
    { copies: 1, bytes: 25 * 1024 * 1024, attached: 0 },
    { copies: 4, bytes: 8 * 1024 * 1024, attached: 3 },
  ])('bounds host-normalized growth for $copies images independently of source bytes', async ({ copies, bytes, attached }) => {
    const paths = await pngFiles(copies)
    const h = await toolHarness({ imageModel: true, reader: { readContent: withImages(paths.map(path => imageCandidate({ path }))) } })
    h.saveImage.mockImplementation(async image => ({ attachmentId: AttachmentId('sha256:' + 'c'.repeat(64)), mediaType: image.mediaType, bytes, width: 1, height: 1 }))
    const value = await h.read({ file_path: 'paper.pdf', focus: 'image' })
    expect(value.inlined_images?.length ?? 0).toBe(attached)
    expect(value.ordered_images?.at(-1)?.status).toBe('omitted')
  })

  it('reports failed and omitted figures while preserving stable ordinals', async () => {
    const paths = await pngFiles(3)
    const h = await toolHarness({ imageModel: true, reader: { readContent: withImages(paths.map((path, index) => imageCandidate({ path, page: index + 1 }))) } })
    const ref = (bytes: number) => ({ attachmentId: AttachmentId('sha256:' + 'd'.repeat(64)), mediaType: 'image/png' as const, bytes, width: 1, height: 1 })
    h.saveImage.mockResolvedValueOnce(ref(13)).mockRejectedValueOnce(new Error('save failed')).mockResolvedValueOnce(ref(25 * 1024 * 1024))
    const value = await h.read({ file_path: 'paper.pdf', focus: 'image' })
    expect(value.inlined_images?.map(image => image.figure)).toEqual([1])
    expect(value.ordered_images?.map(image => image.status)).toEqual(['available', 'failed', 'omitted'])
  })

  it('propagates cancellation observed after the last image is saved', async () => {
    const [path] = await pngFiles(1)
    const controller = new AbortController()
    const h = await toolHarness({ imageModel: true, reader: { readContent: withImages([imageCandidate({ path: path! })]) } })
    h.saveImage.mockImplementation(async image => {
      controller.abort(new Error('cancelled after save'))
      return { attachmentId: AttachmentId('sha256:' + 'e'.repeat(64)), mediaType: image.mediaType, bytes: 13, width: 1, height: 1 }
    })
    await expect(h.read({ file_path: 'paper.pdf', focus: 'image' }, h.exec({ signal: controller.signal }))).rejects.toThrow('cancelled after save')
  })

  it('keeps candidates as listed paths for text-only routes', async () => {
    const [path] = await pngFiles(1)
    const h = await toolHarness({ imageModel: false, reader: { readContent: withImages([imageCandidate({ path: path!, page: 1 })]) } })
    const value = await h.read({ file_path: 'paper.pdf', focus: 'image' })
    expect(value.inlined_images).toBeUndefined()
    expect(value.visuals).toMatchObject({ listed: 1, attached: 0 })
    const rendered = renderResult(value)
    expect(rendered).toHaveLength(1)
    expect(rendered[0]).toMatchObject({ type: 'text', text: expect.stringContaining(path!) })
  })
})

describe('read_pdf response budget', () => {
  it('shortens metadata to fit the budget and records metadata_shortened', async () => {
    const large = 'x'.repeat(300)
    const many = <T>(count: number, item: (index: number) => T): T[] => Array.from({ length: count }, (_, index) => item(index))
    const h = await toolHarness({ reader: { readContent: projectedReader(() => resultView({
      markdown_content: 'Bounded evidence.', output_limit_chars: 650,
      summary: { page_count: 40, image_count: 8, table_count: 4, equation_count: 2 },
      toc: many(8, index => ({ level: 1, title: 'Heading ' + String(index) + ' ' + large })),
      provenance: { provider: 'self-hosted-legacy-v2', model: 'pipeline', parse_method: 'auto', upstream_version: null, index_version: 1, reader_version: 1 },
      diagnostics: many(4, index => ({ id: 'diag-' + String(index), code: 'SOURCE_REPAIR', scope: 'chunk' as const, message: large })),
      verification_hints: many(4, index => ({ reason: 'formula' as const, block_id: 'mr_fixture:b' + String(index + 1), view: 'page' as const })),
      warnings: many(8, index => 'warning-' + String(index) + '-' + large),
      ordered_images: many(4, index => imageCandidate({ path: '/cache/' + large + String(index) + '.png', caption: large })),
    })) } })
    const value = await h.read({ file_path: 'paper.pdf' })
    expect(value.metadata_shortened).toContain('summary')
    expect(value.summary).toBeUndefined()
    expect(fitsReadBudget(value)).toBe(true)
    expect(validateJsonSchemaValue(h.tool('read_pdf').output.schema, value, 'value')).toEqual([])
    const [text] = renderResult(value)
    expect(text).toMatchObject({ type: 'text' })
    expect(text?.type === 'text' && text.text.length).toBeLessThanOrEqual(value.output_limit_chars)
    expect(JSON.stringify(text)).not.toContain('[RESULT_TOO_LARGE]')
  })
})

describe('read_pdf presentation metadata', () => {
  it('is pure, deterministic, lossless JSON of counts and ids below 2 KiB for a maximal value', async () => {
    const h = await toolHarness()
    const meta = h.tool('read_pdf').output.presentationMeta!
    const value = deepFreeze(jsonValue(maximalResultView()))
    const first = meta({}, value)
    expect(meta({}, value)).toEqual(first)
    expect(isJsonValue(first)).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(2048)
    expect(first).toMatchObject({
      result_id: 'mr_maximal', file_ids: ['mf_maximal'], content_status: 'partial', has_more: true, renderer: 'pdfjs',
      counts: { files: 1, artifacts: 100, images: 100, attachments: 100, headings: 100, diagnostics: 100, warnings: 100 },
    })
    expect(JSON.stringify(first)).not.toContain('Evidence')
    expect(JSON.stringify(first)).not.toContain('opaque-cursor')
    expect(JSON.stringify(first)).not.toContain('/cache/')
  })

  it.each([['complete', null], ['not_requested', null], ['partial', 'opaque-token']] as const)(
    'reports has_more only for a non-null cursor (%s)', async (content_status, cursor) => {
      const h = await toolHarness({ reader: { readContent: projectedReader(() => resultView({ files: [resultFile()], content_status, cursor })) } })
      const value = await h.read({ file_path: 'paper.pdf' })
      expect(value.cursor).toBe(cursor)
      expect(h.tool('read_pdf').output.presentationMeta!({}, jsonValue(value))).toMatchObject({ has_more: cursor !== null })
    })
})

describe('async_parse_pdf submission', () => {
  it('snapshots config at submission and summarizes the resolved path in the job', async () => {
    let maxInlineChars = 1000
    const summarize = vi.fn(async () => ({ ...resultView({ content_status: 'not_requested' }) }))
    const h = await toolHarness({ config: () => withOutput({ maxInlineChars }), reader: { summarize } })
    const id = await h.submit({ file_path: 'paper.pdf' })
    maxInlineChars = 5000
    await h.ctx.jobs.wait(id, 1000, h.session.id)
    expect(summarize).toHaveBeenCalledWith('/workspace/paper.pdf', expect.objectContaining({ output: expect.objectContaining({ maxInlineChars: 1000 }) }), expect.any(AbortSignal), expect.any(Function))
    expect(defaultMinerUConfig().output.maxInlineChars).not.toBe(1000)
  })
})
