/** Model-facing MinerU tools: native background submit and direct parse. */
import { open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { fitsReadBudget, boundedWarnings, compactReadMetadata } from './service/read-delivery.js'
import type { JobOutcome, JobRegistry } from '@deepseek-ai/dsh-jobs'
import type { AttachmentStore, ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ObjectValueSchemaSpec, ParameterSchemaSpec, ToolRunContext, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { MinerUError, failure, toMinerUFailure } from './domain/errors.js'
import type { FocusKind, PageSelection, ParseRequestInput } from './domain/request.js'
import { normalizeFocusSelection, normalizePageSelection } from './domain/request.js'
import { DEFAULT_OUTPUT_CONFIG, type OutputConfig } from './config/pure.js'
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
import { MAX_INLINE_IMAGE_SINGLE_BYTES, MAX_INLINE_IMAGE_TOTAL_BYTES, mediaTypeForExtension } from './service/image-policy.js'
import { decodeReadCursor } from './service/read-cursor.js'

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    mineru: 'mineru'
  }
}

const failureSchema = {
  type: 'object',
  properties: {
    code: { type: 'string' }, message: { type: 'string' }, retryable: { type: 'boolean' },
    provider: { type: 'string', enum: ['self-hosted-v2', 'official-v4'] },
    providerCode: { type: 'string' }, traceId: { type: 'string' }, fileId: { type: 'string' },
  },
  additionalProperties: false,
} satisfies ObjectValueSchemaSpec

const artifactViewSchema = {
  type: 'object',
  properties: { kind: { type: 'string', required: true }, path: { type: 'string', required: true }, bytes: { type: 'integer', required: true } },
  additionalProperties: false,
} satisfies ObjectValueSchemaSpec

const inlinedImageViewSchema = {
  type: 'object',
  properties: {
    block_id: { type: 'string' },
    document_label: { type: 'string' },
    page: { type: 'integer' },
    attachment_id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    media_type: { type: 'string', required: true },
    width: { type: 'integer' },
    height: { type: 'integer' },
    bytes: { type: 'integer' },
    figure: { type: 'integer', description: 'Attachment selection index only; use document_label for the original paper figure number.' },
  },
  additionalProperties: false,
} satisfies ObjectValueSchemaSpec

const imageCandidateViewSchema = {
  type: 'object',
  properties: {
    block_id: { type: 'string' },
    document_label: { type: 'string' },
    path: { type: 'string', required: true },
    name: { type: 'string', required: true },
    page: { type: 'integer' },
    caption: { type: 'string' },
    media_type: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
    status: { type: 'string', enum: ['available', 'unavailable', 'unsupported', 'failed', 'omitted'] },
  },
  additionalProperties: false,
} satisfies ObjectValueSchemaSpec

const documentHeadingSchema = {
  type: 'object',
  properties: {
    block_id: { type: 'string' },
    level: { type: 'integer', required: true },
    title: { type: 'string', required: true },
    line: { type: 'integer' },
    page: { type: 'integer' },
  },
  additionalProperties: false,
} satisfies ObjectValueSchemaSpec

const documentSummarySchema = {
  type: 'object',
  properties: {
    page_count: { type: 'integer' },
    page_count_source: { type: 'string', enum: ['layout', 'content-list-lower-bound', 'pdfinfo', 'pdfjs'] },
    table_count: { type: 'integer' },
    image_count: { type: 'integer' },
    equation_count: { type: 'integer' },
    toc: { type: 'array', items: documentHeadingSchema },
  },
  additionalProperties: false,
} satisfies ObjectValueSchemaSpec

const resultFileViewSchema = {
  type: 'object',
  properties: {
    file_id: { type: 'string', required: true }, name: { type: 'string', required: true },
    artifacts: { type: 'array', items: artifactViewSchema, required: true }, artifacts_truncated: { type: 'boolean' },
    markdown_path: { type: 'string' },
  },
  additionalProperties: false,
} satisfies ObjectValueSchemaSpec

const resultViewSchema = {
  type: 'object',
  properties: {
    state: { type: 'string', enum: ['completed'], required: true },
    source: { type: 'string', enum: ['cache', 'shared-operation', 'provider', 'local'], required: true },
    cache_hit: { type: 'boolean', required: true }, result_id: { type: 'string', required: true },
    files: { type: 'array', items: resultFileViewSchema, required: true },
    markdown_content: { type: 'string' },
    content_status: { type: 'string', enum: ['complete', 'partial', 'not_requested'], required: true },
    markdown_path: { type: 'string' },
    cursor: {
      oneOf: [{ type: 'string' }, { type: 'null' }],
      required: true,
      description: 'Non-empty continuation token when content_status is partial; null otherwise. Stop reading when null.',
    },
    warnings: { type: 'array', items: { type: 'string' } },
    provenance: { type: 'object', properties: { provider: { type: 'string', enum: ['self-hosted-v2', 'official-v4'], required: true }, model: { type: 'string', enum: ['pipeline', 'vlm'], required: true }, parse_method: { type: 'string', enum: ['auto', 'txt', 'ocr'], required: true }, upstream_version: { type: 'null', required: true }, index_version: { type: 'integer', required: true }, reader_version: { type: 'integer', required: true } }, additionalProperties: false },
    diagnostics: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', required: true }, code: { type: 'string', required: true }, scope: { type: 'string', enum: ['document', 'selection', 'chunk'], required: true }, message: { type: 'string', required: true }, block_id: { type: 'string' }, page: { type: 'integer' } }, additionalProperties: false } },
    verification_hints: { type: 'array', items: { type: 'object', properties: { reason: { type: 'string', enum: ['formula'], required: true }, block_id: { type: 'string', required: true }, page: { type: 'integer' }, view: { type: 'string', enum: ['page'], required: true } }, additionalProperties: false } },
    metadata_shortened: { type: 'array', items: { type: 'string', enum: ['summary', 'provenance', 'diagnostics', 'verification_hints', 'warnings'] } },
    manifest_path: { type: 'string' },
    source_sha256: { type: 'string' },
    continuation_block: { type: 'object', properties: { block_id: { type: 'string', required: true }, page: { type: 'integer' }, document_label: { type: 'string' } }, additionalProperties: false },
    view: { type: 'string', enum: ['content', 'page'] },
    renderer: { type: 'string', enum: ['poppler', 'pdfjs'] },
    visuals: { type: 'object', properties: { listed: { type: 'integer', required: true }, attached: { type: 'integer', required: true }, omitted: { type: 'integer', required: true }, scope: { type: 'string', enum: ['chunk'], required: true } }, additionalProperties: false },
    output_limit_chars: { type: 'integer', required: true },
    inlined_images: { type: 'array', items: inlinedImageViewSchema },
    ordered_images: { type: 'array', items: imageCandidateViewSchema },
    summary: documentSummarySchema,
    toc: { type: 'array', items: documentHeadingSchema },
    pages: { type: 'string' },
  },
  additionalProperties: false,
} satisfies ObjectValueSchemaSpec

const failedParseViewSchema = {
  type: 'object',
  properties: {
    state: { type: 'string', enum: ['failed'] },
    source: { type: 'string', enum: ['cache', 'shared-operation', 'provider', 'local'] },
    file_id: { type: 'string' }, name: { type: 'string' }, failure: failureSchema,
  },
  additionalProperties: false,
} satisfies ObjectValueSchemaSpec

const parseOutputSchema = resultViewSchema

// DSH's schema inference uses mutable JSON arrays. Domain views stay readonly;
// this type-only boundary does not mutate them (the tool runtime snapshots output).
type MutableJsonView<T> = T extends readonly (infer Item)[]
  ? MutableJsonView<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: MutableJsonView<T[Key]> } : T

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
  view: { type: 'string', enum: ['content', 'page'], description: 'content (default) reads parsed blocks; page renders one original PDF page locally without invoking a Provider. Requires exactly one page and an image-capable model.' },
  block_id: { type: 'string', description: 'Read one exact stable block ID from a prior result; IDs are bound to that parsed result. Cannot combine with query or cursor.' },
  query: { type: 'string', description: 'Case-insensitive literal search (1–256 characters) in selected parsed blocks. Returns bounded snippets and block IDs, not the full matching blocks. Use block_id to read a hit.' },
  expected_sha256: { type: 'string', description: 'Optional source_sha256 from a parsed result. In page view, reject changed sources before rendering.' },
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
    description: 'Opaque continuation cursor returned by a previous partial read. Pass only a non-empty returned token, unchanged; null means stop, not restart. When provided, file_path is required and pages/focus must be omitted.',
  },
}

const DEFAULT_RENDER_LIMIT = 200_000
const MAX_POLL_TIMEOUT_MS = 24 * 60 * 60 * 1000

function clampRenderText(rendered: string, limit = DEFAULT_RENDER_LIMIT): string {
  if (!Number.isSafeInteger(limit) || limit <= 0) return ''
  if (rendered.length <= limit) return rendered
  // Never preserve a "complete" footer after slicing away its evidence.
  return '[RESULT_TOO_LARGE] Reader output could not be delivered intact; narrow the request or increase the output budget.'.slice(0, limit)
}

function fitPostImageBudget(value: ResultView): ResultView {
  let fitted = value
  const warn = (message: string): void => { fitted = { ...fitted, warnings: boundedWarnings([message, ...(fitted.warnings ?? [])]) } }
  if (fitsReadBudget(fitted)) return fitted
  if (fitted.ordered_images?.length) {
    const removed = fitted.ordered_images.length
    const attached = fitted.inlined_images?.length ?? 0
    const { ordered_images: _ordered, ...rest } = fitted
    fitted = { ...rest, visuals: { listed: attached, attached, omitted: 0, scope: 'chunk' } }
    warn('[VISUAL_METADATA_SHORTENED] Removed ' + removed + ' image candidate records to fit; ' + attached + ' attachments remain. Use block IDs to inspect omitted candidates.')
    if (fitsReadBudget(fitted)) return fitted
  }
  if (fitted.summary !== undefined || fitted.toc !== undefined) {
    const { summary: _summary, toc: _toc, ...rest } = fitted
    fitted = { ...rest, metadata_shortened: [...new Set([...(rest.metadata_shortened ?? []), 'summary' as const])] }
    warn('[SUMMARY_SHORTENED] Summary metadata was omitted to fit the response; request a narrower selection.')
    if (fitsReadBudget(fitted)) return fitted
  }
  if (fitted.files.some(file => file.artifacts.length > 0)) {
    fitted = { ...fitted, files: fitted.files.map(file => ({ ...file, artifacts: [], ...(file.artifacts.length ? { artifacts_truncated: true } : {}) })) }
    warn('[ARTIFACT_METADATA_SHORTENED] Artifact records were omitted to fit the response; use focus: artifacts separately.')
    if (fitsReadBudget(fitted)) return fitted
  }
  fitted = compactReadMetadata(fitted)
  if (fitsReadBudget(fitted)) return fitted
  throw new MinerUError(failure('RESULT_TOO_LARGE', 'Result metadata exceeds the output budget; narrow the selection or increase maxInlineChars'))
}

function parsePollTimeout(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 86_400_000) throw new MinerUError(failure('INVALID_REQUEST', 'poll_timeout_ms must be an integer from 1 to 86400000'))
  return value
}

function requireAgent(exec: ToolRunContext): NonNullable<ToolRunContext['agent']> {
  const agent = exec.agent
  if (agent === undefined || agent.session == null) {
    throw new MinerUError(failure('UNAUTHENTICATED_SESSION', 'MinerU operations require an authenticated agent session (UNAUTHENTICATED_SESSION)'))
  }
  return agent
}

const READ_PARAMETER_FIELDS = new Set(['file_path', 'pages', 'focus', 'inline_images', 'poll_timeout_ms', 'cursor', 'block_id', 'query', 'view', 'expected_sha256'])
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
  readonly view?: 'page'
  readonly page?: number
  readonly expected_sha256?: string
}

export function parseReadInput(args: unknown): ParsedToolInput {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new MinerUError(failure('INVALID_REQUEST', 'Tool arguments must be an object'))
  }
  const obj = args as Record<string, unknown>
  assertAllowedParameters(obj, READ_PARAMETER_FIELDS)
  const filePath = extractFilePath(obj)
  const pollTimeoutMs = parsePollTimeout(obj.poll_timeout_ms)

  if (obj.view !== undefined && obj.view !== 'content' && obj.view !== 'page') throw new MinerUError(failure('INVALID_REQUEST', 'view must be content or page'))
  if (obj.view === 'page') {
    for (const key of ['focus', 'cursor', 'query', 'block_id', 'inline_images', 'poll_timeout_ms']) if (obj[key] !== undefined) throw new MinerUError(failure('INVALID_REQUEST', 'page view accepts only file_path, pages, and optional expected_sha256'))
    let selected: Set<number> | undefined
    try { selected = normalizePageSelection(obj.pages) } catch { throw new MinerUError(failure('INVALID_REQUEST', 'page view requires exactly one positive physical page')) }
    if (selected === undefined || selected.size !== 1) throw new MinerUError(failure('INVALID_REQUEST', 'page view requires exactly one physical page in pages'))
    if (obj.expected_sha256 !== undefined && (typeof obj.expected_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(obj.expected_sha256))) throw new MinerUError(failure('INVALID_REQUEST', 'expected_sha256 must be a lowercase SHA-256 digest'))
    return { input: { file_path: filePath }, view: 'page', page: [...selected][0]!, ...(typeof obj.expected_sha256 === 'string' ? { expected_sha256: obj.expected_sha256 } : {}) }
  }
  if (obj.expected_sha256 !== undefined) throw new MinerUError(failure('INVALID_REQUEST', 'expected_sha256 is only supported in page view'))
  if (obj.block_id !== undefined && (typeof obj.block_id !== 'string' || obj.block_id.length > 160 || !/^mr_[a-zA-Z0-9_-]+:b[1-9][0-9]*$/.test(obj.block_id))) throw new MinerUError(failure('INVALID_REQUEST', 'block_id must be an exact ID returned by read_pdf'))
  if (obj.query !== undefined && (typeof obj.query !== 'string' || obj.query.trim() === '' || obj.query.length > 256)) throw new MinerUError(failure('INVALID_REQUEST', 'query must contain 1–256 characters'))
  if (obj.block_id !== undefined && obj.query !== undefined) throw new MinerUError(failure('INVALID_REQUEST', 'block_id and query cannot be combined'))
  if ((obj.query !== undefined || obj.block_id !== undefined) && [...normalizeFocusSelection(obj.focus)].some(f => f === 'toc' || f === 'artifacts')) throw new MinerUError(failure('INVALID_REQUEST', 'query/block_id cannot be combined with toc or artifacts focus'))
  let inline_images: boolean | undefined
  if (obj.inline_images !== undefined) {
    if (typeof obj.inline_images !== 'boolean') {
      throw new MinerUError(failure('INVALID_REQUEST', 'inline_images must be a boolean'))
    }
    inline_images = obj.inline_images
  }

  let cursor: string | undefined
  let cursorInlineImages: boolean | undefined
  if (obj.cursor !== undefined) {
    if (typeof obj.cursor !== 'string' || obj.cursor.trim() === '') throw new MinerUError(failure('INVALID_REQUEST', 'cursor must be a non-empty string'))
    cursor = obj.cursor.trim()
    if (obj.pages !== undefined || obj.focus !== undefined || obj.block_id !== undefined || obj.query !== undefined) throw new MinerUError(failure('INVALID_REQUEST', 'pages and focus must be omitted when cursor is provided, as must block_id and query'))
    try {
      cursorInlineImages = decodeReadCursor(cursor).inline_images
    } catch (error) {
      throw new MinerUError(failure('INVALID_REQUEST', error instanceof Error ? error.message : 'Cursor is malformed; start over without a cursor'), { cause: error })
    }
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

  const resolvedInlineImages = inline_images ?? cursorInlineImages ?? true
  return {
    input: {
      file_path: filePath,
      ...(pages !== undefined ? { pages } : {}),
      ...(focus !== undefined ? { focus } : {}),
      inline_images: resolvedInlineImages,
      ...(cursor !== undefined ? { cursor } : {}),
      ...(typeof obj.block_id === 'string' ? { block_id: obj.block_id } : {}),
      ...(typeof obj.query === 'string' ? { query: obj.query.trim() } : {}),
    },
    ...(pollTimeoutMs !== undefined ? { pollTimeoutMs } : {}),
    inline_images: resolvedInlineImages,
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
  maxInlineImages: number,
  signal?: AbortSignal,
): Promise<ResultView> {
  const declared = view.ordered_images ?? []
  if (declared.length === 0) return view
  const statuses = declared.map(img => ({ ...img }))
  const candidates: ImageCandidate[] = []
  for (let index = 0; index < declared.length; index++) {
    const item = declared[index]!
    const mediaType = mediaTypeForExtension(extname(item.name))
    if (index >= maxInlineImages || mediaType === undefined || item.path === '') {
      statuses[index] = { ...statuses[index], status: index >= maxInlineImages ? 'omitted' : 'unsupported' }
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
        ...(statuses[item.index]!.block_id ? { block_id: statuses[item.index]!.block_id } : {}),
        ...(statuses[item.index]!.document_label ? { document_label: statuses[item.index]!.document_label } : {}),
        ...(statuses[item.index]!.page === undefined ? {} : { page: statuses[item.index]!.page }),
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
  const routed = exec.agent?.session?.requestHeader?.()?.config
  const provider = routed?.provider ?? exec.agent?.options?.provider
  const model = routed?.model ?? exec.agent?.options?.model
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

export function registerTools(
  ctx: Context,
  getService: () => MinerUService,
  accessGate?: StorageAccessGate,
  getOutputConfig: () => OutputConfig = () => DEFAULT_OUTPUT_CONFIG,
): () => Promise<void> {
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
    description: 'Read PDF evidence in bounded chunks with physical pages and stable block IDs. Start with focus: toc or a short query; use block_id to read a search hit. markdown_content contains selected parsed text; partial requires continuing with the unchanged cursor and same file_path only (no pages/focus/block_id/query). The cursor is null when complete or not_requested. Continue only when partial; stop rather than passing null back. Complete ends that text selection, not a guarantee of OCR fidelity or visual coverage; check diagnostics and visuals. Diagnostics are scoped to delivered blocks; document/selection notices appear initially. verification_hints recommend original-page checks for formulas, not automatic corrections. provenance separates parsing configuration from index/reader versions; upstream_version null means unknown. Omitted inline_images inherits the cursor intent; an explicit boolean overrides it. metadata_shortened identifies budget-limited metadata. Use view: page with one page number to inspect the original PDF locally without Provider upload, optionally checking source_sha256 via expected_sha256. Use focus: artifacts only for exported cache paths. Output in run_code should preserve markdown_content and cursor, rather than dumping large/debug objects.',
    parameters: readPdfParameters,
    output: {
      schema: parseOutputSchema,
      render: (_args: unknown, value: unknown) => renderResult(value as ResultView),
      presentationMeta: (_args: unknown, value: unknown): JsonValue => {
        const single = value as ResultView
        return {
          result_id: single.result_id,
          ...(single.renderer === undefined ? {} : { renderer: single.renderer }),
          source: single.source,
          cache_hit: single.cache_hit,
          ...(single.manifest_path === undefined ? {} : { manifest_path: single.manifest_path }),
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
              ...(single.summary.page_count_source !== undefined ? { page_count_source: single.summary.page_count_source } : {}),
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
          cursor: single.cursor,
          ...(single.provenance ? { provenance: { ...single.provenance } } : {}),
          ...(single.diagnostics ? { diagnostics: single.diagnostics.map(d => ({ ...d })) } : {}),
          ...(single.verification_hints ? { verification_hints: single.verification_hints.map(hint => ({ ...hint })) } : {}),
          ...(single.metadata_shortened ? { metadata_shortened: [...single.metadata_shortened] } : {}),
          ...(single.warnings !== undefined ? { warnings: [...single.warnings] } : {}),
        }
      },
    },
    isConcurrencySafe: () => true,
    execute: async (args: unknown, exec: ToolRunContext) => {
      const agent = requireAgent(exec)
      const parsed = parseReadInput(args)
      const { input, pollTimeoutMs, inline_images } = parsed
      const { maxInlineImages } = getOutputConfig()
      const supportsImage = await checkCallingModelSupportsImage(exec, ctx)
      const attachments = ctx.get('attachments') as AttachmentStore | undefined
      if (parsed.view === 'page') {
        if (maxInlineImages === 0) throw new MinerUError(failure('UNSUPPORTED_OPTION', 'Original page view requires output.maxInlineImages greater than zero'))
        if (!supportsImage || attachments === undefined) throw new MinerUError(failure('UNSUPPORTED_OPTION', 'Original page view requires an image-capable model and attachment support'))
        const page = await getService().previewPage(agent.session, { file_path: input.file_path!, page: parsed.page!, ...(parsed.expected_sha256 ? { expectedSha256: parsed.expected_sha256 } : {}) }, exec.signal)
        exec.signal.throwIfAborted()
        const ref = await attachments.saveImage({ data: page.data, mediaType: page.media_type, name: 'page-' + page.page + '.png' })
        exec.signal.throwIfAborted()
        if (!Number.isSafeInteger(ref.bytes) || ref.bytes < 0 || ref.bytes > MAX_INLINE_IMAGE_SINGLE_BYTES) throw new MinerUError(failure('RESULT_TOO_LARGE', 'Rendered page attachment exceeds the image limit'))
        const value: ResultView = {
          state: 'completed', source: 'local', cache_hit: false, result_id: page.result_id, view: 'page', renderer: page.renderer,
          files: [{ file_id: page.file_id, name: page.name, artifacts: [] }],
          content_status: 'not_requested', cursor: null, output_limit_chars: page.output_limit_chars,
          source_sha256: page.sha256, pages: String(page.page), summary: { page_count: page.page_count, page_count_source: page.renderer === 'pdfjs' ? 'pdfjs' : 'pdfinfo' },
          inlined_images: [{ attachment_id: String(ref.attachmentId), name: ref.name ?? 'page-' + page.page + '.png', media_type: ref.mediaType, bytes: ref.bytes, page: page.page, ...(ref.width === undefined ? {} : { width: ref.width }), ...(ref.height === undefined ? {} : { height: ref.height }) }],
          visuals: { listed: 1, attached: 1, omitted: 0, scope: 'chunk' },
        }
        return fitPostImageBudget(value) as MutableJsonView<ResultView>
      }
      const focusSet = normalizeFocusSelection(input.focus)
      const focusIncludesImages = focusSet.has('all') || focusSet.has('image')
      const shouldInline = inline_images === true && focusIncludesImages && supportsImage && attachments !== undefined

      return await withStorageAccess(async () => {
        const rawResult = await getService().parseDocument(agent.session, input, exec.signal, pollTimeoutMs)
        const processed = shouldInline && attachments
          ? await inlineImagesForSingleResult(rawResult, attachments, maxInlineImages, exec.signal)
          : rawResult
        const listed = processed.ordered_images?.length ?? 0
        const attached = processed.inlined_images?.length ?? 0
        const value: ResultView = listed ? { ...processed, visuals: { listed, attached, omitted: listed - attached, scope: 'chunk' },
          ...(listed > attached ? { warnings: [...(processed.warnings ?? []), '[VISUALS_NOT_ATTACHED] Some listed images were not attached; use block_id or original page view to inspect them.'] } : {}),
        } : processed
        return fitPostImageBudget(value) as MutableJsonView<ResultView>
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
