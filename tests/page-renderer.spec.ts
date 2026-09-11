import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_PDF_PAGE_WIDTH,
  MAX_RENDERED_PNG_BYTES,
  PDF_PAGE_MAX_LONG_EDGE,
  createPdfPageRenderer,
  type PdfPageProcessRequest,
  type PdfPageProcessResult,
  type PdfPageProcessRunner,
  type RenderPdfPageInput,
} from '../src/service/page-renderer.js'

function result(stdout: Uint8Array | string = '', stderr: Uint8Array | string = ''): PdfPageProcessResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: typeof stdout === 'string' ? Buffer.from(stdout) : stdout,
    stderr: typeof stderr === 'string' ? Buffer.from(stderr) : stderr,
  }
}

function png(width = 1200, height = 1600, totalBytes = 24): Buffer {
  const bytes = Buffer.alloc(totalBytes)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

function outputPrefix(request: PdfPageProcessRequest): string {
  const prefix = request.args.at(-1)
  if (prefix === undefined) throw new Error('Missing output prefix')
  return prefix
}

describe('renderPdfPage', () => {
  let root: string
  let sourcePath: string
  const source = Buffer.from('%PDF-1.7\nmock original PDF bytes\n%%EOF\n')

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mineru-page-renderer-test-'))
    sourcePath = join(root, 'Original document.pdf')
    await writeFile(sourcePath, source)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  function input(overrides: Partial<RenderPdfPageInput> = {}): RenderPdfPageInput {
    return {
      file_path: sourcePath,
      page: 2,
      maxFileBytes: 1024 * 1024,
      signal: new AbortController().signal,
      ...overrides,
    }
  }

  function successfulRunner(image = png()): PdfPageProcessRunner {
    return async request => {
      if (request.command === 'pdfinfo') return result('Title: mock\nPages:          3\n')
      await writeFile(outputPrefix(request) + '.png', image)
      return result()
    }
  }

  async function expectTemporaryCleanup(): Promise<void> {
    expect((await readdir(root)).sort()).toEqual(['Original document.pdf'])
  }

  it('renders exactly one physical page from a hashed private snapshot', async () => {
    const calls: PdfPageProcessRequest[] = []
    const runner = vi.fn<PdfPageProcessRunner>(async request => {
      calls.push(request)
      const snapshotPath = request.command === 'pdfinfo' ? request.args.at(-1)! : request.args.at(-2)!
      expect(await readFile(snapshotPath)).toEqual(source)
      if (request.command === 'pdfinfo') return result('Pages: 3\n')
      await writeFile(outputPrefix(request) + '.png', png(800, 1000))
      return result()
    })
    const render = createPdfPageRenderer({ runProcess: runner, temporaryRoot: root })
    const rendered = await render(input({ expectedSha256: createHash('sha256').update(source).digest('hex').toUpperCase() }))

    expect(rendered).toMatchObject({
      name: 'Original_document-page-2.png',
      page: 2,
      page_count: 3,
      sha256: createHash('sha256').update(source).digest('hex'),
      media_type: 'image/png',
      width: 800,
      height: 1000,
    })
    expect(Buffer.from(rendered.data)).toEqual(png(800, 1000))
    expect(calls.map(call => call.command)).toEqual(['pdfinfo', 'pdftoppm'])
    const renderArgs = calls[1]?.args ?? []
    expect(renderArgs).toEqual(expect.arrayContaining([
      '-f', '2', '-l', '2', '-singlefile', '-png',
      '-scale-to', String(PDF_PAGE_MAX_LONG_EDGE),
    ]))
    expect(renderArgs).not.toContain('-scale-to-x')
    expect(renderArgs).not.toContain('-scale-to-y')
    expect(calls[1]?.watchedOutput?.maxBytes).toBe(MAX_RENDERED_PNG_BYTES)
    await expectTemporaryCleanup()
  })

  it('uses one long-edge scale argument so Poppler preserves original aspect ratio', async () => {
    const calls: PdfPageProcessRequest[] = []
    const baseRunner = successfulRunner()
    const render = createPdfPageRenderer({
      temporaryRoot: root,
      runProcess: async request => {
        calls.push(request)
        return baseRunner(request)
      },
    })

    await render(input())
    const args = calls.find(call => call.command === 'pdftoppm')?.args ?? []
    expect(args).toEqual(expect.arrayContaining(['-scale-to', String(PDF_PAGE_MAX_LONG_EDGE)]))
    expect(args).not.toContain('-scale-to-x')
    expect(args).not.toContain('-scale-to-y')
    await expectTemporaryCleanup()
  })

  it('validates the requested page against bounded physical pdfinfo output', async () => {
    const runner = vi.fn<PdfPageProcessRunner>(async () => result('Pages: 1\n'))
    const render = createPdfPageRenderer({ runProcess: runner, temporaryRoot: root })

    await expect(render(input({ page: 2 }))).rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
    expect(runner).toHaveBeenCalledTimes(1)
    await expectTemporaryCleanup()
  })

  it('rejects process output beyond the declared capture bound', async () => {
    const runner: PdfPageProcessRunner = async request => result(Buffer.alloc(request.maxStdoutBytes + 1))
    const render = createPdfPageRenderer({ runProcess: runner, temporaryRoot: root })

    await expect(render(input())).rejects.toMatchObject({ failure: { code: 'RESULT_TOO_LARGE' } })
    await expectTemporaryCleanup()
  })

  it('rejects a mismatched expected source hash before starting Poppler', async () => {
    const runner = vi.fn<PdfPageProcessRunner>()
    const render = createPdfPageRenderer({ runProcess: runner, temporaryRoot: root })

    await expect(render(input({ expectedSha256: '0'.repeat(64) }))).rejects.toMatchObject({
      failure: { code: 'INVALID_REQUEST' },
    })
    expect(runner).not.toHaveBeenCalled()
    await expectTemporaryCleanup()
  })

  it('rejects oversized sources and source symlinks before starting Poppler', async () => {
    const runner = vi.fn<PdfPageProcessRunner>()
    const render = createPdfPageRenderer({ runProcess: runner, temporaryRoot: root })
    await expect(render(input({ maxFileBytes: source.byteLength - 1 }))).rejects.toMatchObject({
      failure: { code: 'FILE_TOO_LARGE' },
    })

    const link = join(root, 'linked.pdf')
    await symlink(sourcePath, link)
    await expect(render(input({ file_path: link }))).rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
    expect(runner).not.toHaveBeenCalled()
    expect((await readdir(root)).sort()).toEqual(['Original document.pdf', 'linked.pdf'])
  })

  it('uses an immutable snapshot if the caller path changes during rendering', async () => {
    let snapshot: Buffer | undefined
    const runner: PdfPageProcessRunner = async request => {
      const snapshotPath = request.command === 'pdfinfo' ? request.args.at(-1)! : request.args.at(-2)!
      if (request.command === 'pdfinfo') {
        snapshot = await readFile(snapshotPath)
        await writeFile(sourcePath, 'replacement source')
        return result('Pages: 3\n')
      }
      expect(await readFile(snapshotPath)).toEqual(snapshot)
      await writeFile(outputPrefix(request) + '.png', png())
      return result()
    }
    const render = createPdfPageRenderer({ runProcess: runner, temporaryRoot: root })
    const rendered = await render(input())

    expect(rendered.sha256).toBe(createHash('sha256').update(source).digest('hex'))
    expect(await readFile(sourcePath, 'utf8')).toBe('replacement source')
    await expectTemporaryCleanup()
  })

  it('maps a missing Poppler executable to a clear typed unsupported failure', async () => {
    const runner: PdfPageProcessRunner = async request => {
      throw Object.assign(new Error('not installed'), { code: 'ENOENT', path: request.command })
    }
    const render = createPdfPageRenderer({ runProcess: runner, temporaryRoot: root })

    await expect(render(input())).rejects.toMatchObject({
      failure: {
        code: 'UNSUPPORTED_OPTION',
        message: expect.stringContaining('pdfinfo Poppler executable'),
      },
    })
    await expectTemporaryCleanup()
  })

  it('wraps a cleanup-only failure without exposing the private temporary path', async () => {
    const diagnostics = vi.fn()
    const removeTemporaryDirectory = vi.fn(async (path: string) => {
      throw new Error('cannot remove private path ' + path)
    })
    const render = createPdfPageRenderer({
      runProcess: successfulRunner(), temporaryRoot: root, removeTemporaryDirectory, diagnostics,
    })

    const error = await render(input()).then(() => undefined, reason => reason)
    expect(error).toMatchObject({
      failure: {
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Failed to remove temporary PDF page-rendering data',
        retryable: true,
      },
    })
    expect(error.message).not.toContain(root)
    expect(error.cause).toBeUndefined()
    expect(removeTemporaryDirectory).toHaveBeenCalledTimes(1)
    expect(diagnostics).toHaveBeenCalledWith({
      level: 'warn', phase: 'failed', errorCode: 'PROVIDER_UNAVAILABLE', retryable: true,
    })
  })

  it('preserves a primary typed failure when temporary cleanup also fails', async () => {
    const diagnostics = vi.fn()
    const removeTemporaryDirectory = vi.fn(async () => {
      throw new Error('cleanup included /private/source/path.pdf')
    })
    const render = createPdfPageRenderer({
      runProcess: async () => result('Pages: 1\n'),
      temporaryRoot: root,
      removeTemporaryDirectory,
      diagnostics,
    })

    const error = await render(input({ page: 2 })).then(() => undefined, reason => reason)
    expect(error).toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
    expect(error.message).toContain('outside the physical page range')
    expect(error.message).not.toContain('/private/source/path.pdf')
    expect(removeTemporaryDirectory).toHaveBeenCalledTimes(1)
    expect(diagnostics).toHaveBeenCalledTimes(1)
  })

  it('keeps caller cancellation typed while late process reaping crosses the deadline', async () => {
    const controller = new AbortController()
    let processSettled = false
    let notifyStarted: (() => void) | undefined
    const started = new Promise<void>(resolvePromise => { notifyStarted = resolvePromise })
    const runner: PdfPageProcessRunner = async request => {
      if (request.command === 'pdfinfo') return result('Pages: 3\n')
      notifyStarted?.()
      return new Promise((_resolvePromise, rejectPromise) => {
        const rejectAfterReap = (): void => {
          setTimeout(() => {
            processSettled = true
            rejectPromise(request.signal.reason)
          }, 30)
        }
        request.signal.addEventListener('abort', rejectAfterReap, { once: true })
      })
    }
    const render = createPdfPageRenderer({ runProcess: runner, temporaryRoot: root, runtimeMs: 10 })
    const pending = render(input({ signal: controller.signal }))
    await started
    controller.abort()

    await expect(pending).rejects.toMatchObject({ failure: { code: 'CANCELLED' } })
    expect(processSettled).toBe(true)
    await expectTemporaryCleanup()
  })

  it('enforces a hard whole-operation timeout and cleans its snapshot', async () => {
    const runner: PdfPageProcessRunner = request => new Promise((_resolvePromise, rejectPromise) => {
      request.signal.addEventListener('abort', () => rejectPromise(request.signal.reason), { once: true })
    })
    const render = createPdfPageRenderer({ runProcess: runner, temporaryRoot: root, runtimeMs: 20 })

    await expect(render(input())).rejects.toMatchObject({ failure: { code: 'PROVIDER_UNAVAILABLE' } })
    await expectTemporaryCleanup()
  })

  it('rejects oversized rendered bytes and pixels', async () => {
    const oversizedBytes = createPdfPageRenderer({
      runProcess: successfulRunner(png(100, 100, MAX_RENDERED_PNG_BYTES + 1)),
      temporaryRoot: root,
    })
    await expect(oversizedBytes(input())).rejects.toMatchObject({ failure: { code: 'RESULT_TOO_LARGE' } })
    await expectTemporaryCleanup()

    const oversizedPixels = createPdfPageRenderer({
      runProcess: successfulRunner(png(MAX_PDF_PAGE_WIDTH + 1, 100)),
      temporaryRoot: root,
    })
    await expect(oversizedPixels(input())).rejects.toMatchObject({ failure: { code: 'RESULT_TOO_LARGE' } })
    await expectTemporaryCleanup()
  })

  it('bounds concurrent render operations independently of process-runner behavior', async () => {
    let active = 0
    let peak = 0
    const gates: Array<() => void> = []
    const runner: PdfPageProcessRunner = async request => {
      if (request.command === 'pdfinfo') {
        active += 1
        peak = Math.max(peak, active)
        await new Promise<void>(resolvePromise => gates.push(resolvePromise))
        active -= 1
        return result('Pages: 3\n')
      }
      await writeFile(outputPrefix(request) + '.png', png())
      return result()
    }
    const render = createPdfPageRenderer({ runProcess: runner, temporaryRoot: root, maxConcurrency: 2 })
    const operations = [render(input()), render(input()), render(input())]
    while (gates.length < 2) await new Promise(resolvePromise => setImmediate(resolvePromise))
    expect(peak).toBe(2)
    expect(gates).toHaveLength(2)
    gates.splice(0).forEach(openGate => openGate())
    while (gates.length < 1) await new Promise(resolvePromise => setImmediate(resolvePromise))
    gates.splice(0).forEach(openGate => openGate())

    await expect(Promise.all(operations)).resolves.toHaveLength(3)
    expect(peak).toBe(2)
    await expectTemporaryCleanup()
  })
})
