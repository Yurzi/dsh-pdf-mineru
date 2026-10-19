import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { MinerUError, failure } from '../domain/errors.js'
import {
  isBlockId, isQueryText, isSha256, normalizeFocusSelection, normalizePageSelection,
  type FocusKind, type ReadQuery, type SelectionTarget,
} from '../domain/selection.js'
import { decodeReadCursor } from '../reader/read-cursor.js'
import type { ResultView } from '../reader/views.js'
import type { ImageSink } from '../reader/visuals.js'
import {
  argumentRecord, invalidRequest, modelSupportsImages, parseDocumentSource, requireAgent, resolveSourcePath, type DocumentSource,
} from './common.js'
import { renderResult, type MutableJsonView } from './render.js'
import { readPdfParameters, resultViewSchema } from './schemas.js'
import type { ToolDependencies } from './index.js'

const READ_PARAMETER_FIELDS = new Set(['file_path', 'attachment_id', 'pages', 'focus', 'inline_images', 'poll_timeout_ms', 'cursor', 'block_id', 'query', 'view', 'expected_sha256'])
const PAGE_VIEW_EXCLUDED = ['focus', 'cursor', 'query', 'block_id', 'inline_images', 'poll_timeout_ms']

export interface ReadPdfArguments {
  readonly source: DocumentSource
  readonly query: ReadQuery
}

function parsePollTimeout(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 86_400_000) throw invalidRequest('poll_timeout_ms must be an integer from 1 to 86400000')
  return value
}

function parseFocus(value: unknown): Set<FocusKind> {
  try {
    return normalizeFocusSelection(value)
  } catch (error) {
    throw invalidRequest(error instanceof Error ? error.message : 'Invalid focus', error)
  }
}

function parsePageQuery(args: Record<string, unknown>): Extract<ReadQuery, { kind: 'page' }> {
  if (PAGE_VIEW_EXCLUDED.some(key => args[key] !== undefined)) throw invalidRequest('page view accepts only one source (file_path or attachment_id), pages, and optional expected_sha256')
  let selected: Set<number> | undefined
  try { selected = normalizePageSelection(args.pages) } catch { throw invalidRequest('page view requires exactly one positive physical page') }
  if (selected === undefined || selected.size !== 1) throw invalidRequest('page view requires exactly one physical page in pages')
  if (args.expected_sha256 !== undefined && !isSha256(args.expected_sha256)) throw invalidRequest('expected_sha256 must be a lowercase SHA-256 digest')
  return { kind: 'page', page: [...selected][0]!, ...(typeof args.expected_sha256 === 'string' ? { expectedSha256: args.expected_sha256 } : {}) }
}

/** The single validation boundary for read_pdf arguments. */
export function parseReadArguments(args: unknown): ReadPdfArguments {
  const obj = argumentRecord(args, READ_PARAMETER_FIELDS)
  const source = parseDocumentSource(obj)
  const pollTimeoutMs = parsePollTimeout(obj.poll_timeout_ms)
  const wait = pollTimeoutMs === undefined ? {} : { pollTimeoutMs }

  if (obj.view !== undefined && obj.view !== 'content' && obj.view !== 'page') throw invalidRequest('view must be content or page')
  if (obj.view === 'page') return { source, query: parsePageQuery(obj) }
  if (obj.expected_sha256 !== undefined) throw invalidRequest('expected_sha256 is only supported in page view')
  if (obj.block_id !== undefined && !isBlockId(obj.block_id)) throw invalidRequest('block_id must be an exact ID returned by read_pdf')
  if (obj.query !== undefined && !isQueryText(obj.query)) throw invalidRequest('query must contain 1–256 characters')
  if (obj.block_id !== undefined && obj.query !== undefined) throw invalidRequest('block_id and query cannot be combined')
  if ((obj.query !== undefined || obj.block_id !== undefined) && [...parseFocus(obj.focus)].some(f => f === 'toc' || f === 'artifacts')) throw invalidRequest('query/block_id cannot be combined with toc or artifacts focus')
  if (obj.inline_images !== undefined && typeof obj.inline_images !== 'boolean') throw invalidRequest('inline_images must be a boolean')
  const inlineImages = obj.inline_images as boolean | undefined

  if (obj.cursor !== undefined) {
    if (typeof obj.cursor !== 'string' || obj.cursor.trim() === '') throw invalidRequest('cursor must be a non-empty string')
    if (obj.pages !== undefined || obj.focus !== undefined || obj.block_id !== undefined || obj.query !== undefined) throw invalidRequest('pages and focus must be omitted when cursor is provided, as must block_id and query')
    let cursor
    try {
      cursor = decodeReadCursor(obj.cursor.trim())
    } catch (error) {
      throw invalidRequest(error instanceof Error ? error.message : 'Cursor is malformed; start over without a cursor', error)
    }
    return { source, query: { kind: 'continue', cursor, inlineImages: inlineImages ?? cursor.inline_images, ...wait } }
  }

  let pages: Set<number> | undefined
  try {
    pages = normalizePageSelection(obj.pages)
  } catch (error) {
    throw invalidRequest(error instanceof Error ? error.message : 'Invalid page range', error)
  }
  const focus = parseFocus(obj.focus)
  const target: SelectionTarget | undefined = typeof obj.block_id === 'string' ? { kind: 'block', blockId: obj.block_id }
    : typeof obj.query === 'string' ? { kind: 'query', text: obj.query.trim() } : undefined
  return {
    source,
    query: {
      kind: 'select',
      selection: { ...(pages === undefined ? {} : { pages }), focus, ...(target === undefined ? {} : { target }) },
      inlineImages: inlineImages ?? true,
      ...wait,
    },
  }
}

function presentationMeta(result: ResultView): JsonValue {
  return {
    result_id: result.result_id,
    file_ids: result.files.map(file => file.file_id),
    source: result.source,
    cache_hit: result.cache_hit,
    content_status: result.content_status,
    has_more: result.cursor !== null,
    counts: {
      files: result.files.length,
      artifacts: result.files.reduce((count, file) => count + file.artifacts.length, 0),
      images: result.ordered_images?.length ?? 0,
      attachments: result.inlined_images?.length ?? 0,
      headings: result.toc?.length ?? result.summary?.toc?.length ?? 0,
      diagnostics: result.diagnostics?.length ?? 0,
      warnings: result.warnings?.length ?? 0,
    },
    ...(result.renderer === undefined ? {} : { renderer: result.renderer }),
  }
}

export function readPdfTool(ctx: Context, deps: ToolDependencies) {
  return defineTool({
    name: 'read_pdf',
    description: 'Read PDF evidence in bounded chunks with physical pages and stable block IDs. Start with focus: toc or a short query; use block_id to read a search hit. markdown_content contains selected parsed text; partial requires continuing with the unchanged cursor and same source (file_path or attachment_id) only (no pages/focus/block_id/query). The cursor is null when complete or not_requested. Continue only when partial; stop rather than passing null back. Complete ends that text selection, not a guarantee of OCR fidelity or visual coverage; check diagnostics and visuals. Diagnostics are scoped to delivered blocks; document/selection notices appear initially. verification_hints recommend original-page checks for formulas, not automatic corrections. provenance separates parsing configuration from index/reader versions; upstream_version null means unknown. Omitted inline_images inherits the cursor intent; an explicit boolean overrides it. metadata_shortened identifies budget-limited metadata. Use view: page with one page number to inspect the original PDF locally without Provider upload, optionally checking source_sha256 via expected_sha256. Use focus: artifacts only for exported cache paths. Output in run_code should preserve markdown_content and cursor, rather than dumping large/debug objects.',
    parameters: readPdfParameters,
    output: {
      schema: resultViewSchema,
      render: (_args: unknown, value: unknown) => renderResult(value as ResultView),
      presentationMeta: (_args: unknown, value: unknown): JsonValue => presentationMeta(value as ResultView),
    },
    isConcurrencySafe: () => true,
    execute: async (args: unknown, exec: ToolRunContext) => {
      const agent = requireAgent(exec)
      const { source, query } = parseReadArguments(args)
      exec.signal.throwIfAborted()
      const attachments = deps.attachments()
      const sourcePath = await resolveSourcePath(source, agent, exec, ctx, attachments)
      const config = deps.config()
      const images: ImageSink | undefined = await modelSupportsImages(exec, ctx) && attachments !== undefined
        ? image => attachments.saveImage(image)
        : undefined
      if (query.kind !== 'page') return await deps.reader.readContent(sourcePath, query, config, images, exec.signal) as MutableJsonView<ResultView>
      if (config.output.maxInlineImages === 0) throw new MinerUError(failure('UNSUPPORTED_OPTION', 'Original page view requires output.maxInlineImages greater than zero'))
      if (images === undefined) throw new MinerUError(failure('UNSUPPORTED_OPTION', 'Original page view requires an image-capable model and attachment support'))
      return await deps.reader.viewPage(sourcePath, query, config, images, exec.signal) as MutableJsonView<ResultView>
    },
  })
}
