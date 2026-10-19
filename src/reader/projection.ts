import { basename, extname } from 'node:path'
import { mediaTypeForExtension } from './image-policy.js'
import type { ArtifactView, ContentListBlock, DocumentHeading, ImageCandidateView, ProjectedBlockRange } from './views.js'

/** Block and Markdown projection into model text. Projected bytes feed cursor identity: keep them stable. */

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

/** Resolve an image reference to one artifact: a unique exact suffix, else a unique basename. */
function matchImageArtifact(rawPath: unknown, imageArtifacts: readonly ArtifactView[]): { reference: string; artifact?: ArtifactView } {
  const reference = String(rawPath).replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '')
  const exact = imageArtifacts.filter(a => {
    const candidate = a.path.replaceAll('\\', '/')
    return candidate === reference || candidate.endsWith('/' + reference)
  })
  const base = basename(reference).toLowerCase()
  const byBase = imageArtifacts.filter(a => basename(a.path).toLowerCase() === base)
  const artifact = exact.length === 1 ? exact[0] : (exact.length === 0 && byBase.length === 1 ? byBase[0] : undefined)
  return { reference, ...(artifact === undefined ? {} : { artifact }) }
}

/** Render already-selected blocks in order, recording each block's text range and image candidates. */
export function extractBlocksMarkdown(
  contentList: readonly ContentListBlock[],
  imageArtifacts: readonly ArtifactView[],
): { text: string; orderedImages: ImageCandidateView[]; ranges: ProjectedBlockRange[] } {
  const orderedImages: ImageCandidateView[] = []
  const renderedBlocks: string[] = []
  const ranges: ProjectedBlockRange[] = []
  let renderedLength = 0
  const append = (text: string): void => { renderedLength += text.length + (renderedBlocks.length ? 2 : 0); renderedBlocks.push(text) }

  for (const block of contentList) {
    const pageNum = typeof block.page_idx === 'number' && Number.isSafeInteger(block.page_idx) && block.page_idx >= 0 ? block.page_idx + 1 : undefined
    const cat = getBlockCategory(block.type)

    const rangeStart = renderedLength + (renderedBlocks.length ? 2 : 0)
    if (block.block_id !== undefined) append(`[${block.block_id}${pageNum === undefined ? '' : ' · Page ' + pageNum}${block.document_label ? ' · ' + block.document_label : ''}]`)

    const locatorEnd = renderedLength
    if (cat === 'image') {
      const rawPath = block.img_path ?? block.image_path ?? block.path
      const matched = rawPath === undefined ? undefined : matchImageArtifact(rawPath, imageArtifacts).artifact

      const caption = formatCaption(block.image_caption ?? block.caption)
      let imgName = 'image'
      let imgBytes = 0
      let imgPath = ''
      let mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | undefined

      if (matched) {
        imgPath = matched.path
        imgBytes = matched.bytes
        imgName = basename(matched.path)
        mediaType = mediaTypeForExtension(extname(matched.path))
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

/** Markdown-only results: replace image links with numbered figure lines. */
export function fallbackExtractFromMarkdown(
  fullMarkdownText: string,
  imageArtifacts: readonly ArtifactView[],
): { text: string; orderedImages: ImageCandidateView[] } {
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
    const { reference, artifact: matchedArtifact } = matchImageArtifact(item.url, imageArtifacts)
    const imgPath = matchedArtifact?.path
    const imgName = matchedArtifact === undefined ? basename(reference) || 'image' : basename(matchedArtifact.path)
    const mediaType = matchedArtifact === undefined ? undefined : mediaTypeForExtension(extname(matchedArtifact.path))
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
  return { text: annotatedText, orderedImages }
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
