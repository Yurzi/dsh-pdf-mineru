import { open } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { TextDecoder } from 'node:util'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { MinerUFailure } from '../domain/errors.js'
import type { FocusKind } from '../domain/request.js'

export type SubmissionSource = 'cache' | 'shared-operation' | 'provider'

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
  readonly title: string
  readonly line: number
  readonly page?: number
}

export interface DocumentSummary {
  readonly page_count?: number
  readonly table_count?: number
  readonly image_count?: number
  readonly equation_count?: number
  readonly toc?: readonly DocumentHeading[]
}

export interface ImageCandidateView {
  readonly path: string
  readonly name: string
  readonly page?: number
  readonly caption?: string
  readonly media_type: string
  readonly bytes: number
}

export interface InlinedImageView {
  readonly attachment_id: string
  readonly name: string
  readonly media_type: string
  readonly width?: number
  readonly height?: number
  readonly bytes?: number
  readonly attachmentRef?: ImageAttachmentRef
}

export interface ResultView {
  readonly state: 'completed'
  readonly source: SubmissionSource
  readonly cache_hit: boolean
  readonly result_id: string
  readonly files: readonly ResultFileView[]
  readonly markdown_content?: string
  readonly content_status: ContentStatus
  readonly markdown_path?: string
  readonly read_offset_line?: number
  readonly manifest_path: string
  readonly output_limit_chars: number
  readonly inlined_images?: readonly InlinedImageView[]
  readonly ordered_images?: readonly ImageCandidateView[]
  readonly summary?: DocumentSummary
  readonly toc?: readonly DocumentHeading[]
}

export interface FailedParseView {
  readonly state: 'failed'
  readonly source: SubmissionSource
  readonly file_id: string
  readonly name: string
  readonly failure: MinerUFailure
}

export interface BatchParseDocumentView {
  readonly kind: 'batch'
  readonly state: 'completed' | 'partially-completed' | 'failed'
  readonly results: readonly (ResultView | FailedParseView)[]
  readonly output_limit_chars: number
  readonly content_status?: ContentStatus
  readonly results_omitted?: boolean
}

export type ParseDocumentView = ResultView | BatchParseDocumentView

export interface ContentListBlock {
  readonly type?: string
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

export function getRasterMediaType(ext: string): 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/png' {
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

export function computeDocumentSummary(
  contentList: readonly ContentListBlock[],
  fallbackFullText?: string,
): DocumentSummary {
  const maxPage = contentList.reduce((max, b) => typeof b.page_idx === 'number' ? Math.max(max, b.page_idx) : max, -1)
  const page_count = maxPage >= 0 ? maxPage + 1 : 1
  const table_count = contentList.filter(b => getBlockCategory(b.type) === 'table').length
  const image_count = contentList.filter(b => getBlockCategory(b.type) === 'image').length
  const equation_count = contentList.filter(b => {
    const t = (b.type ?? '').toLowerCase()
    return t === 'equation' || t === 'interline_equation' || t === 'inline_equation'
  }).length

  const toc: DocumentHeading[] = []
  for (const b of contentList) {
    const page = (b.page_idx ?? 0) + 1
    if (typeof b.text_level === 'number' && b.text_level >= 1 && b.text_level <= 6) {
      const title = String(b.text ?? b.content ?? '').trim().replace(/^#{1,6}\s+/, '')
      if (title) toc.push({ level: b.text_level, title, line: page, page })
    } else if (b.type === 'title') {
      const title = String(b.text ?? b.content ?? '').trim().replace(/^#{1,6}\s+/, '')
      if (title) toc.push({ level: 1, title, line: page, page })
    } else if (typeof b.text === 'string' && /^#{1,6}\s+/.test(b.text)) {
      const m = b.text.match(/^(#{1,6})\s+(.+)$/)
      if (m) toc.push({ level: m[1]!.length, title: m[2]!.trim(), line: page, page })
    }
  }

  if (toc.length === 0 && fallbackFullText) {
    return { page_count, table_count, image_count, equation_count, toc: extractMarkdownHeadings(fallbackFullText) }
  }
  return { page_count, table_count, image_count, equation_count, toc }
}

export function extractBlocksMarkdown(
  contentList: readonly ContentListBlock[],
  pagesSet: ReadonlySet<number> | undefined,
  focusSet: ReadonlySet<FocusKind>,
  imageArtifacts: readonly ArtifactView[],
): { text: string; orderedImages: ImageCandidateView[] } {
  const orderedImages: ImageCandidateView[] = []
  const renderedBlocks: string[] = []

  const isAllFocus = focusSet.has('all') || (focusSet.has('text') && focusSet.has('table') && focusSet.has('image'))

  for (const block of contentList) {
    const pageNum = (block.page_idx ?? 0) + 1
    if (pagesSet !== undefined && !pagesSet.has(pageNum)) {
      continue
    }
    const cat = getBlockCategory(block.type)
    if (!isAllFocus && !focusSet.has(cat)) {
      continue
    }

    if (cat === 'image') {
      const rawPath = block.img_path ?? block.image_path ?? block.path
      const base = rawPath ? basename(String(rawPath)).toLowerCase() : undefined
      const matched = imageArtifacts.find(a => {
        const artBase = basename(a.path).toLowerCase()
        return base ? (artBase === base || a.path.toLowerCase().endsWith(base)) : false
      })

      const caption = formatCaption(block.image_caption ?? block.caption)
      let imgName = 'image'
      let imgBytes = 0
      let imgPath = ''
      let mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' = 'image/png'

      if (matched) {
        imgPath = matched.path
        imgBytes = matched.bytes
        imgName = basename(matched.path)
        mediaType = getRasterMediaType(extname(matched.path))
      } else if (rawPath) {
        imgPath = String(rawPath)
        imgName = basename(imgPath)
        mediaType = getRasterMediaType(extname(imgPath))
      }

      if (imgPath) {
        orderedImages.push({
          path: imgPath,
          name: imgName,
          page: pageNum,
          caption,
          media_type: mediaType,
          bytes: imgBytes,
        })
        const imgIdx = orderedImages.length
        const label = caption ? `: ${caption}` : `: ${imgName}`
        let md = `> 🖼️ **[Attached Image #${String(imgIdx)}]** Page ${String(pageNum)}${label}`
        const footnote = formatCaption(block.image_footnote ?? block.footnote)
        if (footnote) md += `\n> *${footnote}*`
        renderedBlocks.push(md)
      }
    } else if (cat === 'table') {
      const caption = formatCaption(block.table_caption ?? block.caption)
      const body = String(block.table_body ?? block.text ?? block.content ?? '').trim()
      const footnote = formatCaption(block.table_footnote ?? block.footnote)
      let md = ''
      if (caption) md += `**${caption}**\n\n`
      if (body) md += body
      if (footnote) md += `\n\n*${footnote}*`
      if (md.trim()) renderedBlocks.push(md.trim())
    } else {
      const lower = (block.type ?? '').toLowerCase()
      if (lower === 'code') {
        const lang = String(block.language ?? '').trim()
        const code = String(block.code ?? block.text ?? block.content ?? '')
        if (code.trim().startsWith('```')) {
          renderedBlocks.push(code.trim())
        } else {
          renderedBlocks.push(`\`\`\`${lang}\n${code}\n\`\`\``)
        }
      } else if (lower === 'equation' || lower === 'interline_equation') {
        const eq = String(block.text ?? block.content ?? '').trim()
        if (eq.startsWith('$$') || eq.startsWith('$')) {
          renderedBlocks.push(eq)
        } else {
          renderedBlocks.push(`$$\n${eq}\n$$`)
        }
      } else {
        const text = String(block.text ?? block.content ?? '').trim()
        const level = typeof block.text_level === 'number' && block.text_level >= 1 && block.text_level <= 6 ? block.text_level : undefined
        if (level !== undefined && !text.startsWith('#')) {
          renderedBlocks.push(`${'#'.repeat(level)} ${text}`)
        } else if (text) {
          renderedBlocks.push(text)
        }
      }
    }
  }

  return {
    text: renderedBlocks.join('\n\n'),
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
    const base = basename(item.url).toLowerCase()
    const matchedArtifact = imageArtifacts.find(a => basename(a.path).toLowerCase() === base || a.path.toLowerCase().endsWith(base))
    const imgPath = matchedArtifact?.path ?? item.url
    const imgBytes = matchedArtifact?.bytes ?? 0
    const imgName = basename(imgPath)
    const mediaType = getRasterMediaType(extname(imgPath))
    imgIndex++
    orderedImages.push({
      path: imgPath,
      name: imgName,
      caption: item.alt,
      media_type: mediaType,
      bytes: imgBytes,
    })
    const replacement = `> 🖼️ **[Attached Image #${String(imgIndex)}]** ${item.alt ? item.alt : imgName}`
    annotatedText = annotatedText.replace(item.fullMatch, replacement)
  }

  const toc = extractMarkdownHeadings(fullMarkdownText)
  const tableCount = (fullMarkdownText.match(/\|[\s-:]+\|/g) ?? []).length
  const summary: DocumentSummary = {
    page_count: 1,
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

export function allocateReclaimedShares(lengths: readonly number[], totalBudget: number): number[] {
  const result = new Array(lengths.length).fill(0)
  const active = lengths.map((len, idx) => ({ idx, len }))
  let remaining = totalBudget

  while (active.length > 0) {
    const share = Math.floor(remaining / active.length)
    if (share <= 0) break
    const fitIndex = active.findIndex(item => item.len <= share)
    if (fitIndex !== -1) {
      const item = active.splice(fitIndex, 1)[0]!
      result[item.idx] = item.len
      remaining -= item.len
    } else {
      for (const item of active) {
        result[item.idx] = share
      }
      break
    }
  }
  return result
}

export async function readMarkdownFile(
  path: string,
  totalBytes: number,
  maxCharsToRead: number,
): Promise<{ text: string; isCompleteFile: boolean }> {
  if (totalBytes === 0) {
    return { text: '', isCompleteFile: true }
  }
  const maxBytes = Math.min(totalBytes, Math.max(4096, (maxCharsToRead + 2048) * 4))
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(maxBytes)
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
    const text = new TextDecoder('utf-8').decode(buffer.subarray(0, bytesRead))
    const isCompleteFile = bytesRead >= totalBytes
    return { text, isCompleteFile }
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
  if (headings.length > 25) {
    const highLevel = headings.filter(h => h.level <= 3)
    const selected = highLevel.length > 0 ? highLevel : headings
    return selected.slice(0, 20)
  }
  return headings
}

export function formatResultProse(value: ResultView): string {
  const status: ContentStatus = value.content_status ?? (value.markdown_content !== undefined ? 'complete' : 'not_requested')
  const lines = [
    '**MinerU Parse Result** (Source: ' + value.source + ', Cache: ' + (value.cache_hit ? 'hit' : 'miss') + ')',
  ]
  const content = value.markdown_content
  if (value.files.length > 0) {
    for (let i = 0; i < value.files.length; i++) {
      const file = value.files[i]!
      lines.push('', '# Document: ' + file.name)
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
    lines.push('', content)
  }

  if (value.inlined_images && value.inlined_images.length > 0) {
    lines.push('', '**Inlined Visual Figures**:')
    for (let idx = 0; idx < value.inlined_images.length; idx++) {
      const img = value.inlined_images[idx]!
      const dim = (img.width !== undefined && img.height !== undefined) ? ` (${String(img.width)}x${String(img.height)})` : ''
      lines.push(`- Attached Image #${String(idx + 1)}: ${img.name}${dim}`)
    }
  }

  if (status === 'partial' && value.toc && value.toc.length > 0) {
    lines.push('', 'Document Outline:')
    for (const heading of value.toc) {
      const indent = '  '.repeat(Math.max(0, heading.level - 1))
      lines.push(`${indent}- ${heading.title} (line ${String(heading.line)})`)
    }
    lines.push('', 'Note: To read specific sections, call read_pdf with pages="X-Y" or use the read tool starting from the given line offset.')
  }

  let footer: string
  if (status === 'complete') {
    footer = '\n---\n[Status: Content complete. Full document markdown delivered above. Artifact path: ' + value.manifest_path + ']'
  } else if (status === 'partial') {
    const mdPath = findMarkdownArtifactPath(value)
    const resumeInfo = value.read_offset_line !== undefined ? ' (resume line: offset=' + String(value.read_offset_line) + ')' : ''
    const mdGuidance = mdPath !== undefined
      ? 'Full markdown artifact at: ' + mdPath + resumeInfo + '.'
      : 'Full markdown artifact path unavailable.'
    footer = '\n---\n[Status: Content partial (truncated to output limit). ' + mdGuidance + ' Manifest: ' + value.manifest_path + ']'
  } else {
    footer = '\n---\n[Status: Markdown content was not requested. Manifest: ' + value.manifest_path + ']'
  }
  lines.push(footer)
  return lines.join('\n')
}

export function formatParseDocumentProse(value: ParseDocumentView): string {
  if (!('kind' in value)) return formatResultProse(value)
  const sections = value.results.map(result =>
    result.state === 'completed'
      ? formatResultProse(result)
      : '**' + result.name + '**: [' + result.failure.code + '] ' + result.failure.message
  )
  return '**MinerU Batch Result**\n- State: ' + value.state + '\n- Results: ' + String(value.results.length) + '\n\n' + sections.join('\n\n')
}

export function formatSingleSummaryProse(value: ResultView): string {
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
      const pageInfo = heading.page !== undefined ? ` (Page ${String(heading.page)})` : ` (line ${String(heading.line)})`
      lines.push(`${indent}- ${heading.title}${pageInfo}`)
    }
  }

  lines.push(
    '',
    '---',
    '💡 **Next Steps**: The document has been fully parsed and cached in local storage. Use `read_pdf` to inspect content on demand:',
    `- Read specific pages: \`read_pdf({ file_path: "${fileName}", pages: "1-3" })\``,
    `- Focus on tables: \`read_pdf({ file_path: "${fileName}", focus: "table" })\``,
    `- Focus on figures/images: \`read_pdf({ file_path: "${fileName}", focus: "image" })\``,
    `- Read complete text: \`read_pdf({ file_path: "${fileName}" })\``,
  )

  return lines.join('\n')
}

export function formatParseSummaryProse(value: ParseDocumentView): string {
  if ('kind' in value && value.kind === 'batch') {
    const lines = [
      '**MinerU Batch Parse Summary**',
      `- State: ${value.state}`,
      `- Documents: ${String(value.results.length)}`,
      '',
    ]
    for (const result of value.results) {
      if (result.state === 'completed') {
        lines.push(formatSingleSummaryProse(result))
      } else {
        lines.push(`**${result.name}**: [${result.failure.code}] ${result.failure.message}`)
      }
    }
    return lines.join('\n\n')
  }
  return formatSingleSummaryProse(value as ResultView)
}
