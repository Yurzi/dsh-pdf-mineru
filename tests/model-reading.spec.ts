import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import type { MinerUResultManifest } from '../src/domain/result.js'
import { MAX_MODEL_MARKDOWN_CHARS, MAX_MODEL_RESPONSE_BYTES, fitsReadBudget } from '../src/reader/read-delivery.js'
import { decodeReadCursor } from '../src/reader/read-cursor.js'
import type { ContentListBlock, ResultView } from '../src/reader/views.js'
import { readerHarness, recordingImageSink, type ReaderHarness } from './support/reader-harness.js'
import { toolHarness, type ToolHarnessOptions } from './support/tool-harness.js'

/** read_pdf through the real tool adapter over the harness reader (image-capable route by default). */
async function readTool(h: ReaderHarness, options: ToolHarnessOptions = {}) {
  return await toolHarness({ reader: { readContent: h.reader.readContent.bind(h.reader) }, config: () => h.config, imageModel: true, ...options })
}

/** Validates views against the compiled read_pdf output schema. */
async function schemaValidator(h: ReaderHarness): Promise<(view: ResultView) => string[]> {
  const schema = (await readTool(h)).tool('read_pdf').output.schema
  return view => validateJsonSchemaValue(schema, view, 'value')
}

/** Follow cursors to completion, bounded so a cycling cursor fails deterministically. */
async function readAll(h: ReaderHarness, first: ResultView): Promise<ResultView[]> {
  const views = [first]
  for (let view = first; view.cursor; ) {
    if (views.length > 50) throw new Error('cursor did not terminate')
    view = await h.read({ cursor: view.cursor })
    views.push(view)
  }
  return views
}

const longText = (label: string, words: number): string => label + ' ' + 'filler '.repeat(words)

describe('read_pdf source adaptation and cache-only continuation', () => {
  it('serves file_path and attachment_id reads from one result and continues by attachment', async () => {
    const h = await readerHarness()
    h.provider.contentList = [{ type: 'text', page_idx: 0, text: longText('Attachment integration.', 2500) }]
    const bytes = await readFile(h.file)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const t = await readTool(h, { files: [{ attachmentId: AttachmentId('sha256:' + sha256), name: 'input.pdf', bytes: bytes.byteLength }] })
    t.fileHostPath.mockReturnValue(h.file)
    const attachment_id = 'sha256:' + sha256.slice(0, 8)

    const initial = await t.read({ attachment_id, inline_images: false })
    expect(initial).toMatchObject({ content_status: 'partial', source_sha256: sha256 })
    const byPath = await t.read({ file_path: h.file, inline_images: false })
    expect(byPath).toMatchObject({ result_id: initial.result_id, cache_hit: true, markdown_content: initial.markdown_content })
    const next = await t.read({ attachment_id, cursor: initial.cursor })
    expect(next).toMatchObject({ result_id: initial.result_id, cache_hit: true })
    expect(next.markdown_content!.length).toBeGreaterThan(0)
    expect(h.provider.submitCount).toBe(1)
  })

  it('fails a continuation with CACHE_EVICTED and never starts a Provider when the result is gone', async () => {
    const h = await readerHarness()
    h.provider.contentList = [{ type: 'text', page_idx: 0, text: longText('Eviction.', 2500) }]
    const initial = await h.read()
    expect(initial.content_status).toBe('partial')
    vi.spyOn(h.results, 'get').mockResolvedValue(undefined)
    await expect(h.read({ cursor: initial.cursor })).rejects.toMatchObject({ failure: { code: 'CACHE_EVICTED' } })
    expect(h.provider.submitCount).toBe(1)
    expect(h.operations.reserved).toHaveLength(1)
  })

  it('rejects a continuation whose projection artifacts changed under the same result id', async () => {
    const h = await readerHarness()
    h.provider.contentList = [{ type: 'text', page_idx: 0, text: longText('Projection.', 2000) }]
    const initial = await h.read()
    const original = h.results.get.bind(h.results)
    vi.spyOn(h.results, 'get').mockImplementation(async (...args): Promise<MinerUResultManifest | undefined> => {
      const manifest = await original(...args)
      if (manifest === undefined) return undefined
      const [file] = manifest.files
      return { ...manifest, files: [{ ...file, artifacts: file.artifacts.map(item => item.kind === 'content-list' ? { ...item, sha256: '0'.repeat(64) } : item) }] }
    })
    await expect(h.read({ cursor: initial.cursor })).rejects.toMatchObject({
      failure: { code: 'INVALID_REQUEST', message: expect.stringContaining('Cursor projection changed or expired') },
    })
  })
})

describe('compact model view', () => {
  it('returns a schema-valid compact view without default paths or a repeated toc', async () => {
    const h = await readerHarness()
    h.provider.contentList = [
      { type: 'text', page_idx: 0, text: 'First paragraph of introduction.' },
      { type: 'text', page_idx: 1, text: 'Second paragraph on page 2.' },
    ]
    const result = await h.read()
    expect(result.files).toEqual([{ file_id: expect.stringMatching(/^mf_/), name: 'input.pdf', artifacts: [] }])
    expect(result.source_sha256).toMatch(/^[a-f0-9]{64}$/)
    for (const key of ['manifest_path', 'markdown_path', 'toc']) expect(result).not.toHaveProperty(key)
    expect(result.summary).toMatchObject({ page_count: 2, page_count_source: 'content-list-lower-bound' })
    expect(result.summary).not.toHaveProperty('toc')
    expect((await schemaValidator(h))(result)).toEqual([])
  })

  it('caps body chunks and response bytes regardless of a large configured character budget', async () => {
    const h = await readerHarness({ output: { maxInlineChars: 200_000 } })
    h.provider.contentList = Array.from({ length: 10 }, (_, index) => ({ type: 'text', page_idx: index, text: longText('Paragraph ' + String(index + 1) + ':', 350) }))
    const result = await h.read()
    expect(result.content_status).toBe('partial')
    expect(result.markdown_content!.length).toBeLessThanOrEqual(MAX_MODEL_MARKDOWN_CHARS)
    expect(fitsReadBudget(result)).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(MAX_MODEL_RESPONSE_BYTES)
    const cursor = decodeReadCursor(result.cursor!)
    expect(cursor).toMatchObject({ rid: result.result_id, inline_images: true })
    expect(cursor.off).toBeGreaterThan(0)
  })

  it('validates every result variant against the native output schema', async () => {
    const h = await readerHarness()
    h.provider.contentList = [
      { type: 'text', page_idx: 0, text: 'Schema validation content.' },
      { type: 'image', page_idx: 0, caption: 'Figure 1: Diagram', img_path: 'images/img1.png' },
    ]
    h.provider.images = [{ relativeName: 'images/img1.png' }]
    const { sink } = recordingImageSink()
    const withImages = await h.read({}, { images: sink })
    expect(withImages.inlined_images).toHaveLength(1)
    const variants = [withImages, await h.read({ query: 'Schema' }), await h.read({ block_id: withImages.result_id + ':b1' }), await h.read({ focus: 'artifacts' })]
    const schemaViolations = await schemaValidator(h)
    for (const view of variants) expect(schemaViolations(view)).toEqual([])
  })
})

describe('block identity and projection', () => {
  it('assigns stable 1-based block IDs that page filtering never renumbers', async () => {
    const h = await readerHarness()
    h.provider.contentList = [
      { type: 'text', page_idx: 0, text: 'Introduction block.' },
      { type: 'image', page_idx: 0, caption: 'Figure 1: Pipeline diagram', img_path: 'images/fig1.png' },
      { type: 'table', page_idx: 1, caption: 'Table 1: Benchmark scores', table_body: '<table></table>' },
      { type: 'text', page_idx: 1, text: 'Conclusion block.' },
    ]
    const result = await h.read()
    const rid = result.result_id
    for (const marker of [':b1 · Page 1]', ':b2 · Page 1 · Figure 1]', ':b3 · Page 2 · Table 1]', ':b4 · Page 2]']) {
      expect(result.markdown_content).toContain('[' + rid + marker)
    }
    const page2 = await h.read({ pages: 2 })
    expect(page2.markdown_content).not.toMatch(new RegExp('\\[' + rid + ':b[12] '))
    expect(page2.markdown_content).toContain('[' + rid + ':b3 · Page 2 · Table 1]')
    expect(page2.markdown_content).toContain('[' + rid + ':b4 · Page 2]')
  })

  it('labels figures by their document label, not by attachment ordinal', async () => {
    const h = await readerHarness()
    h.provider.contentList = [
      { type: 'image', page_idx: 0, caption: 'Figure 5: Model architecture overview', img_path: 'images/f5.png' },
      { type: 'image', page_idx: 0, caption: 'Ablation plot without standard label', img_path: 'images/f6.png' },
    ]
    const result = await h.read()
    expect(result.markdown_content).toContain('> Figure 5 (Page 1)')
    expect(result.markdown_content).toContain('> Image (Page 1)')
    expect(result.markdown_content).not.toMatch(/> Figure [12] /)
    expect(result.ordered_images).toEqual([
      expect.objectContaining({ document_label: 'Figure 5', block_id: result.result_id + ':b1' }),
      expect.not.objectContaining({ document_label: expect.anything() }),
    ])
    expect(result.ordered_images![1]!.block_id).toBe(result.result_id + ':b2')
  })

  it('normalizes nested lines.spans with inline and display math and code', async () => {
    const h = await readerHarness()
    h.provider.contentList = [
      { type: 'text', page_idx: 0, lines: [
        { spans: [{ type: 'text', content: '已知连续函数 ' }, { type: 'inline_equation', content: 'f(x) \\in C^1([0, 1])' }, { type: 'text', content: ' 满足 ' }, { type: 'inline_equation', content: 'f(0) = 0' }, { type: 'text', content: '。' }] },
        { spans: [{ type: 'text', content: '积分界限：' }, { type: 'inline_equation', content: '\\alpha \\le x \\le \\beta' }] },
      ] },
      { type: 'equation', page_idx: 0, caption: '(3) 积分表达式', lines: [{ spans: [{ type: 'equation', content: "\\int_0^1 (f'(x))^2 dx \\ge \\pi^2 \\int_0^1 f(x)^2 dx" }] }] },
      { type: 'code', page_idx: 0, language: 'typescript', lines: [{ spans: [{ type: 'code', content: 'export const norm = (v: number[]): number => Math.hypot(...v);' }] }] },
    ]
    const text = (await h.read()).markdown_content
    expect(text).toContain('已知连续函数 $f(x) \\in C^1([0, 1])$ 满足 $f(0) = 0$。')
    expect(text).toContain('积分界限：$\\alpha \\le x \\le \\beta$')
    expect(text).toContain("$$\\int_0^1 (f'(x))^2 dx \\ge \\pi^2 \\int_0^1 f(x)^2 dx$$")
    expect(text).toContain('```typescript\nexport const norm = (v: number[]): number => Math.hypot(...v);\n```')
    expect(text).not.toContain('[object Object]')
  })

  it('continues long multi-block text exactly, including literal [mr_ text and mid-block continuation markers', async () => {
    const h = await readerHarness({ output: { maxInlineChars: 200_000 } })
    const literal = 'Sample text with literal [mr_fake_identifier and more [mr_unclosed text. '
    h.provider.contentList = [
      { type: 'text', page_idx: 0, text: literal + 'Word 🚀 '.repeat(2000) },
      { type: 'equation', page_idx: 0, text: '\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}' },
      { type: 'text', page_idx: 1, text: '评估指标与性能分析 📊 ' + '准确率与召回率显著提升。'.repeat(250) },
    ]
    const views = await readAll(h, await h.read())
    expect(views.length).toBeGreaterThan(2)
    expect(views[0]!.continuation_block).toBeUndefined()
    expect(views[1]!.continuation_block).toMatchObject({ block_id: views[0]!.result_id + ':b1', page: 1 })
    for (const view of views) {
      expect(view.markdown_content!.length).toBeLessThanOrEqual(MAX_MODEL_MARKDOWN_CHARS)
      expect(view.markdown_content).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/)
    }
    expect(views.at(-1)).toMatchObject({ content_status: 'complete', cursor: null })
    const full = views.map(view => view.markdown_content).join('')
    for (const expected of [literal, '\\sqrt{\\pi}', '评估指标与性能分析 📊']) expect(full).toContain(expected)
  })

  it('keeps long outline headings complete and attributable across chunks', async () => {
    const h = await readerHarness()
    const title = 'Long heading ' + 'x'.repeat(12000)
    h.provider.contentList = [{ type: 'text', text_level: 1, text: title, page_idx: 0 }]
    const views = await readAll(h, await h.read({ focus: 'toc' }))
    const id = views[0]!.result_id + ':b1'
    expect(views[0]!.content_status).toBe('partial')
    for (const view of views.slice(1)) expect(view.continuation_block?.block_id).toBe(id)
    expect(views.map(view => view.markdown_content ?? '').join('')).toBe('# Document Outline\n\n- ' + title + ' (Page 1) [' + id + ']')
  })
})

describe('search and exact block reads', () => {
  const blocks: ContentListBlock[] = [
    { type: 'text', page_idx: 0, text: 'The self-attention mechanism enables capturing long-range dependencies.' },
    { type: 'text', page_idx: 0, text: 'Convolutional neural networks excel at spatial hierarchy feature learning.' },
    { type: 'text', page_idx: 1, text: 'Attention weights are computed through query and key matrix multiplications.' },
  ]

  it('returns case-insensitive literal hits with block IDs and snippets', async () => {
    const h = await readerHarness()
    h.provider.contentList = blocks
    const result = await h.read({ query: 'attention' })
    const rid = result.result_id
    expect(result.markdown_content).toContain('[' + rid + ':b1 · Page 1]')
    expect(result.markdown_content).toContain('[' + rid + ':b3 · Page 2]')
    expect(result.markdown_content).not.toContain('Convolutional')
    expect((await h.read({ query: 'SELF-ATTENTION' })).markdown_content).toContain('[' + rid + ':b1 · Page 1]')
  })

  it('reports a search miss as complete content without a cursor', async () => {
    const h = await readerHarness()
    h.provider.contentList = blocks
    const result = await h.read({ query: 'quantum teleportation' })
    expect(result).toMatchObject({ content_status: 'complete', cursor: null })
    expect(result.markdown_content).toContain('No literal matches')
  })

  it('locates an exact literal after case-fold-expanding Unicode without shifting snippets', async () => {
    const h = await readerHarness()
    h.provider.contentList = [{ type: 'text', page_idx: 0, text: 'İ'.repeat(100) + 'Needle[a+b]' + 'tail'.repeat(200) }]
    expect((await h.read({ query: 'needle[a+b]' })).markdown_content).toContain('Needle[a+b]')
  })

  it('restores the query selection from a continuation cursor alone', async () => {
    const h = await readerHarness({ output: { maxInlineChars: 200_000 } })
    h.provider.contentList = Array.from({ length: 25 }, (_, index) => ({ type: 'text', page_idx: 0, text: 'Block ' + String(index + 1) + ' query hit attention mechanism. ' + 'detail '.repeat(70) }))
    const initial = await h.read({ query: 'attention' })
    expect(initial.content_status).toBe('partial')
    expect(decodeReadCursor(initial.cursor!).query).toBe('attention')
    expect((await h.read({ cursor: initial.cursor })).markdown_content).toContain('attention')
  })

  it('reads exactly one block by ID', async () => {
    const h = await readerHarness()
    h.provider.contentList = blocks
    const first = await h.read()
    const block = await h.read({ block_id: first.result_id + ':b2' })
    expect(block.markdown_content).toContain('[' + first.result_id + ':b2 · Page 1]')
    expect(block.markdown_content).toContain('Convolutional')
    expect(block.markdown_content).not.toMatch(/self-attention|Attention weights/)
  })

  it.each([
    { name: 'another result', block: () => 'mr_foreignresult12345:b1', pages: undefined, message: 'does not belong to the current parsed result' },
    { name: 'an out-of-range index', block: (rid: string) => rid + ':b9999', pages: undefined, message: 'does not belong to the current parsed result' },
    { name: 'a block outside the requested pages', block: (rid: string) => rid + ':b1', pages: 2, message: 'outside the requested pages/focus' },
  ])('rejects a block_id from $name', async ({ block, pages, message }) => {
    const h = await readerHarness()
    h.provider.contentList = blocks
    const { result_id } = await h.read()
    await expect(h.read({ block_id: block(result_id), ...(pages === undefined ? {} : { pages }) }))
      .rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST', message: expect.stringContaining(message) } })
  })
})

describe('page coordinates', () => {
  it('fails page-filtered reads closed when some text has no page, while block reads still work', async () => {
    const h = await readerHarness()
    h.provider.contentList = [
      { type: 'text', page_idx: 0, text: 'Located content on page 1.' },
      { type: 'text', text: 'Unlocated content without page_idx.' },
    ]
    await expect(h.read({ pages: 1 })).rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST', message: expect.stringContaining('[SELECTION_UNAVAILABLE]') } })
    const { result_id } = await h.read()
    expect((await h.read({ block_id: result_id + ':b2' })).markdown_content).toContain('Unlocated content without page_idx.')
  })

  it('treats content-list page counts as a lower bound rather than a false out-of-range', async () => {
    const h = await readerHarness()
    h.provider.contentList = [{ type: 'text', page_idx: 0, text: 'Single page document.' }]
    const result = await h.read({ pages: 5 })
    expect(result).toMatchObject({ pages: '5', summary: { page_count: 1, page_count_source: 'content-list-lower-bound' } })
    expect(result.warnings?.some(warning => warning.includes('[PAGE_COUNT_LOWER_BOUND]'))).toBe(true)
  })

  it.each([['all', 'text'], ['all', 'artifacts']] as const)('continues a partial read with focus %j from the cursor', async (...focus) => {
    const h = await readerHarness({ output: { maxInlineChars: 200_000 } })
    h.provider.contentList = Array.from({ length: 8 }, (_, index) => ({ type: 'text', page_idx: 0, text: longText('Section ' + String(index) + ':', 250) }))
    const first = await h.read({ focus })
    expect(first.content_status).toBe('partial')
    expect(decodeReadCursor(first.cursor!).focus).toEqual(focus)
    expect((await h.read({ cursor: first.cursor })).markdown_content!.length).toBeGreaterThan(0)
  })
})

describe('inline image intent', () => {
  const imageDocument = (h: ReaderHarness, count: number, words: number): void => {
    h.provider.images = Array.from({ length: count }, (_, index) => ({ relativeName: 'images/i' + String(index) + '.png' }))
    h.provider.contentList = h.provider.images.flatMap((image, index): ContentListBlock[] => [
      { type: 'image', page_idx: index, caption: 'Figure ' + String(index + 1) + ': Image', img_path: image.relativeName },
      { type: 'text', page_idx: index, text: longText('Chunk filler ' + String(index) + '.', words) },
    ])
  }

  it('reports omitted images in a batch and never repeats candidates across chunks', async () => {
    const h = await readerHarness({ output: { maxInlineImages: 2 } })
    imageDocument(h, 6, 0)
    const { sink, saved } = recordingImageSink()
    const result = await h.read({}, { images: sink })
    expect(result.visuals).toEqual({ listed: 6, attached: 2, omitted: 4, scope: 'chunk' })
    expect(saved).toHaveLength(2)
    expect(result.warnings?.some(warning => warning.includes('[VISUALS_NOT_ATTACHED]'))).toBe(true)

    const chunked = await readerHarness({ output: { maxInlineImages: 5 } })
    chunked.provider.images = [{ relativeName: 'images/first.png' }, { relativeName: 'images/second.png' }]
    chunked.provider.contentList = [
      { type: 'image', page_idx: 0, caption: 'Figure 1: First', img_path: 'images/first.png' },
      { type: 'text', page_idx: 0, text: 'Long filler paragraph. '.repeat(450) },
      { type: 'image', page_idx: 1, caption: 'Figure 2: Second', img_path: 'images/second.png' },
    ]
    const first = await chunked.read({}, { images: sink })
    expect(first.content_status).toBe('partial')
    expect(first.ordered_images?.map(image => image.name)).toEqual([expect.stringContaining('first')])
    const second = await chunked.read({ cursor: first.cursor }, { images: sink })
    expect(second.ordered_images?.map(image => image.name)).toEqual([expect.stringContaining('second')])
  })

  it('keeps explicit false intent across several cursor-only chunks', async () => {
    const h = await readerHarness()
    imageDocument(h, 5, 800)
    const t = await readTool(h)
    let view = await t.read({ file_path: h.file, inline_images: false })
    let chunks = 0
    let listed = 0
    for (; ; view = await t.read({ file_path: h.file, cursor: view.cursor })) {
      chunks++
      listed += view.ordered_images?.length ?? 0
      expect(view.inlined_images).toBeUndefined()
      if (!view.cursor) break
      expect(decodeReadCursor(view.cursor).inline_images).toBe(false)
    }
    expect(chunks).toBeGreaterThanOrEqual(4)
    expect(listed).toBe(5)
    expect(t.saveImage).not.toHaveBeenCalled()
  })

  it('persists explicit true and false overrides into each next cursor', async () => {
    const h = await readerHarness()
    imageDocument(h, 7, 900)
    const t = await readTool(h)
    const off = await t.read({ file_path: h.file, inline_images: false })
    expect(decodeReadCursor(off.cursor!).inline_images).toBe(false)
    expect(t.saveImage).not.toHaveBeenCalled()

    const on = await t.read({ file_path: h.file, cursor: off.cursor, inline_images: true })
    expect(decodeReadCursor(on.cursor!).inline_images).toBe(true)
    const savedAfterOn = t.saveImage.mock.calls.length
    expect(savedAfterOn).toBeGreaterThan(0)

    const offAgain = await t.read({ file_path: h.file, cursor: on.cursor, inline_images: false })
    expect(decodeReadCursor(offAgain.cursor!).inline_images).toBe(false)
    expect(t.saveImage).toHaveBeenCalledTimes(savedAfterOn)
  })

  it.each([
    { name: 'text-only model', maxInlineImages: 6, options: { imageModel: false } },
    { name: 'missing attachment store', maxInlineImages: 6, options: { attachments: false } },
    { name: 'zero image budget', maxInlineImages: 0, options: {} },
  ] satisfies { name: string; maxInlineImages: number; options: ToolHarnessOptions }[])('keeps true cursor intent when $name suppresses attachments', async ({ maxInlineImages, options }) => {
    const h = await readerHarness({ output: { maxInlineImages } })
    imageDocument(h, 1, 3500)
    const t = await readTool(h, options)
    const first = await t.read({ file_path: h.file, inline_images: true })
    expect(decodeReadCursor(first.cursor!).inline_images).toBe(true)
    expect(first.inlined_images).toBeUndefined()
    const next = await t.read({ file_path: h.file, cursor: first.cursor })
    if (next.cursor) expect(decodeReadCursor(next.cursor).inline_images).toBe(true)
    expect(t.saveImage).not.toHaveBeenCalled()
  })
})
