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
  /** Parse method remains explicit because txt and auto have different cache semantics. */
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
  readonly model?: MinerUModel
  readonly ocr?: boolean
  readonly language?: string
  readonly formula?: boolean
  readonly table?: boolean
  readonly pages?: string
  readonly artifacts?: readonly ArtifactKind[]
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

interface PageInterval { start: number; end: number }

export function normalizePageRanges(input: string): string {
  const intervals: PageInterval[] = []
  for (const token of input.split(',')) {
    const trimmed = token.trim()
    const match = /^(\d+)(?:-(\d+))?$/.exec(trimmed)
    if (match === null) throw new TypeError(`Invalid page range token: ${trimmed}`)
    const start = Number(match[1])
    const end = match[2] === undefined ? start : Number(match[2])
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > 99999) {
      throw new TypeError(`Invalid page range token: ${trimmed}`)
    }
    intervals.push({ start, end })
  }
  if (intervals.length === 0) throw new TypeError('Page range cannot be empty')
  intervals.sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: PageInterval[] = []
  for (const current of intervals) {
    const previous = merged.at(-1)
    if (previous !== undefined && current.start <= previous.end + 1) previous.end = Math.max(previous.end, current.end)
    else merged.push({ ...current })
  }
  return merged.map(({ start, end }) => start === end ? String(start) : `${String(start)}-${String(end)}`).join(',')
}

export function normalizeArtifactKinds(kinds: readonly ArtifactKind[]): readonly ArtifactKind[] {
  const requested = new Set<ArtifactKind>(['markdown', ...kinds])
  return ARTIFACT_KINDS.filter(kind => requested.has(kind))
}
