import { MinerUError, failure } from '../domain/errors.js'
import { narrowPageSelection, type FocusKind, type SelectionTarget } from '../domain/selection.js'
import { safeStringSlice } from '../utils/text.js'
import type { IndexedContentBlock } from './document-index.js'
import { extractBlocksMarkdown, formatTocMarkdown, getBlockCategory } from './projection.js'
import type { ArtifactView, DocumentHeading, ProjectedBlockRange, VerificationHint } from './views.js'

/** A document/selection notice, rendered both as a warning line and as a diagnostic. */
export interface ReaderNotice {
  readonly code: string
  readonly scope: 'document' | 'selection'
  readonly message: string
  readonly warning: string
}

export function notice(code: string, scope: ReaderNotice['scope'], message: string): ReaderNotice {
  return { code, scope, message, warning: '[' + code + '] ' + message }
}

function invalid(message: string): MinerUError {
  return new MinerUError(failure('INVALID_REQUEST', message))
}

/** Out-of-range error with the legal 1-based bounds when the physical page count is known. */
export function formatPageOutOfRangeMessage(totalPages?: number): string {
  const prefix = '[PAGE_OUT_OF_RANGE] Requested pages are outside the document page range'
  if (typeof totalPages === 'number' && Number.isSafeInteger(totalPages) && totalPages >= 1) {
    const validRange = totalPages === 1 ? '1' : `1-${totalPages}`
    return `${prefix} (valid: ${validRange}, total pages: ${totalPages})`
  }
  return prefix
}

export interface PageScope {
  /** Narrowed physical pages; undefined selects every page. */
  readonly pagesSet: ReadonlySet<number> | undefined
  /** Canonical label of the narrowed request; only present when pages were requested. */
  readonly pagesLabel?: string
}

/**
 * Narrow requested physical pages to the document. Fails when selected blocks lack
 * page coordinates; reports out-of-range pages and lower-bound page counts as notices.
 */
export function scopePages(
  requested: ReadonlySet<number> | undefined,
  blocks: readonly IndexedContentBlock[],
  focus: ReadonlySet<FocusKind>,
  parsedPageCount: number | undefined,
  physicalPageCount: number | undefined,
  notices: ReaderNotice[],
): PageScope {
  if (requested !== undefined && blocks.some(block => block.page_idx === undefined && (focus.has('all') || focus.has(getBlockCategory(block.type)) || focus.has('toc') && block.text_level !== undefined))) throw invalid('[SELECTION_UNAVAILABLE] Some selected content has no page coordinates; read without pages or use block_id/original page view')
  if (requested !== undefined && parsedPageCount === undefined) throw invalid('[SELECTION_UNAVAILABLE] No reliable physical page coordinates are available')
  const narrowed = narrowPageSelection(requested, physicalPageCount)
  if (narrowed.fullyOutOfRange) throw invalid(formatPageOutOfRangeMessage(physicalPageCount))
  if (narrowed.outOfRange.length) {
    const message = 'Some requested pages are outside the document range: ' + narrowed.outOfRange.slice(0, 20).join(', ')
    notices.push({ code: 'PAGE_SELECTION_ADJUSTED', scope: 'selection', message, warning: message })
  }
  if (requested !== undefined && physicalPageCount === undefined) notices.push(notice('PAGE_COUNT_LOWER_BOUND', 'selection', 'Physical page count is unknown; parsed page_count is a lower bound. An empty selection is not proof that the requested page is blank or absent.'))
  return { pagesSet: narrowed.pagesSet, ...(requested === undefined ? {} : { pagesLabel: narrowed.pagesLabel }) }
}

function pageOf(block: IndexedContentBlock): number | undefined {
  return typeof block.page_idx === 'number' ? block.page_idx + 1 : undefined
}

/** Blocks inside the page scope and focus, narrowed to the exact target block when one is given. */
export function selectBlocks(
  blocks: readonly IndexedContentBlock[],
  pagesSet: ReadonlySet<number> | undefined,
  focus: ReadonlySet<FocusKind>,
  target: SelectionTarget | undefined,
): IndexedContentBlock[] {
  const selected = blocks.filter(block => {
    const page = pageOf(block)
    return (pagesSet === undefined || page !== undefined && pagesSet.has(page)) && (focus.has('all') || focus.has(getBlockCategory(block.type)))
  })
  if (target?.kind !== 'block') return selected
  if (!blocks.some(block => block.block_id === target.blockId)) throw invalid('[BLOCK_NOT_FOUND] This block does not belong to the current parsed result; search again')
  const matching = selected.filter(block => block.block_id === target.blockId)
  if (matching.length === 0) throw invalid('[BLOCK_NOT_FOUND] Block is outside the requested pages/focus')
  return matching
}

/** Formula blocks are recommended for original-page verification; this is advisory only. */
export function formulaHints(blocks: readonly IndexedContentBlock[]): VerificationHint[] {
  return blocks
    .filter(block => ['equation', 'interline_equation', 'inline_equation'].includes((block.type ?? '').toLowerCase()))
    .map(block => ({ reason: 'formula' as const, block_id: block.block_id, view: 'page' as const, ...(typeof block.page_idx === 'number' ? { page: block.page_idx + 1 } : {}) }))
}

/** Case-insensitive literal search: one bounded snippet per matching block, located by its block locator. */
export function searchBlocks(
  blocks: readonly IndexedContentBlock[],
  query: string,
  imageArtifacts: readonly ArtifactView[],
  signal: AbortSignal,
): { readonly text: string; readonly ranges: readonly ProjectedBlockRange[] } {
  const escaped = [...query].map(character => '\\.^$*+?()[]{}|'.includes(character) ? '\\' + character : character).join('')
  const literal = new RegExp(escaped, 'iu')
  const matches: string[] = []
  const ranges: ProjectedBlockRange[] = []
  let matchLength = 0
  for (const block of blocks) {
    signal.throwIfAborted()
    const projected = extractBlocksMarkdown([block], imageArtifacts).text
    const locationEnd = projected.indexOf(']') + 1
    const body = projected.slice(locationEnd).trim()
    const at = literal.exec(body)?.index
    if (at === undefined) continue
    let snippetStart = Math.max(0, at - 80)
    if (snippetStart > 0 && /[\uDC00-\uDFFF]/.test(body[snippetStart]!)) snippetStart--
    const snippet = safeStringSlice(body.slice(snippetStart), 360).replace(/\s+/g, ' ')
    const match = projected.slice(0, locationEnd) + '\n' + snippet
    const start = matchLength + (matches.length ? 2 : 0)
    matchLength = start + match.length
    matches.push(match)
    ranges.push({ block_id: block.block_id, start, locator_end: start + locationEnd, end: matchLength, ...(typeof block.page_idx === 'number' ? { page: block.page_idx + 1 } : {}) })
  }
  return { text: matches.length ? matches.join('\n\n') : 'No literal matches in the selected parsed blocks.', ranges }
}

/** Prefix the outline of the page scope, shifting body ranges past it. */
export function prependOutline(
  outline: readonly DocumentHeading[] | undefined,
  scope: PageScope,
  text: string,
  ranges: readonly ProjectedBlockRange[],
): { readonly text: string; readonly ranges: readonly ProjectedBlockRange[] } {
  const headings = (outline ?? []).filter(heading => scope.pagesSet === undefined || heading.page !== undefined && scope.pagesSet.has(heading.page))
  const tocRanges: ProjectedBlockRange[] = []
  const tocText = formatTocMarkdown(headings, { pageRange: scope.pagesLabel }, tocRanges)
  const shift = tocText.length + 2
  const shifted = text ? ranges.map(range => ({ ...range, start: range.start + shift, locator_end: range.locator_end + shift, end: range.end + shift })) : ranges
  return { text: text ? tocText + '\n\n' + text : tocText, ranges: [...tocRanges, ...shifted] }
}
