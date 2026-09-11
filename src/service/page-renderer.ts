import { constants, createWriteStream } from 'node:fs'
import type { BigIntStats } from 'node:fs'
import { lstat, mkdtemp, open, rm, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { MinerUError, failure } from '../domain/errors.js'
import { emitDiagnostic } from '../observability.js'
import type { MinerUDiagnosticSink } from '../observability.js'

/** Aspect-preserving Poppler target: the longer page edge is capped at 1600 pixels. */
export const PDF_PAGE_MAX_LONG_EDGE = 1600
/** Defensive validation envelope retained independently from Poppler's scale target. */
export const MAX_PDF_PAGE_WIDTH = 1600
export const MAX_PDF_PAGE_HEIGHT = 2000
export const MAX_PDF_PAGE_PIXELS = MAX_PDF_PAGE_WIDTH * MAX_PDF_PAGE_HEIGHT
export const MAX_RENDERED_PNG_BYTES = 8 * 1024 * 1024
export const MAX_PDF_PAGE_RENDER_CONCURRENCY = 2
export const PDF_PAGE_RENDER_TIMEOUT_MS = 45_000

const MAX_PDFINFO_STDOUT_BYTES = 64 * 1024
const MAX_PROCESS_STDERR_BYTES = 16 * 1024
const MAX_RENDER_STDOUT_BYTES = 4 * 1024
const MAX_PAGE_COUNT = 1_000_000
const IO_CHUNK_BYTES = 64 * 1024
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export interface RenderPdfPageInput {
  readonly file_path: string
  readonly page: number
  readonly cwd?: string
  readonly maxFileBytes: number
  readonly signal: AbortSignal
  readonly expectedSha256?: string
}

export interface RenderedPdfPage {
  readonly name: string
  readonly page: number
  readonly page_count: number
  /** SHA-256 of the immutable source snapshot, not the rendered PNG. */
  readonly sha256: string
  readonly data: Uint8Array
  readonly media_type: 'image/png'
  readonly width?: number
  readonly height?: number
}

export interface PdfPageProcessRequest {
  readonly command: 'pdfinfo' | 'pdftoppm'
  readonly args: readonly string[]
  readonly cwd: string
  readonly signal: AbortSignal
  readonly timeoutMs: number
  readonly maxStdoutBytes: number
  readonly maxStderrBytes: number
  /** A private output path which may be watched and terminated if it grows too large. */
  readonly watchedOutput?: Readonly<{ path: string; maxBytes: number }>
}

export interface PdfPageProcessResult {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: Uint8Array
  readonly stderr: Uint8Array
}

export type PdfPageProcessRunner = (request: PdfPageProcessRequest) => Promise<PdfPageProcessResult>

export interface PdfPageRendererDependencies {
  readonly runProcess?: PdfPageProcessRunner
  readonly temporaryRoot?: string
  readonly maxConcurrency?: number
  readonly runtimeMs?: number
  /** Testable cleanup seam; production defaults to recursive removal with retries. */
  readonly removeTemporaryDirectory?: (path: string) => Promise<void>
  readonly diagnostics?: MinerUDiagnosticSink
}

type ProcessFailureKind = 'spawn' | 'timeout' | 'output-limit'

class ProcessFailure extends Error {
  constructor(readonly kind: ProcessFailureKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PdfPageProcessFailure'
  }
}

class Semaphore {
  private active = 0
  private readonly waiters: Array<{
    readonly signal: AbortSignal
    readonly resolve: (release: () => void) => void
    readonly reject: (reason: unknown) => void
    readonly onAbort: () => void
  }> = []

  constructor(private readonly limit: number) {}

  acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(signal.reason)
    if (this.active < this.limit) {
      this.active += 1
      return Promise.resolve(this.makeRelease())
    }
    return new Promise((resolvePromise, rejectPromise) => {
      const waiter = {
        signal,
        resolve: resolvePromise,
        reject: rejectPromise,
        onAbort: (): void => {
          const index = this.waiters.indexOf(waiter)
          if (index >= 0) this.waiters.splice(index, 1)
          rejectPromise(signal.reason)
        },
      }
      this.waiters.push(waiter)
      signal.addEventListener('abort', waiter.onAbort, { once: true })
    })
  }

  private makeRelease(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      while (this.waiters.length > 0) {
        const waiter = this.waiters.shift()!
        waiter.signal.removeEventListener('abort', waiter.onAbort)
        if (waiter.signal.aborted) {
          waiter.reject(waiter.signal.reason)
          continue
        }
        waiter.resolve(this.makeRelease())
        return
      }
      this.active -= 1
    }
  }
}

function killChild(child: ChildProcess): void {
  try {
    child.kill('SIGKILL')
  } catch {
    // The close event still reaps a child which exited between the check and kill.
  }
}

/** Spawn one fixed local Poppler command without a shell and resolve only after it closes. */
export const runPdfPageProcess: PdfPageProcessRunner = request => new Promise((resolvePromise, rejectPromise) => {
  request.signal.throwIfAborted()
  let child: ChildProcess
  try {
    child = spawn(request.command, [...request.args], {
      cwd: request.cwd,
      env: { PATH: process.env.PATH ?? '', LANG: 'C', LC_ALL: 'C' },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
  } catch (error) {
    rejectPromise(error)
    return
  }

  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let stdoutBytes = 0
  let stderrBytes = 0
  let terminalError: unknown
  let watching = false

  const failAndKill = (error: unknown): void => {
    if (terminalError !== undefined) return
    terminalError = error
    killChild(child)
  }
  const capture = (target: Buffer[], kind: 'stdout' | 'stderr', raw: Buffer | string): void => {
    if (terminalError !== undefined) return
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
    if (kind === 'stdout') stdoutBytes += chunk.byteLength
    else stderrBytes += chunk.byteLength
    const bytes = kind === 'stdout' ? stdoutBytes : stderrBytes
    const limit = kind === 'stdout' ? request.maxStdoutBytes : request.maxStderrBytes
    if (bytes > limit) {
      failAndKill(new ProcessFailure('output-limit', request.command + ' ' + kind + ' exceeded its byte limit'))
      return
    }
    target.push(chunk)
  }

  child.stdout?.on('data', chunk => capture(stdout, 'stdout', chunk as Buffer))
  child.stderr?.on('data', chunk => capture(stderr, 'stderr', chunk as Buffer))
  child.once('error', error => failAndKill(error))

  const onAbort = (): void => failAndKill(request.signal.reason)
  request.signal.addEventListener('abort', onAbort, { once: true })
  if (request.signal.aborted) onAbort()

  const timeout = setTimeout(() => {
    failAndKill(new ProcessFailure('timeout', request.command + ' exceeded its runtime limit'))
  }, request.timeoutMs)
  timeout.unref()

  const outputWatch = request.watchedOutput === undefined ? undefined : setInterval(() => {
    if (watching || terminalError !== undefined) return
    watching = true
    void stat(request.watchedOutput!.path).then(info => {
      if (info.size > request.watchedOutput!.maxBytes) {
        failAndKill(new ProcessFailure('output-limit', 'Rendered PNG exceeded its byte limit'))
      }
    }, error => {
      if (errorCode(error) !== 'ENOENT') failAndKill(error)
    }).finally(() => { watching = false })
  }, 25)
  outputWatch?.unref()

  child.once('close', (exitCode, signal) => {
    clearTimeout(timeout)
    if (outputWatch !== undefined) clearInterval(outputWatch)
    request.signal.removeEventListener('abort', onAbort)
    if (terminalError !== undefined) {
      rejectPromise(terminalError)
      return
    }
    resolvePromise({
      exitCode,
      signal,
      stdout: Buffer.concat(stdout, stdoutBytes),
      stderr: Buffer.concat(stderr, stderrBytes),
    })
  })
})

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

function invalid(message: string, cause?: unknown): MinerUError {
  return new MinerUError(failure('INVALID_REQUEST', message), cause === undefined ? undefined : { cause })
}

function assertInput(input: RenderPdfPageInput): void {
  if (typeof input.file_path !== 'string' || input.file_path.trim() === '') {
    throw invalid('A local PDF path is required for page rendering')
  }
  if (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > MAX_PAGE_COUNT) {
    throw invalid('PDF page must be a positive safe integer')
  }
  if (!Number.isSafeInteger(input.maxFileBytes) || input.maxFileBytes < 1) {
    throw invalid('maxFileBytes must be a positive safe integer')
  }
  if (input.expectedSha256 !== undefined && !/^[a-fA-F0-9]{64}$/.test(input.expectedSha256)) {
    throw invalid('expectedSha256 must be a 64-character hexadecimal SHA-256 digest')
  }
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function sameVersion(left: BigIntStats, right: BigIntStats): boolean {
  return sameIdentity(left, right)
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
}

async function checkedPathStat(path: string, name: string): Promise<BigIntStats> {
  let info: BigIntStats
  try {
    info = await lstat(path, { bigint: true })
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      throw new MinerUError(failure('FILE_NOT_FOUND', 'PDF does not exist: ' + name), { cause: error })
    }
    throw error
  }
  if (info.isSymbolicLink()) throw invalid('PDF source must not be a symbolic link: ' + name)
  if (!info.isFile()) throw invalid('PDF source is not a regular file: ' + name)
  return info
}

async function openCheckedSource(path: string, name: string, maxFileBytes: number): Promise<{
  readonly handle: FileHandle
  readonly initial: BigIntStats
}> {
  const before = await checkedPathStat(path, name)
  let handle: FileHandle
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      throw new MinerUError(failure('FILE_NOT_FOUND', 'PDF does not exist: ' + name), { cause: error })
    }
    if (errorCode(error) === 'ELOOP') throw invalid('PDF source must not be a symbolic link: ' + name, error)
    throw error
  }
  try {
    const opened = await handle.stat({ bigint: true })
    const afterOpen = await checkedPathStat(path, name)
    if (!opened.isFile() || !sameIdentity(before, opened) || !sameIdentity(opened, afterOpen)) {
      throw invalid('PDF source changed while it was being opened: ' + name)
    }
    if (opened.size > BigInt(maxFileBytes)) {
      throw new MinerUError(failure('FILE_TOO_LARGE', name + ' exceeds the configured file-size limit'))
    }
    return { handle, initial: opened }
  } catch (error) {
    await handle.close()
    throw error
  }
}

async function snapshotSource(
  sourcePath: string,
  snapshotPath: string,
  sourceName: string,
  maxFileBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const { handle, initial } = await openCheckedSource(sourcePath, sourceName, maxFileBytes)
  const hash = createHash('sha256')
  let bytes = 0
  const limiter = new Transform({
    transform(chunk: Buffer | Uint8Array, _encoding, callback) {
      bytes += chunk.byteLength
      if (bytes > maxFileBytes) {
        callback(new MinerUError(failure('FILE_TOO_LARGE', sourceName + ' exceeds the configured file-size limit')))
        return
      }
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  try {
    await pipeline(
      handle.createReadStream({ autoClose: false }),
      limiter,
      createWriteStream(snapshotPath, { flags: 'wx', mode: 0o600 }),
      { signal },
    )
    signal.throwIfAborted()
    const finalHandle = await handle.stat({ bigint: true })
    let finalPath: BigIntStats
    try {
      finalPath = await checkedPathStat(sourcePath, sourceName)
    } catch (error) {
      throw invalid('PDF source changed while it was being copied: ' + sourceName, error)
    }
    if (!sameVersion(initial, finalHandle) || !sameVersion(finalHandle, finalPath) || BigInt(bytes) !== initial.size) {
      throw invalid('PDF source changed while it was being copied: ' + sourceName)
    }
    return hash.digest('hex')
  } finally {
    await handle.close()
  }
}

function boundedProcessResult(result: PdfPageProcessResult, request: PdfPageProcessRequest): PdfPageProcessResult {
  if (result.stdout.byteLength > request.maxStdoutBytes || result.stderr.byteLength > request.maxStderrBytes) {
    throw new MinerUError(failure('RESULT_TOO_LARGE', request.command + ' output exceeded its byte limit'))
  }
  return result
}

async function invokeProcess(runProcess: PdfPageProcessRunner, request: PdfPageProcessRequest): Promise<PdfPageProcessResult> {
  try {
    return boundedProcessResult(await runProcess(request), request)
  } catch (error) {
    if (error instanceof MinerUError) throw error
    if (request.signal.aborted) throw request.signal.reason
    if (errorCode(error) === 'ENOENT') {
      throw new MinerUError(failure(
        'UNSUPPORTED_OPTION',
        'Local PDF page rendering requires the ' + request.command + ' Poppler executable',
      ), { cause: error })
    }
    if (error instanceof ProcessFailure && error.kind === 'output-limit') {
      throw new MinerUError(failure('RESULT_TOO_LARGE', request.command + ' output exceeded its byte limit'), { cause: error })
    }
    if (error instanceof ProcessFailure && error.kind === 'timeout') {
      throw new MinerUError(failure('PROVIDER_UNAVAILABLE', request.command + ' exceeded its runtime limit', true), { cause: error })
    }
    throw new MinerUError(failure('PROVIDER_UNAVAILABLE', 'Failed to execute local ' + request.command, true), { cause: error })
  }
}

function parsePageCount(stdout: Uint8Array): number {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(stdout)
  } catch (error) {
    throw invalid('pdfinfo returned invalid UTF-8 output', error)
  }
  const matches = [...text.matchAll(/^Pages:\s+([1-9][0-9]{0,6})\s*$/gm)]
  if (matches.length !== 1) throw invalid('pdfinfo did not return one valid physical page count')
  const pages = Number(matches[0]![1])
  if (!Number.isSafeInteger(pages) || pages < 1 || pages > MAX_PAGE_COUNT) {
    throw invalid('PDF physical page count is outside the supported range')
  }
  return pages
}

async function readBoundedFile(path: string, maxBytes: number): Promise<Uint8Array> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const before = await handle.stat({ bigint: true })
    if (!before.isFile()) throw invalid('Rendered PNG is not a regular file')
    if (before.size > BigInt(maxBytes)) {
      throw new MinerUError(failure('RESULT_TOO_LARGE', 'Rendered PNG exceeds its byte limit'))
    }
    const chunks: Buffer[] = []
    let total = 0
    let position = 0
    for (;;) {
      const chunk = Buffer.allocUnsafe(Math.min(IO_CHUNK_BYTES, maxBytes + 1 - total))
      const read = await handle.read(chunk, 0, chunk.byteLength, position)
      if (read.bytesRead === 0) break
      total += read.bytesRead
      position += read.bytesRead
      if (total > maxBytes) {
        throw new MinerUError(failure('RESULT_TOO_LARGE', 'Rendered PNG exceeds its byte limit'))
      }
      chunks.push(chunk.subarray(0, read.bytesRead))
    }
    const after = await handle.stat({ bigint: true })
    if (!sameVersion(before, after) || BigInt(total) !== before.size) {
      throw invalid('Rendered PNG changed while it was being read')
    }
    return Buffer.concat(chunks, total)
  } finally {
    await handle.close()
  }
}

function pngDimensions(data: Uint8Array): { width: number; height: number } {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  if (bytes.byteLength < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
    || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw invalid('pdftoppm returned an invalid PNG')
  }
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (width < 1 || height < 1 || width > MAX_PDF_PAGE_WIDTH || height > MAX_PDF_PAGE_HEIGHT
    || width * height > MAX_PDF_PAGE_PIXELS) {
    throw new MinerUError(failure('RESULT_TOO_LARGE', 'Rendered PNG dimensions exceed the page-rendering limit'))
  }
  return { width, height }
}

function outputName(sourceName: string, page: number): string {
  const extension = extname(sourceName)
  const stem = basename(sourceName, extension).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 160) || 'document'
  return stem + '-page-' + String(page) + '.png'
}

function normalizeFailure(error: unknown, timedOut: boolean): MinerUError {
  if (error instanceof MinerUError) return error
  if (timedOut || (error instanceof DOMException && error.name === 'TimeoutError')) {
    return new MinerUError(failure('PROVIDER_UNAVAILABLE', 'PDF page rendering exceeded its runtime limit', true), { cause: error })
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new MinerUError(failure('CANCELLED', 'PDF page rendering was cancelled', true), { cause: error })
  }
  return new MinerUError(failure('PROVIDER_UNAVAILABLE', 'Local PDF page rendering failed', true), { cause: error })
}

export function createPdfPageRenderer(dependencies: PdfPageRendererDependencies = {}):
(input: RenderPdfPageInput) => Promise<RenderedPdfPage> {
  const runProcess = dependencies.runProcess ?? runPdfPageProcess
  const temporaryRoot = dependencies.temporaryRoot ?? tmpdir()
  const maxConcurrency = dependencies.maxConcurrency ?? MAX_PDF_PAGE_RENDER_CONCURRENCY
  const runtimeMs = dependencies.runtimeMs ?? PDF_PAGE_RENDER_TIMEOUT_MS
  const removeTemporaryDirectory = dependencies.removeTemporaryDirectory
    ?? (path => rm(path, { recursive: true, force: true, maxRetries: 2 }))
  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 32) {
    throw new TypeError('maxConcurrency must be an integer between 1 and 32')
  }
  if (!Number.isSafeInteger(runtimeMs) || runtimeMs < 1) throw new TypeError('runtimeMs must be a positive safe integer')
  const semaphore = new Semaphore(maxConcurrency)

  return async input => {
    assertInput(input)
    const sourcePath = resolve(input.cwd ?? process.cwd(), input.file_path.trim())
    const sourceName = basename(sourcePath)
    if (extname(sourceName).toLowerCase() !== '.pdf') {
      throw new MinerUError(failure('UNSUPPORTED_OPTION', 'Original-page rendering supports PDF files only'))
    }

    let timedOut = false
    const operation = new AbortController()
    const onAbort = (): void => operation.abort(new DOMException('PDF page rendering was cancelled', 'AbortError'))
    input.signal.addEventListener('abort', onAbort, { once: true })
    if (input.signal.aborted) onAbort()
    const deadline = setTimeout(() => {
      if (operation.signal.aborted) return
      timedOut = true
      operation.abort(new DOMException('PDF page rendering timed out', 'TimeoutError'))
    }, runtimeMs)
    deadline.unref()

    let release: (() => void) | undefined
    let temporaryDirectory: string | undefined
    let outcome: RenderedPdfPage | undefined
    let primaryFailure: MinerUError | undefined
    let cleanupFailed = false
    try {
      release = await semaphore.acquire(operation.signal)
      operation.signal.throwIfAborted()
      temporaryDirectory = await mkdtemp(join(temporaryRoot, 'dsh-pdf-page-'))
      const snapshotPath = join(temporaryDirectory, 'source.pdf')
      const outputPrefix = join(temporaryDirectory, 'page')
      const outputPath = outputPrefix + '.png'
      const sha256 = await snapshotSource(
        sourcePath, snapshotPath, sourceName, input.maxFileBytes, operation.signal,
      )
      if (input.expectedSha256 !== undefined && sha256 !== input.expectedSha256.toLowerCase()) {
        throw invalid('PDF source hash does not match expectedSha256: ' + sourceName)
      }

      const infoRequest: PdfPageProcessRequest = {
        command: 'pdfinfo',
        args: ['-enc', 'UTF-8', snapshotPath],
        cwd: temporaryDirectory,
        signal: operation.signal,
        timeoutMs: Math.min(10_000, runtimeMs),
        maxStdoutBytes: MAX_PDFINFO_STDOUT_BYTES,
        maxStderrBytes: MAX_PROCESS_STDERR_BYTES,
      }
      const info = await invokeProcess(runProcess, infoRequest)
      if (info.exitCode !== 0) throw invalid('pdfinfo could not inspect the PDF')
      const pageCount = parsePageCount(info.stdout)
      if (input.page > pageCount) {
        throw invalid('PDF page ' + String(input.page) + ' is outside the physical page range 1-' + String(pageCount))
      }

      const renderRequest: PdfPageProcessRequest = {
        command: 'pdftoppm',
        args: [
          '-f', String(input.page), '-l', String(input.page), '-singlefile', '-png',
          '-scale-to', String(PDF_PAGE_MAX_LONG_EDGE),
          snapshotPath, outputPrefix,
        ],
        cwd: temporaryDirectory,
        signal: operation.signal,
        timeoutMs: Math.min(30_000, runtimeMs),
        maxStdoutBytes: MAX_RENDER_STDOUT_BYTES,
        maxStderrBytes: MAX_PROCESS_STDERR_BYTES,
        watchedOutput: { path: outputPath, maxBytes: MAX_RENDERED_PNG_BYTES },
      }
      const rendered = await invokeProcess(runProcess, renderRequest)
      if (rendered.exitCode !== 0) throw invalid('pdftoppm could not render the requested PDF page')
      operation.signal.throwIfAborted()
      let data: Uint8Array
      try {
        data = await readBoundedFile(outputPath, MAX_RENDERED_PNG_BYTES)
      } catch (error) {
        if (errorCode(error) === 'ENOENT') throw invalid('pdftoppm did not produce the requested PNG', error)
        throw error
      }
      const dimensions = pngDimensions(data)
      operation.signal.throwIfAborted()
      outcome = {
        name: outputName(sourceName, input.page),
        page: input.page,
        page_count: pageCount,
        sha256,
        data,
        media_type: 'image/png',
        width: dimensions.width,
        height: dimensions.height,
      }
    } catch (error) {
      primaryFailure = normalizeFailure(error, timedOut)
    } finally {
      try {
        if (temporaryDirectory !== undefined) await removeTemporaryDirectory(temporaryDirectory)
      } catch {
        cleanupFailed = true
        emitDiagnostic(dependencies.diagnostics, {
          level: 'warn', phase: 'failed', errorCode: 'PROVIDER_UNAVAILABLE', retryable: true,
        })
      } finally {
        release?.()
        clearTimeout(deadline)
        input.signal.removeEventListener('abort', onAbort)
      }
    }
    if (primaryFailure !== undefined) throw primaryFailure
    if (cleanupFailed) {
      throw new MinerUError(failure(
        'PROVIDER_UNAVAILABLE', 'Failed to remove temporary PDF page-rendering data', true,
      ))
    }
    if (outcome === undefined) {
      throw new MinerUError(failure('PROVIDER_UNAVAILABLE', 'Local PDF page rendering produced no result', true))
    }
    return outcome
  }
}

export const renderPdfPage = createPdfPageRenderer()
