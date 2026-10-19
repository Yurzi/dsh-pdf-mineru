import { MinerUError, failure } from '../domain/errors.js'
import type { ArtifactRef } from '../domain/result.js'
import type { PublishedResult } from '../service/parse-service.js'
import type { ResultRepository } from '../storage/result-repository.js'
import { BoundedReadError, readFileBounded } from '../utils/bounded-read.js'
import type { ArtifactView, ContentListBlock } from './views.js'

/** Absolute artifact locations of one published document, resolved only through the repository. */
export interface PublishedDocument {
  readonly result: PublishedResult
  readonly fileId: string
  readonly manifestPath: string
  readonly markdown: ArtifactView
  /** Every non-Markdown artifact in manifest order. */
  readonly artifacts: readonly ArtifactView[]
}

export const MAX_CONTENT_LIST_BYTES = 64 * 1024 * 1024
const MAX_MARKDOWN_READ_BYTES = 64 * 1024 * 1024

export function openPublishedDocument(
  result: PublishedResult,
  results: Pick<ResultRepository, 'resolveArtifactAbsolutePath' | 'manifestAbsolutePath'>,
): PublishedDocument {
  const document = result.manifest.files[0]
  const view = (artifact: ArtifactRef): ArtifactView => ({
    kind: artifact.kind, path: results.resolveArtifactAbsolutePath(result.cacheKey, artifact.relativePath), bytes: artifact.bytes,
  })
  const markdown = document.artifacts.find(artifact => artifact.kind === 'markdown')
  if (markdown === undefined) {
    throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'Extracted markdown artifact is missing from result'))
  }
  return {
    result,
    fileId: document.fileId,
    manifestPath: results.manifestAbsolutePath(result.cacheKey),
    markdown: view(markdown),
    artifacts: document.artifacts.filter(artifact => artifact.kind !== 'markdown').map(view),
  }
}

function contentListTooLarge(): MinerUError {
  return new MinerUError(failure('RESULT_TOO_LARGE', 'content-list artifact exceeds the bounded reader limit'))
}

/** Read only a manifest-declared JSON artifact, at its declared size. */
async function loadJsonArtifact(artifact: ArtifactView, maxBytes: number, signal: AbortSignal): Promise<unknown> {
  let data: Buffer
  try {
    data = await readFileBounded(artifact.path, { maxBytes, expectedBytes: artifact.bytes }, signal)
  } catch (error) {
    if (error instanceof BoundedReadError && error.reason === 'too-large') throw contentListTooLarge()
    throw error
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data))
}

export async function loadContentList(artifact: ArtifactView, maxBytes: number, signal: AbortSignal): Promise<ContentListBlock[]> {
  const parsed = await loadJsonArtifact(artifact, maxBytes, signal)
  const container = typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  const candidate = Array.isArray(parsed) ? parsed : container?.list ?? container?.content_list
  if (!Array.isArray(candidate)) throw new TypeError('content-list must be an array or contain list/content_list')
  for (const block of candidate) {
    if (typeof block !== 'object' || block === null || Array.isArray(block)) throw new TypeError('content-list contains a malformed block')
    if (block.page_idx !== undefined && (!Number.isSafeInteger(block.page_idx) || block.page_idx < 0)) throw new TypeError('content-list contains an invalid page_idx')
    if (block.type !== undefined && typeof block.type !== 'string') throw new TypeError('content-list contains an invalid type')
  }
  return candidate as ContentListBlock[]
}

/** A complete contiguous MinerU pdf_info page list is stronger than the last text block's index. */
export async function loadLayoutPageCount(artifact: ArtifactView | undefined, signal: AbortSignal): Promise<number | undefined> {
  if (!artifact || artifact.bytes > MAX_CONTENT_LIST_BYTES) return undefined
  const parsed = await loadJsonArtifact(artifact, MAX_CONTENT_LIST_BYTES, signal)
  const pages = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>).pdf_info : undefined
  if (!Array.isArray(pages) || pages.length === 0 || pages.length > 99999) return undefined
  if (!pages.every((page, index) => typeof page === 'object' && page !== null && !Array.isArray(page) && page.page_idx === index)) return undefined
  return pages.length
}

function markdownChanged(stage: string): MinerUError {
  return new MinerUError(failure('RESULT_DOWNLOAD_FAILED', 'Markdown artifact changed ' + stage))
}

export async function loadMarkdown(artifact: ArtifactView, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  if (artifact.bytes > MAX_MARKDOWN_READ_BYTES) {
    throw new MinerUError(failure('RESULT_TOO_LARGE', 'Markdown artifact exceeds the bounded reader limit'))
  }
  if (artifact.bytes === 0) return ''
  let data: Buffer
  try {
    data = await readFileBounded(artifact.path, { maxBytes: MAX_MARKDOWN_READ_BYTES, expectedBytes: artifact.bytes }, signal)
  } catch (error) {
    if (!(error instanceof BoundedReadError)) throw error
    if (error.reason === 'io') throw error.cause
    throw markdownChanged(error.reason === 'short-read' ? 'while it was being read' : error.reason === 'changed' ? 'during reading' : 'before reading')
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(data)
}
