import { createHash } from 'node:crypto'
import { PROVIDER_TRAITS, type MinerUConfig } from '../config/model.js'
import { MinerUError, failure } from '../domain/errors.js'
import { asResultId, createFileId } from '../domain/ids.js'
import { cursorSelection, type ContentQuery, type ContentSelection, type ReadCursorPayload, type ReadQuery } from '../domain/selection.js'
import { reportProgress, type ParseProgressListener, type ParseService } from '../service/parse-service.js'
import type { StorageAccessGate } from '../storage/access-gate.js'
import type { ResultRepository } from '../storage/result-repository.js'
import { collectBlockDiagnostics, DOCUMENT_INDEX_VERSION, normalizeDocumentBlocks } from './document-index.js'
import { MAX_INLINE_IMAGE_SINGLE_BYTES } from './image-policy.js'
import { renderPdfPage } from './page/page-renderer.js'
import { extractBlocksMarkdown, extractMarkdownHeadings, fallbackExtractFromMarkdown, formatTocMarkdown } from './projection.js'
import {
  MAX_CONTENT_LIST_BYTES, loadContentList, loadLayoutPageCount, loadMarkdown, openPublishedDocument, type PublishedDocument,
} from './published-result.js'
import { boundedWarnings, deliverReadChunk, fitArtifactListing, fitToBudget } from './read-delivery.js'
import { READ_CURSOR_VERSION } from './read-cursor.js'
import { formulaHints, notice, prependOutline, scopePages, searchBlocks, selectBlocks, type ReaderNotice } from './selection.js'
import { computeDocumentSummary, synopsisSummary } from './summary.js'
import { finishContentChunk, type ImageSink } from './visuals.js'
import type { ContentListBlock, DocumentSummary, ImageCandidateView, ParseSummaryView, ProjectedBlockRange, ReadDiagnostic, ResultView, VerificationHint } from './views.js'

const MAX_SYNOPSIS_CONTENT_LIST_BYTES = 2 * 1024 * 1024

export interface ReaderServiceOptions {
  readonly parser: Pick<ParseService, 'ensurePublished'>
  readonly results: Pick<ResultRepository, 'resolveArtifactAbsolutePath' | 'manifestAbsolutePath'>
  readonly accessGate: Pick<StorageAccessGate, 'runShared'>
}

/** The reader entry used by tools: bounded content reads, parse synopses and local page views. */
export class ReaderService {
  constructor(private readonly options: ReaderServiceOptions) {}

  /** Read one bounded chunk of a selection; continuations are cache-only. */
  async readContent(sourcePath: string, query: ContentQuery, config: MinerUConfig, images: ImageSink | undefined, signal: AbortSignal): Promise<ResultView> {
    return await this.options.accessGate.runShared(async () => {
      const cursor = query.kind === 'continue' ? query.cursor : undefined
      const published = await this.options.parser.ensurePublished(sourcePath, config, signal, {
        cacheOnly: cursor !== undefined, waitTimeoutMs: query.pollTimeoutMs,
      })
      if (cursor !== undefined && cursor.rid !== String(published.manifest.id)) {
        throw new MinerUError(failure('INVALID_REQUEST', 'Cursor result identity does not match the published result; start over without a cursor'))
      }
      const document = openPublishedDocument(published, this.options.results)
      const selection = query.kind === 'continue' ? cursorSelection(query.cursor) : query.selection
      const chunk = await projectContent(document, selection, cursor, query.inlineImages, config.output.maxInlineChars, signal)
      return await finishContentChunk(chunk, images, query.inlineImages, config.output.maxInlineImages, signal)
    }, signal)
  }

  /** Render one original page locally and attach it; never invokes a Provider or persists the source. */
  async viewPage(sourcePath: string, query: Extract<ReadQuery, { kind: 'page' }>, config: MinerUConfig, images: ImageSink, signal: AbortSignal): Promise<ResultView> {
    const page = await renderPdfPage({
      file_path: sourcePath, page: query.page, ...(query.expectedSha256 ? { expectedSha256: query.expectedSha256 } : {}),
      maxFileBytes: config.limits.maxFileBytes, signal,
    })
    signal.throwIfAborted()
    const name = 'page-' + page.page + '.png'
    const ref = await images({ data: page.data, mediaType: page.media_type, name })
    signal.throwIfAborted()
    if (!Number.isSafeInteger(ref.bytes) || ref.bytes < 0 || ref.bytes > MAX_INLINE_IMAGE_SINGLE_BYTES) throw new MinerUError(failure('RESULT_TOO_LARGE', 'Rendered page attachment exceeds the image limit'))
    return fitToBudget({
      state: 'completed', source: 'local', cache_hit: false, result_id: asResultId('mr_page_' + page.sha256.slice(0, 32) + '_' + page.page), view: 'page', renderer: page.renderer,
      files: [{ file_id: createFileId(page.sha256), name: page.name, artifacts: [] }],
      content_status: 'not_requested', cursor: null, output_limit_chars: config.output.maxInlineChars,
      source_sha256: page.sha256, pages: String(page.page), summary: { page_count: page.page_count, page_count_source: page.renderer === 'pdfjs' ? 'pdfjs' : 'pdfinfo' },
      inlined_images: [{ attachment_id: String(ref.attachmentId), name: ref.name ?? name, media_type: ref.mediaType, bytes: ref.bytes, page: page.page, ...(ref.width === undefined ? {} : { width: ref.width }), ...(ref.height === undefined ? {} : { height: ref.height }) }],
      visuals: { listed: 1, attached: 1, omitted: 0, scope: 'chunk' },
    })
  }

  /** Ensure publication and return a bounded synopsis, never a body projection. */
  async summarize(sourcePath: string, config: MinerUConfig, signal: AbortSignal, onProgress?: ParseProgressListener): Promise<ParseSummaryView> {
    return await this.options.accessGate.runShared(async () => {
      const published = await this.options.parser.ensurePublished(sourcePath, config, signal, { waitTimeoutMs: null, onProgress })
      const document = openPublishedDocument(published, this.options.results)
      reportProgress(onProgress, 'summarizing')
      signal.throwIfAborted()
      const contentList = document.artifacts.find(item => item.kind === 'content-list')
      let summary: DocumentSummary | undefined
      const warnings: string[] = []
      if (contentList !== undefined) {
        try {
          const synopsis = synopsisSummary(await loadContentList(contentList, MAX_SYNOPSIS_CONTENT_LIST_BYTES, signal))
          summary = synopsis.summary
          if (synopsis.shortened) warnings.push('Outline shortened for the parse summary; use read_pdf to inspect the complete outline.')
        } catch {
          signal.throwIfAborted()
          warnings.push('Optional summary metadata is unavailable or exceeds the synopsis budget; the parsed result remains cached. Use read_pdf to inspect it.')
        }
      }
      signal.throwIfAborted()
      return {
        state: 'completed', source: published.source, cache_hit: published.source === 'cache', result_id: published.manifest.id,
        files: [{ file_id: document.fileId, name: published.sourceFile.name, artifacts: [] }], content_status: 'not_requested',
        manifest_path: document.manifestPath,
        ...(summary !== undefined ? { summary } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
      }
    }, signal)
  }
}

/** Project one selection of a published document into a bounded, cursor-addressable chunk. */
async function projectContent(
  document: PublishedDocument,
  selection: ContentSelection,
  cursor: ReadCursorPayload | undefined,
  inlineImageIntent: boolean,
  limit: number,
  signal: AbortSignal,
): Promise<ResultView> {
  signal.throwIfAborted()
  const { manifest, source, sourceFile } = document.result
  const { focus, target } = selection
  const blockId = target?.kind === 'block' ? target.blockId : undefined
  const query = target?.kind === 'query' ? target.text : undefined
  const artifactsRequested = focus.has('artifacts')
  const contentList = document.artifacts.find(artifact => artifact.kind === 'content-list')
  let rawBlocks: ContentListBlock[] = []
  if (contentList) {
    try { rawBlocks = await loadContentList(contentList, MAX_CONTENT_LIST_BYTES, signal) }
    catch (error) {
      signal.throwIfAborted()
      if (error instanceof MinerUError) throw error
      throw new MinerUError(failure('INVALID_REQUEST', 'Malformed content-list artifact; cannot provide a reliable selection'), { cause: error })
    }
  }
  // Index all evidence once, but diagnose only blocks actually delivered below.
  const blocks = normalizeDocumentBlocks(rawBlocks, manifest.id, new Set()).blocks
  const summary = blocks.length ? computeDocumentSummary(blocks) : undefined
  const { toc: outline, ...rest } = summary ?? {}
  const counts: { -readonly [Key in keyof DocumentSummary]: DocumentSummary[Key] } = rest
  const notices: ReaderNotice[] = []
  let physicalPageCount: number | undefined
  try { physicalPageCount = await loadLayoutPageCount(document.artifacts.find(artifact => artifact.kind === 'layout'), signal) }
  catch { signal.throwIfAborted(); notices.push(notice('PAGE_COUNT_UNAVAILABLE', 'document', 'Layout page metadata could not be read reliably; use original page view to verify physical bounds.')) }
  if (physicalPageCount !== undefined && (summary?.page_count ?? 0) > physicalPageCount) {
    notices.push(notice('PAGE_MAPPING_CONFLICT', 'document', 'Content blocks exceed layout page metadata; physical bounds are not reliable.'))
    physicalPageCount = undefined
  }
  if (physicalPageCount !== undefined) counts.page_count = physicalPageCount
  if (counts.page_count !== undefined) counts.page_count_source = physicalPageCount === undefined ? 'content-list-lower-bound' : 'layout'
  const scope = scopePages(selection.pages, blocks, focus, summary?.page_count, physicalPageCount, notices)
  const artifactList = artifactsRequested ? [document.markdown, ...document.artifacts] : []
  const warningsOf = (): string[] => notices.map(item => item.warning)
  const base: ResultView = {
    state: 'completed', source, cache_hit: source === 'cache', result_id: manifest.id,
    files: [{ file_id: document.fileId, name: sourceFile.name, artifacts: artifactList.slice(0, 20), ...(artifactList.length > 20 ? { artifacts_truncated: true } : {}) }],
    content_status: 'not_requested', cursor: null, output_limit_chars: limit,
    source_sha256: sourceFile.sha256,
    provenance: {
      provider: manifest.producer.providerId,
      model: PROVIDER_TRAITS[manifest.producer.providerId].selectsModel ? manifest.request.semantics.model : null,
      parse_method: manifest.request.semantics.parseMethod, upstream_version: null, index_version: DOCUMENT_INDEX_VERSION, reader_version: READ_CURSOR_VERSION,
    },
    ...(artifactsRequested ? { manifest_path: document.manifestPath, markdown_path: document.markdown.path } : {}),
    ...(summary ? { summary: counts } : {}),
    ...(scope.pagesLabel ? { pages: scope.pagesLabel } : {}),
    ...(notices.length ? { warnings: boundedWarnings(warningsOf()) } : {}),
  }
  if (focus.size === 1 && artifactsRequested) return fitArtifactListing(base)
  let text = ''
  let images: readonly ImageCandidateView[] = []
  let ranges: readonly ProjectedBlockRange[] = []
  let verificationHints: readonly VerificationHint[] = []
  if (blocks.length) {
    const matching = selectBlocks(blocks, scope.pagesSet, focus, target)
    verificationHints = formulaHints(matching)
    const imageArtifacts = document.artifacts.filter(artifact => artifact.kind === 'images')
    if (query !== undefined) {
      ({ text, ranges } = searchBlocks(matching, query, imageArtifacts, signal))
    } else {
      const projected = extractBlocksMarkdown(matching, imageArtifacts)
      text = projected.text
      images = projected.orderedImages
      ranges = projected.ranges
    }
    if (focus.has('toc')) ({ text, ranges } = prependOutline(outline, scope, text, ranges))
  } else {
    if (blockId !== undefined || query !== undefined || selection.pages !== undefined || !focus.has('all') && !focus.has('toc')) throw new MinerUError(failure('INVALID_REQUEST', '[SELECTION_UNAVAILABLE] No content-list mapping; use unfiltered reading or original page view'))
    const markdown = await loadMarkdown(document.markdown, signal)
    if (focus.has('toc') && !focus.has('all')) {
      text = formatTocMarkdown(extractMarkdownHeadings(markdown))
    } else {
      ({ text, orderedImages: images } = fallbackExtractFromMarkdown(markdown, document.artifacts.filter(artifact => artifact.kind === 'images')))
    }
    notices.push(notice('LOCATION_UNAVAILABLE', 'document', 'Reading Markdown fallback; page/block coordinates are unavailable.'))
  }
  const scopeDiagnostics: ReadDiagnostic[] = notices.map(item => ({
    id: createHash('sha256').update(manifest.id + '|' + item.scope + '|' + item.warning).digest('hex').slice(0, 24),
    code: item.code, scope: item.scope, message: item.message,
  }))
  return deliverReadChunk({ base: { ...base, ...(notices.length ? { warnings: boundedWarnings(warningsOf()) } : {}) }, text, focus, images, ranges, cursor, signal, identity: JSON.stringify({ index_version: DOCUMENT_INDEX_VERSION, reader_version: READ_CURSOR_VERSION, files: manifest.files }),
    inlineImages: inlineImageIntent, verificationHints, scopeDiagnostics,
    diagnosticsForBlocks: ids => collectBlockDiagnostics(rawBlocks, manifest.id, new Set([...ids].map(id => Number(id.slice(id.lastIndexOf(':b') + 2))))),
    selection: { ...(blockId ? { block: blockId } : {}), ...(query ? { query } : {}) },
  })
}
