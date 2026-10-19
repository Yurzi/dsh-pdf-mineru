import { extname } from 'node:path'
import { BoundedReadError, readFileBounded } from '../utils/bounded-read.js'
import { fitToBudget } from './read-delivery.js'
import { MAX_INLINE_IMAGE_SINGLE_BYTES, MAX_INLINE_IMAGE_TOTAL_BYTES, mediaTypeForExtension, type SupportedImageMediaType } from './image-policy.js'
import type { ImageCandidateView, InlinedImageView, ResultView } from './views.js'

/** The host attachment a saved image became. */
export interface SavedImage {
  readonly attachmentId: string
  readonly mediaType: string
  readonly bytes: number
  readonly name?: string
  readonly width?: number
  readonly height?: number
}

/** Port to the host attachment store; the reader never knows how images are delivered. */
export type ImageSink = (image: { readonly data: Uint8Array; readonly mediaType: SupportedImageMediaType; readonly name: string }) => Promise<SavedImage>

interface ImageCandidate {
  readonly path: string
  readonly name: string
  readonly mediaType: SupportedImageMediaType
  readonly index: number
}

/**
 * Attach the chunk's image candidates through the sink, charging actual bytes read
 * (including failed partial reads) against the per-response budget.
 */
export async function inlineImages(
  view: ResultView,
  sink: ImageSink,
  maxInlineImages: number,
  signal: AbortSignal,
): Promise<ResultView> {
  const declared = view.ordered_images ?? []
  if (declared.length === 0) return view
  const statuses: ImageCandidateView[] = declared.map(img => ({ ...img }))
  const candidates: ImageCandidate[] = []
  for (let index = 0; index < declared.length; index++) {
    const item = declared[index]!
    const mediaType = mediaTypeForExtension(extname(item.name))
    if (index >= maxInlineImages || mediaType === undefined || item.path === '') {
      statuses[index] = { ...statuses[index]!, status: index >= maxInlineImages ? 'omitted' : 'unsupported' }
      continue
    }
    if (item.bytes > MAX_INLINE_IMAGE_SINGLE_BYTES) {
      statuses[index] = { ...statuses[index]!, status: 'omitted' }
      continue
    }
    candidates.push({ path: item.path, name: item.name, mediaType, index })
  }

  const inlined: InlinedImageView[] = []
  let actualTotalBytes = 0
  let emittedTotalBytes = 0
  for (const item of candidates) {
    signal.throwIfAborted()
    const status = (next: NonNullable<ImageCandidateView['status']>): void => { statuses[item.index] = { ...statuses[item.index]!, status: next } }
    const remaining = MAX_INLINE_IMAGE_TOTAL_BYTES - actualTotalBytes
    let data: Buffer
    try {
      // An exhausted budget rejects every file, including an empty one.
      data = await readFileBounded(item.path, { maxBytes: remaining > 0 ? Math.min(MAX_INLINE_IMAGE_SINGLE_BYTES, remaining) : -1 }, signal)
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof BoundedReadError) actualTotalBytes += error.bytesRead
      status(error instanceof BoundedReadError && (error.reason === 'not-file' || error.reason === 'too-large') ? 'omitted' : 'failed')
      continue
    }
    actualTotalBytes += data.byteLength
    let ref: SavedImage
    try {
      ref = await sink({ data, mediaType: item.mediaType, name: item.name })
    } catch {
      signal.throwIfAborted()
      status('failed')
      continue
    }
    signal.throwIfAborted()
    const emittedBytes = ref.bytes
    if (!Number.isSafeInteger(emittedBytes) || emittedBytes < 0 || emittedBytes > MAX_INLINE_IMAGE_SINGLE_BYTES || emittedTotalBytes + emittedBytes > MAX_INLINE_IMAGE_TOTAL_BYTES) {
      status('omitted')
      continue
    }
    emittedTotalBytes += emittedBytes
    status('available')
    const candidate = statuses[item.index]!
    inlined.push({
      attachment_id: String(ref.attachmentId), name: ref.name ?? item.name, media_type: ref.mediaType, figure: item.index + 1,
      ...(candidate.block_id ? { block_id: candidate.block_id } : {}),
      ...(candidate.document_label ? { document_label: candidate.document_label } : {}),
      ...(candidate.page === undefined ? {} : { page: candidate.page }),
      ...(ref.width !== undefined ? { width: ref.width } : {}),
      ...(ref.height !== undefined ? { height: ref.height } : {}),
      ...(ref.bytes !== undefined ? { bytes: ref.bytes } : {}),
    })
  }
  return { ...view, ordered_images: statuses, ...(inlined.length > 0 ? { inlined_images: inlined } : {}) }
}

/** Chunk visual accounting; listed-but-unattached images point the model at block IDs or page view. */
function withVisualAccounting(view: ResultView): ResultView {
  const listed = view.ordered_images?.length ?? 0
  if (listed === 0) return view
  const attached = view.inlined_images?.length ?? 0
  return {
    ...view, visuals: { listed, attached, omitted: listed - attached, scope: 'chunk' },
    ...(listed > attached ? { warnings: [...(view.warnings ?? []), '[VISUALS_NOT_ATTACHED] Some listed images were not attached; use block_id or original page view to inspect them.'] } : {}),
  }
}
/**
 * Final content response: attach images only when the caller asked for them and the
 * route can show them (a sink exists), account visuals, then fit the response budget.
 */
export async function finishContentChunk(
  chunk: ResultView,
  images: ImageSink | undefined,
  inlineIntent: boolean,
  maxInlineImages: number,
  signal: AbortSignal,
): Promise<ResultView> {
  const attached = images !== undefined && inlineIntent ? await inlineImages(chunk, images, maxInlineImages, signal) : chunk
  return fitToBudget(withVisualAccounting(attached))
}
