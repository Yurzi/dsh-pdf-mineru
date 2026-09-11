import { createHash } from 'node:crypto'
import { testPng } from './fixtures/png.js'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_RENDERED_PNG_BYTES,
  createPdfPageRenderer,
  type PdfPageProcessRequest,
  type PdfPageProcessResult,
  type PdfPageProcessRunner,
  type RenderPdfPageInput,
} from '../src/service/page-renderer.js'

function processResult(
  stdout: Uint8Array | string = '',
  options: { stderr?: Uint8Array | string; exitCode?: number | null } = {},
): PdfPageProcessResult {
  const stderr = options.stderr ?? ''
  return {
    exitCode: options.exitCode ?? 0,
    signal: null,
    stdout: typeof stdout === 'string' ? Buffer.from(stdout) : stdout,
    stderr: typeof stderr === 'string' ? Buffer.from(stderr) : stderr,
  }
}

const png = testPng

function unavailable(code: 'ENOENT' | 'EACCES' | 'EPERM' | 'ENOEXEC' | 'ENOSYS', detail = 'private executable detail'): Error {
  return Object.assign(new Error(detail), { code })
}

function popplerOutput(request: PdfPageProcessRequest): string {
  const prefix = request.args.at(-1)
  if (prefix === undefined) throw new Error('pdftoppm output prefix is missing')
  return prefix + '.png'
}

function pdfjsPaths(request: PdfPageProcessRequest): { snapshot: string; output: string } {
  const tail = request.args.slice(-4)
  if (tail.length !== 4) throw new Error('pdfjs argument tail is incomplete')
  return { snapshot: tail[0]!, output: tail[1]! }
}

async function writeBackendPng(request: PdfPageProcessRequest, bytes = png()): Promise<void> {
  if (request.command === 'pdftoppm') await writeFile(popplerOutput(request), bytes)
  else if (request.command === 'pdfjs') await writeFile(pdfjsPaths(request).output, bytes)
  else throw new Error('Unexpected render command: ' + request.command)
}

describe('PDF page renderer automatic fallback', () => {
  let root: string
  let sourcePath: string
  const original = Buffer.from('%PDF-1.7\nimmutable input\n%%EOF\n')

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mineru-page-fallback-test-'))
    sourcePath = join(root, 'fallback.pdf')
    await writeFile(sourcePath, original)
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

  async function expectClean(): Promise<void> {
    expect(await readdir(root)).toEqual(['fallback.pdf'])
  }

  it.each(['header-only', 'missing-IEND', 'bad-CRC', 'trailing-bytes'])('rejects incomplete or corrupt PNG containers: %s', async corruption => {
    let bytes = png()
    if (corruption === 'header-only') bytes = bytes.subarray(0, 24)
    if (corruption === 'missing-IEND') bytes = bytes.subarray(0, bytes.length - 12)
    if (corruption === 'bad-CRC') bytes[bytes.length - 1]! ^= 1
    if (corruption === 'trailing-bytes') bytes = Buffer.concat([bytes, Buffer.from([0])])
    const runProcess: PdfPageProcessRunner = async request => {
      if (request.command === 'pdfinfo') throw unavailable('ENOENT')
      await writeBackendPng(request, bytes)
      return processResult('{"page_count":3}')
    }
    await expect(createPdfPageRenderer({ runProcess, temporaryRoot: root })(input())).rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
    await expectClean()
  })

  it.each([false, true])('keeps caller cancellation during cleanup, including cleanup failure=%s', async failCleanup => {
    const controller = new AbortController()
    const runProcess: PdfPageProcessRunner = async request => {
      if (request.command === 'pdfinfo') throw unavailable('ENOENT')
      await writeBackendPng(request)
      return processResult('{"page_count":3}')
    }
    const render = createPdfPageRenderer({ runProcess, temporaryRoot: root,
      removeTemporaryDirectory: async path => {
        controller.abort()
        await rm(path, { recursive: true, force: true })
        if (failCleanup) throw new Error('private cleanup detail')
      },
    })
    await expect(render(input({ signal: controller.signal }))).rejects.toMatchObject({ failure: { code: 'CANCELLED' } })
    await expectClean()
  })

  it('does not report success when cleanup crosses the shared deadline', async () => {
    let signal: AbortSignal | undefined
    let cleanupEnteredBeforeDeadline = false
    const runProcess: PdfPageProcessRunner = async request => {
      signal = request.signal
      if (request.command === 'pdfinfo') throw unavailable('ENOENT')
      await writeBackendPng(request)
      return processResult('{"page_count":3}')
    }
    const render = createPdfPageRenderer({ runProcess, temporaryRoot: root, runtimeMs: 200,
      removeTemporaryDirectory: async path => {
        cleanupEnteredBeforeDeadline = signal?.aborted === false
        await new Promise(resolve => setTimeout(resolve, 250))
        await rm(path, { recursive: true, force: true })
      },
    })
    await expect(render(input())).rejects.toMatchObject({ failure: { code: 'PROVIDER_UNAVAILABLE', message: expect.stringContaining('runtime limit') } })
    expect(cleanupEnteredBeforeDeadline).toBe(true)
    await expectClean()
  })

  it.each(['output-io', 'signal'])('reports Poppler %s as execution failure without fallback', async mode => {
    const runProcess = vi.fn<PdfPageProcessRunner>(async () => ({ ...processResult(),
      exitCode: mode === 'output-io' ? 2 : null, signal: mode === 'signal' ? 'SIGKILL' : null,
    }))
    await expect(createPdfPageRenderer({ runProcess, temporaryRoot: root })(input())).rejects.toMatchObject({ failure: { code: 'PROVIDER_UNAVAILABLE' } })
    expect(runProcess).toHaveBeenCalledTimes(1)
    await expectClean()
  })

  it('recovers Poppler priority on the next request after dependency installation', async () => {
    let installed = false
    const runProcess: PdfPageProcessRunner = async request => {
      if (request.command === 'pdfinfo') {
        if (!installed) throw unavailable('ENOENT')
        return processResult('Pages: 3\n')
      }
      await writeBackendPng(request)
      return processResult(request.command === 'pdfjs' ? '{"page_count":3}' : '')
    }
    const render = createPdfPageRenderer({ runProcess, temporaryRoot: root })
    expect((await render(input())).renderer).toBe('pdfjs')
    installed = true
    expect((await render(input())).renderer).toBe('poppler')
    await expectClean()
  })

  it.each(['{}', '{"page_count":0}', '{"page_count":1000001}', '{"page_count":3,"path":"private"}', 'not-json'])('rejects malformed worker metadata: %s', async metadata => {
    const runProcess: PdfPageProcessRunner = async request => {
      if (request.command === 'pdfinfo') throw unavailable('ENOENT')
      await writeBackendPng(request)
      return processResult(metadata)
    }
    await expect(createPdfPageRenderer({ runProcess, temporaryRoot: root })(input())).rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
    await expectClean()
  })

  it('prefers Poppler when both Poppler commands succeed', async () => {
    const calls: PdfPageProcessRequest[] = []
    const runProcess: PdfPageProcessRunner = async request => {
      calls.push(request)
      if (request.command === 'pdfinfo') return processResult('Pages: 3\n')
      if (request.command === 'pdftoppm') {
        await writeBackendPng(request)
        return processResult()
      }
      throw new Error('pdfjs must not run while Poppler is available')
    }

    const rendered = await createPdfPageRenderer({ runProcess, temporaryRoot: root })(input())

    expect(rendered.renderer).toBe('poppler')
    expect(calls.map(call => call.command)).toEqual(['pdfinfo', 'pdftoppm'])
    await expectClean()
  })

  it.each([
    { missing: 'pdfinfo' as const, commands: ['pdfinfo', 'pdfjs'] },
    { missing: 'pdftoppm' as const, commands: ['pdfinfo', 'pdftoppm', 'pdfjs'] },
  ])('uses pdfjs when $missing is missing', async ({ missing, commands }) => {
    const calls: PdfPageProcessRequest[] = []
    const runProcess: PdfPageProcessRunner = async request => {
      calls.push(request)
      if (request.command === missing) throw unavailable('ENOENT')
      if (request.command === 'pdfinfo') return processResult('Pages: 3\n')
      if (request.command === 'pdfjs') {
        const tail = request.args.slice(-4)
        expect(tail).toHaveLength(4)
        expect(tail[0]).toMatch(/source\.pdf$/)
        expect(tail[1]).toMatch(/page\.png$/)
        expect(tail.slice(2)).toEqual(['2', String(input().maxFileBytes)])
        await writeBackendPng(request)
        return processResult(JSON.stringify({ page_count: 3 }))
      }
      throw new Error('Unexpected command ' + request.command)
    }

    const rendered = await createPdfPageRenderer({ runProcess, temporaryRoot: root })(input())

    expect(rendered.renderer).toBe('pdfjs')
    expect(rendered.page_count).toBe(3)
    expect(calls.map(call => call.command)).toEqual(commands)
    await expectClean()
  })

  it.each(['EACCES', 'EPERM', 'ENOEXEC', 'ENOSYS'] as const)('falls back for an unusable Poppler executable (%s)', async code => {
    const calls: PdfPageProcessRequest[] = []
    const runProcess: PdfPageProcessRunner = async request => {
      calls.push(request)
      if (request.command === 'pdfinfo') throw unavailable(code)
      expect(request.command).toBe('pdfjs')
      await writeBackendPng(request)
      return processResult('{"page_count":3}')
    }

    await expect(createPdfPageRenderer({ runProcess, temporaryRoot: root })(input())).resolves.toMatchObject({
      renderer: 'pdfjs', page_count: 3,
    })
    expect(calls.map(call => call.command)).toEqual(['pdfinfo', 'pdfjs'])
    await expectClean()
  })

  it('reports both unavailable backends without leaking executable or temporary paths', async () => {
    const leakedPoppler = '/secret/bin/pdfinfo-from-private-path'
    const leakedPdfjs = '/secret/package/pdfjs-worker-from-private-path.mjs'
    const runProcess: PdfPageProcessRunner = async request => {
      throw unavailable('ENOENT', request.command === 'pdfjs' ? leakedPdfjs : leakedPoppler)
    }

    const error = await createPdfPageRenderer({ runProcess, temporaryRoot: root })(input())
      .then(() => undefined, reason => reason)

    expect(error).toMatchObject({ failure: { code: 'UNSUPPORTED_OPTION' } })
    expect(error.failure.message).toMatch(/Poppler|pdfjs/i)
    expect(error.failure.message).not.toContain(leakedPoppler)
    expect(error.failure.message).not.toContain(leakedPdfjs)
    expect(error.failure.message).not.toContain(root)
    await expectClean()
  })

  it.each([
    {
      name: 'pdfinfo non-zero exit',
      runner: async (request: PdfPageProcessRequest) => request.command === 'pdfinfo'
        ? processResult('', { exitCode: 1, stderr: 'invalid PDF at /secret/input.pdf' })
        : (() => { throw new Error('unexpected fallback') })(),
      expected: 'INVALID_REQUEST',
    },
    {
      name: 'malformed pdfinfo summary',
      runner: async (request: PdfPageProcessRequest) => request.command === 'pdfinfo'
        ? processResult('Pages: unknown\n')
        : (() => { throw new Error('unexpected fallback') })(),
      expected: 'INVALID_REQUEST',
    },
    {
      name: 'requested page out of range',
      runner: async (request: PdfPageProcessRequest) => request.command === 'pdfinfo'
        ? processResult('Pages: 1\n')
        : (() => { throw new Error('unexpected fallback') })(),
      expected: 'INVALID_REQUEST',
    },
    {
      name: 'pdftoppm non-zero exit',
      runner: async (request: PdfPageProcessRequest) => request.command === 'pdfinfo'
        ? processResult('Pages: 3\n')
        : request.command === 'pdftoppm'
          ? processResult('', { exitCode: 1 })
          : (() => { throw new Error('unexpected fallback') })(),
      expected: 'INVALID_REQUEST',
    },
    {
      name: 'bounded process output violation',
      runner: async (request: PdfPageProcessRequest) => processResult(Buffer.alloc(request.maxStdoutBytes + 1)),
      expected: 'RESULT_TOO_LARGE',
    },
  ])('does not fall back for $name', async ({ runner, expected }) => {
    const wrapped = vi.fn<PdfPageProcessRunner>(runner)
    await expect(createPdfPageRenderer({ runProcess: wrapped, temporaryRoot: root })(input())).rejects.toMatchObject({
      failure: { code: expected },
    })
    expect(wrapped.mock.calls.some(([request]) => request.command === 'pdfjs')).toBe(false)
    await expectClean()
  })

  it('does not fall back for a non-environment process failure', async () => {
    const calls: PdfPageProcessRequest[] = []
    const runProcess: PdfPageProcessRunner = async request => {
      calls.push(request)
      throw Object.assign(new Error('generic process failure'), { code: 'EINVAL' })
    }

    await expect(createPdfPageRenderer({ runProcess, temporaryRoot: root })(input())).rejects.toMatchObject({
      failure: { code: 'PROVIDER_UNAVAILABLE' },
    })
    expect(calls.map(call => call.command)).toEqual(['pdfinfo'])
    await expectClean()
  })

  it('does not fall back after caller cancellation', async () => {
    const controller = new AbortController()
    const calls: PdfPageProcessRequest[] = []
    const runProcess: PdfPageProcessRunner = request => {
      calls.push(request)
      return new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })
      })
    }
    const pending = createPdfPageRenderer({ runProcess, temporaryRoot: root })(input({ signal: controller.signal }))
    while (calls.length === 0) await new Promise(resolve => setImmediate(resolve))
    controller.abort()

    await expect(pending).rejects.toMatchObject({ failure: { code: 'CANCELLED' } })
    expect(calls.map(call => call.command)).toEqual(['pdfinfo'])
    await expectClean()
  })

  it('does not fall back when the whole-operation deadline expires', async () => {
    const calls: PdfPageProcessRequest[] = []
    const runProcess: PdfPageProcessRunner = request => {
      calls.push(request)
      return new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })
      })
    }

    await expect(createPdfPageRenderer({ runProcess, temporaryRoot: root, runtimeMs: 20 })(input())).rejects.toMatchObject({
      failure: { code: 'PROVIDER_UNAVAILABLE' },
    })
    expect(calls.map(call => call.command)).toEqual(['pdfinfo'])
    await expectClean()
  })

  it('reuses the immutable parent snapshot after the caller source changes before fallback', async () => {
    const calls: PdfPageProcessRequest[] = []
    const runProcess: PdfPageProcessRunner = async request => {
      calls.push(request)
      if (request.command === 'pdfinfo') return processResult('Pages: 3\n')
      if (request.command === 'pdftoppm') {
        await writeFile(sourcePath, 'replacement bytes')
        throw unavailable('ENOENT')
      }
      const { snapshot } = pdfjsPaths(request)
      expect(await readFile(snapshot)).toEqual(original)
      await writeBackendPng(request)
      return processResult('{"page_count":3}')
    }

    const rendered = await createPdfPageRenderer({ runProcess, temporaryRoot: root })(input())

    expect(rendered).toMatchObject({
      renderer: 'pdfjs',
      sha256: createHash('sha256').update(original).digest('hex'),
    })
    expect(calls.map(call => call.command)).toEqual(['pdfinfo', 'pdftoppm', 'pdfjs'])
    expect(await readFile(sourcePath, 'utf8')).toBe('replacement bytes')
    await expectClean()
  })

  it('passes only the remaining whole-operation budget to fallback processes', async () => {
    const timeouts: number[] = []
    const runProcess: PdfPageProcessRunner = async request => {
      timeouts.push(request.timeoutMs)
      await new Promise(resolve => setTimeout(resolve, 20))
      if (request.command === 'pdfinfo') return processResult('Pages: 3\n')
      if (request.command === 'pdftoppm') throw unavailable('ENOENT')
      await writeBackendPng(request)
      return processResult('{"page_count":3}')
    }

    await createPdfPageRenderer({ runProcess, temporaryRoot: root, runtimeMs: 1000 })(input())

    expect(timeouts).toHaveLength(3)
    expect(timeouts[1]!).toBeLessThan(timeouts[0]!)
    expect(timeouts[2]!).toBeLessThan(timeouts[1]!)
    expect(timeouts[2]!).toBeGreaterThan(0)
    await expectClean()
  })

  it('holds one semaphore slot through fallback and releases it after completion', async () => {
    let activeFallbacks = 0
    let peakFallbacks = 0
    const gates: Array<() => void> = []
    const runProcess: PdfPageProcessRunner = async request => {
      if (request.command === 'pdfinfo') throw unavailable('ENOENT')
      activeFallbacks += 1
      peakFallbacks = Math.max(peakFallbacks, activeFallbacks)
      await new Promise<void>(resolve => gates.push(resolve))
      activeFallbacks -= 1
      await writeBackendPng(request)
      return processResult('{"page_count":3}')
    }
    const render = createPdfPageRenderer({ runProcess, temporaryRoot: root, maxConcurrency: 2 })
    const pending = [render(input()), render(input()), render(input())]

    while (gates.length < 2) await new Promise(resolve => setImmediate(resolve))
    expect(peakFallbacks).toBe(2)
    expect(gates).toHaveLength(2)
    gates.splice(0).forEach(release => release())
    while (gates.length < 1) await new Promise(resolve => setImmediate(resolve))
    gates.splice(0).forEach(release => release())

    await expect(Promise.all(pending)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ renderer: 'pdfjs' }),
    ]))
    expect(peakFallbacks).toBe(2)
    await expectClean()
  })

  it('rejects an invalid PNG from fallback and cleans all private files', async () => {
    const runProcess: PdfPageProcessRunner = async request => {
      if (request.command === 'pdfinfo') throw unavailable('ENOENT')
      await writeBackendPng(request, Buffer.from('not a PNG'))
      return processResult('{"page_count":3}')
    }

    await expect(createPdfPageRenderer({ runProcess, temporaryRoot: root })(input())).rejects.toMatchObject({
      failure: { code: 'INVALID_REQUEST' },
    })
    await expectClean()
  })

  it.each([
    [20, 'UNSUPPORTED_OPTION'],
    [21, 'INVALID_REQUEST'],
    [22, 'RESULT_TOO_LARGE'],
    [23, 'PROVIDER_UNAVAILABLE'],
  ] as const)('maps pdfjs worker exit %i without accepting partial output', async (exitCode, expectedCode) => {
    const runProcess: PdfPageProcessRunner = async request => {
      if (request.command === 'pdfinfo') throw unavailable('ENOENT')
      await writeBackendPng(request)
      return processResult('{"page_count":3}', { exitCode })
    }

    await expect(createPdfPageRenderer({ runProcess, temporaryRoot: root })(input())).rejects.toMatchObject({
      failure: { code: expectedCode },
    })
    await expectClean()
  })

  it('surfaces cleanup failure after a successful fallback without leaking the private path', async () => {
    const removeTemporaryDirectory = vi.fn(async (path: string) => {
      throw new Error('cleanup failed at ' + path)
    })
    const runProcess: PdfPageProcessRunner = async request => {
      if (request.command === 'pdfinfo') throw unavailable('ENOENT')
      await writeBackendPng(request)
      return processResult('{"page_count":3}')
    }

    const error = await createPdfPageRenderer({ runProcess, temporaryRoot: root, removeTemporaryDirectory })(input())
      .then(() => undefined, reason => reason)

    expect(error).toMatchObject({
      failure: { code: 'PROVIDER_UNAVAILABLE', message: 'Failed to remove temporary PDF page-rendering data' },
    })
    expect(error.failure.message).not.toContain(root)
    expect(removeTemporaryDirectory).toHaveBeenCalledTimes(1)
  })

  it('keeps fallback output bounded by the parent PNG limit', async () => {
    const requests: PdfPageProcessRequest[] = []
    const runProcess: PdfPageProcessRunner = async request => {
      requests.push(request)
      if (request.command === 'pdfinfo') throw unavailable('ENOENT')
      expect(request.watchedOutput).toMatchObject({ maxBytes: MAX_RENDERED_PNG_BYTES })
      await writeBackendPng(request)
      return processResult('{"page_count":3}')
    }

    await createPdfPageRenderer({ runProcess, temporaryRoot: root })(input())
    expect(requests.map(request => request.command)).toEqual(['pdfinfo', 'pdfjs'])
    await expectClean()
  })
})
