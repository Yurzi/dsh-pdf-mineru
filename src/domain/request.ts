import type { MinerUFileId } from './ids.js'

export const CANONICAL_PARSE_REQUEST_SCHEMA_VERSION = 1 as const
export const CACHE_KEY_SPEC_VERSION = 1 as const
export const RESULT_SCHEMA_VERSION = 1 as const

export const ARTIFACT_KINDS = [
  'markdown',
  'layout',
  'model-output',
  'content-list',
  'images',
] as const

export type ArtifactKind = typeof ARTIFACT_KINDS[number]
export type MinerUModel = 'pipeline' | 'vlm'
export type ParseMethod = 'auto' | 'txt' | 'ocr'

export interface ParseSemantics {
  readonly model: MinerUModel
  readonly ocr: boolean
  /** Preserves the self-hosted legacy txt/auto distinction in the cache key. */
  readonly parseMethod: ParseMethod
  readonly language: string
  readonly formula: boolean
  readonly table: boolean
  readonly pages?: string
}

export interface CanonicalSourceFile {
  readonly fileId: MinerUFileId
  readonly name: string
  readonly bytes: number
  readonly sha256: string
}

export interface CanonicalParseRequest {
  readonly schemaVersion: typeof CANONICAL_PARSE_REQUEST_SCHEMA_VERSION
  readonly files: readonly CanonicalSourceFile[]
  readonly semantics: ParseSemantics
  readonly requiredArtifacts: readonly ArtifactKind[]
}

export interface PreparedSourceFile extends CanonicalSourceFile {
  /** Ephemeral execution input. This field is never persisted. */
  readonly path: string
  readonly fingerprint: {
    readonly size: number
    readonly mtimeMs: number
    readonly device: number
    readonly inode: number
  }
}

export interface PreparedParseRequest {
  readonly request: CanonicalParseRequest
  readonly sources: readonly PreparedSourceFile[]
}

export interface ParseRequestInput {
  readonly file_paths?: readonly string[]
  /** Compatibility alias through the next major release. */
  readonly file_path?: string
  readonly model?: MinerUModel
  readonly ocr?: boolean
  readonly language?: string
  readonly formula?: boolean
  readonly table?: boolean
  readonly pages?: string
  readonly artifacts?: readonly ArtifactKind[]
  readonly backend?: string
  readonly parse_method?: ParseMethod
  readonly lang_list?: readonly string[]
  readonly formula_enable?: boolean
  readonly table_enable?: boolean
  readonly return_middle_json?: boolean
  readonly return_model_output?: boolean
  readonly return_content_list?: boolean
  readonly return_images?: boolean
  readonly start_page_id?: number
  readonly end_page_id?: number
}

export interface ParseDefaults {
  readonly model: MinerUModel
  readonly ocr: boolean
  readonly parseMethod: ParseMethod
  readonly language: string
  readonly formula: boolean
  readonly table: boolean
  readonly artifacts: readonly ArtifactKind[]
}

export function normalizeArtifactKinds(kinds: readonly ArtifactKind[]): readonly ArtifactKind[] {
  const requested = new Set<ArtifactKind>(['markdown', ...kinds])
  return ARTIFACT_KINDS.filter(kind => requested.has(kind))
}
