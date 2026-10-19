import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { JobId } from '@deepseek-ai/dsh-jobs'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { PtcRuntime, type PtcJsonValue, type PtcRunRequest, type PtcRunResult, type PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'
import { createScope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/types'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { RUN_CODE_NAME, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import WorkingDirectoryService from '@deepseek-ai/dsh-working-directory'
import { describe, expect, it } from 'vitest'
import { loaderFixture } from './support/loader-fixture.js'
import { publishFixtureResult, type PublishedFixture } from './support/reader-harness.js'
import { testAgent } from './support/tool-harness.js'

/**
 * Real-composition tier (DSH docs/testing.md): the app-boot Loader mounts the published Settings,
 * SystemPrompt, SessionProjections, ToolRuntime (with its run_code PTC dispatch bridge), AgentRegistry,
 * LocalJobRegistry and WorkingDirectoryService beside the plugin. MinerU HTTP never runs: a result is
 * pre-published into the plugin's storage root, so every read is a cache hit.
 *
 * Stand-ins for packages that are not installed as devDependencies:
 * - fs: dsh-fs-local is absent; WorkingDirectoryService needs only resolve/stat/processPath.
 * - ptcRuntime: dsh-ptc-runtime-node is absent; an in-process function-body evaluator implements the
 *   published PtcRuntime Service Definition. Bindings, scheduling and ptc-dispatch events are ToolRuntime's.
 */
class InProcessPtcRuntime extends PtcRuntime {
  readonly language = 'typescript'
  readonly isolation = 'in-process-test'
  resolve(request: PtcRunRequest): PtcRunSpec {
    return { ...request, cwd: request.cwd ?? '/', timeoutMs: request.timeoutMs ?? 30_000 }
  }
  async run(spec: PtcRunSpec): Promise<PtcRunResult> {
    const globals = spec.bindings.map(binding => binding.global)
    const values = spec.bindings.map(binding => binding.functions)
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<PtcJsonValue>
    try {
      return { logs: [], value: await new AsyncFunction(...globals, spec.program)(...values) }
    } catch (error) {
      return { logs: [], error: { kind: 'exception', message: error instanceof Error ? error.message : String(error) } }
    }
  }
}

const localFs = {
  resolve: async (path: string, options: { cwd?: string } = {}) => isAbsolute(path) ? path : resolve(options.cwd ?? '/', path),
  stat: async (target: string) => {
    const info = await stat(target).catch(() => undefined)
    return info === undefined ? undefined : { type: info.isDirectory() ? 'directory' : 'file' }
  },
  processPath: (target: string) => target,
}

async function composedHost() {
  let published!: PublishedFixture
  let project!: string
  const host = await loaderFixture({
    transport: false, hmr: false, hostStandIns: false,
    provide: ctx => { ctx.provide('fs', localFs) },
    services: [
      { id: 'system-prompt', name: 'systemPrompt', plugin: SystemPrompt },
      { id: 'session-projections', name: 'sessionProjections', plugin: SessionProjectionRegistry },
      { id: 'tools', name: 'tools', plugin: ToolRuntime, config: { mode: 'native' } },
      { id: 'agents', name: 'agents', plugin: AgentRegistry },
      { id: 'jobs', name: 'jobs', plugin: LocalJobRegistry, config: {} },
      { id: 'working-directory', name: 'workingDirectory', plugin: WorkingDirectoryService, config: { defaultDirectory: '/' } },
      { id: 'ptc-runtime', name: 'ptcRuntime', plugin: InProcessPtcRuntime },
    ],
    configure: async (config, home) => {
      project = join(home, 'project')
      const source = join(project, 'sub', 'paper.pdf')
      await mkdir(dirname(source), { recursive: true })
      await writeFile(source, '%PDF-1.7\ncomposition fixture\n%%EOF\n')
      published = await publishFixtureResult({
        sourcePath: source, config,
        markdown: '# Results\n\nComposed evidence.\n',
        contentList: [{ type: 'text', text_level: 1, page_idx: 0, text: 'Results' }, { type: 'text', page_idx: 0, text: 'Composed evidence.' }],
      })
      return config
    },
  })
  const { ctx } = host
  // Guard against a stand-in silently replacing a published service.
  expect(ctx.tools).toBeInstanceOf(ToolRuntime)
  expect(ctx.workingDirectory).toBeInstanceOf(WorkingDirectoryService)
  expect(ctx.jobs).toBeInstanceOf(LocalJobRegistry)
  ctx.jobs.attachController('composition-controller')
  const mint = async (name: string, mode: 'native' | 'ptc') => {
    const session = Session.create(SessionId(name), [], { version: SESSION_FORMAT_VERSION, id: SessionId(name), createdAt: Date.now(), cwd: project, isSeeded: false })
    const owner = ctx.plugin(() => {})
    const agent = testAgent(owner.ctx, session)
    await ctx.agents.register(agent)
    if (mode === 'ptc') {
      await ctx.plugin(Object.assign((inner: Context) => { createScope(inner, agent).ctx.tools.presentAs('ptc') }, { inject: ['tools', 'systemPrompt'] }))
    }
    return agent
  }
  let calls = 0
  const execute = (agent: Agent, name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> =>
    ctx.tools.execute({ callId: ToolCallId('composition-' + String(++calls)), name, arguments: args, agent, signal: new AbortController().signal })
  return { ...host, published: () => published, project: () => project, mint, execute }
}

describe('real composition with DSH tools, jobs and working directory', () => {
  it('resolves a relative file_path under the directory set by the working-directory service', async () => {
    const host = await composedHost()
    const agent = await host.mint('composition-cwd', 'native')
    const before = await host.execute(agent, 'read_pdf', { file_path: 'paper.pdf' })
    expect(before.isError).toBe(true)
    expect(await host.ctx.workingDirectory.set(agent, 'sub')).toBe(join(host.project(), 'sub'))
    const after = await host.execute(agent, 'read_pdf', { file_path: 'paper.pdf' })
    expect(after.isError).toBe(false)
    expect(after.value).toMatchObject({ result_id: host.published().resultId, source: 'cache', cache_hit: true, content_status: 'complete' })
    expect(JSON.stringify(after.value)).toContain('Composed evidence.')
  })

  it('runs async_parse_pdf as a native job whose final result summarizes the cached parse', async () => {
    const host = await composedHost()
    const agent = await host.mint('composition-job', 'native')
    await host.ctx.workingDirectory.set(agent, 'sub')
    const submitted = await host.execute(agent, 'async_parse_pdf', { file_path: 'paper.pdf' })
    expect(submitted).toMatchObject({ isError: false, value: { state: 'running' } })
    const id = JobId((submitted.value as { job_id: string }).job_id)
    expect(submitted.meta).toEqual({ job_id: id, state: 'running' })
    await host.ctx.jobs.wait(id, 5000, agent.session.id)
    const read = host.ctx.jobs.read(id, agent.session.id)
    expect(read.job).toMatchObject({ kind: 'mineru', status: 'completed', outputLimitBytes: 48_000 })
    expect(read.result).toContain('paper.pdf')
  })

  it('returns the same canonical read_pdf value natively and nested in run_code, with compact nested metadata', async () => {
    const host = await composedHost()
    const native = await host.mint('composition-native', 'native')
    const coded = await host.mint('composition-ptc', 'ptc')
    for (const agent of [native, coded]) await host.ctx.workingDirectory.set(agent, 'sub')

    const direct = await host.execute(native, 'read_pdf', { file_path: 'paper.pdf' })
    expect(direct.isError).toBe(false)
    const denied = await host.execute(coded, 'read_pdf', { file_path: 'paper.pdf' })
    expect(denied.error?.info).toMatchObject({ code: 'UNKNOWN_TOOL' })

    const program = await host.execute(coded, RUN_CODE_NAME, {
      description: 'Read the fixture PDF', code: "return await tools.read_pdf({ file_path: 'paper.pdf' })",
    })
    expect(program.isError).toBe(false)
    expect(program.value).toEqual({ logs: [], result: direct.value })
    const events = coded.session.snapshotEvents()
    const dispatch = events.find(event => event.type === 'tool/ptc-dispatch')
    expect(dispatch?.data).toMatchObject({ name: 'read_pdf', isError: false })
    expect(dispatch?.data).not.toHaveProperty('error')
    expect(dispatch?.data.meta).toEqual(direct.meta)
    expect(direct.meta).toMatchObject({ result_id: host.published().resultId, cache_hit: true, has_more: false })
    expect(Buffer.byteLength(JSON.stringify(dispatch?.data.meta))).toBeLessThanOrEqual(2048)
    expect(JSON.stringify(dispatch?.data.meta)).not.toContain('Composed evidence.')
  })
})
