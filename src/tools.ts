/** Model-facing MinerU tools: native background submit and direct parse. */
import { readFile } from 'node:fs/promises'
import { basename, dirname, extname, resolve } from 'node:path'
import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JobOutcome, JobRegistry } from '@deepseek-ai/dsh-jobs'
import type { AttachmentStore, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock, JsonValue, ObjectValueSchemaSpec, ParameterSchemaSpec, ToolRunContext, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { MinerUError, failure, toMinerUFailure } from './domain/errors.js'
import type { FocusKind, PageSelection, ParseRequestInput } from './domain/request.js'
import { normalizeFocusSelection, normalizePageSelection } from './domain/request.js'
import type { MinerUResultManifest } from './domain/result.js'
import type { StorageAccessGate } from './storage/access-gate.js'
import type {
  FailedParseView,
  ImageCandidateView,
  InlinedImageView,
  MinerUService,
  ParseDocumentView,
  ResultView,
} from './service/mineru-service.js'
import {
  formatParseDocumentProse,
  formatParseSummaryProse,
  formatResultProse,
  getRasterMediaType,
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

const imageCandidateViewSchema: ObjectValueSchemaSpec = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    name: { type: 'string' },
    page: { type: 'integer' },
    caption: { type: 'string' },
    media_type: { type: 'string' },
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
    ordered_images: { type: 'array', items: imageCandidateViewSchema },
    summary: documentSummarySchema,
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

const parseOutputSchema: ValueSchemaSpec = resultViewSchema

const asyncParseParameters: ParameterSchemaSpec = {
  file_path: {
    type: 'string',
    description: 'Path of the local PDF document to parse.',
  },
}

const readPdfParameters: ParameterSchemaSpec = {
  file_path: {
    type: 'string',
    description: 'Path of the local PDF document to read.',
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
      { type: 'string', enum: ['all', 'text', 'table', 'image'], description: 'Focus content type' },
      { type: 'array', items: { type: 'string', enum: ['all', 'text', 'table', 'image'] }, description: 'Focus content types' },
    ],
    description: 'Content types to extract: "all" (default), "text" (paragraphs, headers, code, formulas), "table" (tables and captions), or "image" (charts, figures, and captions). Accepts a single kind or an array.',
  },
  inline_images: {
    type: 'boolean',
    description: 'Whether to inline visual figures directly as multimodal image blocks. Defaults to true when calling model route supports images.',
  },
  poll_timeout_ms: {
    type: 'integer',
    description: 'Maximum synchronous wait in milliseconds. A timeout leaves the shared producer running; retry the same request to rejoin it.',
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

const REMOVED_TOOL_PARAMETERS = new Set([
  'model', 'ocr', 'formula', 'table', 'language', 'artifacts', 'max_inline_images',
])

function assertNoRemovedParameters(args: Record<string, unknown>): void {
  for (const key of Object.keys(args)) {
    if (REMOVED_TOOL_PARAMETERS.has(key)) {
      throw new MinerUError(failure('INVALID_REQUEST', `Unsupported parameter: ${key}. Technical parameters (model, ocr, formula, table, language, artifacts, max_inline_images) have been removed from tool arguments.`))
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
  assertNoRemovedParameters(obj)
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
  assertNoRemovedParameters(obj)
  const filePath = extractFilePath(obj)
  const pollTimeoutMs = parsePollTimeout(obj.poll_timeout_ms)

  let inline_images: boolean | undefined
  if (obj.inline_images !== undefined) {
    if (typeof obj.inline_images !== 'boolean') {
      throw new MinerUError(failure('INVALID_REQUEST', 'inline_images must be a boolean'))
    }
    inline_images = obj.inline_images
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
    },
    ...(pollTimeoutMs !== undefined ? { pollTimeoutMs } : {}),
    ...(inline_images !== undefined ? { inline_images } : {}),
  }
}

export function parseInput(args: unknown): ParsedToolInput {
  return parseReadInput(args)
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
  return renderResult(value)
}

function backgroundLabel(input: ParseRequestInput): string {
  const name = input.file_path ? basename(input.file_path) : 'document'
  return 'Parse ' + name + ' with MinerU'
}

function nativeSuccessOutcome(value: ParseDocumentView): JobOutcome {
  const output = formatParseSummaryProse(value)
  return { status: 'completed', detail: 'completed', output }
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

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
  signal?: AbortSignal,
): Promise<ResultView> {
  let candidates: ImageCandidate[] = []
  if (view.ordered_images && view.ordered_images.length > 0) {
    candidates = view.ordered_images.map(img => ({
      path: img.path,
      bytes: img.bytes,
      name: img.name,
      mediaType: img.media_type as ImageMediaType,
    }))
  } else {
    candidates = await collectImageCandidates(view)
  }
  if (candidates.length === 0) return view

  const inlined: InlinedImageView[] = []
  for (const item of candidates) {
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
  signal?: AbortSignal,
): Promise<ParseDocumentView> {
  return await inlineImagesForSingleResult(view, attachments, signal)
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
    name: 'async_parse_pdf',
    description: 'Submit PDF document parsing as a native background job. Fully parses the PDF to local cache and returns a structured summary (pages, outline, tables, images) upon completion. Use read_pdf to read specific content or pages on demand.',
    parameters: asyncParseParameters,
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
      const { input } = parseAsyncInput(args)
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
    description: 'Read and extract structured content from PDF documents synchronously. Supports page selection (pages) and content focus (focus). When content_status is complete, full Markdown is provided in markdown_content. When content_status is partial, Markdown is truncated by output limits; use the returned markdown_path and read_offset_line to read the remainder.',
    parameters: readPdfParameters,
    output: {
      schema: parseOutputSchema,
      render: (_args: unknown, value: unknown) => renderParseDocument(value as ParseDocumentView),
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
                  line: item.line,
                  ...(item.page !== undefined ? { page: item.page } : {}),
                })),
              } : {}),
            },
          } : {}),
          ...(single.toc !== undefined ? {
            toc: single.toc.map(item => ({
              level: item.level,
              title: item.title,
              line: item.line,
              ...(item.page !== undefined ? { page: item.page } : {}),
            })),
          } : {}),
        }
      },
    },
    isConcurrencySafe: () => true,
    execute: async (args: unknown, exec: ToolRunContext) => {
      const agent = requireAgent(exec)
      const { input, pollTimeoutMs, inline_images } = parseReadInput(args)
      const supportsImage = await checkCallingModelSupportsImage(exec, ctx)
      const attachments = ctx.get('attachments') as AttachmentStore | undefined
      const shouldInline = inline_images !== false && supportsImage && attachments !== undefined

      const rawResult = await withStorageAccess(() => getService().parseDocument(agent.session, input, exec.signal, pollTimeoutMs))
      if (shouldInline && attachments) {
        return await processInlineImages(rawResult, attachments, exec.signal)
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
