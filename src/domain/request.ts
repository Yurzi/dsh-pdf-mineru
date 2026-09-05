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

export const FOCUS_KINDS = ['all', 'text', 'table', 'image'] as const
export type FocusKind = typeof FOCUS_KINDS[number]

export type PageSelection = number | string | readonly (number | string)[]

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
  readonly file_path?: string
  readonly model?: MinerUModel
  readonly ocr?: boolean
  readonly language?: string
  readonly formula?: boolean
  readonly table?: boolean
  readonly pages?: PageSelection
  readonly focus?: FocusKind | readonly FocusKind[]
  readonly artifacts?: readonly ArtifactKind[]
  readonly inline_images?: boolean
  readonly poll_timeout_ms?: number
}

export interface ParseDefaults {
  readonly model: MinerUModel
  readonly ocr: boolean
  readonly parseMethod: ParseMethod
  readonly language: string
  readonly formula: boolean
  readonly table: boolean
}

interface PageInterval { start: number; end: number }

function parsePageRangeTokens(input: string): PageInterval[] {
  const intervals: PageInterval[] = []
  for (const token of input.split(',')) {
    const trimmed = token.trim()
    if (trimmed === '') continue
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
  return intervals
}

export function normalizePageRanges(input: string): string {
  const intervals = parsePageRangeTokens(input)
  intervals.sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: PageInterval[] = []
  for (const current of intervals) {
    const previous = merged.at(-1)
    if (previous !== undefined && current.start <= previous.end + 1) previous.end = Math.max(previous.end, current.end)
    else merged.push({ ...current })
  }
  return merged.map(({ start, end }) => start === end ? String(start) : `${String(start)}-${String(end)}`).join(',')
}

export function normalizePageSelection(input: unknown): Set<number> | undefined {
  if (input === undefined || input === null) return undefined
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input) || input < 1 || input > 99999) {
      throw new TypeError(`Invalid page number: ${String(input)}`)
    }
    return new Set([input])
  }
  if (Array.isArray(input)) {
    if (input.length === 0) throw new TypeError('Page selection cannot be empty')
    const set = new Set<number>()
    for (const item of input) {
      if (typeof item === 'number') {
        if (!Number.isSafeInteger(item) || item < 1 || item > 99999) {
          throw new TypeError(`Invalid page number: ${String(item)}`)
        }
        set.add(item)
      } else if (typeof item === 'string') {
        const intervals = parsePageRangeTokens(item)
        for (const { start, end } of intervals) {
          for (let p = start; p <= end; p++) set.add(p)
        }
      } else {
        throw new TypeError(`Invalid page selection item: ${String(item)}`)
      }
    }
    return set
  }
  if (typeof input === 'string') {
    if (input.trim() === '') throw new TypeError('Page range cannot be empty')
    const intervals = parsePageRangeTokens(input)
    const set = new Set<number>()
    for (const { start, end } of intervals) {
      for (let p = start; p <= end; p++) set.add(p)
    }
    return set
  }
  throw new TypeError(`Invalid page selection: ${String(input)}`)
}

export function normalizeFocusSelection(input: unknown): Set<FocusKind> {
  if (input === undefined || input === null) return new Set(['all'])
  if (typeof input === 'string') {
    const trimmed = input.trim().toLowerCase() as FocusKind
    if (!FOCUS_KINDS.includes(trimmed)) throw new TypeError(`Invalid focus option: ${String(input)}`)
    return new Set([trimmed])
  }
  if (Array.isArray(input)) {
    if (input.length === 0) return new Set(['all'])
    const set = new Set<FocusKind>()
    for (const item of input) {
      if (typeof item !== 'string') throw new TypeError(`Invalid focus option: ${String(item)}`)
      const trimmed = item.trim().toLowerCase() as FocusKind
      if (!FOCUS_KINDS.includes(trimmed)) throw new TypeError(`Invalid focus option: ${String(item)}`)
      set.add(trimmed)
    }
    return set
  }
  throw new TypeError(`Invalid focus option: ${String(input)}`)
}

export function normalizeArtifactKinds(kinds: readonly ArtifactKind[]): readonly ArtifactKind[] {
  const requested = new Set<ArtifactKind>(['markdown', ...kinds])
  return ARTIFACT_KINDS.filter(kind => requested.has(kind))
}
