/** Model-facing MinerU tools: native background submit and direct parse. */
import { readFile } from 'node:fs/promises'
import { basename, dirname, extname, resolve } from 'node:path'
import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JobOutcome, JobRegistry } from '@deepseek-ai/dsh-jobs'
import type { AttachmentStore, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock, JsonValue, ObjectValueSchemaSpec, ParameterSchemaSpec, ToolRunContext, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { MinerUError, failure, toMinerUFailure } from './domain/errors.js'
import type { ParseRequestInput } from './domain/request.js'
import type { MinerUResultManifest } from './domain/result.js'
import type { StorageAccessGate } from './storage/access-gate.js'
import type {
  BatchParseDocumentView,
  FailedParseView,
  InlinedImageView,
  MinerUService,
  ParseDocumentView,
  ResultView,
} from './service/mineru-service.js'
import {
  formatParseDocumentProse,
  formatResultProse,
} from './service/mineru-service.js'

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

const inlinedImageViewSchema: ObjectValueSchemaSpec = {
  type: 'object',
  properties: {
    attachment_id: { type: 'string' },
    name: { type: 'string' },
    media_type: { type: 'string' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    bytes: { type: 'integer' },
  },
  additionalProperties: false,
}

const documentHeadingSchema: ObjectValueSchemaSpec = {
  type: 'object',
  properties: {
    level: { type: 'integer' },
    title: { type: 'string' },
    line: { type: 'integer' },
  },
  additionalProperties: false,
}

const resultFileViewSchema: ObjectValueSchemaSpec = {
  type: 'object',
  properties: {
    file_id: { type: 'string' }, name: { type: 'string' },
    artifacts: { type: 'array', items: artifactViewSchema }, artifacts_truncated: { type: 'boolean' },
    markdown_path: { type: 'string' },
  },
  additionalProperties: false,
}

const resultViewSchema: ObjectValueSchemaSpec = {
  type: 'object',
  properties: {
    state: { type: 'string', enum: ['completed'] },
    source: { type: 'string', enum: ['cache', 'shared-operation', 'provider'] },
    cache_hit: { type: 'boolean' }, result_id: { type: 'string' },
    files: { type: 'array', items: resultFileViewSchema },
    markdown_content: { type: 'string' },
    content_status: { type: 'string', enum: ['complete', 'partial', 'not_requested'] },
    markdown_path: { type: 'string' },
    read_offset_line: { type: 'integer' },
    manifest_path: { type: 'string' },
    output_limit_chars: { type: 'integer' },
    inlined_images: { type: 'array', items: inlinedImageViewSchema },
    toc: { type: 'array', items: documentHeadingSchema },
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
    output_limit_chars: { type: 'integer' },
    content_status: { type: 'string', enum: ['complete', 'partial', 'not_requested'] },
    results_omitted: { type: 'boolean' },
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

const DEFAULT_RENDER_LIMIT = 200_000
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

export interface ParsedToolInput {
  readonly input: ParseRequestInput
  readonly pollTimeoutMs?: number
  readonly inline_images?: boolean
  readonly max_inline_images?: number
}

function parseInput(args: unknown): ParsedToolInput {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new MinerUError(failure('INVALID_REQUEST', 'Tool arguments must be an object'))
  }
  const {
    poll_timeout_ms: rawPollTimeout,
    inline_images: rawInlineImages,
    max_inline_images: rawMaxInlineImages,
    ...input
  } = args as ParseRequestInput & {
    poll_timeout_ms?: unknown
    inline_images?: unknown
    max_inline_images?: unknown
  }
  const pollTimeoutMs = parsePollTimeout(rawPollTimeout)

  let inline_images: boolean | undefined
  if (rawInlineImages !== undefined) {
    if (typeof rawInlineImages !== 'boolean') {
      throw new MinerUError(failure('INVALID_REQUEST', 'inline_images must be a boolean'))
    }
    inline_images = rawInlineImages
  }

  let max_inline_images: number | undefined
  if (rawMaxInlineImages !== undefined) {
    if (!Number.isSafeInteger(rawMaxInlineImages) || (rawMaxInlineImages as number) <= 0) {
      throw new MinerUError(failure('INVALID_REQUEST', 'max_inline_images must be a positive integer'))
    }
    max_inline_images = rawMaxInlineImages as number
  }

  return {
    input,
    ...(pollTimeoutMs === undefined ? {} : { pollTimeoutMs }),
    ...(inline_images === undefined ? {} : { inline_images }),
    ...(max_inline_images === undefined ? {} : { max_inline_images }),
  }
}

export function renderResult(value: ResultView): ContentBlock[] {
  const limit = (typeof value.output_limit_chars === 'number' && Number.isSafeInteger(value.output_limit_chars) && value.output_limit_chars > 0)
    ? value.output_limit_chars
    : DEFAULT_RENDER_LIMIT
  const textBlock: ContentBlock = { type: 'text', text: clampRenderText(formatResultProse(value), limit) }
  const inlined = value.inlined_images ?? []
  const imageBlocks: ContentBlock[] = inlined.flatMap(img =>
    img.attachmentRef ? [{ type: 'image' as const, attachment: img.attachmentRef }] : []
  )
  return [textBlock, ...imageBlocks]
}

export function renderParseDocument(value: ParseDocumentView): ContentBlock[] {
  if (!('kind' in value)) return renderResult(value)
  const limit = ('output_limit_chars' in value && typeof value.output_limit_chars === 'number' && Number.isSafeInteger(value.output_limit_chars) && value.output_limit_chars > 0)
    ? value.output_limit_chars
    : DEFAULT_RENDER_LIMIT
  const textBlock: ContentBlock = { type: 'text', text: clampRenderText(formatParseDocumentProse(value), limit) }
  const imageBlocks: ContentBlock[] = value.results
    .filter((r): r is ResultView => r.state === 'completed')
    .flatMap(r => (r.inlined_images ?? []).flatMap(img => img.attachmentRef ? [{ type: 'image' as const, attachment: img.attachmentRef }] : []))
  return [textBlock, ...imageBlocks]
}

function backgroundLabel(input: ParseRequestInput): string {
  const count = Array.isArray(input.file_paths) ? input.file_paths.length : 0
  return 'Read ' + String(count) + ' PDF document' + (count === 1 ? '' : 's') + ' with MinerU'
}

function nativeSuccessOutcome(value: ParseDocumentView): JobOutcome {
  const firstBlock = renderParseDocument(value)[0]
  const output = (firstBlock && 'text' in firstBlock) ? firstBlock.text : JSON.stringify(value)
  if ('kind' in value && value.state === 'failed') {
    return { status: 'failed', detail: 'batch-failed', output }
  }
  return { status: 'completed', detail: 'kind' in value ? value.state : 'completed', output }
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const MIN_FIGURE_BYTES = 5 * 1024 // 5KB

function getRasterMediaType(ext: string): ImageMediaType {
  switch (ext.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    default:
      return 'image/png'
  }
}

interface ImageCandidate {
  readonly path: string
  readonly bytes: number
  readonly name: string
  readonly mediaType: ImageMediaType
}

async function collectImageCandidates(view: ResultView): Promise<ImageCandidate[]> {
  const candidates: ImageCandidate[] = []
  const seenPaths = new Set<string>()

  for (const file of view.files ?? []) {
    for (const artifact of file.artifacts ?? []) {
      if (artifact.kind === 'images') {
        const ext = extname(artifact.path).toLowerCase()
        if (IMAGE_EXTENSIONS.has(ext) && !seenPaths.has(artifact.path)) {
          seenPaths.add(artifact.path)
          candidates.push({
            path: artifact.path,
            bytes: artifact.bytes,
            name: basename(artifact.path),
            mediaType: getRasterMediaType(ext),
          })
        }
      }
    }
  }

  if (candidates.length === 0 && view.manifest_path) {
    try {
      const manifestRaw = await readFile(view.manifest_path, 'utf8')
      const manifest = JSON.parse(manifestRaw) as MinerUResultManifest
      const manifestDir = dirname(view.manifest_path)
      for (const file of manifest.files ?? []) {
        for (const artifact of file.artifacts ?? []) {
          if (artifact.kind === 'images') {
            const ext = extname(artifact.relativePath).toLowerCase()
            if (IMAGE_EXTENSIONS.has(ext)) {
              const absPath = resolve(manifestDir, artifact.relativePath)
              if (!seenPaths.has(absPath)) {
                seenPaths.add(absPath)
                candidates.push({
                  path: absPath,
                  bytes: artifact.bytes,
                  name: basename(artifact.relativePath),
                  mediaType: getRasterMediaType(ext),
                })
              }
            }
          }
        }
      }
    } catch {
      // Manifest unreadable or missing, ignore
    }
  }

  return candidates
}

async function inlineImagesForSingleResult(
  view: ResultView,
  attachments: AttachmentStore,
  maxInline: number,
  signal?: AbortSignal,
): Promise<ResultView> {
  const candidates = await collectImageCandidates(view)
  if (candidates.length === 0) return view

  candidates.sort((a, b) => b.bytes - a.bytes)

  const hasLarger = candidates.some(c => c.bytes >= MIN_FIGURE_BYTES)
  const filtered = hasLarger ? candidates.filter(c => c.bytes >= MIN_FIGURE_BYTES) : candidates

  const limit = Math.max(1, Math.min(10, maxInline))
  const selected = filtered.slice(0, limit)

  const inlined: InlinedImageView[] = []
  for (const item of selected) {
    signal?.throwIfAborted()
    try {
      const imageBytes = await readFile(item.path)
      const ref = await attachments.saveImage({
        data: imageBytes,
        mediaType: item.mediaType,
        name: item.name,
      })
      inlined.push({
        attachment_id: String(ref.attachmentId),
        name: ref.name ?? item.name,
        media_type: ref.mediaType,
        ...(ref.width !== undefined ? { width: ref.width } : {}),
        ...(ref.height !== undefined ? { height: ref.height } : {}),
        ...(ref.bytes !== undefined ? { bytes: ref.bytes } : {}),
        attachmentRef: ref,
      })
    } catch {
      // Skip individual failure gracefully
    }
  }

  if (inlined.length > 0) {
    return { ...view, inlined_images: inlined }
  }
  return view
}

async function processInlineImages(
  view: ParseDocumentView,
  attachments: AttachmentStore,
  maxInline?: number,
  signal?: AbortSignal,
): Promise<ParseDocumentView> {
  const totalMax = Math.max(1, Math.min(10, (typeof maxInline === 'number' && Number.isSafeInteger(maxInline)) ? maxInline : 3))
  if (!('kind' in view)) {
    return await inlineImagesForSingleResult(view, attachments, totalMax, signal)
  }
  let remaining = totalMax
  const updatedResults: Array<ResultView | FailedParseView> = []
  for (const res of view.results) {
    if (res.state === 'completed' && remaining > 0) {
      const updated = await inlineImagesForSingleResult(res, attachments, remaining, signal)
      const count = updated.inlined_images?.length ?? 0
      remaining -= count
      updatedResults.push(updated)
    } else {
      updatedResults.push(res)
    }
  }
  return { ...view, results: updatedResults }
}

async function checkCallingModelSupportsImage(exec: ToolRunContext, ctx: Context): Promise<boolean> {
  const routed = (exec.agent?.session as any)?.requestHeader?.()?.config
  const provider = routed?.provider ?? (exec.agent as any)?.options?.provider
  const model = routed?.model ?? (exec.agent as any)?.options?.model
  const llm = ctx.get('llm') as { resolveModelInfo?: (p: string, m: string, s?: AbortSignal) => Promise<{ inputModalities?: readonly string[] }> } | undefined
  if (provider && model && llm && typeof llm.resolveModelInfo === 'function') {
    try {
      const active = await llm.resolveModelInfo(provider, model, exec.signal)
      return active?.inputModalities?.includes('image') ?? false
    } catch {
      return false
    }
  }
  return false
}

export function registerTools(ctx: Context, getService: () => MinerUService, accessGate?: StorageAccessGate): () => Promise<void> {
  const disposers: Array<() => void> = []
  const backgroundInvocations = new Set<{ readonly controller: AbortController; readonly done: Promise<JobOutcome> }>()
  const withStorageAccess = async <T,>(operation: () => Promise<T>): Promise<T> => {
    return accessGate === undefined ? await operation() : await accessGate.runShared(operation)
  }

  disposers.push(ctx.tools.register(defineTool({
    name: 'async_read_pdf',
    description: 'Submit PDF document parsing as a native background job. Returns job_id immediately. Use job_output to retrieve results or job_kill to cancel.',
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
      presentationMeta: (_args: unknown, value: unknown) => {
        const output = value as { readonly job_id: string; readonly state: string }
        return {
          job_id: output.job_id,
          state: output.state,
        }
      },
    },
    isConcurrencySafe: () => true,
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
    name: 'read_pdf',
    description: 'Parse PDF documents and return extracted Markdown text and figures directly. When content_status is complete, full Markdown is provided in markdown_content. When content_status is partial, Markdown is truncated by output limits; use the returned markdown_path and read_offset_line to read the remainder.',
    parameters: {
      ...parseParameters,
      inline_images: {
        type: 'boolean',
        description: 'Whether to inline key visual figures directly as multimodal image blocks. Defaults to true when calling model route supports images.',
      },
      max_inline_images: {
        type: 'integer',
        description: 'Maximum number of key images to inline directly (default 3, max 10).',
      },
      poll_timeout_ms: {
        type: 'integer',
        description: 'Maximum synchronous wait in milliseconds. A timeout leaves the shared producer running; retry the same request to rejoin it.',
      },
    },
    output: {
      schema: parseOutputSchema,
      render: (_args: unknown, value: unknown) => renderParseDocument(value as ParseDocumentView),
      presentationMeta: (_args: unknown, value: unknown): JsonValue => {
        const doc = value as ParseDocumentView
        if ('kind' in doc && doc.kind === 'batch') {
          return {
            kind: 'batch',
            state: doc.state,
            results_count: doc.results.length,
            manifests: doc.results.flatMap(r => r.state === 'completed' ? [r.manifest_path] : []),
          }
        }
        const single = doc as ResultView
        return {
          result_id: single.result_id,
          source: single.source,
          cache_hit: single.cache_hit,
          manifest_path: single.manifest_path,
          files: single.files.map(f => ({
            file_id: f.file_id,
            name: f.name,
            artifacts: f.artifacts.map(a => ({ kind: a.kind, path: a.path, bytes: a.bytes })),
          })),
          ...(single.inlined_images !== undefined ? {
            inlined_images: single.inlined_images.map(img => ({
              attachment_id: img.attachment_id,
              name: img.name,
              media_type: img.media_type,
              ...(img.width !== undefined ? { width: img.width } : {}),
              ...(img.height !== undefined ? { height: img.height } : {}),
              ...(img.bytes !== undefined ? { bytes: img.bytes } : {}),
            })),
          } : {}),
          ...(single.toc !== undefined ? {
            toc: single.toc.map(item => ({
              level: item.level,
              title: item.title,
              line: item.line,
            })),
          } : {}),
        }
      },
    },
    isConcurrencySafe: () => true,
    execute: async (args: unknown, exec: ToolRunContext) => {
      const agent = requireAgent(exec)
      const { input, pollTimeoutMs, inline_images, max_inline_images } = parseInput(args)
      const supportsImage = await checkCallingModelSupportsImage(exec, ctx)
      const attachments = ctx.get('attachments') as AttachmentStore | undefined
      const shouldInline = inline_images !== false && supportsImage && attachments !== undefined

      const effectiveArtifacts = input.artifacts
        ? (shouldInline && !input.artifacts.includes('images') ? [...input.artifacts, 'images' as const] : input.artifacts)
        : (shouldInline ? ['markdown' as const, 'images' as const] : undefined)
      const effectiveInput = effectiveArtifacts ? { ...input, artifacts: effectiveArtifacts } : input

      const rawResult = await withStorageAccess(() => getService().parseDocument(agent.session, effectiveInput, exec.signal, pollTimeoutMs))
      if (shouldInline && attachments) {
        return await processInlineImages(rawResult, attachments, max_inline_images, exec.signal)
      }
      return rawResult
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
