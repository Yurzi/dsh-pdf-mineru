import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runPdfPageProcess, type PdfPageProcessRequest } from '../src/reader/page/page-renderer.js'

describe('local renderer process lifecycle', () => {
  let root: string
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'mineru-process-test-')) })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })
  const hanging = "require('node:fs').writeFileSync('pid', String(process.pid)); setInterval(() => {}, 1000)"
  function request(code: string, overrides: Partial<PdfPageProcessRequest> = {}): PdfPageProcessRequest {
    return { command: 'pdfjs', args: ['-e', code], cwd: root,
      signal: new AbortController().signal, timeoutMs: 2000,
      maxStdoutBytes: 1024, maxStderrBytes: 1024, ...overrides }
  }
  const childPid = async (): Promise<number> => Number(await readFile(join(root, 'pid'), 'utf8'))
  /** Resolves once the child has written its pid, i.e. it is running. */
  const startedPid = (): Promise<number> => vi.waitFor(childPid, { timeout: 2000, interval: 5 })
  function expectReaped(pid: number): void {
    expect(() => process.kill(pid, 0)).toThrowError(expect.objectContaining({ code: 'ESRCH' }))
  }

  it('kills and reaps the Node child before rejecting cancellation', async () => {
    const controller = new AbortController()
    const rejection = expect(runPdfPageProcess(request(hanging, { signal: controller.signal }))).rejects.toMatchObject({ name: 'AbortError' })
    const pid = await startedPid()
    controller.abort()
    await rejection
    expectReaped(pid)
  })

  it('kills and reaps the Node child on its remaining runtime limit', async () => {
    const rejection = expect(runPdfPageProcess(request(hanging, { timeoutMs: 400 }))).rejects.toMatchObject({ kind: 'timeout' })
    const pid = await startedPid()
    await rejection
    expectReaped(pid)
  })

  it.each(['stdout', 'stderr'] as const)('terminates on bounded %s capture overflow', async stream => {
    await expect(runPdfPageProcess(request(hanging + '; process.' + stream + '.write(Buffer.alloc(2048))')))
      .rejects.toMatchObject({ kind: 'output-limit' })
    expectReaped(await childPid())
  })

  it('terminates growing PNG output and reaps before completion', async () => {
    await expect(runPdfPageProcess(request(
      hanging + "; require('node:fs').writeFileSync('page.png', Buffer.alloc(2048))",
      { watchedOutput: { path: join(root, 'page.png'), maxBytes: 1024 } },
    ))).rejects.toMatchObject({ kind: 'output-limit' })
    expectReaped(await childPid())
  })

  it('reports abnormal child exit without accepting it as successful output', async () => {
    await expect(runPdfPageProcess(request('process.exit(23)'))).resolves.toMatchObject({ exitCode: 23, signal: null })
  })
})
