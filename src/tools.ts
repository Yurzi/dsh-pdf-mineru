/** Model-facing MinerU tools: health, native background submit, and direct parse. */
import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JobOutcome, JobRegistry } from '@deepseek-ai/dsh-jobs'
import type { ContentBlock, ObjectValueSchemaSpec, ParameterSchemaSpec, ToolRunContext, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { MinerUError, failure, toMinerUFailure } from './domain/errors.js'
import type { ParseRequestInput } from './domain/request.js'
import type { StorageAccessGate } from './storage/access-gate.js'
import type { BatchParseDocumentView, FailedParseView, MinerUService, ParseDocumentView, ProbeView, ResultView } from './service/mineru-service.js'

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    mineru: 'mineru'
  }
}

const failureSchema: ObjectValueSchemaSpec = {
  type: 'object',
  properties: {
    code: { type: 'string' }, message: { type: 'string' }, retryable: { type: 'boolean' },
    provider: { type: 'string', enum: ['self-hosted-v2', 'official-v4'] },
    providerCode: { type: 'string' }, traceId: { type: 'string' }, fileId: { type: 'string' },
  },
  additionalProperties: false,
}

const artifactViewSchema: ObjectValueSchemaSpec = {
  type: 'object',
  properties: { kind: { type: 'string' }, path: { type: 'string' }, bytes: { type: 'integer' } },
  additionalProperties: false,
}

const resultFileViewSchema: ObjectValueSchemaSpec = {
  type: 'object',
  properties: {
    file_id: { type: 'string' }, name: { type: 'string' },
    artifacts: { type: 'array', items: artifactViewSchema }, artifacts_truncated: { type: 'boolean' },
  },
  additionalProperties: false,
}

const resultViewSchema: ObjectValueSchemaSpec = {
  type: 'object',
  properties: {
    state: { type: 'string', enum: ['completed'] },
    source: { type: 'string', enum: ['cache', 'shared-operation', 'provider'] },
    cache_hit: { type: 'boolean' }, result_id: { type: 'string' },
    files: { type: 'array', items: resultFileViewSchema }, markdown_preview: { type: 'string' },
    preview_truncated: { type: 'boolean' }, manifest_path: { type: 'string' }, output_limit_chars: { type: 'integer' },
  },
  additionalProperties: false,
}

const failedParseViewSchema: ObjectValueSchemaSpec = {
  type: 'object',
  properties: {
    state: { type: 'string', enum: ['failed'] },
    source: { type: 'string', enum: ['cache', 'shared-operation', 'provider'] },
    file_id: { type: 'string' }, name: { type: 'string' }, failure: failureSchema,
  },
  additionalProperties: false,
}

const batchViewSchema: ObjectValueSchemaSpec = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['batch'] },
    state: { type: 'string', enum: ['completed', 'partially-completed', 'failed'] },
    results: { type: 'array', items: { oneOf: [resultViewSchema, failedParseViewSchema] } },
  },
  additionalProperties: false,
}

const parseOutputSchema: ValueSchemaSpec = { oneOf: [resultViewSchema, batchViewSchema] }

const parseParameters: ParameterSchemaSpec = {
  file_paths: { type: 'array', items: { type: 'string' }, description: 'Paths of local documents to parse.' },
  model: { type: 'string', enum: ['pipeline', 'vlm'], description: 'Parsing model: pipeline or vlm.' },
  ocr: { type: 'boolean', description: 'Force OCR on all pages.' },
  language: { type: 'string', description: 'Language hint code.' },
  formula: { type: 'boolean', description: 'Enable mathematical formula recognition.' },
  table: { type: 'boolean', description: 'Enable table structure recognition.' },
  pages: { type: 'string', description: '1-based page range string.' },
  artifacts: {
    type: 'array',
    items: { type: 'string', enum: ['markdown', 'layout', 'model-output', 'content-list', 'images'] },
    description: 'Artifacts to extract and retain. Default: markdown.',
  },
}

const DEFAULT_RENDER_LIMIT = 16_384
const MAX_POLL_TIMEOUT_MS = 24 * 60 * 60 * 1000

function clampRenderText(rendered: string, limit = DEFAULT_RENDER_LIMIT): string {
  if (!Number.isSafeInteger(limit) || limit <= 0) return ''
  if (rendered.length <= limit) return rendered
  const suffix = '\n\n[Output truncated to limit]'
  if (suffix.length >= limit) return suffix.slice(0, limit)
  return rendered.slice(0, limit - suffix.length) + suffix
}

function parsePollTimeout(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > MAX_POLL_TIMEOUT_MS) {
    throw new MinerUError(failure('INVALID_REQUEST', 'poll_timeout_ms must be a positive integer no greater than ' + String(MAX_POLL_TIMEOUT_MS)))
  }
  return value as number
}

function requireAgent(exec: ToolRunContext): NonNullable<ToolRunContext['agent']> {
  const agent = exec.agent
  if (agent === undefined) {
    throw new MinerUError(failure('UNAUTHENTICATED_SESSION', 'MinerU operations require an authenticated agent session (UNAUTHENTICATED_SESSION)'))
  }
  return agent
}

function parseInput(args: unknown): { readonly input: ParseRequestInput; readonly pollTimeoutMs?: number } {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new MinerUError(failure('INVALID_REQUEST', 'Tool arguments must be an object'))
  }
  const { poll_timeout_ms: rawPollTimeout, ...input } = args as ParseRequestInput & { poll_timeout_ms?: unknown }
  const pollTimeoutMs = parsePollTimeout(rawPollTimeout)
  return { input, ...(pollTimeoutMs === undefined ? {} : { pollTimeoutMs }) }
}

export function renderHealth(value: ProbeView): ContentBlock[] {
  const lines = [
    '**MinerU Health Status**: ' + (value.available ? 'Available' : 'Unavailable'),
    '- Provider: ' + value.provider,
    '- Authentication: ' + value.authentication,
    '- Protocol Version: ' + value.protocol_version,
  ]
  if (value.server_version !== undefined) lines.push('- Server Version: ' + value.server_version)
  if (value.queue !== undefined) {
    const q = value.queue
    lines.push('- Queue: queued=' + String(q.queued ?? 0) + ', processing=' + String(q.processing ?? 0) + ', completed=' + String(q.completed ?? 0) + ', failed=' + String(q.failed ?? 0))
  }
  if (value.diagnostics !== undefined) lines.push('- Diagnostics: ' + value.diagnostics)
  return [{ type: 'text', text: clampRenderText(lines.join('\n')) }]
}

export function renderResult(value: ResultView): ContentBlock[] {
  const lines = [
    '**MinerU Parse Result**', '- Source: ' + value.source,
    '- Cache Hit: ' + (value.cache_hit ? 'Yes' : 'No'), '- Result ID: ' + value.result_id,
    '- Manifest: ' + value.manifest_path,
  ]
  if (value.files.length > 0) {
    lines.push('\n### Artifact Files:')
    for (const file of value.files) {
      lines.push('- **' + file.name + '**:')
      for (const artifact of file.artifacts) lines.push('  - ' + artifact.kind + ' (' + String(artifact.bytes) + ' bytes): ' + artifact.path)
      if (file.artifacts_truncated) lines.push('  - *(Artifact list truncated to output limit)*')
    }
  }
  if (value.markdown_preview !== undefined) {
    lines.push('\n### Markdown Preview:', value.markdown_preview)
    if (value.preview_truncated) lines.push('\n*(Preview truncated to output limit)*')
  }
  return [{ type: 'text', text: clampRenderText(lines.join('\n'), value.output_limit_chars) }]
}

function renderFailure(value: FailedParseView): string {
  return '**' + value.name + '**: [' + value.failure.code + '] ' + value.failure.message
}

export function renderParseDocument(value: ParseDocumentView): ContentBlock[] {
  if (!('kind' in value)) return renderResult(value)
  const sections = value.results.map(result => result.state === 'completed' ? renderResult(result)[0]?.text ?? '' : renderFailure(result))
  return [{ type: 'text', text: clampRenderText('**MinerU Batch Result**\n- State: ' + value.state + '\n- Results: ' + String(value.results.length) + '\n\n' + sections.join('\n\n')) }]
}

function backgroundLabel(input: ParseRequestInput): string {
  const count = Array.isArray(input.file_paths) ? input.file_paths.length : 0
  return 'Parse ' + String(count) + ' document' + (count === 1 ? '' : 's') + ' with MinerU'
}

function nativeSuccessOutcome(value: ParseDocumentView): JobOutcome {
  const output = renderParseDocument(value)[0]?.text ?? JSON.stringify(value)
  if ('kind' in value && value.state === 'failed') {
    return { status: 'failed', detail: 'batch-failed', output }
  }
  return { status: 'completed', detail: 'kind' in value ? value.state : 'completed', output }
}

export function registerTools(ctx: Context, getService: () => MinerUService, accessGate?: StorageAccessGate): () => Promise<void> {
  const disposers: Array<() => void> = []
  const backgroundInvocations = new Set<{ readonly controller: AbortController; readonly done: Promise<JobOutcome> }>()
  const withStorageAccess = async <T,>(operation: () => Promise<T>): Promise<T> => {
    return accessGate === undefined ? await operation() : await accessGate.runShared(operation)
  }

  disposers.push(ctx.tools.register(defineTool({
    name: 'mineru_health',
    description: 'Check MinerU backend connectivity, authentication status, and queue capacity.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        properties: {
          available: { type: 'boolean' }, provider: { type: 'string', enum: ['self-hosted-v2', 'official-v4'] },
          authentication: { type: 'string', enum: ['valid', 'invalid', 'not-configured', 'unknown'] },
          protocol_version: { type: 'string' }, server_version: { type: 'string' },
          queue: {
            type: 'object', properties: {
              queued: { type: 'integer' }, processing: { type: 'integer' }, completed: { type: 'integer' },
              failed: { type: 'integer' }, max_concurrent: { type: 'integer' },
            }, additionalProperties: false,
          },
          diagnostics: { type: 'string' },
        },
        additionalProperties: false,
      },
      render: (_args: unknown, value: unknown) => renderHealth(value as ProbeView),
    },
    execute: async (_args: unknown, exec: ToolRunContext) => {
      requireAgent(exec)
      return await getService().probe(exec.signal)
    },
  })) as () => void)

  disposers.push(ctx.tools.register(defineTool({
    name: 'mineru_submit_parse_job',
    description: 'Start document parsing as a native DSH background job. Returns a job ID immediately; use job_output to collect the final result and job_kill to cancel it.',
    parameters: parseParameters,
    output: {
      schema: {
        type: 'object',
        properties: { job_id: { type: 'string' }, state: { type: 'string', enum: ['running'] } },
        additionalProperties: false,
      },
      render: (_args: unknown, value: unknown) => {
        const output = value as { readonly job_id: string }
        return [{ type: 'text', text: 'Started native MinerU background job ' + output.job_id + '.' }]
      },
    },
    execute: async (args: unknown, exec: ToolRunContext) => {
      const agent = requireAgent(exec)
      exec.signal.throwIfAborted()
      const { input } = parseInput(args)
      const jobs = ctx.get('jobs') as JobRegistry | undefined
      if (jobs === undefined) {
        throw new MinerUError(failure('PROVIDER_UNAVAILABLE', 'Native DSH background jobs are unavailable; load the jobs registry and job tools'))
      }
      const controller = new AbortController()
      const jobId = jobs.start({
        kind: 'mineru', label: backgroundLabel(input), owner: agent,
        run: () => {
          const done = withStorageAccess(() => getService().parseDocument(agent.session, input, controller.signal, null))
            .then((value): JobOutcome => nativeSuccessOutcome(value))
            .catch((error): JobOutcome => {
              if (controller.signal.aborted) return { status: 'killed', detail: 'cancelled' }
              const normalized = toMinerUFailure(error)
              return { status: 'failed', detail: normalized.code, output: '[' + normalized.code + '] ' + normalized.message }
            })
          const invocation = { controller, done }
          backgroundInvocations.add(invocation)
          void done.finally(() => backgroundInvocations.delete(invocation))
          return {
            cancel: reason => {
              if (!controller.signal.aborted) controller.abort(new MinerUError(failure('CANCELLED', reason?.trim() || 'MinerU background parse cancelled', true)))
            },
            done,
          }
        },
      })
      return { job_id: jobId, state: 'running' as const }
    },
  })) as () => void)

  disposers.push(ctx.tools.register(defineTool({
    name: 'mineru_parse_document',
    description: 'Parse documents and synchronously return immutable result manifests, previews, and artifact paths. This call does not create a plugin Job.',
    parameters: {
      ...parseParameters,
      poll_timeout_ms: {
        type: 'integer',
        description: 'Maximum synchronous wait in milliseconds. A timeout leaves the shared producer running; retry the same request to rejoin it.',
      },
    },
    output: { schema: parseOutputSchema, render: (_args: unknown, value: unknown) => renderParseDocument(value as ParseDocumentView) },
    execute: async (args: unknown, exec: ToolRunContext) => {
      const agent = requireAgent(exec)
      const { input, pollTimeoutMs } = parseInput(args)
      return await withStorageAccess(() => getService().parseDocument(agent.session, input, exec.signal, pollTimeoutMs))
    },
  })) as () => void)

  return async () => {
    for (const dispose of disposers) dispose()
    const active = [...backgroundInvocations]
    for (const invocation of active) {
      if (!invocation.controller.signal.aborted) {
        invocation.controller.abort(new MinerUError(failure('CANCELLED', 'MinerU plugin disposed', true)))
      }
    }
    await Promise.allSettled(active.map(invocation => invocation.done))
  }
}
