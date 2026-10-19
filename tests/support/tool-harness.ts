import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId, type AttachmentStore, type FileAttachmentRef, type SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { JobId } from '@deepseek-ai/dsh-jobs'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import { createUserMessage, ToolCallId, type LlmRuntime } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { ToolDefinition, ToolExecutionToken, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { onTestFinished, vi } from 'vitest'
import type { MinerUConfig, OutputConfig } from '../../src/config/model.js'
import { defaultMinerUConfig } from '../../src/config/parse.js'
import type { ContentQuery } from '../../src/domain/selection.js'
import type { ParseSummaryView, ResultView } from '../../src/reader/views.js'
import { finishContentChunk } from '../../src/reader/visuals.js'
import { registerTools, type ToolDependencies } from '../../src/tools/index.js'
import { resultView, summaryView } from './views.js'

export type ToolReader = ToolDependencies['reader']

/** Configuration with only the output section changed. */
export function withOutput(output: Partial<OutputConfig>, base: MinerUConfig = defaultMinerUConfig()): MinerUConfig {
  return { ...base, output: { ...base.output, ...output } }
}

/** The query read_pdf builds for a plain selection; override fields as needed. */
export function selectQuery(
  selection: Partial<Extract<ContentQuery, { kind: 'select' }>['selection']> = {},
  delivery: { inlineImages?: boolean; pollTimeoutMs?: number } = {},
): ContentQuery {
  return {
    kind: 'select', selection: { focus: new Set(['all']), ...selection }, inlineImages: delivery.inlineImages ?? true,
    ...(delivery.pollTimeoutMs === undefined ? {} : { pollTimeoutMs: delivery.pollTimeoutMs }),
  }
}

/** A content reader whose projection is a fixture; image attachment, visual accounting and budget fitting stay production code. */
export function projectedReader(project: (sourcePath: string, query: ContentQuery, signal: AbortSignal) => ResultView | Promise<ResultView> = () => resultView()) {
  return vi.fn<ToolReader['readContent']>(async (sourcePath, query, config, images, signal) =>
    finishContentChunk(await project(sourcePath, query, signal), images, query.inlineImages, config.output.maxInlineImages, signal))
}

export interface ToolHarnessOptions {
  readonly reader?: Partial<ToolReader>
  readonly config?: () => MinerUConfig
  /** Attachment store fake; false removes the service (path-only hosts). */
  readonly attachments?: false
  /** Calling-route image capability; undefined mounts no llm service. */
  readonly imageModel?: boolean
  /** Agent route options; defaults to a route the llm fake resolves. */
  readonly route?: { readonly provider?: string; readonly model?: string }
  /** Mount the published LocalJobRegistry (default) or no jobs service. */
  readonly jobs?: boolean
  /** Attach a job controller so the registry admits work (default true). */
  readonly jobController?: boolean
  /** Visible file references on the session surface. */
  readonly files?: readonly FileAttachmentRef[]
  readonly cwd?: string
}

export const FILE_REF: FileAttachmentRef = { attachmentId: AttachmentId('sha256:' + 'a'.repeat(64)), name: 'paper.pdf', bytes: 100 }
export const ATTACHMENT_HOST_PATH = '/dsh-owned/paper.pdf'

/**
 * Register both tools through the real defineTool compiler on a real Cordis context with a live
 * Session/AgentRegistry and (by default) the published LocalJobRegistry. Only the reader, working
 * directory, attachment store and model resolver are fakes.
 */
export async function toolHarness(options: ToolHarnessOptions = {}) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  let cwd = options.cwd ?? '/workspace'
  const ensure = vi.fn(async (_agent: Agent, _signal?: AbortSignal) => cwd)
  ctx.provide('workingDirectory', { ensure, get: () => cwd })
  const definitions = new Map<string, ToolDefinition>()
  ctx.provide('tools', {
    register: (tool: ToolDefinition) => {
      definitions.set(tool.name, tool)
      return () => { definitions.delete(tool.name) }
    },
  })

  const saveImage = vi.fn(async (image: SaveImageAttachment) => ({
    attachmentId: AttachmentId('sha256:' + 'b'.repeat(64)), mediaType: image.mediaType, bytes: image.data.byteLength,
    width: 10, height: 10, ...(image.name === undefined ? {} : { name: image.name }),
  }))
  const fileHostPath = vi.fn((_ref: FileAttachmentRef): string | undefined => ATTACHMENT_HOST_PATH)
  const store: Pick<AttachmentStore, 'saveImage' | 'fileHostPath'> = { saveImage, fileHostPath }
  if (options.attachments !== false) ctx.provide('attachments', store)

  const resolveModelInfo = vi.fn<LlmRuntime['resolveModelInfo']>(async (provider, model) => ({
    provider, id: model, name: model, inputModalities: options.imageModel === true ? ['text', 'image'] : ['text'],
  }))
  const llm: Pick<LlmRuntime, 'resolveModelInfo'> = { resolveModelInfo }
  if (options.imageModel !== undefined) ctx.provide('llm', llm)

  await ctx.plugin(AgentRegistry)
  if (options.jobs !== false) {
    await ctx.plugin(LocalJobRegistry, {})
    if (options.jobController !== false) ctx.jobs.attachController('mineru-test-controller')
  }
  const owner = ctx.plugin(() => {})
  const session = Session.create(SessionId('mineru-tool-session'))
  if (options.files?.length) {
    session.append('user/message', createUserMessage({
      source: { kind: 'user' }, content: options.files.map(attachment => ({ type: 'file' as const, attachment })),
    }), { surfaceOp: 'append' })
  }
  const agent = testAgent(owner.ctx, session, options.route ?? { provider: 'mock', model: 'vision' })
  await ctx.agents.register(agent)

  // Always spies, so callers can assert reader inputs whether or not they supplied an implementation.
  // Methods are bound so a real ReaderService instance can be passed as the reader.
  const supplied = options.reader
  const reader = {
    readContent: vi.fn<ToolReader['readContent']>(supplied?.readContent?.bind(supplied) ?? projectedReader()),
    viewPage: vi.fn<ToolReader['viewPage']>(supplied?.viewPage?.bind(supplied) ?? (async () => resultView({ view: 'page', source: 'local', content_status: 'not_requested' }))),
    summarize: vi.fn<ToolReader['summarize']>(supplied?.summarize?.bind(supplied) ?? (async (): Promise<ParseSummaryView> => summaryView())),
  }
  const dispose = registerTools(ctx, { reader, config: options.config ?? defaultMinerUConfig, attachments: () => ctx.get('attachments') })
  onTestFinished(dispose)

  const exec = (overrides: Partial<ToolRunContext> = {}): ToolRunContext => ({
    callId: ToolCallId('mineru-call'), rootCallId: ToolCallId('mineru-root'), name: 'read_pdf', arguments: {},
    signal: new AbortController().signal, agent, token: executionToken(),
    deferContext: () => undefined, concludeTurn: () => undefined, ...overrides,
  })
  const tool = (name: 'read_pdf' | 'async_parse_pdf'): ToolDefinition => definitions.get(name)!
  return {
    ctx, owner, session, agent, definitions, tool, exec, reader, ensure, saveImage, fileHostPath, resolveModelInfo, dispose,
    setDirectory: (directory: string) => { cwd = directory },
    read: async (args: Record<string, unknown>, context: ToolRunContext = exec()) =>
      await tool('read_pdf').execute(args, context) as ResultView,
    submit: async (args: Record<string, unknown>, context: ToolRunContext = exec({ name: 'async_parse_pdf' })) =>
      JobId((await tool('async_parse_pdf').execute(args, context) as { job_id: string }).job_id),
  }
}

/** The runtime mints execution tokens; unit tests only need a unique branded symbol. */
export function executionToken(): ToolExecutionToken {
  return Symbol('mineru-test-execution') as ToolExecutionToken
}

/**
 * The Agent members tools, AgentRegistry and LocalJobRegistry read. The agent loop itself is
 * outside unit tests, so this is the single place a structural Agent is asserted.
 */
export function testAgent(ctx: Context, session: Session, options: { readonly provider?: string; readonly model?: string } = {}): Agent {
  const agent: Pick<Agent, 'id' | 'ctx' | 'session' | 'options' | 'status' | 'inject'> = {
    id: session.id, ctx, session, options, status: 'idle', inject: () => undefined,
  }
  return agent as Agent
}
