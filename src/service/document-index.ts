import type { ContentListBlock } from '../service/result-presenter.js'

/** A content-list block with an identity fixed before page/focus selection. */
export interface IndexedContentBlock extends ContentListBlock {
  readonly block_id: string
  readonly document_label?: string
  /** One-based position in the provider's original content-list. */
  readonly document_order: number
}

const MAX_NORMALIZATION_WARNINGS = 20
const MAX_DETAIL_WARNINGS = MAX_NORMALIZATION_WARNINGS - 1

type BlockKind = 'image' | 'table' | 'equation' | 'code' | 'text'

interface MutableBlock extends Record<string, unknown> {
  text?: unknown
  content?: unknown
  code?: unknown
  table_body?: unknown
}

class WarningCollector {
  readonly #details: Array<{ text: string; priority: number }> = []
  #omitted = 0
  constructor(private readonly orders?: ReadonlySet<number>) {}

  add(code: string, location: string, message: string): void {
    if (this.orders !== undefined && !this.orders.has(Number(/^block ([0-9]+)/.exec(location)?.[1]))) return
    const priority = /POSSIBLE_TEXT_GAP|CONFLICTING|UNKNOWN_NESTED|UNSUPPORTED_CONTENT/.test(code) ? 2 : /EMPTY_CONTENT/.test(code) ? 1 : 0
    const detail = { text: `[${code}] ${location}: ${message}`, priority }
    if (this.#details.length < MAX_DETAIL_WARNINGS) this.#details.push(detail)
    else {
      const lowest = Math.min(...this.#details.map(item => item.priority))
      if (priority > lowest) this.#details[this.#details.findIndex(item => item.priority === lowest)] = detail
      this.#omitted++
    }
  }

  finish(): readonly string[] {
    const details = [...this.#details].sort((a, b) => b.priority - a.priority).map(detail => detail.text)
    if (this.#omitted === 0) return details
    return [
      ...details,
      `[DOCUMENT_INDEX_WARNINGS_OMITTED] ${String(this.#omitted)} additional normalization warning(s) omitted.`,
    ]
  }
}

const KNOWN_BLOCK_TYPES = new Set([
  'text', 'title',
  'table',
  'image', 'chart', 'figure',
  'equation', 'interline_equation', 'inline_equation',
  'code',
])

// Narrow signals observed in upstream Chinese extraction gaps. These only
// request page verification; they never repair or infer the missing value.
const POSSIBLE_TEXT_GAP_PATTERNS = [
  /中的\s+个/u,
  /(?:包含|通过率为|分别通过)\s+(?:个|和|，|；|。)/u,
] as const

function blockKind(type: unknown): BlockKind {
  if (typeof type !== 'string') return 'text'
  const lower = type.toLowerCase()
  if (lower === 'table' || lower.startsWith('table_')) return 'table'
  if (lower === 'image' || lower === 'chart' || lower === 'figure' || lower.startsWith('image_')) return 'image'
  if (lower === 'equation' || lower === 'interline_equation' || lower === 'inline_equation') return 'equation'
  if (lower === 'code') return 'code'
  return 'text'
}

function captionStrings(value: unknown): readonly string[] {
  if (typeof value === 'string') return value.trim().length > 0 ? [value] : []
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

/**
 * Extract an author/provider supplied figure, table, or equation label.
 *
 * Only a label at the beginning of a relevant caption is accepted. This
 * deliberately does not synthesize labels from the block's return position.
 */
export function extractDocumentLabel(block: ContentListBlock): string | undefined {
  const kind = blockKind(block.type)
  const captions = kind === 'image'
    ? [
        ...captionStrings(block.image_caption),
        ...captionStrings(block.img_caption),
        ...captionStrings(block.chart_caption),
        ...captionStrings(block.caption),
      ]
    : kind === 'table'
      ? [...captionStrings(block.table_caption), ...captionStrings(block.caption)]
      : kind === 'equation'
        ? [...captionStrings(block.equation_caption), ...captionStrings(block.caption)]
        : []

  for (const caption of captions) {
    if (kind === 'image') {
      const label = caption.match(/^\s*((?:figure|fig\.?|图)\s*(?:[A-Z]?\d+(?:[.\-]\d+)*(?:\s*[（(][A-Za-z0-9]+[）)])?|[IVXLCDM]+|[一二三四五六七八九十百]+))(?=\s|[:：.、]|$)/iu)?.[1]?.trim()
      if (label !== undefined) return label
      continue
    }
    if (kind === 'table') {
      const label = caption.match(/^\s*((?:table|tab\.?|表)\s*(?:[A-Z]?\d+(?:[.\-]\d+)*(?:\s*[（(][A-Za-z0-9]+[）)])?|[IVXLCDM]+|[一二三四五六七八九十百]+))(?=\s|[:：.、]|$)/iu)?.[1]?.trim()
      if (label !== undefined) return label
      continue
    }
    if (kind === 'equation') {
      const prefixed = caption.match(/^\s*((?:equation|eq\.?|公式|式)\s*(?:[（(]\s*[A-Za-z]?\d+(?:[.\-]\d+)*\s*[）)]|[A-Za-z]?\d+(?:[.\-]\d+)*))(?=\s|[:：.、]|$)/iu)?.[1]
      if (prefixed !== undefined) return prefixed.trim()
      const parenthesized = caption.match(/^\s*([（(]\s*[A-Za-z]?\d+(?:[.\-]\d+)*\s*[）)])(?=\s|[:：.、]|$)/u)?.[1]?.trim()
      if (parenthesized !== undefined) return parenthesized
    }
  }
  return undefined
}

function safeStringField(
  source: ContentListBlock,
  target: MutableBlock,
  field: 'text' | 'content' | 'code' | 'language' | 'table_body' | 'img_path' | 'image_path' | 'path',
  blockLocation: string,
  warnings: WarningCollector,
): string | undefined {
  const value = source[field]
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  delete target[field]
  warnings.add('DOCUMENT_INDEX_UNSUPPORTED_CONTENT', blockLocation, `non-string ${field} was omitted`)
  return undefined
}

const CAPTION_FIELDS = [
  'table_caption', 'table_footnote',
  'image_caption', 'image_footnote',
  'img_caption', 'img_footnote',
  'chart_caption', 'chart_footnote',
  'equation_caption', 'caption', 'footnote',
] as const

type CaptionField = typeof CAPTION_FIELDS[number]
type CaptionValue = string | readonly string[]

function safeCaptionField(
  source: ContentListBlock,
  target: MutableBlock,
  field: CaptionField,
  blockLocation: string,
  warnings: WarningCollector,
): CaptionValue | undefined {
  const value = source[field]
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) {
    delete target[field]
    warnings.add('DOCUMENT_INDEX_UNSUPPORTED_CONTENT', blockLocation, `non-string ${field} was omitted`)
    return undefined
  }
  const strings = value.filter((item): item is string => typeof item === 'string')
  if (strings.length !== value.length) {
    target[field] = strings
    warnings.add('DOCUMENT_INDEX_UNSUPPORTED_CONTENT', blockLocation, `non-string ${field} item(s) were omitted`)
    return strings
  }
  return value as readonly string[]
}

function inlineEquation(content: string): string {
  if (/^\$(?!\$)[\s\S]*\$$/u.test(content)) return content
  if (/^\$\$[\s\S]*\$\$$/u.test(content)) return `$${content.slice(2, -2)}$`
  const parenthesized = content.match(/^\\\(([\s\S]*)\\\)$/u)
  return `$${parenthesized?.[1] ?? content}$`
}

function displayEquation(content: string): string {
  if (/^\$\$[\s\S]*\$\$$/u.test(content)) return content
  return `$$${content}$$`
}

function nonBlank(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0
}

function preferNonBlank(...values: readonly (string | undefined)[]): string | undefined {
  return values.find(nonBlank) ?? values.find(value => value !== undefined)
}

function comparableText(value: string): string {
  return value
    .replace(/(?:\$\$|\$|\\\(|\\\)|\\\[|\\\])/gu, '')
    .replace(/\s+/gu, '')
}

function contentFromNestedLines(
  lines: unknown,
  blockLocation: string,
  warnings: WarningCollector,
): string | undefined {
  if (!Array.isArray(lines)) {
    warnings.add('DOCUMENT_INDEX_UNSUPPORTED_CONTENT', blockLocation, 'nested lines is not an array; nested content was omitted')
    return undefined
  }
  if (lines.length === 0) {
    warnings.add('DOCUMENT_INDEX_EMPTY_CONTENT', blockLocation, 'nested lines is empty')
    return undefined
  }

  const renderedLines: string[] = []
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const lineLocation = `${blockLocation} line ${String(lineIndex + 1)}`
    const line = lines[lineIndex]
    if (typeof line !== 'object' || line === null || Array.isArray(line)) {
      warnings.add('DOCUMENT_INDEX_UNKNOWN_NESTED_NODE', lineLocation, 'line is not a supported object; line was omitted')
      continue
    }
    const spans = (line as Record<string, unknown>).spans
    if (!Array.isArray(spans)) {
      warnings.add('DOCUMENT_INDEX_UNKNOWN_NESTED_NODE', lineLocation, 'line has no spans array; line was omitted')
      continue
    }
    if (spans.length === 0) {
      warnings.add('DOCUMENT_INDEX_EMPTY_CONTENT', lineLocation, 'spans is empty')
      continue
    }

    const pieces: string[] = []
    for (let spanIndex = 0; spanIndex < spans.length; spanIndex++) {
      const spanLocation = `${lineLocation} span ${String(spanIndex + 1)}`
      const span = spans[spanIndex]
      if (typeof span !== 'object' || span === null || Array.isArray(span)) {
        warnings.add('DOCUMENT_INDEX_UNKNOWN_NESTED_NODE', spanLocation, 'span is not a supported object; span was omitted')
        continue
      }
      const node = span as Record<string, unknown>
      const type = node.type
      if (typeof type !== 'string') {
        warnings.add('DOCUMENT_INDEX_UNKNOWN_NESTED_NODE', spanLocation, 'span has no string type; span was omitted')
        continue
      }
      if (type !== 'text' && type !== 'inline_equation' && type !== 'interline_equation' && type !== 'equation' && type !== 'code') {
        warnings.add('DOCUMENT_INDEX_UNKNOWN_NESTED_NODE', spanLocation, 'unsupported span type; span was omitted')
        continue
      }
      if (typeof node.content !== 'string') {
        warnings.add('DOCUMENT_INDEX_UNSUPPORTED_CONTENT', spanLocation, 'span content is not a string; span was omitted')
        continue
      }
      if (node.content.length === 0) {
        warnings.add('DOCUMENT_INDEX_EMPTY_CONTENT', spanLocation, 'span content is empty')
        continue
      }
      if (type === 'inline_equation') pieces.push(inlineEquation(node.content))
      else if (type === 'interline_equation' || type === 'equation') pieces.push(displayEquation(node.content))
      else pieces.push(node.content)
    }
    if (pieces.length > 0) renderedLines.push(pieces.join(''))
  }

  return renderedLines.length > 0 ? renderedLines.join('\n') : undefined
}

/**
 * Add stable document identities and faithfully expose known MinerU nested text.
 * The input array and its blocks are never mutated.
 */
export function normalizeDocumentBlocks(
  contentList: readonly ContentListBlock[],
  resultId: string,
  warningBlockOrders?: ReadonlySet<number>,
): { blocks: readonly IndexedContentBlock[]; warnings: readonly string[] } {
  const warnings = new WarningCollector(warningBlockOrders)
  const blocks = contentList.map((source, index): IndexedContentBlock => {
    const documentOrder = index + 1
    const blockLocation = `block ${String(documentOrder)}`
    const target: MutableBlock = { ...source }
    delete target.document_label

    if (source.type !== undefined && typeof source.type !== 'string') {
      delete target.type
      warnings.add('DOCUMENT_INDEX_UNSUPPORTED_CONTENT', blockLocation, 'non-string block type was omitted')
    } else if (typeof source.type === 'string' && !KNOWN_BLOCK_TYPES.has(source.type.toLowerCase())) {
      warnings.add('DOCUMENT_INDEX_UNKNOWN_BLOCK_TYPE', blockLocation, 'unknown top-level block type was preserved')
    }

    const text = safeStringField(source, target, 'text', blockLocation, warnings)
    const content = safeStringField(source, target, 'content', blockLocation, warnings)
    const code = safeStringField(source, target, 'code', blockLocation, warnings)
    safeStringField(source, target, 'language', blockLocation, warnings)
    const tableBody = safeStringField(source, target, 'table_body', blockLocation, warnings)
    safeStringField(source, target, 'img_path', blockLocation, warnings)
    safeStringField(source, target, 'image_path', blockLocation, warnings)
    safeStringField(source, target, 'path', blockLocation, warnings)

    const safeCaptions: Partial<Record<CaptionField, CaptionValue>> = {}
    for (const field of CAPTION_FIELDS) {
      const value = safeCaptionField(source, target, field, blockLocation, warnings)
      if (value !== undefined) safeCaptions[field] = value
    }
    if (safeCaptions.image_caption === undefined) {
      const imageCaption = safeCaptions.img_caption ?? safeCaptions.chart_caption
      if (imageCaption !== undefined) target.image_caption = imageCaption
    }
    if (safeCaptions.image_footnote === undefined) {
      const imageFootnote = safeCaptions.img_footnote ?? safeCaptions.chart_footnote
      if (imageFootnote !== undefined) target.image_footnote = imageFootnote
    }

    const kind = blockKind(source.type)
    const flatText = preferNonBlank(text, content)
    const selectedFlat = kind === 'code'
      ? preferNonBlank(code, text, content)
      : kind === 'table'
        ? preferNonBlank(tableBody, text, content)
        : flatText

    let nestedText: string | undefined
    if (source.lines !== undefined) {
      if (kind === 'table') {
        warnings.add('DOCUMENT_INDEX_UNSUPPORTED_CONTENT', blockLocation, 'nested table lines cannot be losslessly normalized; raw fields were preserved')
      } else {
        nestedText = contentFromNestedLines(source.lines, blockLocation, warnings)
        if (kind === 'image' && nonBlank(nestedText)) {
          warnings.add('DOCUMENT_INDEX_UNSUPPORTED_CONTENT', blockLocation, 'nonempty nested image text was not merged; verify the original page')
        }
      }
    }

    if (kind !== 'table' && kind !== 'image') {
      if (nonBlank(selectedFlat)) {
        // A nonblank flat value is authoritative; nested text is comparison-only.
        if (kind === 'code') target.code = selectedFlat
        else target.text = selectedFlat
        if (nonBlank(nestedText) && comparableText(selectedFlat) !== comparableText(nestedText)) {
          warnings.add('DOCUMENT_INDEX_CONFLICTING_CONTENT', blockLocation, 'nonempty flat and nested text differ; flat content was kept')
        }
      } else if (nonBlank(nestedText)) {
        // Blank flat placeholders are not evidence that the nested representation
        // is empty. Recover known spans without appending to the placeholder.
        if (kind === 'code') target.code = nestedText
        else target.text = nestedText
      } else if (selectedFlat !== undefined) {
        warnings.add('DOCUMENT_INDEX_EMPTY_CONTENT', blockLocation, 'flat textual content is empty')
      } else if (source.lines === undefined) {
        warnings.add('DOCUMENT_INDEX_EMPTY_CONTENT', blockLocation, 'no supported textual content was present')
      } else {
        warnings.add('DOCUMENT_INDEX_EMPTY_CONTENT', blockLocation, 'no supported textual content was recovered')
      }
    } else if (kind === 'table' && !nonBlank(selectedFlat)) {
      if (selectedFlat !== undefined) warnings.add('DOCUMENT_INDEX_EMPTY_CONTENT', blockLocation, 'flat textual content is empty')
      else if (source.lines === undefined) warnings.add('DOCUMENT_INDEX_EMPTY_CONTENT', blockLocation, 'no supported textual content was present')
    }

    const sourceType = typeof source.type === 'string' ? source.type.toLowerCase() : undefined
    const normalizedProse = typeof target.text === 'string'
      ? target.text
      : typeof target.content === 'string'
        ? target.content
        : undefined
    if ((sourceType === undefined || sourceType === 'text' || sourceType === 'title')
      && normalizedProse !== undefined
      && POSSIBLE_TEXT_GAP_PATTERNS.some(pattern => pattern.test(normalizedProse))) {
      warnings.add('DOCUMENT_INDEX_POSSIBLE_TEXT_GAP', blockLocation, 'possible missing value detected; verify the original page')
    }

    const documentLabel = extractDocumentLabel(source)
    return {
      ...target,
      block_id: `${resultId}:b${String(documentOrder)}`,
      ...(documentLabel === undefined ? {} : { document_label: documentLabel }),
      document_order: documentOrder,
    } as IndexedContentBlock
  })

  return { blocks, warnings: warnings.finish() }
}
