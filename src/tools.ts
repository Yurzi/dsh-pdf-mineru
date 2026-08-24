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
import type { MinerUConfig } from './config.js'
import type { ParseRequestInput } from './domain/request.js'
import type {
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
    artifacts_truncated: { type: 'boolean', description: 'Whether artifact list was truncated to fit limit.' },
  },
  additionalProperties: false,
}

const parseParameters: ParameterSchemaSpec = {
  file_paths: {
    type: 'array',
    items: { type: 'string' },
    description: 'Local filesystem paths of the documents to parse (single document per submission in current release).',
  },
  file_path: {
    type: 'string',
    description: 'Deprecated: Single local file path. Use file_paths instead.',
  },
  model: {
    type: 'string',
    enum: ['pipeline', 'vlm'],
    description: 'Parsing model. pipeline: rule-based layout/table/formula pipeline. vlm: vision-language model.',
  },
  ocr: {
    type: 'boolean',
    description: 'Force OCR parsing for all pages.',
  },
  language: {
    type: 'string',
    description: 'Language hint code (e.g. "ch", "en", "latin", "japan", "korean").',
  },
  formula: {
    type: 'boolean',
    description: 'Enable mathematical formula recognition.',
  },
  table: {
    type: 'boolean',
    description: 'Enable table structure recognition.',
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
    description: 'Artifact kinds to retain and publish in the global result (default: ["markdown"]).',
  },
  backend: {
    type: 'string',
    description: 'Deprecated: Legacy backend string (pipeline, vlm-engine, hybrid-engine). Use model instead.',
  },
  parse_method: {
    type: 'string',
    enum: ['auto', 'txt', 'ocr'],
    description: 'Deprecated: Legacy parse method. Use ocr instead.',
  },
  lang_list: {
    type: 'array',
    items: { type: 'string' },
    description: 'Deprecated: Legacy language code array. Use language instead.',
  },
  formula_enable: {
    type: 'boolean',
    description: 'Deprecated: Legacy formula flag. Use formula instead.',
  },
  table_enable: {
    type: 'boolean',
    description: 'Deprecated: Legacy table flag. Use table instead.',
  },
  return_middle_json: {
    type: 'boolean',
    description: 'Deprecated: Include layout middle JSON. Use artifacts: ["layout"] instead.',
  },
  return_model_output: {
    type: 'boolean',
    description: 'Deprecated: Include model output JSON. Use artifacts: ["model-output"] instead.',
  },
  return_content_list: {
    type: 'boolean',
    description: 'Deprecated: Include content list JSON. Use artifacts: ["content-list"] instead.',
  },
  return_images: {
    type: 'boolean',
    description: 'Deprecated: Include extracted images. Use artifacts: ["images"] instead.',
  },
  start_page_id: {
    type: 'integer',
    description: 'Deprecated: 0-based start page index. Use pages instead.',
  },
  end_page_id: {
    type: 'integer',
    description: 'Deprecated: 0-based end page index. Use pages instead.',
  },
}

// ============================================================================
// Render Helpers
// ============================================================================

function clampRenderText(rendered: string, limit?: number): string {
  if (limit === undefined || limit <= 0 || rendered.length <= limit) {
    return rendered
  }
  const suffix = '\n\n[Output truncated to limit]'
  const sliceLen = Math.max(0, limit - suffix.length)
  return rendered.slice(0, sliceLen) + suffix
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
  return [{ type: 'text', text: lines.join('\n') }]
}

export function renderSubmit(value: SubmitView): ContentBlock[] {
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
      lines.push(`  - ${file.name} (${file.state})`)
    }
  }
  if (value.failure !== undefined) {
    lines.push(`- Failure: [${value.failure.code}] ${value.failure.message}`)
  }
  return [{ type: 'text', text: lines.join('\n') }]
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
      lines.push(`  - ${file.name}: ${file.state}${progress}`)
    }
  }
  if (value.failure !== undefined) {
    lines.push(`- Error: [${value.failure.code}] ${value.failure.message}`)
  }
  return [{ type: 'text', text: lines.join('\n') }]
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
      for (const artifact of file.artifacts) {
        lines.push(`  - ${artifact.kind} (${String(artifact.bytes)} bytes): \`${artifact.path}\``)
      }
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
  if ('manifest_path' in value && (value.state === 'completed' || value.state === 'partially-completed')) {
    return renderResult(value as ResultView)
  }
  return renderStatus(value as StatusView)
}

// ============================================================================
// Registration
// ============================================================================

function requireAgentSession(exec: ToolRunContext) {
  const agent = exec.agent
  if (agent === undefined) {
    throw new Error('MinerU operations require an authenticated agent session (UNAUTHENTICATED_SESSION)')
  }
  return {
    session: agent.session,
    signal: exec.signal,
  }
}

export function registerTools(
  ctx: Context,
  getService: () => MinerUService,
  _getConfig?: () => MinerUConfig,
): () => void {
  const disposers: Array<() => void> = []

  // 1. mineru_health
  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'mineru_health',
        description: 'Check MinerU server and provider health, connection status, and queue depth.',
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
        description: 'Submit a document to MinerU for asynchronous parsing and return immediately with a job ID.',
        parameters: parseParameters,
        output: {
          schema: {
            type: 'object',
            properties: {
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
          render: (_args: unknown, value: unknown) => renderSubmit(value as SubmitView),
        },
        execute: async (args: unknown, exec: ToolRunContext) => {
          const { session, signal } = requireAgentSession(exec)
          return await getService().submit(session, args as ParseRequestInput, signal)
        },
      }),
    ) as () => void,
  )

  // 3. mineru_get_parse_status
  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'mineru_get_parse_status',
        description: 'Check the status and progress of an asynchronous MinerU parsing job.',
        parameters: {
          job_id: {
            type: 'string',
            description: 'MinerU job ID (mj_...) returned by submit or parse_document.',
          },
          task_id: {
            type: 'string',
            description: 'Deprecated: Alias for job_id. Only accepts plugin job_id (mj_...).',
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
          const typedArgs = args as { job_id?: string; task_id?: string }
          const jobId = typedArgs.job_id ?? typedArgs.task_id
          if (typeof jobId !== 'string' || jobId.trim() === '') {
            throw new Error('job_id is required')
          }
          return await getService().status(session, jobId, signal)
        },
      }),
    ) as () => void,
  )

  // 4. mineru_get_parse_result
  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'mineru_get_parse_result',
        description: 'Fetch parsed markdown content and published artifact paths for a completed MinerU task.',
        parameters: {
          job_id: {
            type: 'string',
            description: 'MinerU job ID of a completed parse job.',
          },
          task_id: {
            type: 'string',
            description: 'Deprecated: Alias for job_id. Only accepts plugin job_id (mj_...).',
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
          const typedArgs = args as { job_id?: string; task_id?: string }
          const jobId = typedArgs.job_id ?? typedArgs.task_id
          if (typeof jobId !== 'string' || jobId.trim() === '') {
            throw new Error('job_id is required')
          }
          return await getService().result(session, jobId, signal)
        },
      }),
    ) as () => void,
  )

  // 5. mineru_parse_document
  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'mineru_parse_document',
        description: 'Parse a local document via MinerU and return extracted markdown content and artifact paths.',
        parameters: {
          ...parseParameters,
          poll_timeout_ms: {
            type: 'integer',
            description: 'Maximum time (ms) to wait for parsing before returning in-progress job status.',
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
                    state: { type: 'string', description: 'File state if in status view.' },
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
          const typedArgs = args as ParseRequestInput & { poll_timeout_ms?: number }
          return await getService().parseDocument(session, typedArgs, signal, typedArgs.poll_timeout_ms)
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