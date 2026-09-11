import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runPdfPageProcess, type PdfPageProcessRequest } from '../src/service/page-renderer.js'

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
  async function waitForPid(): Promise<number> {
    for (let attempt = 0; attempt < 200; attempt++) {
      try { return Number(await readFile(join(root, 'pid'), 'utf8')) } catch {}
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    throw new Error('Child did not start')
  }
  function expectReaped(pid: number) {
    expect(() => process.kill(pid, 0)).toThrowError(expect.objectContaining({ code: 'ESRCH' }))
  }
  it('kills and reaps the Node child before rejecting cancellation', async () => {
    const controller = new AbortController()
    const pending = runPdfPageProcess(request(hanging, { signal: controller.signal }))
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    const pid = await waitForPid()
    controller.abort()
    await rejection
    expectReaped(pid)
  })
  it('kills and reaps the Node child on its remaining runtime limit', async () => {
    const pending = runPdfPageProcess(request(hanging, { timeoutMs: 400 }))
    const rejection = expect(pending).rejects.toMatchObject({ kind: 'timeout' })
    const pid = await waitForPid()
    await rejection
    expectReaped(pid)
  })
  it.each(['stdout', 'stderr'] as const)('terminates on bounded %s capture overflow', async stream => {
    await expect(runPdfPageProcess(request(
      hanging + '; process.' + stream + '.write(Buffer.alloc(2048))',
    ))).rejects.toMatchObject({ kind: 'output-limit' })
    expectReaped(Number(await readFile(join(root, 'pid'), 'utf8')))
  })
  it('terminates growing PNG output and reaps before completion', async () => {
    await expect(runPdfPageProcess(request(
      hanging + "; require('node:fs').writeFileSync('page.png', Buffer.alloc(2048))",
      { watchedOutput: { path: join(root, 'page.png'), maxBytes: 1024 } },
    ))).rejects.toMatchObject({ kind: 'output-limit' })
    expectReaped(Number(await readFile(join(root, 'pid'), 'utf8')))
  })
  it('reports abnormal child exit without accepting it as successful output', async () => {
    await expect(runPdfPageProcess(request('process.exit(23)'))).resolves.toMatchObject({ exitCode: 23, signal: null })
  })
})
