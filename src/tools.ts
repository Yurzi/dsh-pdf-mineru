/** Model-facing MinerU tools: native background submit and direct parse. */
import { open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, extname } from 'node:path'
import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JobOutcome, JobRegistry } from '@deepseek-ai/dsh-jobs'
import type { AttachmentStore, ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock, JsonValue, ObjectValueSchemaSpec, ParameterSchemaSpec, ToolRunContext, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { MinerUError, failure, toMinerUFailure } from './domain/errors.js'
import type { FocusKind, PageSelection, ParseRequestInput } from './domain/request.js'
import { normalizeFocusSelection, normalizePageSelection } from './domain/request.js'
import type { StorageAccessGate } from './storage/access-gate.js'
import type {
  FailedParseView,
  ImageCandidateView,
  InlinedImageView,
  MinerUService,
  ParseSummaryView,
  ResultView,
} from './service/mineru-service.js'
import {
  formatResultProse,
  formatSingleSummaryProse,
} from './service/mineru-service.js'
import { MAX_INLINE_IMAGES, MAX_INLINE_IMAGE_SINGLE_BYTES, MAX_INLINE_IMAGE_TOTAL_BYTES, mediaTypeForExtension } from './service/image-policy.js'

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
  properties: { kind: { type: 'string', required: true }, path: { type: 'string', required: true }, bytes: { type: 'integer', required: true } },
  additionalProperties: false,
}

const inlinedImageViewSchema: ObjectValueSchemaSpec = {
  type: 'object',
  properties: {
    attachment_id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    media_type: { type: 'string', required: true },
    width: { type: 'integer' },
    height: { type: 'integer' },
    bytes: { type: 'integer' },
    figure: { type: 'integer' },
  },
  additionalProperties: false,
}

const imageCandidateViewSchema: ObjectValueSchemaSpec = {
  type: 'object',
  properties: {
    path: { type: 'string', required: true },
    name: { type: 'string', required: true },
    page: { type: 'integer' },
    caption: { type: 'string' },
    media_type: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
    status: { type: 'string', enum: ['available', 'unavailable', 'unsupported', 'failed', 'omitted'] },
  },
  additionalProperties: false,
}

const documentHeadingSchema: ObjectValueSchemaSpec = {
  type: 'object',
  properties: {
    level: { type: 'integer', required: true },
    title: { type: 'string', required: true },
    line: { type: 'integer' },
    page: { type: 'integer' },
  },
  additionalProperties: false,
}

const documentSummarySchema: ObjectValueSchemaSpec = {
  type: 'object',
  properties: {
    page_count: { type: 'integer' },
    table_count: { type: 'integer' },
    image_count: { type: 'integer' },
    equation_count: { type: 'integer' },
    toc: { type: 'array', items: documentHeadingSchema },
  },
  additionalProperties: false,
}

const resultFileViewSchema: ObjectValueSchemaSpec = {
  type: 'object',
  properties: {
    file_id: { type: 'string', required: true }, name: { type: 'string', required: true },
    artifacts: { type: 'array', items: artifactViewSchema, required: true }, artifacts_truncated: { type: 'boolean' },
    markdown_path: { type: 'string' },
  },
  additionalProperties: false,
}

const resultViewSchema: ObjectValueSchemaSpec = {
  type: 'object',
  properties: {
    state: { type: 'string', enum: ['completed'], required: true },
    source: { type: 'string', enum: ['cache', 'shared-operation', 'provider'], required: true },
    cache_hit: { type: 'boolean', required: true }, result_id: { type: 'string', required: true },
    files: { type: 'array', items: resultFileViewSchema, required: true },
    markdown_content: { type: 'string' },
    content_status: { type: 'string', enum: ['complete', 'partial', 'not_requested'], required: true },
    markdown_path: { type: 'string' },
    cursor: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' } },
    manifest_path: { type: 'string', required: true },
    output_limit_chars: { type: 'integer', required: true },
    inlined_images: { type: 'array', items: inlinedImageViewSchema },
    ordered_images: { type: 'array', items: imageCandidateViewSchema },
    summary: documentSummarySchema,
    toc: { type: 'array', items: documentHeadingSchema },
    pages: { type: 'string' },
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

const parseOutputSchema: ValueSchemaSpec = resultViewSchema

const asyncParseParameters: ParameterSchemaSpec = {
  file_path: {
    type: 'string',
    description: 'Path of the local PDF document to parse.',
    required: true,
  },
}

const readPdfParameters: ParameterSchemaSpec = {
  file_path: {
    type: 'string',
    description: 'Path of the local PDF document to read.',
    required: true,
  },
  pages: {
    oneOf: [
      { type: 'integer', description: 'Single 1-based page number, e.g. 3' },
      { type: 'string', description: 'Page range string, e.g. "1-3, 5"' },
      { type: 'array', items: { type: 'integer' }, description: 'Array of page numbers, e.g. [1, 2, 5]' },
    ],
    description: '1-based page numbers to extract. Accepts a single page number (e.g. 3), an array of page numbers (e.g. [1, 2, 5]), or a range string (e.g. "1-3, 5").',
  },
  focus: {
    oneOf: [
      { type: 'string', enum: ['all', 'text', 'table', 'image', 'toc', 'artifacts'], description: 'Focus content type' },
      { type: 'array', items: { type: 'string', enum: ['all', 'text', 'table', 'image', 'toc', 'artifacts'] }, description: 'Focus content types' },
    ],
    description: 'Content types to extract: "all" (default), "text" (paragraphs, headers, code, formulas), "table" (tables and captions), "image" (charts, figures, and captions), "toc" (document outline / table of contents), or "artifacts" (secondary artifact files like layout.json, model.json, and extracted images). Accepts a single kind or an array.',
  },
  inline_images: {
    type: 'boolean',
    description: 'Whether to inline visual figures directly as multimodal image blocks. Defaults to true when calling model route supports images.',
  },
  poll_timeout_ms: {
    type: 'integer',
    description: 'Maximum synchronous wait in milliseconds. A timeout leaves the shared producer running; retry the same request to rejoin it.',
  },
  cursor: {
    type: 'string',
    description: 'Opaque continuation cursor returned by a previous partial read. When provided, file_path is required and pages/focus must be omitted.',
  },
}

const DEFAULT_RENDER_LIMIT = 200_000
const MAX_POLL_TIMEOUT_MS = 24 * 60 * 60 * 1000

function clampRenderText(rendered: string, limit = DEFAULT_RENDER_LIMIT): string {
  if (!Number.isSafeInteger(limit) || limit <= 0) return ''
  if (rendered.length <= limit) return rendered
  const suffix = '\n\n[Output truncated to limit]'
  if (suffix.length >= limit) return suffix.slice(0, limit)
  const footerStart = rendered.lastIndexOf('\n---\n')
  if (footerStart >= 0) {
    const footer = rendered.slice(footerStart)
    if (footer.length < limit) return rendered.slice(0, limit - footer.length - suffix.length) + suffix + footer
  }
  return rendered.slice(0, limit - suffix.length) + suffix
}

function fitPostImageBudget(value: ResultView): ResultView {
  const limit = value.output_limit_chars
  let fitted = value
  const fits = (): boolean => JSON.stringify(fitted).length <= limit && formatResultProse(fitted).length <= limit
  if (fits()) return fitted
  fitted = { ...fitted, ordered_images: undefined }
  if (fits()) return fitted
  fitted = { ...fitted, summary: undefined, toc: undefined }
  if (fits()) return fitted
  throw new MinerUError(failure('RESULT_TOO_LARGE', 'Image attachment metadata exceeds the configured output limit'))
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

const READ_PARAMETER_FIELDS = new Set(['file_path', 'pages', 'focus', 'inline_images', 'poll_timeout_ms', 'cursor'])
const ASYNC_PARAMETER_FIELDS = new Set(['file_path'])

function assertAllowedParameters(args: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) {
      throw new MinerUError(failure('INVALID_REQUEST', `Unsupported parameter: ${key}. Valid parameters: ${[...allowed].join(', ')}`))
    }
  }
}

function extractFilePath(args: Record<string, unknown>): string {
  if (typeof args.file_path !== 'string' || args.file_path.trim() === '') {
    throw new MinerUError(failure('INVALID_REQUEST', 'Local document path (file_path) is required'))
  }
  return args.file_path.trim()
}

export function parseAsyncInput(args: unknown): { readonly input: ParseRequestInput } {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new MinerUError(failure('INVALID_REQUEST', 'Tool arguments must be an object'))
  }
  const obj = args as Record<string, unknown>
  assertAllowedParameters(obj, ASYNC_PARAMETER_FIELDS)
  const filePath = extractFilePath(obj)
  return {
    input: {
      file_path: filePath,
    },
  }
}

export interface ParsedToolInput {
  readonly input: ParseRequestInput
  readonly pollTimeoutMs?: number
  readonly inline_images?: boolean
}

export function parseReadInput(args: unknown): ParsedToolInput {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new MinerUError(failure('INVALID_REQUEST', 'Tool arguments must be an object'))
  }
  const obj = args as Record<string, unknown>
  assertAllowedParameters(obj, READ_PARAMETER_FIELDS)
  const filePath = extractFilePath(obj)
  const pollTimeoutMs = parsePollTimeout(obj.poll_timeout_ms)

  let inline_images: boolean | undefined
  if (obj.inline_images !== undefined) {
    if (typeof obj.inline_images !== 'boolean') {
      throw new MinerUError(failure('INVALID_REQUEST', 'inline_images must be a boolean'))
    }
    inline_images = obj.inline_images
  }

  let cursor: string | undefined
  if (obj.cursor !== undefined) {
    if (typeof obj.cursor !== 'string' || obj.cursor.trim() === '') throw new MinerUError(failure('INVALID_REQUEST', 'cursor must be a non-empty string'))
    cursor = obj.cursor.trim()
    if (obj.pages !== undefined || obj.focus !== undefined) throw new MinerUError(failure('INVALID_REQUEST', 'pages and focus must be omitted when cursor is provided'))
  }

  let pages: PageSelection | undefined
  if (obj.pages !== undefined) {
    try {
      normalizePageSelection(obj.pages)
      pages = obj.pages as PageSelection
    } catch (error) {
      throw new MinerUError(failure('INVALID_REQUEST', error instanceof Error ? error.message : 'Invalid page range'), { cause: error })
    }
  }

  let focus: FocusKind | readonly FocusKind[] | undefined
  if (obj.focus !== undefined) {
    try {
      normalizeFocusSelection(obj.focus)
      focus = obj.focus as FocusKind | readonly FocusKind[]
    } catch (error) {
      throw new MinerUError(failure('INVALID_REQUEST', error instanceof Error ? error.message : 'Invalid focus'), { cause: error })
    }
  }

  return {
    input: {
      file_path: filePath,
      ...(pages !== undefined ? { pages } : {}),
      ...(focus !== undefined ? { focus } : {}),
      ...(inline_images !== undefined ? { inline_images } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
    },
    ...(pollTimeoutMs !== undefined ? { pollTimeoutMs } : {}),
    ...(inline_images !== undefined ? { inline_images } : {}),
  }
}

export function renderResult(value: ResultView): ContentBlock[] {
  const limit = (typeof value.output_limit_chars === 'number' && Number.isSafeInteger(value.output_limit_chars) && value.output_limit_chars > 0)
    ? value.output_limit_chars
    : DEFAULT_RENDER_LIMIT
  const textBlock: ContentBlock = { type: 'text', text: clampRenderText(formatResultProse(value), limit) }
  const inlined = value.inlined_images ?? []
  const imageBlocks: ContentBlock[] = inlined.flatMap(img => {
    const attachment: ImageAttachmentRef = img.attachmentRef ?? {
      attachmentId: img.attachment_id as any,
      mediaType: img.media_type as ImageMediaType,
      bytes: img.bytes ?? 0,
      width: img.width ?? 0,
      height: img.height ?? 0,
      ...(img.name !== undefined ? { name: img.name } : {}),
    }
    return [{ type: 'image' as const, attachment }]
  })
  return [textBlock, ...imageBlocks]
}

function backgroundLabel(input: ParseRequestInput): string {
  const name = input.file_path ? basename(input.file_path) : 'document'
  return 'Parse ' + name + ' with MinerU'
}

function nativeSuccessOutcome(value: ParseSummaryView): JobOutcome {
  const output = formatSingleSummaryProse(value)
  return { status: 'completed', detail: 'completed', output }
}

interface ImageCandidate {
  readonly path: string
  readonly bytes: number
  readonly name: string
  readonly mediaType: ImageMediaType
  readonly index: number
}

interface BoundedImageRead {
  readonly data: Buffer
  readonly bytesRead: number
}

class BoundedImageReadError extends Error {
  readonly status: 'budget' | 'failed'
  readonly bytesRead: number

  constructor(status: 'budget' | 'failed', message: string, bytesRead: number) {
    super(message)
    this.name = 'BoundedImageReadError'
    this.status = status
    this.bytesRead = bytesRead
  }
}

async function readImageBounded(path: string, remainingBytes: number, signal?: AbortSignal): Promise<BoundedImageRead> {
  signal?.throwIfAborted()
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  let consumed = 0
  try {
    const details = await handle.stat()
    if (!details.isFile() || details.size > MAX_INLINE_IMAGE_SINGLE_BYTES) throw new BoundedImageReadError('budget', 'image exceeds inline budget', consumed)
    if (remainingBytes <= 0 || details.size > remainingBytes) throw new BoundedImageReadError('budget', 'image exceeds remaining inline budget', consumed)
    const buffer = Buffer.alloc(details.size)
    let offset = 0
    while (offset < buffer.length) {
      signal?.throwIfAborted()
      try {
        const read = await handle.read(buffer, offset, buffer.length - offset, offset)
        consumed += read.bytesRead
        if (read.bytesRead === 0) throw new BoundedImageReadError('failed', 'image changed during read', consumed)
        offset += read.bytesRead
      } catch (error) {
        if (error instanceof BoundedImageReadError) throw error
        throw new BoundedImageReadError('failed', 'image read failed', consumed)
      }
    }
    const finalDetails = await handle.stat()
    if (!finalDetails.isFile() || finalDetails.size !== offset) throw new BoundedImageReadError('failed', 'image changed during read', consumed)
    return { data: buffer, bytesRead: consumed }
  } catch (error) {
    if (error instanceof BoundedImageReadError) throw error
    throw new BoundedImageReadError('failed', 'image read failed', consumed)
  } finally {
    try {
      await handle.close()
    } catch {
      throw new BoundedImageReadError('failed', 'image close failed', consumed)
    }
  }
}

async function inlineImagesForSingleResult(
  view: ResultView,
  attachments: AttachmentStore,
  signal?: AbortSignal,
): Promise<ResultView> {
  const declared = view.ordered_images ?? []
  if (declared.length === 0) return view
  const statuses = declared.map(img => ({ ...img }))
  const candidates: ImageCandidate[] = []
  for (let index = 0; index < declared.length; index++) {
    const item = declared[index]!
    const mediaType = mediaTypeForExtension(extname(item.name))
    if (index >= MAX_INLINE_IMAGES || mediaType === undefined || item.path === '') {
      statuses[index] = { ...statuses[index], status: index >= MAX_INLINE_IMAGES ? 'omitted' : 'unsupported' }
      continue
    }
    if (item.bytes > MAX_INLINE_IMAGE_SINGLE_BYTES) {
      statuses[index] = { ...statuses[index], status: 'omitted' }
      continue
    }
    candidates.push({ path: item.path, bytes: item.bytes, name: item.name, mediaType, index })
  }

  const inlined: InlinedImageView[] = []
  let actualTotalBytes = 0
  let emittedTotalBytes = 0
  for (const item of candidates) {
    signal?.throwIfAborted()
    try {
      const imageRead = await readImageBounded(item.path, MAX_INLINE_IMAGE_TOTAL_BYTES - actualTotalBytes, signal)
      actualTotalBytes += imageRead.bytesRead
      const imageBytes = imageRead.data
      if (imageBytes.length > MAX_INLINE_IMAGE_SINGLE_BYTES || actualTotalBytes > MAX_INLINE_IMAGE_TOTAL_BYTES) {
        statuses[item.index] = { ...statuses[item.index]!, status: 'omitted' }
        continue
      }
      const ref = await attachments.saveImage({ data: imageBytes, mediaType: item.mediaType, name: item.name })
      signal?.throwIfAborted()
      const emittedBytes = ref.bytes
      if (!Number.isSafeInteger(emittedBytes) || emittedBytes < 0 || emittedBytes > MAX_INLINE_IMAGE_SINGLE_BYTES || emittedTotalBytes + emittedBytes > MAX_INLINE_IMAGE_TOTAL_BYTES) {
        statuses[item.index] = { ...statuses[item.index]!, status: 'omitted' }
        continue
      }
      emittedTotalBytes += emittedBytes
      statuses[item.index] = { ...statuses[item.index]!, status: 'available' }
      inlined.push({
        attachment_id: String(ref.attachmentId), name: ref.name ?? item.name, media_type: ref.mediaType, figure: item.index + 1,
        ...(ref.width !== undefined ? { width: ref.width } : {}),
        ...(ref.height !== undefined ? { height: ref.height } : {}),
        ...(ref.bytes !== undefined ? { bytes: ref.bytes } : {}),
      })
    } catch (error) {
      if (signal?.aborted) signal.throwIfAborted()
      if (error instanceof BoundedImageReadError) {
        actualTotalBytes += error.bytesRead
        statuses[item.index] = { ...statuses[item.index]!, status: error.status === 'budget' ? 'omitted' : 'failed' }
      } else {
        statuses[item.index] = { ...statuses[item.index]!, status: 'failed' }
      }
    }
  }
  return { ...view, ordered_images: statuses, ...(inlined.length > 0 ? { inlined_images: inlined } : {}) }
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
  const withStorageAccess = async <T,>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    return accessGate === undefined ? await operation() : await accessGate.runShared(operation, signal)
  }

  disposers.push(ctx.tools.register(defineTool({
    name: 'async_parse_pdf',
    description: 'Submit PDF document parsing as a native background job. Fully parses the PDF to local cache and returns a structured summary (pages, outline, tables, images) upon completion. Use read_pdf to read specific content or pages on demand.',
    parameters: asyncParseParameters,
    output: {
      schema: {
        type: 'object',
        properties: { job_id: { type: 'string', required: true }, state: { type: 'string', enum: ['running'], required: true } },
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
      const { input } = parseAsyncInput(args)
      const jobs = ctx.get('jobs') as JobRegistry | undefined
      if (jobs === undefined) {
        throw new MinerUError(failure('PROVIDER_UNAVAILABLE', 'Native DSH background jobs are unavailable; load the jobs registry and job tools'))
      }
      const controller = new AbortController()
      const jobId = jobs.start({
        kind: 'mineru', label: backgroundLabel(input), owner: agent,
        run: () => {
          const done = withStorageAccess(() => getService().ensureParsed(agent.session, input, controller.signal), controller.signal)
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
    description: 'Read and extract structured content from PDF documents synchronously. Supports page selection and content focus. When content_status is complete, full Markdown is provided in markdown_content. When content_status is partial, continue with the returned cursor using the same file_path and no new selection arguments.',
    parameters: readPdfParameters,
    output: {
      schema: parseOutputSchema,
      render: (_args: unknown, value: unknown) => renderResult(value as ResultView),
      presentationMeta: (_args: unknown, value: unknown): JsonValue => {
        const single = value as ResultView
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
              ...(img.figure !== undefined ? { figure: img.figure } : {}),
            })),
          } : {}),
          ...(single.ordered_images !== undefined ? {
            ordered_images: single.ordered_images.map(img => ({
              path: img.path,
              name: img.name,
              media_type: img.media_type,
              bytes: img.bytes,
              ...(img.page !== undefined ? { page: img.page } : {}),
              ...(img.caption !== undefined ? { caption: img.caption } : {}),
              ...(img.status !== undefined ? { status: img.status } : {}),
            })),
          } : {}),
          ...(single.summary !== undefined ? {
            summary: {
              ...(single.summary.page_count !== undefined ? { page_count: single.summary.page_count } : {}),
              ...(single.summary.table_count !== undefined ? { table_count: single.summary.table_count } : {}),
              ...(single.summary.image_count !== undefined ? { image_count: single.summary.image_count } : {}),
              ...(single.summary.equation_count !== undefined ? { equation_count: single.summary.equation_count } : {}),
              ...(single.summary.toc !== undefined ? {
                toc: single.summary.toc.map(item => ({
                  level: item.level,
                  title: item.title,
                  ...(item.line !== undefined ? { line: item.line } : {}),
                  ...(item.page !== undefined ? { page: item.page } : {}),
                })),
              } : {}),
            },
          } : {}),
          ...(single.toc !== undefined ? {
            toc: single.toc.map(item => ({
              level: item.level,
              title: item.title,
              ...(item.line !== undefined ? { line: item.line } : {}),
              ...(item.page !== undefined ? { page: item.page } : {}),
            })),
          } : {}),
          ...(single.pages !== undefined ? { pages: single.pages } : {}),
          ...(single.cursor !== undefined ? { cursor: single.cursor } : {}),
          ...(single.warnings !== undefined ? { warnings: [...single.warnings] } : {}),
        }
      },
    },
    isConcurrencySafe: () => true,
    execute: async (args: unknown, exec: ToolRunContext) => {
      const agent = requireAgent(exec)
      const { input, pollTimeoutMs, inline_images } = parseReadInput(args)
      const supportsImage = await checkCallingModelSupportsImage(exec, ctx)
      const attachments = ctx.get('attachments') as AttachmentStore | undefined
      const focusSet = normalizeFocusSelection(input.focus)
      const focusIncludesImages = focusSet.has('all') || focusSet.has('image')
      const shouldInline = inline_images !== false && focusIncludesImages && supportsImage && attachments !== undefined

      return await withStorageAccess(async () => {
        const rawResult = await getService().parseDocument(agent.session, input, exec.signal, pollTimeoutMs)
        const processed = shouldInline && attachments
          ? await inlineImagesForSingleResult(rawResult, attachments, exec.signal)
          : rawResult
        return fitPostImageBudget(processed)
      }, exec.signal)
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
