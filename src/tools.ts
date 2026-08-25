/**
 * tools.ts — 5 model-facing MinerU parsing tools.
 *
 * Tools:
 *   mineru_health            — Provider probe and capacity preflight
 *   mineru_submit_parse_job  — Submit asynchronous document parse job
 *   mineru_get_parse_status  — Query job status and progress
 *   mineru_get_parse_result  — Fetch completed parse result, preview and artifact paths
 *   mineru_parse_document    — Folded high-level flow: submit → poll → result
 *
 * Architecture & Conventions:
 *   - Tools strictly delegate to MinerUService; no direct fetch, ZIP or filesystem manipulation.
 *   - Every execute requires an authenticated agent session (exec.agent.session); fails otherwise.
 *   - exec.signal is threaded through every async call.
 *   - execute returns canonical lossless JSON.
 *   - render is a pure projection without reading config/service, and truncates to output_limit_chars.
 *   - All object output schemas recursively enforce additionalProperties: false.
 */

import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {
  ContentBlock,
  ObjectValueSchemaSpec,
  ParameterSchemaSpec,
  ToolRunContext,
} from '@deepseek-ai/dsh-tools'
import { MinerUError, failure } from './domain/errors.js'
import type { ParseRequestInput } from './domain/request.js'
import type { StorageAccessGate } from './storage/access-gate.js'
import type {
  BatchParseDocumentView,
  BatchSubmitView,
  MinerUService,
  ParseDocumentView,
  ProbeView,
  ResultView,
  StatusView,
  SubmitView,
} from './service/mineru-service.js'

// ============================================================================
// Schemas
// ============================================================================

const failureSchema: ObjectValueSchemaSpec = {
  type: 'object',
  description: 'Structured failure details if the operation failed.',
  properties: {
    code: { type: 'string', description: 'Unified error code.' },
    message: { type: 'string', description: 'Error message description.' },
    retryable: { type: 'boolean', description: 'Whether the failure is retryable.' },
    provider: { type: 'string', enum: ['self-hosted-v2', 'official-v4'], description: 'Provider identifier.' },
    providerCode: { type: 'string', description: 'Upstream provider error code.' },
    traceId: { type: 'string', description: 'Upstream trace or request ID.' },
    fileId: { type: 'string', description: 'Affected file identifier.' },
  },
  additionalProperties: false,
}

const fileStatusSchema: ObjectValueSchemaSpec = {
  type: 'object',
  description: 'Individual file processing status.',
  properties: {
    file_id: { type: 'string', description: 'Stable internal file identifier.' },
    name: { type: 'string', description: 'File display name.' },
    state: { type: 'string', description: 'File lifecycle state.' },
    job_id: { type: 'string', description: 'Per-file MinerU job ID for a multi-file submission.' },
    progress: {
      type: 'object',
      description: 'Page-level processing progress if available.',
      properties: {
        completed: { type: 'integer', description: 'Completed pages.' },
        total: { type: 'integer', description: 'Total pages.' },
      },
      additionalProperties: false,
    },
    failure: failureSchema,
  },
  additionalProperties: false,
}

const artifactViewSchema: ObjectValueSchemaSpec = {
  type: 'object',
  description: 'Artifact reference in published result.',
  properties: {
    kind: { type: 'string', description: 'Artifact kind (markdown, layout, model-output, content-list, images).' },
    path: { type: 'string', description: 'Absolute local filesystem path to the artifact.' },
    bytes: { type: 'integer', description: 'Artifact file size in bytes.' },
  },
  additionalProperties: false,
}

const resultFileViewSchema: ObjectValueSchemaSpec = {
  type: 'object',
  description: 'Document result summary with artifact paths.',
  properties: {
    file_id: { type: 'string', description: 'Internal file identifier.' },
    name: { type: 'string', description: 'Document display name.' },
    artifacts: {
      type: 'array',
      description: 'List of published artifact files.',
      items: artifactViewSchema,
    },
    job_id: { type: 'string', description: 'Per-file MinerU job ID in a folded multi-file result.' },
    state: { type: 'string', description: 'Per-file final state in a folded multi-file result.' },
    result_id: { type: 'string', description: 'Published single-file result ID.' },
    manifest_path: { type: 'string', description: 'Published single-file manifest path.' },
    cache_hit: { type: 'boolean', description: 'Whether this individual file result came from cache.' },
    failure: failureSchema,
    artifacts_truncated: { type: 'boolean', description: 'Whether artifact list was truncated to fit limit.' },
  },
  additionalProperties: false,
}


const submitOutputProperties = {
  job_id: { type: 'string' as const, description: 'Unique MinerU job ID (mj_...).' },
  state: { type: 'string' as const, enum: ['queued', 'uploading', 'processing', 'collecting', 'completed', 'partially-completed', 'failed'] },
  source: { type: 'string' as const, enum: ['cache', 'shared-operation', 'provider'] },
  provider: { type: 'string' as const, enum: ['self-hosted-v2', 'official-v4'] },
  files: { type: 'array' as const, items: fileStatusSchema },
  result_available: { type: 'boolean' as const },
  failure: failureSchema,
}

const submitChildSchema: ObjectValueSchemaSpec = { type: 'object', properties: submitOutputProperties, additionalProperties: false }
const parseChildSchema: ObjectValueSchemaSpec = {
  type: 'object',
  properties: {
    ...submitOutputProperties, cache_hit: { type: 'boolean' }, result_id: { type: 'string' },
    files: { type: 'array', items: { type: 'object', properties: {
      ...resultFileViewSchema.properties, state: { type: 'string' }, progress: { type: 'object', properties: { completed: { type: 'integer' }, total: { type: 'integer' } }, additionalProperties: false }, failure: failureSchema,
    }, additionalProperties: false } },
    markdown_preview: { type: 'string' }, preview_truncated: { type: 'boolean' }, manifest_path: { type: 'string' },
    output_limit_chars: { type: 'integer' }, created_at: { type: 'number' }, updated_at: { type: 'number' },
  },
  additionalProperties: false,
}

const parseParameters: ParameterSchemaSpec = {
  file_paths: {
    type: 'array',
    items: { type: 'string' },
    description: 'Paths of local documents (PDF, Word, Excel, PPT) to parse.',
  },
  model: {
    type: 'string',
    enum: ['pipeline', 'vlm'],
    description: 'Parsing model: "pipeline" (rule-based layout/table) or "vlm" (vision model for complex visual layouts).',
  },
  ocr: {
    type: 'boolean',
    description: 'Force OCR on all pages (for scanned documents or image PDFs).',
  },
  language: {
    type: 'string',
    description: 'Language hint code (e.g. "ch", "en", "japan", "korean").',
  },
  formula: {
    type: 'boolean',
    description: 'Enable LaTeX mathematical formula recognition.',
  },
  table: {
    type: 'boolean',
    description: 'Enable table structure recognition into Markdown/HTML.',
  },
  pages: {
    type: 'string',
    description: '1-based page range string (e.g. "1-10,15").',
  },
  artifacts: {
    type: 'array',
    items: {
      type: 'string',
      enum: ['markdown', 'layout', 'model-output', 'content-list', 'images'],
    },
    description: 'Artifacts to extract and retain (e.g. ["markdown", "images"]). Default: ["markdown"].',
  },
}

// ============================================================================
// Render Helpers
// ============================================================================

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
    throw new MinerUError(failure(
      'INVALID_REQUEST',
      `poll_timeout_ms must be a positive integer no greater than ${String(MAX_POLL_TIMEOUT_MS)}`,
    ))
  }
  return value as number
}

export function renderHealth(value: ProbeView): ContentBlock[] {
  const lines: string[] = [
    `**MinerU Health Status**: ${value.available ? 'Available' : 'Unavailable'}`,
    `- Provider: ${value.provider}`,
    `- Authentication: ${value.authentication}`,
    `- Protocol Version: ${value.protocol_version}`,
  ]
  if (value.server_version !== undefined) {
    lines.push(`- Server Version: ${value.server_version}`)
  }
  if (value.queue !== undefined) {
    const q = value.queue
    lines.push(
      `- Queue: queued=${String(q.queued ?? 0)}, processing=${String(q.processing ?? 0)}, completed=${String(q.completed ?? 0)}, failed=${String(q.failed ?? 0)}`,
    )
  }
  if (value.diagnostics !== undefined) {
    lines.push(`- Diagnostics: ${value.diagnostics}`)
  }
  return [{ type: 'text', text: clampRenderText(lines.join('\n')) }]
}

export function renderSubmit(value: SubmitView | BatchSubmitView): ContentBlock[] {
  if ('kind' in value) {
    const sections = value.jobs.map(job => renderSubmit(job)[0]?.text ?? '')
    return [{ type: 'text', text: clampRenderText(`**MinerU Batch Submitted**
- State: ${value.state}
- Jobs: ${String(value.jobs.length)}

${sections.join('\n\n')}`) }]
  }
  const lines: string[] = [
    `**MinerU Job Submitted**: \`${value.job_id}\``,
    `- State: ${value.state}`,
    `- Source: ${value.source}`,
    `- Provider: ${value.provider}`,
    `- Result Available: ${value.result_available ? 'Yes' : 'No'}`,
  ]
  if (value.files.length > 0) {
    lines.push('- Files:')
    for (const file of value.files) {
      lines.push(`  - ${file.name} (${file.state})${file.job_id === undefined ? '' : ` [job: \`${file.job_id}\`]`}`)
    }
  }
  if (value.failure !== undefined) {
    lines.push(`- Failure: [${value.failure.code}] ${value.failure.message}`)
  }
  return [{ type: 'text', text: clampRenderText(lines.join('\n')) }]
}

export function renderStatus(value: StatusView): ContentBlock[] {
  const lines: string[] = [
    `**MinerU Job Status**: \`${value.job_id}\``,
    `- State: ${value.state}`,
    `- Source: ${value.source}`,
    `- Provider: ${value.provider}`,
    `- Result Available: ${value.result_available ? 'Yes' : 'No'}`,
  ]
  if (value.files.length > 0) {
    lines.push('- Files:')
    for (const file of value.files) {
      const progress = file.progress !== undefined ? ` (progress: ${String(file.progress.completed)}/${String(file.progress.total)})` : ''
      lines.push(`  - ${file.name}: ${file.state}${progress}${file.job_id === undefined ? '' : ` [job: \`${file.job_id}\`]`}`)
    }
  }
  if (value.failure !== undefined) {
    lines.push(`- Error: [${value.failure.code}] ${value.failure.message}`)
  }
  return [{ type: 'text', text: clampRenderText(lines.join('\n')) }]
}

export function renderResult(value: ResultView): ContentBlock[] {
  const lines: string[] = [
    `**MinerU Parse Result**: \`${value.job_id}\``,
    `- State: ${value.state}`,
    `- Cache Hit: ${value.cache_hit ? 'Yes' : 'No'}`,
    `- Result ID: \`${value.result_id}\``,
    `- Manifest: \`${value.manifest_path}\``,
  ]

  if (value.files.length > 0) {
    lines.push('\n### Artifact Files:')
    for (const file of value.files) {
      lines.push(`- **${file.name}**:`)
      if (file.job_id !== undefined) lines.push(`  - Job: \`${file.job_id}\``)
      if (file.state !== undefined) lines.push(`  - State: ${file.state}`)
      if (file.result_id !== undefined) lines.push(`  - Result: \`${file.result_id}\``)
      if (file.manifest_path !== undefined) lines.push(`  - Manifest: \`${file.manifest_path}\``)
      if (file.failure !== undefined) lines.push(`  - Failure: [${file.failure.code}] ${file.failure.message}`)
      for (const artifact of file.artifacts) {
        lines.push(`  - ${artifact.kind} (${String(artifact.bytes)} bytes): \`${artifact.path}\``)
      }
      if (file.artifacts_truncated) lines.push('  - *(Artifact list truncated to output limit)*')
    }
  }

  if (value.markdown_preview !== undefined) {
    lines.push('\n### Markdown Preview:')
    lines.push(value.markdown_preview)
    if (value.preview_truncated) {
      lines.push('\n*(Preview truncated to output limit)*')
    }
  }

  const rendered = lines.join('\n')
  return [{ type: 'text', text: clampRenderText(rendered, value.output_limit_chars) }]
}

export function renderParseDocument(value: ParseDocumentView): ContentBlock[] {
  if ('kind' in value) {
    const sections = value.jobs.map(job => 'result_id' in job ? renderResult(job)[0]?.text ?? '' : renderStatus(job)[0]?.text ?? '')
    const timeout = value.poll_timed_out === true ? '\n- Poll Timed Out: Yes' : ''
    return [{ type: 'text', text: clampRenderText(`**MinerU Batch Result**
- State: ${value.state}
- Jobs: ${String(value.jobs.length)}${timeout}

${sections.join('\n\n')}`) }]
  }
  return 'result_id' in value ? renderResult(value) : renderStatus(value)
}

// ============================================================================
// Registration
// ============================================================================

function requireAgentSession(exec: ToolRunContext) {
  const session = exec.agent?.session
  if (session === undefined) {
    throw new MinerUError(failure(
      'UNAUTHENTICATED_SESSION',
      'MinerU operations require an authenticated agent session (UNAUTHENTICATED_SESSION)',
    ))
  }
  return { session, signal: exec.signal }
}

function requireJobId(args: unknown): string {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new MinerUError(failure('INVALID_REQUEST', 'Tool arguments must be an object'))
  }
  for (const key of Object.keys(args)) {
    if (key !== 'job_id') throw new MinerUError(failure('INVALID_REQUEST', `Unsupported tool argument ${key}`))
  }
  const { job_id: jobId } = args as { job_id?: unknown }
  if (typeof jobId !== 'string' || jobId.trim() === '') {
    throw new MinerUError(failure('INVALID_REQUEST', 'job_id is required'))
  }
  return jobId
}

export function registerTools(
  ctx: Context,
  getService: () => MinerUService,
  accessGate?: StorageAccessGate,
): () => void {
  const disposers: Array<() => void> = []
  const withStorageAccess = async <T,>(operation: () => Promise<T>): Promise<T> => {
    return accessGate === undefined ? await operation() : await accessGate.runShared(operation)
  }

  // 1. mineru_health
  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'mineru_health',
        description: 'Check MinerU backend connectivity, authentication status, and queue capacity.',
        parameters: {},
        output: {
          schema: {
            type: 'object',
            properties: {
              available: { type: 'boolean', description: 'Whether the provider service is available.' },
              provider: { type: 'string', enum: ['self-hosted-v2', 'official-v4'], description: 'Active provider identifier.' },
              authentication: {
                type: 'string',
                enum: ['valid', 'invalid', 'not-configured', 'unknown'],
                description: 'Provider credential authentication status.',
              },
              protocol_version: { type: 'string', description: 'Provider protocol version.' },
              server_version: { type: 'string', description: 'Upstream server version string.' },
              queue: {
                type: 'object',
                description: 'Provider queue capacity and status.',
                properties: {
                  queued: { type: 'integer', description: 'Tasks waiting in queue.' },
                  processing: { type: 'integer', description: 'Tasks currently being processed.' },
                  completed: { type: 'integer', description: 'Completed tasks retained by upstream.' },
                  failed: { type: 'integer', description: 'Failed tasks.' },
                  max_concurrent: { type: 'integer', description: 'Maximum concurrent processing capacity.' },
                },
                additionalProperties: false,
              },
              diagnostics: { type: 'string', description: 'Diagnostic notes or connection error information.' },
            },
            additionalProperties: false,
          },
          render: (_args: unknown, value: unknown) => renderHealth(value as ProbeView),
        },
        execute: async (_args: unknown, exec: ToolRunContext) => {
          const { signal } = requireAgentSession(exec)
          return await getService().probe(signal)
        },
      }),
    ) as () => void,
  )

  // 2. mineru_submit_parse_job
  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'mineru_submit_parse_job',
        description: 'Submit documents (PDF, Word, Excel, PPT) for async parsing into Markdown. Returns a job ID immediately for non-blocking or large batch tasks.',
        parameters: parseParameters,
        output: {
          schema: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['batch'], description: 'Present only for a multi-file batch envelope.' },
              jobs: { type: 'array', description: 'Independent per-file submission jobs.', items: submitChildSchema },
              job_id: { type: 'string', description: 'Unique MinerU job ID (mj_...).' },
              state: {
                type: 'string',
                enum: ['queued', 'uploading', 'processing', 'collecting', 'completed', 'partially-completed', 'failed'],
                description: 'Initial job lifecycle state.',
              },
              source: {
                type: 'string',
                enum: ['cache', 'shared-operation', 'provider'],
                description: 'Resolution source.',
              },
              provider: { type: 'string', enum: ['self-hosted-v2', 'official-v4'], description: 'Assigned provider.' },
              files: {
                type: 'array',
                description: 'Files included in this job submission.',
                items: fileStatusSchema,
              },
              result_available: { type: 'boolean', description: 'Whether result is already available (e.g. cache hit).' },
              failure: failureSchema,
            },
            additionalProperties: false,
          },
          render: (_args: unknown, value: unknown) => renderSubmit(value as SubmitView | BatchSubmitView),
        },
        execute: async (args: unknown, exec: ToolRunContext) => {
          const { session, signal } = requireAgentSession(exec)
          return await withStorageAccess(() => getService().submit(session, args as ParseRequestInput, signal))
        },
      }),
    ) as () => void,
  )

  // 3. mineru_get_parse_status
  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'mineru_get_parse_status',
        description: 'Check status and progress of an async parsing job. Call mineru_get_parse_result when completed.',
        parameters: {
          job_id: {
            type: 'string',
            description: 'MinerU job ID (mj_...) to query.',
          },
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              job_id: { type: 'string', description: 'MinerU job ID.' },
              state: {
                type: 'string',
                enum: ['queued', 'uploading', 'processing', 'collecting', 'completed', 'partially-completed', 'failed'],
                description: 'Current job state.',
              },
              source: {
                type: 'string',
                enum: ['cache', 'shared-operation', 'provider'],
                description: 'Resolution source.',
              },
              provider: { type: 'string', enum: ['self-hosted-v2', 'official-v4'], description: 'Provider identifier.' },
              files: {
                type: 'array',
                description: 'File statuses and progress.',
                items: fileStatusSchema,
              },
              result_available: { type: 'boolean', description: 'Whether parsing result is ready to fetch.' },
              failure: failureSchema,
              created_at: { type: 'number', description: 'Creation timestamp in epoch milliseconds.' },
              updated_at: { type: 'number', description: 'Last update timestamp in epoch milliseconds.' },
            },
            additionalProperties: false,
          },
          render: (_args: unknown, value: unknown) => renderStatus(value as StatusView),
        },
        execute: async (args: unknown, exec: ToolRunContext) => {
          const { session, signal } = requireAgentSession(exec)
          return await withStorageAccess(() => getService().status(session, requireJobId(args), signal))
        },
      }),
    ) as () => void,
  )

  // 4. mineru_get_parse_result
  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'mineru_get_parse_result',
        description: 'Retrieve parsed Markdown preview and local artifact paths (images, layout) for a completed job.',
        parameters: {
          job_id: {
            type: 'string',
            description: 'MinerU job ID of a completed parse job.',
          },
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              job_id: { type: 'string', description: 'MinerU job ID.' },
              state: {
                type: 'string',
                enum: ['completed', 'partially-completed'],
                description: 'Final completed job state.',
              },
              cache_hit: { type: 'boolean', description: 'Whether the result was served from global cache.' },
              result_id: { type: 'string', description: 'Global content-addressed result ID.' },
              files: {
                type: 'array',
                description: 'Published documents and artifact paths.',
                items: resultFileViewSchema,
              },
              markdown_preview: { type: 'string', description: 'Inline markdown preview text.' },
              preview_truncated: { type: 'boolean', description: 'Whether inline preview was truncated.' },
              manifest_path: { type: 'string', description: 'Local path to the result manifest.json file.' },
              output_limit_chars: { type: 'integer', description: 'Configured maximum inline character limit.' },
            },
            additionalProperties: false,
          },
          render: (_args: unknown, value: unknown) => renderResult(value as ResultView),
        },
        execute: async (args: unknown, exec: ToolRunContext) => {
          const { session, signal } = requireAgentSession(exec)
          return await withStorageAccess(() => getService().result(session, requireJobId(args), signal))
        },
      }),
    ) as () => void,
  )

  // 5. mineru_parse_document
  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'mineru_parse_document',
        description: 'Parse documents (PDF, Word, Excel, PPT) into Markdown with formulas, tables, and images. Synchronously waits and returns markdown preview and artifact paths.',
        parameters: {
          ...parseParameters,
          poll_timeout_ms: {
            type: 'integer',
            description: 'Maximum time (ms) to wait before returning in-progress status.',
          },
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['batch'], description: 'Present only for a multi-file batch envelope.' },
              jobs: { type: 'array', description: 'Independent per-file parse views.', items: parseChildSchema },
              job_id: { type: 'string', description: 'MinerU job ID.' },
              state: {
                type: 'string',
                enum: ['queued', 'uploading', 'processing', 'collecting', 'completed', 'partially-completed', 'failed'],
                description: 'Job state.',
              },
              source: {
                type: 'string',
                enum: ['cache', 'shared-operation', 'provider'],
                description: 'Resolution source.',
              },
              provider: { type: 'string', enum: ['self-hosted-v2', 'official-v4'], description: 'Provider identifier.' },
              cache_hit: { type: 'boolean', description: 'Whether result came from cache.' },
              result_id: { type: 'string', description: 'Result manifest ID if completed.' },
              files: {
                type: 'array',
                description: 'Document files and statuses / artifacts.',
                items: {
                  type: 'object',
                  properties: {
                    file_id: { type: 'string', description: 'File identifier.' },
                    name: { type: 'string', description: 'File name.' },
                    job_id: { type: 'string', description: 'Per-file MinerU job ID in a multi-file response.' },
                    state: { type: 'string', description: 'File state if in status view.' },
                    result_id: { type: 'string', description: 'Published single-file result ID.' },
                    manifest_path: { type: 'string', description: 'Published single-file manifest path.' },
                    cache_hit: { type: 'boolean', description: 'Whether this individual file result came from cache.' },
                    progress: {
                      type: 'object',
                      properties: {
                        completed: { type: 'integer' },
                        total: { type: 'integer' },
                      },
                      additionalProperties: false,
                    },
                    failure: failureSchema,
                    artifacts: {
                      type: 'array',
                      items: artifactViewSchema,
                    },
                    artifacts_truncated: { type: 'boolean' },
                  },
                  additionalProperties: false,
                },
              },
              markdown_preview: { type: 'string', description: 'Inline markdown preview text.' },
              preview_truncated: { type: 'boolean', description: 'Whether markdown preview was truncated.' },
              manifest_path: { type: 'string', description: 'Absolute path to result manifest.json.' },
              output_limit_chars: { type: 'integer', description: 'Inline output character limit.' },
              result_available: { type: 'boolean', description: 'Whether result is available.' },
              failure: failureSchema,
              poll_timed_out: { type: 'boolean', description: 'Whether synchronous poll timed out.' },
              created_at: { type: 'number', description: 'Creation timestamp in epoch milliseconds.' },
              updated_at: { type: 'number', description: 'Last update timestamp in epoch milliseconds.' },
            },
            additionalProperties: false,
          },
          render: (_args: unknown, value: unknown) => renderParseDocument(value as ParseDocumentView),
        },
        execute: async (args: unknown, exec: ToolRunContext) => {
          const { session, signal } = requireAgentSession(exec)
          if (typeof args !== 'object' || args === null || Array.isArray(args)) {
            throw new MinerUError(failure('INVALID_REQUEST', 'Tool arguments must be an object'))
          }
          const { poll_timeout_ms: rawPollTimeout, ...input } = args as ParseRequestInput & { poll_timeout_ms?: unknown }
          return await withStorageAccess(() => getService().parseDocument(session, input, signal, parsePollTimeout(rawPollTimeout)))
        },
      }),
    ) as () => void,
  )

  return () => {
    for (const dispose of disposers) {
      dispose()
    }
  }
}