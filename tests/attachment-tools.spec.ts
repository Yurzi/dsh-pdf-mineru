import { describe, expect, it } from 'vitest'
import { cursorForRemainder, decodeReadCursor } from '../src/reader/read-cursor.js'
import { ATTACHMENT_HOST_PATH, FILE_REF, selectQuery, toolHarness, type ToolHarnessOptions } from './support/tool-harness.js'

// Attachment selectors and the effective working directory both end in one absolute source path.
const harness = (options: ToolHarnessOptions = {}) => toolHarness({ imageModel: true, files: [FILE_REF], ...options })
const sources = [['read_pdf', {}], ['read_pdf', { view: 'page', pages: 2 }], ['async_parse_pdf', {}]] as const

describe('attachment_id source selection', () => {
  it.each([
    [{ focus: 'toc' }, selectQuery({ focus: new Set(['toc']) })],
    [{ pages: [2, 3], query: '  equation  ', inline_images: false, poll_timeout_ms: 1234 }, selectQuery({ pages: new Set([2, 3]), target: { kind: 'query', text: 'equation' } }, { inlineImages: false, pollTimeoutMs: 1234 })],
    [{ block_id: 'mr_fixture:b1' }, selectQuery({ target: { kind: 'block', blockId: 'mr_fixture:b1' } })],
  ] as const)('maps the visible reference to its host path for %j', async (selection, query) => {
    const h = await harness()
    await h.read({ attachment_id: 'sha256:aaaaaaaa', ...selection })
    expect(h.reader.readContent).toHaveBeenCalledExactlyOnceWith(ATTACHMENT_HOST_PATH, query, expect.anything(), expect.any(Function), expect.any(AbortSignal))
    expect(h.fileHostPath).toHaveBeenCalledExactlyOnceWith(FILE_REF)
  })

  it('keeps cursor intent on attachment continuations', async () => {
    const h = await harness()
    const cursor = cursorForRemainder('mr_fixture', undefined, new Set(['all']), 4, { inline_images: false })
    await h.read({ attachment_id: String(FILE_REF.attachmentId), cursor })
    expect(h.reader.readContent).toHaveBeenLastCalledWith(ATTACHMENT_HOST_PATH, { kind: 'continue', inlineImages: false, cursor: decodeReadCursor(cursor) }, expect.anything(), expect.any(Function), expect.any(AbortSignal))
  })

  it('routes attachment page views only to the local page reader', async () => {
    const h = await harness()
    await h.read({ attachment_id: 'aaaaaaaa', view: 'page', pages: 2, expected_sha256: 'c'.repeat(64) })
    expect(h.reader.viewPage).toHaveBeenCalledWith(ATTACHMENT_HOST_PATH, { kind: 'page', page: 2, expectedSha256: 'c'.repeat(64) }, expect.anything(), expect.any(Function), expect.any(AbortSignal))
    expect(h.reader.readContent).not.toHaveBeenCalled()
    expect(h.ctx.jobs.list(h.session.id)).toEqual([])
  })

  it('maps before job registration and summarizes the host path under the session owner', async () => {
    const h = await harness()
    const id = await h.submit({ attachment_id: 'aaaaaaaa' })
    await h.ctx.jobs.wait(id, 1000, h.session.id)
    expect(h.ctx.jobs.get(id, h.session.id)).toMatchObject({ status: 'completed', label: 'Parse paper.pdf with MinerU' })
    expect(h.reader.summarize).toHaveBeenCalledWith(ATTACHMENT_HOST_PATH, expect.anything(), expect.any(AbortSignal), expect.any(Function))
  })

  it.each(['missing store', 'missing host path'] as const)('fails with UNSUPPORTED_OPTION before reading or registering a job: %s', async mode => {
    const h = await harness(mode === 'missing store' ? { attachments: false } : {})
    h.fileHostPath.mockReturnValue(undefined)
    for (const [name, extra] of sources) {
      await expect(h.tool(name).execute({ attachment_id: 'aaaaaaaa', ...extra }, h.exec())).rejects.toMatchObject({ failure: { code: 'UNSUPPORTED_OPTION' } })
    }
    expect(h.reader.readContent).not.toHaveBeenCalled()
    expect(h.reader.viewPage).not.toHaveBeenCalled()
    expect(h.ctx.jobs.list(h.session.id)).toEqual([])
  })

  it('rejects references absent from the session surface without starting a job', async () => {
    const h = await harness({ files: [] })
    await expect(h.submit({ attachment_id: 'aaaaaaaa' })).rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
    expect(h.fileHostPath).not.toHaveBeenCalled()
    expect(h.ctx.jobs.list(h.session.id)).toEqual([])
  })

  it('never consults the working directory for host-owned attachment paths', async () => {
    const h = await harness()
    h.ensure.mockRejectedValue(new Error('directory unavailable'))
    for (const [name, extra] of sources) await h.tool(name).execute({ attachment_id: 'aaaaaaaa', ...extra }, h.exec())
    expect(h.ensure).not.toHaveBeenCalled()
  })
})

describe('file_path against the effective working directory', () => {
  it.each(['content', 'page', 'async'] as const)('resolves relative paths under the directory current at the call (%s)', async mode => {
    const h = await harness()
    h.setDirectory('/workspace/new-directory')
    if (mode === 'async') {
      const id = await h.submit({ file_path: 'paper.pdf' })
      h.setDirectory('/workspace/later')
      await h.ctx.jobs.wait(id, 1000, h.session.id)
    } else {
      await h.read({ file_path: 'paper.pdf', ...(mode === 'page' ? { view: 'page', pages: 2 } : {}) })
    }
    const calls = mode === 'async' ? h.reader.summarize.mock.calls : mode === 'page' ? h.reader.viewPage.mock.calls : h.reader.readContent.mock.calls
    expect(calls[0]?.[0]).toBe('/workspace/new-directory/paper.pdf')
    expect(h.ensure).toHaveBeenCalledOnce()
  })

  it.each(['read_pdf', 'async_parse_pdf'] as const)('fails closed when the directory cannot be ensured (%s)', async name => {
    const h = await harness()
    const reason = new Error('directory unavailable')
    h.ensure.mockRejectedValue(reason)
    await expect(h.tool(name).execute({ file_path: 'paper.pdf' }, h.exec())).rejects.toBe(reason)
    expect(h.reader.readContent).not.toHaveBeenCalled()
    expect(h.ctx.jobs.list(h.session.id)).toEqual([])
  })
})
