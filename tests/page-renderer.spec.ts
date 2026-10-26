import { createHash } from 'node:crypto'
import { readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  MAX_PDF_PAGE_WIDTH,
  MAX_RENDERED_PNG_BYTES,
  PDF_PAGE_MAX_LONG_EDGE,
  createPdfPageRenderer,
  parsePageCount,
  rendererEnvironment,
  type PdfPageProcessRequest,
  type PdfPageProcessRunner,
} from '../src/reader/page/page-renderer.js'
import { testPng } from './fixtures/png.js'
import { processResult, renderRoot, snapshotPath, writeBackendPng } from './support/render-fixtures.js'

const source = Buffer.from('%PDF-1.7\nmock original PDF bytes\n%%EOF\n')
const sourceSha256 = createHash('sha256').update(source).digest('hex')

function successfulRunner(image = testPng(1200, 1600)): PdfPageProcessRunner {
  return async request => {
    if (request.command === 'pdfinfo') return processResult('Title: mock\nPages:          3\n')
    await writeBackendPng(request, image)
    return processResult()
  }
}

/** A runner that never settles until its signal aborts. */
const hangingRunner = (calls: PdfPageProcessRequest[] = []): PdfPageProcessRunner => request => {
  calls.push(request)
  return new Promise((_resolve, reject) => {
    request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })
  })
}

describe('renderPdfPage with Poppler', () => {
  const fx = renderRoot('Original document.pdf', source)

  it('renders exactly one physical page from a hashed private snapshot at one long-edge scale', async () => {
    const calls: PdfPageProcessRequest[] = []
    const runner = vi.fn<PdfPageProcessRunner>(async request => {
      calls.push(request)
      expect(await readFile(snapshotPath(request))).toEqual(source)
      if (request.command === 'pdfinfo') return processResult('Pages: 3\n')
      await writeBackendPng(request, testPng(800, 1000))
      return processResult()
    })
    const render = createPdfPageRenderer({ runProcess: runner, temporaryRoot: fx.root })
    const rendered = await render(fx.input({ expectedSha256: sourceSha256.toUpperCase() }))

    expect(rendered).toMatchObject({
      name: 'Original_document-page-2.png', page: 2, page_count: 3, sha256: sourceSha256,
      media_type: 'image/png', width: 800, height: 1000, renderer: 'poppler',
    })
    expect(Buffer.from(rendered.data)).toEqual(testPng(800, 1000))
    expect(calls.map(call => call.command)).toEqual(['pdfinfo', 'pdftoppm'])
    const renderArgs = calls[1]!.args
    expect(renderArgs).toEqual(expect.arrayContaining(['-f', '2', '-l', '2', '-singlefile', '-png', '-scale-to', String(PDF_PAGE_MAX_LONG_EDGE)]))
    // One long-edge bound preserves the original aspect ratio.
    expect(renderArgs).not.toContain('-scale-to-x')
    expect(renderArgs).not.toContain('-scale-to-y')
    expect(calls[1]!.watchedOutput?.maxBytes).toBe(MAX_RENDERED_PNG_BYTES)
    await fx.expectOnly()
  })

  it('validates the requested page against bounded physical pdfinfo output', async () => {
    const runner = vi.fn<PdfPageProcessRunner>(async () => processResult('Pages: 1\n'))
    await expect(createPdfPageRenderer({ runProcess: runner, temporaryRoot: fx.root })(fx.input({ page: 2 })))
      .rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
    expect(runner).toHaveBeenCalledTimes(1)
    await fx.expectOnly()
  })

  it('reads the page count when unrelated pdfinfo fields use a local code page', async () => {
    // Poppler on zh-CN Windows prints the CreationDate time-zone name (中国标准时间)
    // in GBK regardless of LC_ALL or -enc UTF-8, with CRLF line endings.
    const gbkTimeZone = Buffer.from([0xD6, 0xD0, 0xB9, 0xFA, 0xB1, 0xEA, 0xD7, 0xBC, 0xCA, 0xB1, 0xBC, 0xE4])
    const stdout = Buffer.concat([
      Buffer.from('Title:           Attention Is All You Need\r\nCreationDate:    Thu Apr 11 05:11:43 2024 '),
      gbkTimeZone,
      Buffer.from('\r\nPages:           15\r\nPage size:       612 x 792 pts (letter)\r\n'),
    ])
    expect(parsePageCount(stdout)).toBe(15)

    const runner: PdfPageProcessRunner = async request => {
      if (request.command === 'pdfinfo') return processResult(stdout)
      await writeBackendPng(request, testPng(800, 1000))
      return processResult()
    }
    const rendered = await createPdfPageRenderer({ runProcess: runner, temporaryRoot: fx.root })(fx.input({ page: 8 }))
    expect(rendered).toMatchObject({ renderer: 'poppler', page: 8, page_count: 15 })
    await fx.expectOnly()
  })

  it('still requires exactly one physical page-count line', () => {
    const injected = Buffer.concat([
      Buffer.from('Title:           x\nPages:           99\n'),
      Buffer.from([0xFF, 0xFE]),
      Buffer.from('\nPages:           3\n'),
    ])
    expect(() => parsePageCount(injected)).toThrow(expect.objectContaining({ failure: expect.objectContaining({ code: 'INVALID_REQUEST' }) }))
    expect(() => parsePageCount(Buffer.from([0xD6, 0xD0, 0x0A]))).toThrow(expect.objectContaining({ failure: expect.objectContaining({ code: 'INVALID_REQUEST' }) }))
  })

  it('spawns renderers with an allow-listed UTC environment', () => {
    expect(rendererEnvironment('/usr/bin')).toEqual({ PATH: '/usr/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' })
  })

  it('rejects process output beyond the declared capture bound', async () => {
    const runner: PdfPageProcessRunner = async request => processResult(Buffer.alloc(request.maxStdoutBytes + 1))
    await expect(createPdfPageRenderer({ runProcess: runner, temporaryRoot: fx.root })(fx.input()))
      .rejects.toMatchObject({ failure: { code: 'RESULT_TOO_LARGE' } })
    await fx.expectOnly()
  })

  it('rejects a mismatched source hash, oversized sources and symlinks before starting a process', async () => {
    const runner = vi.fn<PdfPageProcessRunner>()
    const render = createPdfPageRenderer({ runProcess: runner, temporaryRoot: fx.root })
    await expect(render(fx.input({ expectedSha256: '0'.repeat(64) }))).rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
    await expect(render(fx.input({ maxFileBytes: source.byteLength - 1 }))).rejects.toMatchObject({ failure: { code: 'FILE_TOO_LARGE' } })
    const link = join(fx.root, 'linked.pdf')
    await symlink(fx.sourcePath, link)
    await expect(render(fx.input({ file_path: link }))).rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
    expect(runner).not.toHaveBeenCalled()
    await fx.expectOnly(['Original document.pdf', 'linked.pdf'])
  })

  it('uses an immutable snapshot if the caller path changes during rendering', async () => {
    let snapshot: Buffer | undefined
    const runner: PdfPageProcessRunner = async request => {
      if (request.command === 'pdfinfo') {
        snapshot = await readFile(snapshotPath(request))
        await writeFile(fx.sourcePath, 'replacement source')
        return processResult('Pages: 3\n')
      }
      expect(await readFile(snapshotPath(request))).toEqual(snapshot)
      await writeBackendPng(request)
      return processResult()
    }
    const rendered = await createPdfPageRenderer({ runProcess: runner, temporaryRoot: fx.root })(fx.input())
    expect(rendered.sha256).toBe(sourceSha256)
    expect(await readFile(fx.sourcePath, 'utf8')).toBe('replacement source')
    await fx.expectOnly()
  })

  it('maps unavailable Poppler and PDF.js executables to an actionable failure', async () => {
    const runner: PdfPageProcessRunner = async request => {
      throw Object.assign(new Error('not installed'), { code: 'ENOENT', path: request.command })
    }
    await expect(createPdfPageRenderer({ runProcess: runner, temporaryRoot: fx.root })(fx.input())).rejects.toMatchObject({
      failure: { code: 'UNSUPPORTED_OPTION', message: expect.stringContaining('install Poppler (pdfinfo and pdftoppm)') },
    })
    await fx.expectOnly()
  })

  it('wraps a cleanup-only failure without exposing the private temporary path', async () => {
    const diagnostics = vi.fn()
    const removeTemporaryDirectory = vi.fn(async (path: string) => { throw new Error('cannot remove private path ' + path) })
    const render = createPdfPageRenderer({ runProcess: successfulRunner(), temporaryRoot: fx.root, removeTemporaryDirectory, diagnostics })

    const error = await render(fx.input()).then(() => undefined, (reason: unknown) => reason)
    expect(error).toMatchObject({ failure: { code: 'PROVIDER_UNAVAILABLE', retryable: true } })
    expect(error).not.toHaveProperty('cause')
    expect(String(error)).not.toContain(fx.root)
    expect(removeTemporaryDirectory).toHaveBeenCalledTimes(1)
    expect(diagnostics).toHaveBeenCalledWith({ level: 'warn', phase: 'failed', errorCode: 'PROVIDER_UNAVAILABLE', retryable: true })
  })

  it('preserves a primary typed failure when temporary cleanup also fails', async () => {
    const removeTemporaryDirectory = vi.fn(async () => { throw new Error('cleanup included /private/source/path.pdf') })
    const render = createPdfPageRenderer({ runProcess: async () => processResult('Pages: 1\n'), temporaryRoot: fx.root, removeTemporaryDirectory })
    const error = await render(fx.input({ page: 2 })).then(() => undefined, (reason: unknown) => reason)
    expect(error).toMatchObject({ failure: { code: 'INVALID_REQUEST', message: expect.stringContaining('outside the physical page range') } })
    expect(String(error)).not.toContain('/private/source/path.pdf')
    expect(removeTemporaryDirectory).toHaveBeenCalledTimes(1)
  })

  it('keeps caller cancellation typed while late process reaping crosses the deadline', async () => {
    const controller = new AbortController()
    let processSettled = false
    let notifyStarted!: () => void
    const started = new Promise<void>(resolve => { notifyStarted = resolve })
    const runner: PdfPageProcessRunner = async request => {
      if (request.command === 'pdfinfo') return processResult('Pages: 3\n')
      notifyStarted()
      return new Promise((_resolve, reject) => {
        // The child is reaped after the 10 ms operation deadline has passed.
        request.signal.addEventListener('abort', () => setTimeout(() => {
          processSettled = true
          reject(request.signal.reason)
        }, 30), { once: true })
      })
    }
    const pending = createPdfPageRenderer({ runProcess: runner, temporaryRoot: fx.root, runtimeMs: 10 })(fx.input({ signal: controller.signal }))
    await started
    controller.abort()
    await expect(pending).rejects.toMatchObject({ failure: { code: 'CANCELLED' } })
    expect(processSettled).toBe(true)
    await fx.expectOnly()
  })

  it('enforces a hard whole-operation timeout and cleans its snapshot', async () => {
    await expect(createPdfPageRenderer({ runProcess: hangingRunner(), temporaryRoot: fx.root, runtimeMs: 20 })(fx.input()))
      .rejects.toMatchObject({ failure: { code: 'PROVIDER_UNAVAILABLE' } })
    await fx.expectOnly()
  })

  it.each([
    { name: 'bytes', image: () => testPng(100, 100, MAX_RENDERED_PNG_BYTES + 1) },
    { name: 'pixels', image: () => testPng(MAX_PDF_PAGE_WIDTH + 1, 100) },
  ])('rejects oversized rendered $name', async ({ image }) => {
    await expect(createPdfPageRenderer({ runProcess: successfulRunner(image()), temporaryRoot: fx.root })(fx.input()))
      .rejects.toMatchObject({ failure: { code: 'RESULT_TOO_LARGE' } })
    await fx.expectOnly()
  })

  it('bounds concurrent render operations independently of process-runner behavior', async () => {
    let active = 0
    let peak = 0
    const gates: (() => void)[] = []
    const runner: PdfPageProcessRunner = async request => {
      if (request.command === 'pdfinfo') {
        peak = Math.max(peak, ++active)
        await new Promise<void>(resolve => gates.push(resolve))
        active--
        return processResult('Pages: 3\n')
      }
      await writeBackendPng(request)
      return processResult()
    }
    const render = createPdfPageRenderer({ runProcess: runner, temporaryRoot: fx.root, maxConcurrency: 2 })
    const operations = [render(fx.input()), render(fx.input()), render(fx.input())]
    await vi.waitFor(() => expect(gates).toHaveLength(2))
    gates.splice(0).forEach(open => open())
    await vi.waitFor(() => expect(gates).toHaveLength(1))
    gates.splice(0).forEach(open => open())
    await expect(Promise.all(operations)).resolves.toHaveLength(3)
    expect(peak).toBe(2)
    await fx.expectOnly()
  })
})
