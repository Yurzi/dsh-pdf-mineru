import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentId, type FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createUserMessage, type Message } from '@deepseek-ai/dsh-llm'
import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { MinerUService, ResultView } from '../src/service/mineru-service.js'
import { registerTools } from '../src/tools.js'
import { cursorForRemainder } from '../src/service/read-cursor.js'

const ref: FileAttachmentRef = { attachmentId: AttachmentId('sha256:' + 'a'.repeat(64)), name: 'paper.pdf', bytes: 100 }
const hostPath = '/dsh-owned/paper.pdf'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })

function harness(options: { missingStore?: boolean; missingPath?: boolean } = {}) {
  let messages: readonly Message[] = [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'file', attachment: ref }] })]
  const session = { header: { id: 'attachment-tools', cwd: '/workspace' }, deriveMessages: () => messages }
  const exec = { callId: 'attachment-call', name: 'read_pdf', arguments: {}, signal: new AbortController().signal, agent: { options: { provider: 'mock', model: 'vision' }, session } } as unknown as ToolRunContext
  const result: ResultView = { state: 'completed', source: 'cache', cache_hit: true, result_id: 'mr_attachment', files: [{ file_id: 'mf_attachment', name: 'paper.pdf', artifacts: [] }], content_status: 'complete', cursor: null, output_limit_chars: 12000 }
  const parseDocument = vi.fn(async () => result)
  const ensureParsed = vi.fn(async () => ({ ...result, content_status: 'not_requested' as const }))
  const previewPage = vi.fn(async () => ({ name: 'paper.pdf', page: 2, page_count: 3, sha256: 'a'.repeat(64), renderer: 'pdfjs' as const, data: new Uint8Array([1]), media_type: 'image/png' as const, result_id: 'mr_page_attachment_2', file_id: 'mf_attachment', output_limit_chars: 12000 }))
  const store = { fileHostPath: vi.fn(() => options.missingPath ? undefined : hostPath), saveImage: vi.fn(async () => ({ attachmentId: AttachmentId('sha256:' + 'b'.repeat(64)), name: 'page-2.png', mediaType: 'image/png', bytes: 1, width: 10, height: 10 })) }
  const jobSpecs: Array<Parameters<JobRegistry['start']>[0]> = []
  const start = vi.fn((spec: Parameters<JobRegistry['start']>[0]) => { jobSpecs.push(spec); return 'mineru-1' })
  const tools = new Map<string, ToolDefinition>()
  const ctx = { tools: { register: (tool: ToolDefinition) => { tools.set(tool.name, tool); return () => undefined } }, get: (name: string) => {
    if (name === 'attachments') return options.missingStore ? undefined : store
    if (name === 'jobs') return { start }
    if (name === 'llm') return { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }) }
    return undefined
  } } as unknown as Context
  cleanups.push(registerTools(ctx, () => ({ parseDocument, ensureParsed, previewPage }) as unknown as MinerUService))
  return { tools, exec, session, parseDocument, ensureParsed, previewPage, store, start, jobSpecs, clearSurface: () => { messages = [] } }
}

describe('attachment input through real compiled tools', () => {
  it('normalizes content, query and block selections into the unchanged path service input', async () => {
    const h = harness()
    for (const selection of [{ focus: 'toc' }, { query: 'equation' }, { block_id: 'mr_attachment:b1' }]) {
      await h.tools.get('read_pdf')!.execute({ attachment_id: 'sha256:aaaaaaaa', ...selection }, h.exec)
      expect(h.parseDocument).toHaveBeenLastCalledWith(h.session, { file_path: hostPath, inline_images: true, ...selection }, h.exec.signal, undefined)
    }
    expect(h.previewPage).not.toHaveBeenCalled()
    expect(h.start).not.toHaveBeenCalled()
  })

  it('preserves content page selection, timeout and explicit presentation options', async () => {
    const h = harness()
    await h.tools.get('read_pdf')!.execute({ attachment_id: 'aaaaaaaa', pages: [2, 3], focus: 'text', query: '  equation  ', inline_images: false, poll_timeout_ms: 1234 }, h.exec)
    expect(h.parseDocument).toHaveBeenCalledWith(h.session, { file_path: hostPath, pages: [2, 3], focus: 'text', query: 'equation', inline_images: false }, h.exec.signal, 1234)
  })

  it('preserves cursor and inherited/overridden inline intent without exposing attachment_id to the service', async () => {
    const h = harness()
    const cursor = cursorForRemainder('mr_attachment', undefined, new Set(['all']), 4, { inline_images: false })
    const read = h.tools.get('read_pdf')!
    await read.execute({ attachment_id: String(ref.attachmentId), cursor }, h.exec)
    expect(h.parseDocument).toHaveBeenLastCalledWith(h.session, { file_path: hostPath, inline_images: false, cursor }, h.exec.signal, undefined)
    await read.execute({ attachment_id: String(ref.attachmentId), cursor, inline_images: true }, h.exec)
    expect(h.parseDocument).toHaveBeenLastCalledWith(h.session, { file_path: hostPath, inline_images: true, cursor }, h.exec.signal, undefined)
    for (const extra of [{ pages: 1 }, { focus: 'text' }, { query: 'x' }, { block_id: 'mr_attachment:b1' }]) {
      await expect(read.execute({ attachment_id: 'aaaaaaaa', cursor, ...extra }, h.exec)).rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
    }
    expect(h.parseDocument).toHaveBeenCalledTimes(2)
  })

  it('routes page attachments through only the existing local preview', async () => {
    const h = harness()
    const value = await h.tools.get('read_pdf')!.execute({ attachment_id: 'aaaaaaaa', view: 'page', pages: 2, expected_sha256: 'c'.repeat(64) }, h.exec)
    expect(h.previewPage).toHaveBeenCalledWith(h.session, { file_path: hostPath, page: 2, expectedSha256: 'c'.repeat(64) }, h.exec.signal)
    expect(h.parseDocument).not.toHaveBeenCalled()
    expect(h.start).not.toHaveBeenCalled()
    expect(value).toMatchObject({ view: 'page', renderer: 'pdfjs', source: 'local', cursor: null })
    for (const extra of [{ pages: [1, 2] }, { focus: 'image' }, { inline_images: false }]) {
      await expect(h.tools.get('read_pdf')!.execute({ attachment_id: 'aaaaaaaa', view: 'page', pages: 2, ...extra }, h.exec)).rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
    }
    expect(h.previewPage).toHaveBeenCalledOnce()
  })

  it('maps before native job registration and preserves the exact live owner and path job semantics', async () => {
    const h = harness()
    expect(await h.tools.get('async_parse_pdf')!.execute({ attachment_id: 'aaaaaaaa' }, h.exec)).toEqual({ job_id: 'mineru-1', state: 'running' })
    expect(h.jobSpecs[0]!.owner).toBe(h.exec.agent)
    expect(h.jobSpecs[0]!.label).toBe('Parse paper.pdf with MinerU')
    const hooks = h.jobSpecs[0]!.run()
    expect(await hooks.done).toMatchObject({ status: 'completed' })
    expect(h.ensureParsed).toHaveBeenCalledWith(h.session, { file_path: hostPath }, expect.any(AbortSignal))
    expect(hooks).not.toHaveProperty('readOutput')
    expect(h.store.fileHostPath).toHaveBeenCalledOnce()
  })

  it.each([{ missingStore: true }, { missingPath: true }])('fails without parsing or starting a job when capability is unavailable: %j', async options => {
    const h = harness(options)
    for (const [name, extra] of [['read_pdf', {}], ['read_pdf', { view: 'page', pages: 1 }], ['async_parse_pdf', {}]] as const) {
      await expect(h.tools.get(name)!.execute({ attachment_id: 'aaaaaaaa', ...extra }, h.exec)).rejects.toMatchObject({ failure: { code: 'UNSUPPORTED_OPTION' } })
    }
    expect(h.parseDocument).not.toHaveBeenCalled()
    expect(h.previewPage).not.toHaveBeenCalled()
    expect(h.start).not.toHaveBeenCalled()
  })

  it('rejects absent references and cancellation before source mapping or jobs', async () => {
    const h = harness()
    h.clearSurface()
    await expect(h.tools.get('async_parse_pdf')!.execute({ attachment_id: 'aaaaaaaa' }, h.exec)).rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
    const controller = new AbortController()
    controller.abort(new Error('cancelled fixture'))
    for (const tool of h.tools.values()) {
      await expect(tool.execute({ attachment_id: 'aaaaaaaa' }, { ...h.exec, signal: controller.signal })).rejects.toThrow('cancelled fixture')
    }
    expect(h.store.fileHostPath).not.toHaveBeenCalled()
    expect(h.start).not.toHaveBeenCalled()
  })

  it('keeps paths functional without the attachment service or visible file references', async () => {
    const h = harness({ missingStore: true })
    h.clearSurface()
    await h.tools.get('read_pdf')!.execute({ file_path: 'relative.pdf' }, h.exec)
    expect(h.parseDocument).toHaveBeenCalledWith(h.session, { file_path: 'relative.pdf', inline_images: true }, h.exec.signal, undefined)
    expect(h.store.fileHostPath).not.toHaveBeenCalled()
  })
})
