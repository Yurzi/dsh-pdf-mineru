import type { MinerUProviderId } from '../domain/ids.js'

/** Wire shapes of read_pdf/async_parse_pdf results and the content-list blocks they are projected from. */

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
  readonly page_count_source?: 'layout' | 'content-list-lower-bound' | 'pdfinfo' | 'pdfjs'
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
  readonly figure?: number
}

/** Parsing identity is distinct from the current reader/projection implementation. */
export interface ReadProvenance {
  readonly provider: MinerUProviderId
  /** Null when the protocol selects a server tier rather than a pipeline/vlm model. */
  readonly model: 'pipeline' | 'vlm' | null
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
  /** Present only for local original-page rendering. */
  readonly renderer?: 'poppler' | 'pdfjs'
  readonly continuation_block?: { readonly block_id: string; readonly page?: number; readonly document_label?: string }
  readonly visuals?: { readonly listed: number; readonly attached: number; readonly omitted: number; readonly scope: 'chunk' }
}

/** Parse completion metadata, independent of body output and its character budget. */
export type ParseSummaryView = Pick<ResultView,
  'state' | 'source' | 'cache_hit' | 'result_id' | 'files' | 'content_status' | 'manifest_path' | 'summary' | 'toc' | 'warnings'>

/** One provider content-list block as stored in a published result. */
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

/** Offsets of one block inside projected text: [start, locator_end) is its generated locator. */
export interface ProjectedBlockRange {
  readonly block_id: string
  readonly page?: number
  readonly document_label?: string
  readonly start: number
  readonly locator_end: number
  readonly end: number
}
