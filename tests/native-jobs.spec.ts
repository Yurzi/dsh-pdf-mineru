import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { JobId, type JobEvent } from '@deepseek-ai/dsh-jobs'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { registerTools } from '../src/tools.js'
import type { MinerUService, ParseSummaryView } from '../src/service/mineru-service.js'
import { MinerUError, failure } from '../src/domain/errors.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const summary: ParseSummaryView = {
  state: 'completed', source: 'cache', cache_hit: true, result_id: 'mr_native',
  files: [{ file_id: 'mf_native', name: 'paper.pdf', artifacts: [] }], content_status: 'not_requested',
}

async function harness(ensureParsed: MinerUService['ensureParsed'], controller = true) {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalJobRegistry, {})
  if (controller) ctx.jobs.attachController('mineru-test-controller')
  const owner = ctx.plugin(() => {})
  const session = Session.create(SessionId('mineru-owner'))
  // The agent loop is outside this test; registry, Session and owner lifecycle are real.
  const agent = { id: session.id, session, ctx: owner.ctx, options: {}, status: 'idle' } as Agent
  await ctx.agents.register(agent)
  const definitions = new Map<string, ToolDefinition>()
  ctx.provide('tools', { register: (tool: ToolDefinition) => {
    definitions.set(tool.name, tool)
    return () => { definitions.delete(tool.name) }
  } })
  const dispose = registerTools(ctx, () => ({ ensureParsed }) as MinerUService)
  cleanups.push(dispose)
  const events: JobEvent[] = []
  ctx.jobs.events.subscribe({ owner: session.id }, event => events.push(event))
  const exec = { name: 'async_parse_pdf', callId: 'native-call', arguments: {}, signal: new AbortController().signal, agent } as ToolRunContext
  const submit = async () => {
    const value = await definitions.get('async_parse_pdf')!.execute({ file_path: '/paper.pdf' }, exec) as { job_id: string }
    return JobId(value.job_id)
  }
  return { ctx, owner, session, events, submit, dispose }
}

describe('MinerU with the published 0.1.7-rc.2 job registry', () => {
  it('delivers progress and a final result once, with owner-fenced reads', async () => {
    const h = await harness(async (_session, _input, _signal, progress) => {
      progress?.('preparing')
      await Promise.resolve() // subsequent progress occurs after the registration commit
      progress?.('summarizing')
      return summary
    })
    const id = await h.submit()
    await h.ctx.jobs.wait(id, 1000, h.session.id)
    expect(h.ctx.jobs.get(id, h.session.id)).toMatchObject({ status: 'completed', outputLimitBytes: 48_000 })
    expect(h.events[0]?.type).toBe('registered')
    expect(h.events.some(event => event.type === 'progress' && event.job.progress === 'summarizing')).toBe(true)
    expect(() => h.ctx.jobs.read(id, SessionId('foreign'))).toThrow()
    expect(h.ctx.jobs.list(SessionId('foreign'))).toEqual([])
    const read = h.ctx.jobs.read(id, h.session.id)
    expect(read.result).toContain('MinerU Document Parse Summary')
    expect(read.result).toContain('paper.pdf')
    expect(read.chunks).toEqual([]) // progress is not duplicated into the output ring
    expect(h.ctx.jobs.read(id, h.session.id).result).toBeUndefined()
  })

  it('refuses work before invoking the service if no job controller is attached', async () => {
    const ensureParsed = vi.fn(async () => summary)
    const h = await harness(ensureParsed, false)
    await expect(h.submit()).rejects.toThrow()
    expect(ensureParsed).not.toHaveBeenCalled()
    expect(h.ctx.jobs.list(h.session.id)).toEqual([])
  })

  it('delivers failed final results through the new result field', async () => {
    const h = await harness(async () => { throw new MinerUError(failure('FILE_TOO_LARGE', 'Input exceeds limit')) })
    const id = await h.submit()
    await h.ctx.jobs.wait(id, 1000, h.session.id)
    expect(h.ctx.jobs.read(id, h.session.id)).toMatchObject({
      result: '[FILE_TOO_LARGE] Input exceeds limit', job: { status: 'failed', detail: 'FILE_TOO_LARGE' },
    })
  })

  it.each(['kill', 'owner', 'plugin'] as const)('cancels the invocation and awaits cleanup on %s', async mode => {
    let signal: AbortSignal | undefined
    let cleaned = false
    const h = await harness(async (_session, _input, invocationSignal) => {
      signal = invocationSignal
      try {
        await new Promise<void>((_resolve, reject) => {
          invocationSignal.addEventListener('abort', () => reject(invocationSignal.reason), { once: true })
        })
      } finally { cleaned = true }
      return summary
    })
    const id = await h.submit()
    if (mode === 'owner') await h.owner.dispose()
    else if (mode === 'plugin') await h.dispose()
    else h.ctx.jobs.kill(id, h.session.id, 'stop this waiter')
    if (mode !== 'owner') {
      await h.ctx.jobs.wait(id, 1000, h.session.id)
      expect(h.ctx.jobs.get(id, h.session.id).status).toBe('killed')
    }
    expect(signal?.aborted).toBe(true)
    expect(cleaned).toBe(true)
  })
})
