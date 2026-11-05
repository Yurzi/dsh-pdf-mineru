import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { emitAgentEvent } from '@deepseek-ai/dsh-agent'
import { JobId, type JobEvent } from '@deepseek-ai/dsh-jobs'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import { createUserMessage, ToolCallId, type ContentBlock, type MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import * as ToolJobs from '@deepseek-ai/dsh-tool-jobs'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { defaultMinerUConfig } from '../src/config/parse.js'
import type { MinerUConfig } from '../src/config/model.js'
import { formatSingleSummaryProse } from '../src/reader/prose.js'
import type { ParseSummaryView } from '../src/reader/views.js'
import { registerTools } from '../src/tools/index.js'
import { readerHarness } from './support/reader-harness.js'
import { projectedReader, testAgent, type ToolReader } from './support/tool-harness.js'
import { resultView, summaryView } from './support/views.js'

const SUMMARY = summaryView({ summary: { page_count: 3, table_count: 1, image_count: 2, toc: [{ level: 1, title: 'Results', page: 2 }] } })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

/** Only the reader is held; cancellation, settlement, notices and consuming reads are host code. */
function heldSummary(summary: ParseSummaryView) {
  let finish!: () => void
  let signal!: AbortSignal
  const summarize = vi.fn<ToolReader['summarize']>((_path, _config, invocationSignal) => {
    signal = invocationSignal
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      finish = () => { signal.removeEventListener('abort', abort); resolve(summary) }
    })
  })
  return { summarize, finish: () => finish(), signal: () => signal }
}

function text(value: { readonly content: readonly ContentBlock[] }): string {
  return value.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
}

/** Real published services; only Agent loop/inbox edges and (unless supplied) the reader are fakes. */
async function deliveryHarness(options: {
  summary?: ParseSummaryView
  status?: 'idle' | 'running'
  reader?: ToolReader
  config?: MinerUConfig
} = {}) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalJobRegistry, {})
  await ctx.plugin(ToolJobs, {}) // default 2048-byte inline budget and host-owned wakeup policy
  ctx.provide('workingDirectory', { ensure: async () => '/workspace' })

  const owner = ctx.plugin(() => {})
  const session = Session.create(SessionId('mineru-delivery'))
  const nextStep: UserMessage[] = []
  const nextTurn: UserMessage[] = []
  const remove = vi.fn((id: MessageId) => {
    for (const queue of [nextStep, nextTurn]) {
      const index = queue.findIndex(message => message.id === id)
      if (index !== -1) { queue.splice(index, 1); return true }
    }
    return false
  })
  const inject = vi.fn((message: UserMessage) => { nextStep.push(message) })
  const followup = vi.fn((message: UserMessage) => { nextTurn.push(message) })
  const agent = Object.assign(testAgent(owner.ctx, session), {
    status: options.status ?? 'running', inject, followup,
    inbox: { nextStep, nextTurn, remove },
  })
  await ctx.agents.register(agent)

  const held = heldSummary(options.summary ?? SUMMARY)
  const dispose = registerTools(ctx, {
    reader: options.reader ?? {
      summarize: held.summarize, readContent: projectedReader(), viewPage: async () => resultView(),
    },
    config: () => options.config ?? defaultMinerUConfig(), attachments: () => undefined,
  })
  onTestFinished(dispose)
  const events: JobEvent[] = []
  ctx.jobs.events.subscribe({ owner: session.id }, event => { events.push(event) })
  let calls = 0
  const call = async (name: string, args: unknown) => {
    const batch = await ctx.tools.execute({
      calls: [{ type: 'tool-call', id: ToolCallId('delivery-' + String(++calls)), name, arguments: JSON.stringify(args) }],
      agent, signal: new AbortController().signal,
    })
    const result = batch.results[0]!.result
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error(JSON.stringify(result.error))
    return result
  }
  const submit = async (file = '/paper.pdf') => {
    const result = await call('async_parse_pdf', { file_path: file })
    const value = result.value as { job_id: string; state: string }
    expect(value).toEqual({ job_id: expect.any(String), state: 'running' })
    return JobId(value.job_id)
  }
  const settled = (id: JobId) => new Promise<void>(resolve => {
    const unsubscribe = ctx.jobs.events.subscribe({ owner: session.id }, event => {
      if (event.type !== 'settled' || event.job.id !== id) return
      unsubscribe()
      resolve()
    })
  })
  const complete = async (id: JobId) => {
    const done = settled(id) // event observation is non-consuming, unlike jobs.wait/job_output
    held.finish()
    await done
  }
  const commit = (message: UserMessage) => {
    remove(message.id)
    const event = session.append('user/message', message, { surfaceOp: 'append' })
    ctx.emit('session/event', session, event)
  }
  const steer = () => {
    const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue with another step' }] })
    nextStep.push(message)
    emitAgentEvent(ctx, agent, 'agent/inbox/inserted', { message })
  }
  const notices = () => [...nextStep, ...nextTurn].filter(message => message.source.kind === 'tool-jobs')
  return { ctx, session, agent, held, events, call, submit, settled, complete, commit, steer, notices, inject, followup, remove }
}

/** Observe registration without replacing the registry's wait/cancellation behavior. */
async function awaitingOutput(h: Awaited<ReturnType<typeof deliveryHarness>>, id: JobId) {
  const entered = deferred<void>()
  const wait = h.ctx.jobs.wait.bind(h.ctx.jobs)
  const spy = vi.spyOn(h.ctx.jobs, 'wait').mockImplementation((...args) => {
    const pending = wait(...args)
    entered.resolve()
    return pending
  })
  const result = h.call('job_output', { job_id: id, wait: true })
  await entered.promise
  spy.mockRestore()
  return { result }
}

describe('async_parse_pdf first delivery through published jobs/tool-jobs', () => {
  it.each(['running', 'idle'] as const)('inlines a small summary once for a %s owner', async status => {
    const h = await deliveryHarness({ status })
    const id = await h.submit()
    expect(h.ctx.jobs.get(id, h.session.id)?.status).toBe('running')
    expect(h.notices()).toEqual([])
    await h.complete(id)

    const notice = h.notices()[0]!
    const prose = formatSingleSummaryProse(SUMMARY)
    expect(text(notice)).toContain(prose)
    expect(Buffer.byteLength(text(notice))).toBeLessThanOrEqual(2048)
    expect(status === 'idle' ? h.followup : h.inject).toHaveBeenCalledTimes(1)
    h.commit(notice) // durable delivery, not merely an inbox claim
    expect(h.session.deriveMessages().some(message => text(message).includes(prose))).toBe(true)
    expect((await h.call('job_output', { job_id: id })).value).toMatchObject({ text: '', job: { status: 'completed' } })
    expect(h.notices()).toEqual([])
    expect(h.held.summarize).toHaveBeenCalledTimes(1)
  })

  it('leaves a large summary for job_output after a pointer notice, without replay', async () => {
    const summary = summaryView({ summary: { toc: Array.from({ length: 20 }, (_, i) => ({ level: 1, title: 'Section ' + String(i) + ' 日本語'.repeat(40), page: i + 1 })) } })
    const prose = formatSingleSummaryProse(summary)
    expect(Buffer.byteLength(prose)).toBeGreaterThan(2048)
    expect(Buffer.byteLength(prose)).toBeLessThan(48_000)
    const h = await deliveryHarness({ summary })
    const id = await h.submit()
    await h.complete(id)
    const notice = h.notices()[0]!
    expect(text(notice)).toContain('job_output')
    expect(text(notice)).not.toContain('MinerU Document Parse Summary')
    h.commit(notice)
    expect((await h.call('job_output', { job_id: id })).value).toMatchObject({ text: prose, job: { status: 'completed' } })
    expect((await h.call('job_output', { job_id: id })).value).toMatchObject({ text: '' })
    expect(h.notices()).toEqual([])
  })

  it('withdraws a queued inline notice when an active read wins delivery', async () => {
    const h = await deliveryHarness()
    const id = await h.submit()
    await h.complete(id)
    const notice = h.notices()[0]!
    const result = await h.call('job_output', { job_id: id })
    expect(result.value).toMatchObject({ text: formatSingleSummaryProse(SUMMARY) })
    expect(h.remove).toHaveBeenCalledWith(notice.id)
    expect(h.notices()).toEqual([])
    expect(h.session.deriveMessages()).toEqual([])
    expect((await h.call('job_output', { job_id: id })).value).toMatchObject({ text: '' })
  })

  it('keeps a claimed but uncommitted inline summary available for collection', async () => {
    const h = await deliveryHarness()
    const id = await h.submit()
    await h.complete(id)
    h.remove(h.notices()[0]!.id) // a cancelled/rejected step never logged this notice
    expect((await h.call('job_output', { job_id: id })).value).toMatchObject({ text: formatSingleSummaryProse(SUMMARY) })
    expect((await h.call('job_output', { job_id: id })).value).toMatchObject({ text: '' })
  })

  it('delivers completion only through an already-waiting job_output', async () => {
    const h = await deliveryHarness()
    const id = await h.submit()
    const pending = await awaitingOutput(h, id)
    await h.complete(id)
    expect((await pending.result).value).toMatchObject({ text: formatSingleSummaryProse(SUMMARY), job: { status: 'completed' } })
    expect(h.events.find(event => event.type === 'settled')).toMatchObject({ awaited: true })
    expect(h.inject).not.toHaveBeenCalled()
    expect(h.followup).not.toHaveBeenCalled()
    expect((await h.call('job_output', { job_id: id })).value).toMatchObject({ text: '' })
  })

  it('releases only the wait on user next-step input, then still notifies completion', async () => {
    const h = await deliveryHarness()
    const id = await h.submit()
    const pending = await awaitingOutput(h, id)
    h.steer()
    expect((await pending.result).value).toMatchObject({ text: '', job: { status: 'running', detail: expect.stringContaining('user steered') } })
    expect(h.held.signal().aborted).toBe(false)
    expect(h.ctx.jobs.get(id, h.session.id)?.status).toBe('running')
    expect(h.notices()).toEqual([])
    await h.complete(id)
    expect(h.notices()).toHaveLength(1)
    expect(text(h.notices()[0]!)).toContain(formatSingleSummaryProse(SUMMARY))
    h.commit(h.notices()[0]!)
    expect((await h.call('job_output', { job_id: id })).value).toMatchObject({ text: '', job: { status: 'completed' } })
  })

  it('does not duplicate a settlement crossing a steer-released consuming read', async () => {
    const h = await deliveryHarness()
    const id = await h.submit()
    const entered = deferred<void>()
    const released = deferred<void>()
    const allowRead = deferred<void>()
    const wait = h.ctx.jobs.wait.bind(h.ctx.jobs)
    vi.spyOn(h.ctx.jobs, 'wait').mockImplementation((...args) => {
      const pending = wait(...args)
      entered.resolve()
      // A test-only scheduling barrier lets the real settlement cross the real released wait.
      return pending.catch(async error => { released.resolve(); await allowRead.promise; throw error })
    })
    const output = h.call('job_output', { job_id: id, wait: true })
    await entered.promise
    try {
      h.steer()
      await released.promise
      expect(h.held.signal().aborted).toBe(false)
      await h.complete(id)
      expect(h.notices()).toEqual([])
    } finally { allowRead.resolve() }
    expect((await output).value).toMatchObject({ text: formatSingleSummaryProse(SUMMARY), job: { status: 'completed' } })
    expect(h.inject).not.toHaveBeenCalled()
    expect(h.followup).not.toHaveBeenCalled()
    expect((await h.call('job_output', { job_id: id })).value).toMatchObject({ text: '' })
  })

  it('uses read_pdf for evidence after the summary was delivered inline', async () => {
    const fixture = await readerHarness()
    fixture.provider.contentList = [
      { type: 'text', text_level: 1, text: 'Results', page_idx: 0 },
      { type: 'text', text: 'Evidence is delivered by read_pdf, not the job summary.', page_idx: 0 },
    ]
    const gate = fixture.provider.holdSubmit()
    const h = await deliveryHarness({ reader: fixture.reader, config: fixture.config })
    const id = await h.submit(fixture.file)
    await gate.entered
    const done = h.settled(id)
    gate.release()
    await done
    const notice = h.notices()[0]!
    expect(text(notice)).toContain('MinerU Document Parse Summary')
    expect(text(notice)).not.toContain('Evidence is delivered by read_pdf')
    h.commit(notice)
    const evidence = await h.call('read_pdf', { file_path: fixture.file, focus: 'text', inline_images: false })
    expect(evidence.value).toMatchObject({ source: 'cache', cache_hit: true, content_status: 'complete', markdown_content: expect.stringContaining('Evidence is delivered by read_pdf') })
    expect(fixture.provider.submitCount).toBe(1)
    expect(h.ctx.jobs.list(h.session.id)).toHaveLength(1)
  })
})
