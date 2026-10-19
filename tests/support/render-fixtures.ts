import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect } from 'vitest'
import type { PdfPageProcessRequest, PdfPageProcessResult, RenderPdfPageInput } from '../../src/reader/page/page-renderer.js'
import { testPng } from '../fixtures/png.js'

/** A finished renderer subprocess with captured output. */
export function processResult(
  stdout: Uint8Array | string = '',
  options: { readonly stderr?: Uint8Array | string; readonly exitCode?: number | null; readonly signal?: NodeJS.Signals | null } = {},
): PdfPageProcessResult {
  const stderr = options.stderr ?? ''
  return {
    exitCode: options.exitCode === undefined ? 0 : options.exitCode,
    signal: options.signal ?? null,
    stdout: typeof stdout === 'string' ? Buffer.from(stdout) : stdout,
    stderr: typeof stderr === 'string' ? Buffer.from(stderr) : stderr,
  }
}

/** A spawn failure for a missing or unusable executable. */
export function unavailable(code: 'ENOENT' | 'EACCES' | 'EPERM' | 'ENOEXEC' | 'ENOSYS', detail = 'private executable detail'): Error {
  return Object.assign(new Error(detail), { code })
}

/** The snapshot path a backend request reads. */
export function snapshotPath(request: PdfPageProcessRequest): string {
  const index = request.command === 'pdfinfo' ? -1 : request.command === 'pdftoppm' ? -2 : -4
  const path = request.args.at(index)
  if (path === undefined) throw new Error('snapshot argument is missing')
  return path
}

/** Write the PNG a pdftoppm or pdfjs request is expected to produce. */
export async function writeBackendPng(request: PdfPageProcessRequest, bytes: Uint8Array = testPng()): Promise<void> {
  const target = request.command === 'pdftoppm' ? request.args.at(-1) + '.png' : request.command === 'pdfjs' ? request.args.at(-3) : undefined
  if (target === undefined) throw new Error('Unexpected render command: ' + request.command)
  await writeFile(target, bytes)
}

/**
 * Per-test temporary root holding one source PDF; registers its own beforeEach/afterEach.
 * input() targets page 2 of that source with a 1 MiB file bound.
 */
export function renderRoot(sourceName: string, source: Uint8Array) {
  const state = { root: '', sourcePath: '' }
  beforeEach(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'mineru-page-render-'))
    state.sourcePath = join(state.root, sourceName)
    await writeFile(state.sourcePath, source)
  })
  afterEach(async () => {
    await rm(state.root, { recursive: true, force: true })
  })
  return {
    get root(): string { return state.root },
    get sourcePath(): string { return state.sourcePath },
    input: (overrides: Partial<RenderPdfPageInput> = {}): RenderPdfPageInput => ({
      file_path: state.sourcePath, page: 2, maxFileBytes: 1024 * 1024, signal: new AbortController().signal, ...overrides,
    }),
    /** Assert that only the given entries (default: the source) remain, i.e. every private snapshot was removed. */
    expectOnly: async (files: readonly string[] = [sourceName]): Promise<void> => {
      expect((await readdir(state.root)).sort()).toEqual([...files].sort())
    },
  }
}
