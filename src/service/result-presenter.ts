import { open } from 'node:fs/promises'
import { TextDecoder } from 'node:util'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { MinerUFailure } from '../domain/errors.js'

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
