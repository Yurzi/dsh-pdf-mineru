import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { testPng } from './fixtures/png.js'
import { jsonValue } from './support/views.js'

const { renderPageRoute } = vi.hoisted(() => ({ renderPageRoute: vi.fn() }))
vi.mock('../src/reader/page/page-renderer.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/reader/page/page-renderer.js')>()),
  renderPdfPage: renderPageRoute,
}))

import type { ReaderService } from '../src/reader/reader-service.js'
import { createPdfPageRenderer, type PdfPageProcessRunner } from '../src/reader/page/page-renderer.js'
import { ReaderService as RealReaderService } from '../src/reader/reader-service.js'
import { toolHarness, withOutput } from './support/tool-harness.js'

type ReaderDependencies = ConstructorParameters<typeof ReaderService>[0]

/** Page view must never touch parsing or storage: every access to those dependencies fails the test. */
function forbidden<K extends keyof ReaderDependencies>(name: K): ReaderDependencies[K] {
  return new Proxy(Object.create(null) as ReaderDependencies[K], { get: () => { throw new Error(name + ' must not be used by page view') } })
}

function pageReader() {
  const reader = new RealReaderService({ parser: forbidden('parser'), results: forbidden('results'), accessGate: forbidden('accessGate') })
  return { viewPage: reader.viewPage.bind(reader), readContent: vi.fn<ReaderService['readContent']>(async () => { throw new Error('Provider parsing must not run') }) }
}

async function harness(options: { image?: boolean; budget?: number; maxFileBytes?: number } = {}) {
  const config = withOutput({ maxInlineChars: 12_000, maxInlineImages: options.budget ?? 6 })
  return await toolHarness({
    imageModel: options.image ?? true, reader: pageReader(),
    config: () => ({ ...config, limits: { ...config.limits, maxFileBytes: options.maxFileBytes ?? config.limits.maxFileBytes } }),
  })
}

describe('original-page tool contract', () => {
  it('renders locally and delivers a schema-valid page attachment without parsing', async () => {
    renderPageRoute.mockResolvedValue({ name: 'paper.pdf', page: 2, page_count: 3, sha256: 'a'.repeat(64), renderer: 'pdfjs', data: new Uint8Array([1]), media_type: 'image/png' })
    const h = await harness()
    const args = { file_path: '/paper.pdf', view: 'page', pages: 2, expected_sha256: 'a'.repeat(64) }
    const result = await h.read(args)
    expect(renderPageRoute).toHaveBeenCalledWith({ file_path: '/paper.pdf', page: 2, expectedSha256: 'a'.repeat(64), maxFileBytes: expect.any(Number), signal: expect.any(AbortSignal) })
    expect(h.reader.readContent).not.toHaveBeenCalled()
    const tool = h.tool('read_pdf')
    expect(validateJsonSchemaValue(tool.output.schema, result, 'value')).toEqual([])
    expect(result).toMatchObject({
      view: 'page', source: 'local', renderer: 'pdfjs', source_sha256: 'a'.repeat(64), content_status: 'not_requested', cursor: null,
      summary: { page_count: 3, page_count_source: 'pdfjs' }, visuals: { listed: 1, attached: 1, omitted: 0 },
    })
    expect(tool.output.presentationMeta!(args, jsonValue(result))).toMatchObject({ renderer: 'pdfjs', counts: { attachments: 1 } })
    expect(tool.output.render(args, jsonValue(result)).map(block => block.type)).toEqual(['text', 'image'])
  })

  it('reaches the real PDF.js fallback through the reader/tool chain when Poppler is unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mineru-page-tool-fallback-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const source = join(root, 'fixture.pdf')
    await writeFile(source, '%PDF-1.7\nfixture\n%%EOF\n')
    const png = testPng(800, 1000)
    const runProcess: PdfPageProcessRunner = async request => {
      if (request.command === 'pdfinfo') throw Object.assign(new Error('not installed'), { code: 'ENOENT' })
      expect(request.command).toBe('pdfjs')
      await writeFile(request.args.at(-3)!, png)
      return { exitCode: 0, signal: null, stdout: Buffer.from('{"page_count":1}'), stderr: Buffer.alloc(0) }
    }
    renderPageRoute.mockImplementation(createPdfPageRenderer({ runProcess, temporaryRoot: root }))
    const h = await harness({ budget: 1, maxFileBytes: 1024 * 1024 })
    const value = await h.read({ file_path: source, view: 'page', pages: 1 })
    expect(validateJsonSchemaValue(h.tool('read_pdf').output.schema, value, 'value')).toEqual([])
    expect(value).toMatchObject({ renderer: 'pdfjs', summary: { page_count: 1, page_count_source: 'pdfjs' } })
  })

  it.each([{ image: false }, { budget: 0 }])('fails with UNSUPPORTED_OPTION before rendering when the route/budget disallows images: %j', async options => {
    const h = await harness(options)
    await expect(h.read({ file_path: '/paper.pdf', view: 'page', pages: 2 })).rejects.toMatchObject({ failure: { code: 'UNSUPPORTED_OPTION' } })
    expect(renderPageRoute).not.toHaveBeenCalled()
  })

  it.each([{}, { pages: '1-2' }, { pages: 2, focus: 'text' }, { pages: 2, cursor: 'abc' }, { pages: 2, query: 'test' }, { pages: 2, inline_images: false }, { pages: 2, expected_sha256: 'bad' }])(
    'rejects unsupported page selections/options before rendering: %j', async extra => {
      const h = await harness()
      await expect(h.read({ file_path: '/paper.pdf', view: 'page', ...extra })).rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
      expect(renderPageRoute).not.toHaveBeenCalled()
    })
})
