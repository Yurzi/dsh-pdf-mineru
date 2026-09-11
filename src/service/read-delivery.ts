/** Bounded model delivery, independent of provider/cache representation. */
import { createHash } from 'node:crypto'
import { MinerUError, failure } from '../domain/errors.js'
import { cursorForRemainder, type ReadCursorPayload } from './read-cursor.js'
import { formatResultProse, safeStringSlice, truncateAtCleanBoundary, type ImageCandidateView, type ProjectedBlockRange, type ResultView } from './result-presenter.js'
import type { FocusKind } from '../domain/request.js'

/** Below DSH console object's 10,000-character string preview limit. */
export const MAX_MODEL_MARKDOWN_CHARS = 8000
export const MAX_MODEL_RESPONSE_BYTES = 48000

export function boundedWarnings(warnings: readonly string[]): string[] {
  const unique = [...new Set(warnings)]
  const result = unique.slice(0, 8).map(warning => safeStringSlice(warning, 240))
  if (unique.length > 8) result.push('[DIAGNOSTICS_SHORTENED] More quality warnings exist; narrow pages or block_id.')
  return result
}

export function fitsReadBudget(view: ResultView): boolean {
  const json = JSON.stringify(view)
  const prose = formatResultProse(view)
  return json.length <= view.output_limit_chars && prose.length <= view.output_limit_chars
    && Buffer.byteLength(json, 'utf8') <= MAX_MODEL_RESPONSE_BYTES && Buffer.byteLength(prose, 'utf8') <= MAX_MODEL_RESPONSE_BYTES
}

export function deliverReadChunk(options: {
  base: ResultView; text: string; focus: ReadonlySet<FocusKind>; images: readonly ImageCandidateView[];
  cursor?: ReadCursorPayload; selection?: { block?: string; query?: string }; ranges?: readonly ProjectedBlockRange[]; identity?: string; signal?: AbortSignal;
}): ResultView {
  const { base, text, focus, images, cursor, selection, ranges = [] } = options
  options.signal?.throwIfAborted()
  const projection = createHash('sha256').update(text).update('\0').update(options.identity ?? '').digest('hex')
  if (cursor !== undefined && cursor.projection !== projection) throw new MinerUError(failure('INVALID_REQUEST', 'Cursor projection changed or expired; restart without a cursor'))
  const offset = cursor?.off ?? 0
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length ||
    (offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]!) && /[\uDC00-\uDFFF]/.test(text[offset]!))) {
    throw new MinerUError(failure('INVALID_REQUEST', 'Cursor is outside the projection or splits a Unicode character; start over without a cursor'))
  }
  if (ranges.some(range => offset > range.start && offset < range.locator_end)) throw new MinerUError(failure('INVALID_REQUEST', 'Cursor splits a generated block locator; restart without a cursor'))
  const activeBlock = ranges.find(range => offset >= range.locator_end && offset < range.end)
  const remaining = text.slice(offset)
  let target = Math.min(MAX_MODEL_MARKDOWN_CHARS, remaining.length, Math.max(0, base.output_limit_chars))
  for (;;) {
    options.signal?.throwIfAborted()
    let content = target >= remaining.length ? remaining : truncateAtCleanBoundary(remaining, target).text
    // A locator before a very long paragraph is not a useful whole chunk.
    if (content.length < target / 2) content = safeStringSlice(remaining, target)
    const splitLocator = ranges.find(range => range.start < offset + content.length && range.locator_end > offset + content.length)
    if (splitLocator) content = content.slice(0, Math.max(0, splitLocator.start - offset))
    if (remaining.length > 0 && content.length === 0) throw new MinerUError(failure('RESULT_TOO_LARGE', 'Output budget cannot make reading progress; increase maxInlineChars'))
    const partial = offset + content.length < text.length
    // Only emit figures whose locator starts in this chunk. Later figures are not
    // attached early and preceding figures are not replayed on every continuation.
    const chunkBlockIds = new Set(ranges.filter(range => range.start >= offset && range.start < offset + content.length).map(range => range.block_id))
    const chunkImages = images.filter(image => image.block_id ? chunkBlockIds.has(image.block_id) : offset === 0)
    const warnings = boundedWarnings([
      ...(base.warnings ?? []),
      ...(chunkImages.length > 20 ? ['[VISUAL_METADATA_SHORTENED] Use block_id to inspect images not listed in this chunk.'] : []),
    ])
    const view: ResultView = {
      ...base, markdown_content: content, content_status: partial ? 'partial' : 'complete',
      ...(partial && base.files.some(file => file.artifacts.length > 0) ? { files: base.files.map(file => ({ ...file, artifacts: [], artifacts_truncated: true })) } : {}),
      cursor: partial ? cursorForRemainder(base.result_id, base.pages, focus, offset + content.length, { ...selection, projection }) : null,
      ...(chunkImages.length ? { ordered_images: chunkImages.slice(0, 20).map(image => ({ ...image, ...(image.caption ? { caption: safeStringSlice(image.caption, 256) } : {}) })) } : {}),
      ...(warnings.length ? { warnings } : {}),
      ...(activeBlock ? { continuation_block: { block_id: activeBlock.block_id, ...(activeBlock.page === undefined ? {} : { page: activeBlock.page }), ...(activeBlock.document_label ? { document_label: activeBlock.document_label } : {}) } } : {}),
    }
    if (fitsReadBudget(view)) return view
    if (target === 0) throw new MinerUError(failure('RESULT_TOO_LARGE', 'Result metadata exceeds model output budget'))
    target = Math.max(0, Math.floor(Math.min(target, content.length) * 0.75))
  }
}
