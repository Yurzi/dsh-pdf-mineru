import { open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, extname } from 'node:path'
import { TextDecoder } from 'node:util'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { MinerUError, failure } from '../domain/errors.js'
import type { MinerUFailure } from '../domain/errors.js'
import type { FocusKind } from '../domain/request.js'

export type SubmissionSource = 'cache' | 'shared-operation' | 'provider' | 'local'

export type ContentStatus = 'complete' | 'partial' | 'not_requested'

export interface ArtifactView {
  readonly kind: string
  readonly path: string
  readonly bytes: number
}

export interface ResultFileView {
  readonly file_id: string
  readonly name: string
  readonly artifacts: readonly ArtifactView[]
  readonly artifacts_truncated?: boolean
  readonly markdown_path?: string
}

export interface DocumentHeading {
  readonly level: number
  readonly block_id?: string
  readonly title: string
  readonly line?: number
  readonly page?: number
}

export interface DocumentSummary {
  readonly page_count?: number
  readonly page_count_source?: 'layout' | 'content-list-lower-bound' | 'pdfinfo'
  readonly table_count?: number
  readonly image_count?: number
  readonly equation_count?: number
  readonly toc?: readonly DocumentHeading[]
}

export interface ImageCandidateView {
  readonly block_id?: string
  readonly document_label?: string
  readonly path: string
  readonly name: string
  readonly page?: number
  readonly caption?: string
  readonly media_type: string
  readonly bytes: number
  readonly status?: 'available' | 'unavailable' | 'unsupported' | 'failed' | 'omitted'
}

export interface InlinedImageView {
  readonly block_id?: string
  readonly document_label?: string
  readonly page?: number
  readonly attachment_id: string
  readonly name: string
  readonly media_type: string
  readonly width?: number
  readonly height?: number
  readonly bytes?: number
  readonly attachmentRef?: ImageAttachmentRef
  readonly figure?: number
}

/** Parsing identity is distinct from the current reader/projection implementation. */
export interface ReadProvenance {
  readonly provider: 'self-hosted-v2' | 'official-v4'
  readonly model: 'pipeline' | 'vlm'
  readonly parse_method: 'auto' | 'txt' | 'ocr'
  readonly upstream_version: null
  readonly index_version: number
  readonly reader_version: number
}

export interface ReadDiagnostic {
  readonly id: string
  readonly code: string
  readonly scope: 'document' | 'selection' | 'chunk'
  readonly message: string
  readonly block_id?: string
  readonly page?: number
}

export interface VerificationHint {
  readonly reason: 'formula'
  readonly block_id: string
  readonly page?: number
  readonly view: 'page'
}

export type ShortenedMetadata = 'summary' | 'provenance' | 'diagnostics' | 'verification_hints' | 'warnings'

export interface ResultView {
  readonly state: 'completed'
  readonly source: SubmissionSource
  readonly cache_hit: boolean
  readonly result_id: string
  readonly files: readonly ResultFileView[]
  readonly markdown_content?: string
  readonly content_status: ContentStatus
  readonly markdown_path?: string
  readonly manifest_path?: string
  readonly output_limit_chars: number
  readonly inlined_images?: readonly InlinedImageView[]
  readonly ordered_images?: readonly ImageCandidateView[]
  readonly summary?: DocumentSummary
  readonly toc?: readonly DocumentHeading[]
  readonly pages?: string
  /** Non-empty exact-text continuation token when partial; null otherwise. */
  readonly cursor: string | null
  readonly warnings?: readonly string[]
  readonly diagnostics?: readonly ReadDiagnostic[]
  readonly verification_hints?: readonly VerificationHint[]
  readonly provenance?: ReadProvenance
  readonly metadata_shortened?: readonly ShortenedMetadata[]
  readonly source_sha256?: string
  readonly view?: 'content' | 'page'
  readonly continuation_block?: { readonly block_id: string; readonly page?: number; readonly document_label?: string }
  readonly visuals?: { readonly listed: number; readonly attached: number; readonly omitted: number; readonly scope: 'chunk' }
}

/** Parse completion metadata, independent of body output and its character budget. */
export type ParseSummaryView = Pick<ResultView,
  'state' | 'source' | 'cache_hit' | 'result_id' | 'files' | 'content_status' | 'manifest_path' | 'summary' | 'toc' | 'warnings'>

export interface FailedParseView {
  readonly state: 'failed'
  readonly source: SubmissionSource
  readonly file_id: string
  readonly name: string
  readonly failure: MinerUFailure
}

export type ParseDocumentView = ResultView

export interface ContentListBlock {
  readonly type?: string
  readonly block_id?: string
  readonly document_label?: string
  readonly document_order?: number
  readonly page_idx?: number
  readonly text?: string
  readonly content?: string
  readonly text_level?: number
  readonly code?: string
  readonly language?: string
  readonly table_body?: string
  readonly table_caption?: string | readonly string[]
  readonly table_footnote?: string | readonly string[]
  readonly img_path?: string
  readonly image_path?: string
  readonly path?: string
  readonly image_caption?: string | readonly string[]
  readonly caption?: string | readonly string[]
  readonly image_footnote?: string | readonly string[]
  readonly footnote?: string | readonly string[]
  readonly [key: string]: unknown
}

export function getBlockCategory(type?: string): 'text' | 'table' | 'image' {
  if (!type) return 'text'
  const lower = type.toLowerCase()
  if (lower === 'table' || lower.startsWith('table_')) return 'table'
  if (lower === 'image' || lower === 'chart' || lower === 'figure' || lower.startsWith('image_')) return 'image'
  return 'text'
}

export function formatCaption(caption: unknown): string {
  if (typeof caption === 'string') return caption.trim()
  if (Array.isArray(caption)) {
    return caption.map(c => typeof c === 'string' ? c.trim() : String(c)).filter(Boolean).join(' ')
  }
  return ''
}

export function getRasterMediaType(ext: string): 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/png' | undefined {
  switch (ext.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.png':
      return 'image/png'
    default:
      return undefined
  }
}

export function formatTocMarkdown(
  headings: readonly DocumentHeading[] | undefined,
  options?: { pageRange?: string },
  ranges?: ProjectedBlockRange[],
): string {
  if (!headings || headings.length === 0) {
    return options?.pageRange
      ? `*(No headings found in pages: ${options.pageRange})*`
      : '*(No headings detected in document outline)*'
  }
  const lines: string[] = ['# Document Outline', '']
  let nextOffset = '# Document Outline\n\n'.length
  for (const heading of headings) {
    const indent = '  '.repeat(Math.max(0, heading.level - 1))
    const location = heading.page !== undefined
      ? ` (Page ${String(heading.page)})`
      : (heading.line !== undefined ? ` (line ${String(heading.line)})` : '')
    const label = heading.block_id ? ' [' + heading.block_id + ']' : ''
    const line = `${indent}- ${heading.title}${location}${label}`
    if (heading.block_id && ranges) {
      const end = nextOffset + line.length
      const markerStart = end - label.length + 1
      const coordinates = { block_id: heading.block_id, ...(heading.page === undefined ? {} : { page: heading.page }) }
      ranges.push({ ...coordinates, start: nextOffset, locator_end: nextOffset, end: markerStart })
      ranges.push({ ...coordinates, start: markerStart, locator_end: end, end })
    }
    lines.push(line)
    nextOffset += line.length + 1
  }
  return lines.join('\n')
}

export function computeDocumentSummary(
  contentList: readonly ContentListBlock[],
  fallbackFullText?: string,
): DocumentSummary {
  const maxPage = contentList.reduce((max, b) => typeof b.page_idx === 'number' ? Math.max(max, b.page_idx) : max, -1)
  const page_count = maxPage >= 0 ? maxPage + 1 : undefined
  const table_count = contentList.filter(b => getBlockCategory(b.type) === 'table').length
  const image_count = contentList.filter(b => getBlockCategory(b.type) === 'image').length
  const equation_count = contentList.filter(b => {
    const t = (b.type ?? '').toLowerCase()
    return t === 'equation' || t === 'interline_equation' || t === 'inline_equation'
  }).length

  const toc: DocumentHeading[] = []
  for (const b of contentList) {
    const page = typeof b.page_idx === 'number' && Number.isSafeInteger(b.page_idx) && b.page_idx >= 0 ? b.page_idx + 1 : undefined
    if (typeof b.text_level === 'number' && b.text_level >= 1 && b.text_level <= 6) {
      const title = String(b.text ?? b.content ?? '').trim().replace(/^#{1,6}\s+/, '')
      if (title) toc.push({ level: b.text_level, title, ...(page === undefined ? {} : { page }), ...(b.block_id ? { block_id: b.block_id } : {}) })
    } else if (b.type === 'title') {
      const title = String(b.text ?? b.content ?? '').trim().replace(/^#{1,6}\s+/, '')
      if (title) toc.push({ level: 1, title, ...(page === undefined ? {} : { page }), ...(b.block_id ? { block_id: b.block_id } : {}) })
    } else if (typeof b.text === 'string' && /^#{1,6}\s+/.test(b.text)) {
      const m = b.text.match(/^(#{1,6})\s+(.+)$/)
      if (m) toc.push({ level: m[1]!.length, title: m[2]!.trim(), ...(page === undefined ? {} : { page }), ...(b.block_id ? { block_id: b.block_id } : {}) })
    }
  }

  if (toc.length === 0 && fallbackFullText) {
    return {
      ...(page_count !== undefined ? { page_count } : {}),
      table_count,
      image_count,
      equation_count,
      toc: extractMarkdownHeadings(fallbackFullText),
    }
  }
  return {
    ...(page_count !== undefined ? { page_count } : {}),
    table_count,
    image_count,
    equation_count,
    toc,
  }
}

export interface ProjectedBlockRange {
  readonly block_id: string
  readonly page?: number
  readonly document_label?: string
  readonly start: number
  readonly locator_end: number
  readonly end: number
}

export function extractBlocksMarkdown(
  contentList: readonly ContentListBlock[],
  pagesSet: ReadonlySet<number> | undefined,
  focusSet: ReadonlySet<FocusKind>,
  imageArtifacts: readonly ArtifactView[],
): { text: string; orderedImages: ImageCandidateView[]; ranges: ProjectedBlockRange[] } {
  const orderedImages: ImageCandidateView[] = []
  const renderedBlocks: string[] = []
  const ranges: ProjectedBlockRange[] = []
  let renderedLength = 0
  const append = (text: string): void => { renderedLength += text.length + (renderedBlocks.length ? 2 : 0); renderedBlocks.push(text) }

  const isAllFocus = focusSet.has('all') || (focusSet.has('text') && focusSet.has('table') && focusSet.has('image'))

  for (const block of contentList) {
    const pageNum = typeof block.page_idx === 'number' && Number.isSafeInteger(block.page_idx) && block.page_idx >= 0 ? block.page_idx + 1 : undefined
    if (pagesSet !== undefined && (pageNum === undefined || !pagesSet.has(pageNum))) {
      continue
    }
    const cat = getBlockCategory(block.type)
    if (!isAllFocus && !focusSet.has(cat)) {
      continue
    }

    const rangeStart = renderedLength + (renderedBlocks.length ? 2 : 0)
    if (block.block_id !== undefined) append(`[${block.block_id}${pageNum === undefined ? '' : ' · Page ' + pageNum}${block.document_label ? ' · ' + block.document_label : ''}]`)

    const locatorEnd = renderedLength
    if (cat === 'image') {
      const rawPath = block.img_path ?? block.image_path ?? block.path
      const reference = rawPath === undefined ? undefined : String(rawPath).replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '')
      const exact = reference === undefined ? undefined : imageArtifacts.filter(a => {
        const candidate = a.path.replaceAll('\\', '/')
        return candidate === reference || candidate.endsWith('/' + reference)
      })
      const base = reference === undefined ? undefined : basename(reference).toLowerCase()
      const byBase = base === undefined ? [] : imageArtifacts.filter(a => basename(a.path).toLowerCase() === base)
      const matched = exact?.length === 1 ? exact[0] : (exact?.length === 0 && byBase.length === 1 ? byBase[0] : undefined)

      const caption = formatCaption(block.image_caption ?? block.caption)
      let imgName = 'image'
      let imgBytes = 0
      let imgPath = ''
      let mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | undefined

      if (matched) {
        imgPath = matched.path
        imgBytes = matched.bytes
        imgName = basename(matched.path)
        mediaType = getRasterMediaType(extname(matched.path))
      }

      const imgIdx = orderedImages.length + 1
      const status = matched === undefined ? 'unavailable' : (mediaType === undefined ? 'unsupported' : 'available')
      orderedImages.push({
        ...(block.block_id ? { block_id: block.block_id } : {}),
        ...(block.document_label ? { document_label: block.document_label } : {}),
        path: imgPath,
        name: imgName,
        ...(pageNum !== undefined ? { page: pageNum } : {}),
        ...(caption ? { caption } : {}),
        media_type: mediaType ?? 'application/octet-stream',
        bytes: imgBytes,
        status,
      })
      const imageLabel = block.document_label ?? (block.block_id ? 'Image' : 'Image ' + String(imgIdx))
      const pageLabel = pageNum === undefined ? '' : ' (Page ' + String(pageNum) + ')'
      let md = '> ' + imageLabel + pageLabel + (mediaType === undefined || imgPath === '' ? ' unavailable' : '') + (caption ? ': ' + caption : '')
      const footnote = formatCaption(block.image_footnote ?? block.footnote)
      if (footnote) md += `\n> *${footnote}*`
      append(md)
    } else if (cat === 'table') {
      const caption = formatCaption(block.table_caption ?? block.caption)
      const body = String(block.table_body ?? block.text ?? block.content ?? '').trim()
      const footnote = formatCaption(block.table_footnote ?? block.footnote)
      let md = ''
      if (caption) md += `**${caption}**\n\n`
      if (body) md += body
      if (footnote) md += `\n\n*${footnote}*`
      if (md.trim()) append(md.trim())
    } else {
      const lower = (block.type ?? '').toLowerCase()
      if (lower === 'code') {
        const lang = String(block.language ?? '').trim()
        const code = String(block.code ?? block.text ?? block.content ?? '')
        if (code.trim().startsWith('```')) {
          append(code.trim())
        } else {
          append(`\`\`\`${lang}\n${code}\n\`\`\``)
        }
      } else if (lower === 'equation' || lower === 'interline_equation') {
        const eq = String(block.text ?? block.content ?? '').trim()
        if (eq.startsWith('$$') || eq.startsWith('$')) {
          append(eq)
        } else {
          append(`$$\n${eq}\n$$`)
        }
      } else {
        const text = String(block.text ?? block.content ?? '').trim()
        const level = typeof block.text_level === 'number' && block.text_level >= 1 && block.text_level <= 6 ? block.text_level : undefined
        if (level !== undefined && !text.startsWith('#')) {
          append(`${'#'.repeat(level)} ${text}`)
        } else if (text) {
          append(text)
        }
      }
    }
    if (block.block_id) ranges.push({ block_id: block.block_id, start: rangeStart, locator_end: locatorEnd, end: renderedLength, ...(pageNum === undefined ? {} : { page: pageNum }), ...(block.document_label ? { document_label: block.document_label } : {}) })
  }

  return {
    text: renderedBlocks.join('\n\n'),
    ranges,
    orderedImages,
  }
}

export function fallbackExtractFromMarkdown(
  fullMarkdownText: string,
  imageArtifacts: readonly ArtifactView[],
): { text: string; orderedImages: ImageCandidateView[]; summary: DocumentSummary } {
  const orderedImages: ImageCandidateView[] = []
  let annotatedText = fullMarkdownText
  const imgRegex = /!\[(.*?)\]\((.*?)\)/g
  let match: RegExpExecArray | null
  let imgIndex = 0

  const matches: Array<{ fullMatch: string; alt: string; url: string }> = []
  while ((match = imgRegex.exec(fullMarkdownText)) !== null) {
    matches.push({ fullMatch: match[0], alt: match[1] ?? '', url: match[2] ?? '' })
  }

  for (const item of matches) {
    const reference = item.url.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '')
    const exact = imageArtifacts.filter(a => {
      const candidate = a.path.replaceAll('\\', '/')
      return candidate === reference || candidate.endsWith('/' + reference)
    })
    const base = basename(reference).toLowerCase()
    const byBase = imageArtifacts.filter(a => basename(a.path).toLowerCase() === base)
    const matchedArtifact = exact.length === 1 ? exact[0] : (exact.length === 0 && byBase.length === 1 ? byBase[0] : undefined)
    const imgPath = matchedArtifact?.path
    const imgName = matchedArtifact === undefined ? basename(reference) || 'image' : basename(matchedArtifact.path)
    const mediaType = matchedArtifact === undefined ? undefined : getRasterMediaType(extname(matchedArtifact.path))
    imgIndex++
    orderedImages.push({
      path: imgPath ?? '',
      name: imgName,
      ...(item.alt ? { caption: item.alt } : {}),
      media_type: mediaType ?? 'application/octet-stream',
      bytes: matchedArtifact?.bytes ?? 0,
      status: matchedArtifact === undefined ? 'unavailable' : (mediaType === undefined ? 'unsupported' : 'available'),
    })
    const replacement = mediaType === undefined || imgPath === undefined
      ? `> Figure ${String(imgIndex)} unavailable`
      : `> Figure ${String(imgIndex)}${item.alt ? `: ${item.alt}` : ''}`
    annotatedText = annotatedText.replace(item.fullMatch, replacement)
  }

  const toc = extractMarkdownHeadings(fullMarkdownText)
  const tableCount = (fullMarkdownText.match(/\|[\s-:]+\|/g) ?? []).length
  const summary: DocumentSummary = {
    table_count: tableCount,
    image_count: orderedImages.length,
    toc,
  }
  return { text: annotatedText, orderedImages, summary }
}

export function safeStringSlice(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  let end = maxLen
  const code = str.charCodeAt(end - 1)
  if (code >= 0xD800 && code <= 0xDBFF) {
    end--
  }
  return str.slice(0, end)
}

export function truncateAtCleanBoundary(
  fullText: string,
  maxChars: number,
): { text: string; truncated: boolean; resumeLine?: number } {
  if (fullText.length <= maxChars) {
    return { text: fullText, truncated: false }
  }
  if (maxChars <= 0) {
    return { text: '', truncated: true, resumeLine: 1 }
  }

  const boundedSlice = safeStringSlice(fullText, maxChars)
  const paragraphIndex = boundedSlice.lastIndexOf('\n\n')
  const lineIndex = boundedSlice.lastIndexOf('\n')

  let cutIndex = -1
  if (paragraphIndex !== -1 && paragraphIndex >= Math.floor(maxChars * 0.7)) {
    cutIndex = paragraphIndex + 2
  } else if (lineIndex !== -1) {
    cutIndex = lineIndex + 1
  }

  if (cutIndex > 0) {
    const text = boundedSlice.slice(0, cutIndex)
    let newlineCount = 0
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) newlineCount++
    }
    const resumeLine = newlineCount + 1
    return { text, truncated: true, resumeLine }
  }

  const text = boundedSlice
  return { text, truncated: true, resumeLine: 1 }
}

const MAX_MARKDOWN_READ_BYTES = 64 * 1024 * 1024

export async function readMarkdownFile(
  path: string,
  totalBytes: number,
  signal?: AbortSignal,
): Promise<{ text: string; isCompleteFile: boolean }> {
  signal?.throwIfAborted()
  if (totalBytes > MAX_MARKDOWN_READ_BYTES) {
    throw new MinerUError(failure('RESULT_TOO_LARGE', 'Markdown artifact exceeds the bounded reader limit'))
  }
  if (totalBytes === 0) {
    return { text: '', isCompleteFile: true }
  }
  const maxBytes = totalBytes
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.size !== totalBytes) throw new MinerUError(failure('RESULT_DOWNLOAD_FAILED', 'Markdown artifact changed before reading'))
    const buffer = Buffer.alloc(maxBytes)
    let bytesRead = 0
    while (bytesRead < maxBytes) {
      signal?.throwIfAborted()
      const result = await handle.read(buffer, bytesRead, maxBytes - bytesRead, bytesRead)
      if (result.bytesRead === 0) break
      bytesRead += result.bytesRead
    }
    if (bytesRead !== totalBytes) throw new MinerUError(failure('RESULT_DOWNLOAD_FAILED', 'Markdown artifact changed while it was being read'))
    signal?.throwIfAborted()
    const after = await handle.stat()
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new MinerUError(failure('RESULT_DOWNLOAD_FAILED', 'Markdown artifact changed during reading'))
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return { text, isCompleteFile: true }
  } finally {
    await handle.close()
  }
}

export function findMarkdownArtifactPath(value: ResultView): string | undefined {
  if (value.markdown_path !== undefined) return value.markdown_path
  for (const file of value.files) {
    if (file.markdown_path !== undefined) return file.markdown_path
    const md = file.artifacts.find(artifact => artifact.kind === 'markdown')
    if (md !== undefined) return md.path
  }
  return undefined
}

export function extractMarkdownHeadings(fullText: string): DocumentHeading[] {
  if (!fullText) return []
  const lines = fullText.split(/\r?\n/)
  const headings: DocumentHeading[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) {
      const title = match[2]!.trim()
      if (title.length > 0) {
        headings.push({
          level: match[1]!.length,
          title,
          line: i + 1,
        })
      }
    }
  }
  return headings
}

export function formatResultProse(value: ResultView): string {
  const status: ContentStatus = value.content_status ?? (value.markdown_content !== undefined ? 'complete' : 'not_requested')
  const lines: string[] = []
  const content = value.markdown_content
  if (value.files.length > 0) {
    for (let i = 0; i < value.files.length; i++) {
      const file = value.files[i]!
      if (lines.length > 0) lines.push('')
      lines.push('# Document: ' + file.name)
      if (i === 0 && content !== undefined) {
        lines.push('', content)
      }
      const secondary = file.artifacts.filter(artifact => artifact.kind !== 'markdown')
      if (secondary.length > 0) {
        lines.push('', 'Artifacts: ' + secondary.map(a => a.kind + ' (' + String(a.bytes) + ' bytes): ' + a.path).join(', '))
      }
      if (file.artifacts_truncated) {
        lines.push('', '*(Artifact list truncated to output limit)*')
      }
    }
  } else if (content !== undefined) {
    lines.push(content)
  }

  if (status === 'partial' && value.toc && value.toc.length > 0) {
    lines.push('', 'Document Outline:')
    for (const heading of value.toc) {
      const indent = '  '.repeat(Math.max(0, heading.level - 1))
      const location = heading.page !== undefined ? ` (Page ${String(heading.page)})` : (heading.line !== undefined ? ` (line ${String(heading.line)})` : '')
      lines.push(`${indent}- ${heading.title}${location}${heading.block_id ? ' [' + heading.block_id + ']' : ''}`)
    }
    if (typeof value.cursor === 'string' && value.cursor.length > 0) lines.push('', 'Continue with the returned cursor using the same file_path.')
  }

  const totalPages = value.summary?.page_count
  const pagesLabel = value.pages ?? (totalPages !== undefined ? (totalPages > 1 ? `1-${totalPages}` : '1') : undefined)
  const pagesParts: string[] = []
  if (pagesLabel !== undefined) pagesParts.push(`Pages: ${pagesLabel}`)
  if (totalPages !== undefined) pagesParts.push(`${value.summary?.page_count_source === 'content-list-lower-bound' ? 'Parsed page lower bound' : 'Total Pages'}: ${String(totalPages)}`)
  const pagesInfo = pagesParts.length > 0 ? pagesParts.join(', ') + '. ' : ''

  let footer: string
  if (status === 'complete') {
    footer = '\n---\n[Status: Content complete. ' + pagesInfo + 'Selected parsed text complete across this and preceding chunks; not a guarantee of OCR fidelity or visual coverage.]'
  } else if (status === 'partial') {
    const mdGuidance = typeof value.cursor === 'string' && value.cursor.length > 0
      ? `Continue with read_pdf({ file_path: "<same file_path>", cursor: "${value.cursor}" }); omit pages/focus.`
      : 'Full markdown artifact available in local result storage.'
    footer = '\n---\n[Status: Content partial (truncated to output limit). ' + pagesInfo + mdGuidance + ']'
  } else {
    footer = '\n---\n[Status: Markdown content was not requested.' + (pagesParts.length > 0 ? ' ' + pagesParts.join(', ') + '.' : '') + ']'
  }
  if (value.provenance) {
    const p = value.provenance
    lines.push('', `Parse provenance: ${p.provider}/${p.model}, method ${p.parse_method}; upstream engine version unknown. Index v${p.index_version}, reader protocol v${p.reader_version}.`)
  }
  if (value.diagnostics?.length) lines.push('', 'Diagnostics:', ...value.diagnostics.map(d => `- [${d.code}] (${d.scope})${d.block_id ? ' [' + d.block_id + ']' : ''}${d.page === undefined ? '' : ' Page ' + d.page}: ${d.message}`))
  if (value.verification_hints?.length) lines.push('', 'Formula verification suggested (advisory, not a detected error):', ...value.verification_hints.map(hint => `- [${hint.block_id}]${hint.page === undefined ? '' : ' Page ' + hint.page}: inspect the original page before relying on formula symbols.`))
  if (value.metadata_shortened?.length) lines.push('', 'Metadata shortened to fit: ' + value.metadata_shortened.join(', ') + '. Narrow the selection to inspect omitted details.')
  if (value.view === 'page') lines.push('', 'Original PDF page rendered locally; no Provider parsing was performed.')
  if (value.visuals) lines.push('', `Visuals in this chunk: ${value.visuals.attached}/${value.visuals.listed} attached, ${value.visuals.omitted} not attached.`)
  if (value.continuation_block) lines.push('', 'Continuing block [' + value.continuation_block.block_id + ']' + (value.continuation_block.page ? ' (Page ' + value.continuation_block.page + ')' : ''))
  lines.push(footer)
  if (value.warnings && value.warnings.length > 0) lines.push('', 'Warnings:', ...value.warnings.map(warning => `- ${warning}`))

  if (value.inlined_images && value.inlined_images.length > 0) {
    lines.push('', '**Inlined Visual Figures**:')
    for (let idx = 0; idx < value.inlined_images.length; idx++) {
      const img = value.inlined_images[idx]!
      const dim = (img.width !== undefined && img.height !== undefined) ? ` (${String(img.width)}x${String(img.height)})` : ''
      const label = value.view === 'page' ? 'Original PDF Page ' + img.page : img.document_label ?? (img.block_id ? 'Image [' + img.block_id + ']' : 'Figure ' + String(img.figure ?? idx + 1))
      lines.push(`- ${label}: ${img.name}${dim}`)
    }
  }
  if (value.ordered_images && value.ordered_images.length > 0) {
    for (let idx = 0; idx < value.ordered_images.length; idx++) {
      const img = value.ordered_images[idx]!
      const pageStr = img.page !== undefined ? `Page ${String(img.page)}` : ''
      const capStr = img.caption ? `"${img.caption}"` : ''
      const meta = [pageStr, capStr].filter(Boolean).join(', ')
      const metaStr = meta ? ` (${meta})` : ''
      const status = img.status && img.status !== 'available' ? ` [${img.status}]` : ''
      const label = img.document_label ?? (img.block_id ? 'Image' : 'Figure ' + String(idx + 1))
      const target = img.block_id ? '[' + img.block_id + ']' : img.path || 'unavailable'
      lines.push(`${label}${metaStr}: ${target}${status}`)
    }
  }

  return lines.join('\n')
}

export function formatSingleSummaryProse(value: ParseSummaryView): string {
  const file = value.files[0]
  const fileName = file?.name ?? 'Document'
  const summary = value.summary
  const lines = [
    `**MinerU Document Parse Summary** (Source: ${value.source}, Cache: ${value.cache_hit ? 'hit' : 'miss'})`,
    '',
    `# Document: ${fileName}`,
  ]

  if (summary?.page_count !== undefined) {
    lines.push(`- **Total Pages**: ${String(summary.page_count)}`)
  }
  if (summary?.table_count !== undefined) {
    lines.push(`- **Tables**: ${String(summary.table_count)}`)
  }
  if (summary?.image_count !== undefined) {
    lines.push(`- **Figures / Images**: ${String(summary.image_count)}`)
  }
  if (summary?.equation_count !== undefined && summary.equation_count > 0) {
    lines.push(`- **Formulas / Equations**: ${String(summary.equation_count)}`)
  }

  const outline = summary?.toc ?? value.toc
  if (outline && outline.length > 0) {
    lines.push('', '**Document Outline**:')
    for (const heading of outline) {
      const indent = '  '.repeat(Math.max(0, heading.level - 1))
      const pageInfo = heading.page !== undefined ? ` (Page ${String(heading.page)})` : (heading.line !== undefined ? ` (line ${String(heading.line)})` : '')
      lines.push(`${indent}- ${heading.title}${pageInfo}`)
    }
  }

  if (value.warnings?.length) lines.push('', ...value.warnings.map(warning => 'Note: ' + warning))

  lines.push(
    '',
    '---',
    '**Next Steps**: The document has been fully parsed and cached in local storage. Use `read_pdf` to inspect content on demand:',
    '- Reuse the original file_path for a page selection: `read_pdf({ file_path: "<same file_path>", pages: "1-3" })`',
    '- Reuse the original file_path for tables: `read_pdf({ file_path: "<same file_path>", focus: "table" })`',
    '- Reuse the original file_path for figures/images: `read_pdf({ file_path: "<same file_path>", focus: "image" })`',
    '- Reuse the original file_path for outline / TOC: `read_pdf({ file_path: "<same file_path>", focus: "toc" })`',
    '- Reuse the original file_path for complete text: `read_pdf({ file_path: "<same file_path>" })`',
  )

  return lines.join('\n')
}

/**
 * Formats the model-facing error message when requested pages fall completely outside the document bounds.
 * Retains the standard `[PAGE_OUT_OF_RANGE]` prefix and appends legal 1-based bounds when `totalPages` is known.
 */
export function formatPageOutOfRangeMessage(totalPages?: number): string {
  const prefix = '[PAGE_OUT_OF_RANGE] Requested pages are outside the document page range'
  if (typeof totalPages === 'number' && Number.isSafeInteger(totalPages) && totalPages >= 1) {
    const validRange = totalPages === 1 ? '1' : `1-${totalPages}`
    return `${prefix} (valid: ${validRange}, total pages: ${totalPages})`
  }
  return prefix
}
