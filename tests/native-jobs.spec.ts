import type { JobEvent } from '@deepseek-ai/dsh-jobs'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { MinerUError, failure } from '../src/domain/errors.js'
import { toolHarness, type ToolHarnessOptions, type ToolReader } from './support/tool-harness.js'
import { summaryView } from './support/views.js'

// Registry, Session, owner lifecycle and admission are the published LocalJobRegistry/AgentRegistry.
async function harness(summarize: ToolReader['summarize'], options: ToolHarnessOptions = {}) {
  const h = await toolHarness({ ...options, reader: { summarize } })
  const events: JobEvent[] = []
  h.ctx.jobs.events.subscribe({ owner: h.session.id }, event => events.push(event))
  return { ...h, events }
}

describe('async_parse_pdf with the published job registry', () => {
  it('delivers progress and one final result with owner-fenced reads', async () => {
    const h = await harness(async (_path, _config, _signal, progress) => {
      progress?.('preparing')
      await Promise.resolve() // later progress arrives after the registration commit
      progress?.('summarizing')
      return summaryView({ files: [{ file_id: 'mf_native', name: 'paper.pdf', artifacts: [] }] })
    })
    const id = await h.submit({ file_path: '/paper.pdf' })
    await h.ctx.jobs.wait(id, 1000, h.session.id)
    expect(h.ctx.jobs.get(id, h.session.id)).toMatchObject({ kind: 'mineru', status: 'completed', outputLimitBytes: 48_000 })
    expect(h.events[0]?.type).toBe('registered')
    expect(h.events.some(event => event.type === 'progress' && event.job.progress === 'summarizing')).toBe(true)
    expect(() => h.ctx.jobs.read(id, SessionId('foreign'))).toThrow()
    expect(h.ctx.jobs.list(SessionId('foreign'))).toEqual([])
    const read = h.ctx.jobs.read(id, h.session.id)
    expect(read.result).toContain('paper.pdf')
    expect(read.chunks).toEqual([]) // progress is never duplicated into the output ring
    expect(h.ctx.jobs.read(id, h.session.id).result).toBeUndefined()
  })

  it('refuses before invoking the reader when no job controller is attached', async () => {
    const summarize = vi.fn(async () => summaryView())
    const h = await harness(summarize, { jobController: false })
    await expect(h.submit({ file_path: '/paper.pdf' })).rejects.toThrow()
    expect(summarize).not.toHaveBeenCalled()
    expect(h.ctx.jobs.list(h.session.id)).toEqual([])
  })

  it('settles failures with the MinerU code in detail and result', async () => {
    const h = await harness(async () => { throw new MinerUError(failure('FILE_TOO_LARGE', 'Input exceeds limit')) })
    const id = await h.submit({ file_path: '/paper.pdf' })
    await h.ctx.jobs.wait(id, 1000, h.session.id)
    const read = h.ctx.jobs.read(id, h.session.id)
    expect(read.job).toMatchObject({ status: 'failed', detail: 'FILE_TOO_LARGE' })
    expect(read.result).toMatch(/^\[FILE_TOO_LARGE\]/)
  })

  it.each(['kill', 'owner', 'plugin'] as const)('aborts the invocation and awaits its cleanup on %s', async mode => {
    let signal: AbortSignal | undefined
    let cleaned = false
    const h = await harness(async (_path, _config, invocationSignal) => {
      signal = invocationSignal
      try {
        await new Promise<void>((_resolve, reject) => invocationSignal.addEventListener('abort', () => reject(invocationSignal.reason), { once: true }))
      } finally { cleaned = true }
      return summaryView()
    })
    const id = await h.submit({ file_path: '/paper.pdf' })
    await vi.waitFor(() => expect(signal).toBeDefined())
    if (mode === 'owner') await h.owner.dispose()
    else if (mode === 'plugin') await h.dispose()
    else h.ctx.jobs.kill(id, h.session.id, 'stop this waiter')
    if (mode !== 'owner') {
      await h.ctx.jobs.wait(id, 1000, h.session.id)
      expect(h.ctx.jobs.get(id, h.session.id)).toMatchObject({ status: 'killed' })
    }
    expect(signal?.aborted).toBe(true)
    expect(cleaned).toBe(true)
  })

  it.each([
    { callId: ToolCallId('native-call'), rootCallId: ToolCallId('native-root') },
    { callId: ToolCallId('root:ptc:1'), rootCallId: ToolCallId('root') },
  ])('records the exact creating invocation: %j', async toolCall => {
    const h = await harness(async () => summaryView())
    const id = await h.submit({ file_path: '/paper.pdf' }, h.exec({ name: 'async_parse_pdf', ...toolCall }))
    await h.ctx.jobs.wait(id, 1000, h.session.id)
    const event = h.session.snapshotEvents().find(entry => entry.type === 'job/registered')
    expect(event?.data).toMatchObject({ jobId: id, owner: h.session.id, toolCall })
  })

  it('starts no job when the invocation is cancelled while the source path resolves', async () => {
    const summarize = vi.fn(async () => summaryView())
    const h = await harness(summarize)
    const controller = new AbortController()
    h.ensure.mockImplementationOnce(async () => { controller.abort(); return '/workspace' })
    await expect(h.submit({ file_path: 'paper.pdf' }, h.exec({ name: 'async_parse_pdf', signal: controller.signal }))).rejects.toThrow()
    expect(h.ctx.jobs.list(h.session.id)).toEqual([])
    expect(summarize).not.toHaveBeenCalled()
  })

  it('pins the submit-time directory before registration and never resolves it inside the job', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const summarize = vi.fn<ToolReader['summarize']>(async () => { await gate; return summaryView() })
    const h = await harness(summarize)
    h.setDirectory('/workspace/submit-time')
    const start = vi.spyOn(h.ctx.jobs, 'start')
    const exec = h.exec({ name: 'async_parse_pdf' })
    const id = await h.submit({ file_path: 'paper.pdf' }, exec)
    h.setDirectory('/workspace/later')
    release()
    await h.ctx.jobs.wait(id, 1000, h.session.id)
    expect(h.ensure).toHaveBeenCalledExactlyOnceWith(exec.agent, exec.signal)
    expect(h.ensure.mock.invocationCallOrder[0]).toBeLessThan(start.mock.invocationCallOrder[0]!)
    expect(summarize.mock.calls[0]?.[0]).toBe('/workspace/submit-time/paper.pdf')
  })
})
