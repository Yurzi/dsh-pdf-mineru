import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { testPng } from './fixtures/png.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'

const { renderPageRoute } = vi.hoisted(() => ({ renderPageRoute: vi.fn() }))
vi.mock('../src/service/page-renderer.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/service/page-renderer.js')>()),
  renderPdfPage: renderPageRoute,
}))

import { createPdfPageRenderer, type PdfPageProcessRunner } from '../src/service/page-renderer.js'
import { MinerUService } from '../src/service/mineru-service.js'
import { parseReadInput, registerTools } from '../src/tools.js'

function harness(options: { image?: boolean; budget?: number } = {}) {
  const previewPage = vi.fn(async () => ({ name: 'paper.pdf', page: 2, page_count: 3, sha256: 'a'.repeat(64), renderer: 'pdfjs' as const, data: new Uint8Array([1]), media_type: 'image/png' as const, result_id: 'mr_page_test_2', file_id: 'mf_test', output_limit_chars: 12000 }))
  const parseDocument = vi.fn(() => { throw new Error('Provider parsing must not run') })
  const saveImage = vi.fn(async () => ({ attachmentId: 'sha256:' + 'b'.repeat(64), name: 'page-2.png', mediaType: 'image/png', bytes: 1, width: 1200, height: 1600 }))
  let tool: any
  const ctx = { tools: { register(t: any) { if (t.name === 'read_pdf') tool = t; return () => undefined } }, get(name: string) { if (name === 'llm') return { resolveModelInfo: async () => ({ inputModalities: options.image === false ? ['text'] : ['text', 'image'] }) }; if (name === 'attachments') return { saveImage }; return undefined } } as any
  registerTools(ctx, () => ({ previewPage, parseDocument }) as any, undefined, () => ({ maxInlineChars: 12000, maxInlineImages: options.budget ?? 6 }))
  const exec = { signal: new AbortController().signal, agent: { options: { provider: 'mock', model: 'vision' }, session: { header: { id: 'page-test', cwd: '/workspace' } } } } as any
  return { tool, exec, previewPage, parseDocument, saveImage }
}

describe('original-page tool contract', () => {
  it('uses only local preview and delivers a validated original-page attachment', async () => {
    const h = harness()
    const args = { file_path: '/paper.pdf', view: 'page', pages: 2, expected_sha256: 'a'.repeat(64) }
    const result = await h.tool.execute(args, h.exec)
    expect(h.previewPage).toHaveBeenCalledWith(h.exec.agent.session, { file_path: '/paper.pdf', page: 2, expectedSha256: 'a'.repeat(64) }, h.exec.signal)
    expect(h.parseDocument).not.toHaveBeenCalled()
    expect(validateJsonSchemaValue(h.tool.output.schema, result, 'value')).toEqual([])
    expect(result).toMatchObject({ view: 'page', source: 'local', renderer: 'pdfjs', source_sha256: 'a'.repeat(64), content_status: 'not_requested', cursor: null, summary: { page_count: 3, page_count_source: 'pdfjs' }, visuals: { listed: 1, attached: 1, omitted: 0 } })
    expect(h.tool.output.presentationMeta(args, result)).toMatchObject({ renderer: 'pdfjs', summary: { page_count: 3, page_count_source: 'pdfjs' } })
    const rendered = h.tool.output.render(args, result)
    expect(rendered.map((block: any) => block.type)).toEqual(['text', 'image'])
    expect(rendered[0].text).toContain('Original PDF Page 2')
    expect(rendered[0].text).toContain('(pdfjs)')
    expect(rendered[0].text).not.toContain('Content complete')
  })
  it('routes an unavailable Poppler environment through real fallback and the service/tool chain', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mineru-page-tool-fallback-'))
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
    const service = new MinerUService({
      getConfig: () => ({ limits: { maxFileBytes: 1024 * 1024 }, output: { maxInlineChars: 12000 } }),
    } as any)
    let tool: any
    const ctx = {
      tools: { register(definition: any) { if (definition.name === 'read_pdf') tool = definition; return () => undefined } },
      get(name: string) {
        if (name === 'llm') return { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }) }
        if (name === 'attachments') return { saveImage: async ({ data, mediaType, name }: any) => ({ attachmentId: 'sha256:' + 'c'.repeat(64), mediaType, name, bytes: data.byteLength, width: 800, height: 1000 }) }
        return undefined
      },
    } as any
    const dispose = registerTools(ctx, () => service, undefined, () => ({ maxInlineChars: 12000, maxInlineImages: 1 }))
    const exec = { signal: new AbortController().signal, agent: { options: { provider: 'mock', model: 'vision' }, session: { header: { id: 'fallback-chain', cwd: root } } } } as any
    try {
      const value = await tool.execute({ file_path: source, view: 'page', pages: 1 }, exec)
      expect(validateJsonSchemaValue(tool.output.schema, value, 'value')).toEqual([])
      expect(value).toMatchObject({ renderer: 'pdfjs', summary: { page_count: 1, page_count_source: 'pdfjs' } })
      expect(tool.output.render({}, value)[0].text).toContain('(pdfjs)')
    } finally {
      await dispose()
      renderPageRoute.mockReset()
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each([{ image: false }, { budget: 0 }])('fails before reading when the image route/budget disallows preview: %j', async options => {
    const h = harness(options)
    await expect(h.tool.execute({ file_path: '/paper.pdf', view: 'page', pages: 2 }, h.exec)).rejects.toMatchObject({ failure: { code: 'UNSUPPORTED_OPTION' } })
    expect(h.previewPage).not.toHaveBeenCalled()
  })
  it('requires a live session, not just an agent-shaped object', async () => {
    const h = harness()
    await expect(h.tool.execute({ file_path: '/paper.pdf', view: 'page', pages: 2 }, { ...h.exec, agent: {} })).rejects.toMatchObject({ failure: { code: 'UNAUTHENTICATED_SESSION' } })
  })
  it.each([{}, { pages: '1-2' }, { pages: 2, focus: 'text' }, { pages: 2, cursor: 'abc' }, { pages: 2, query: 'test' }, { pages: 2, inline_images: false }, { pages: 2, expected_sha256: 'bad' }])('rejects unsupported page selections/options: %j', extra => {
    expect(() => parseReadInput({ file_path: '/paper.pdf', view: 'page', ...extra })).toThrow()
  })
})
