import { stat } from 'node:fs/promises'
import { computeFileSha256 } from '../utils/crypto.js'
import { basename, extname, resolve } from 'node:path'
import { createFileId } from '../domain/ids.js'
import { MinerUError, failure } from '../domain/errors.js'
import {
  ARTIFACT_KINDS,
  CANONICAL_PARSE_REQUEST_SCHEMA_VERSION,
  normalizeArtifactKinds,
  normalizePageRanges,
  normalizePageSelection,
  type ArtifactKind,
  type ParseDefaults,
  type ParseMethod,
  type ParseRequestInput,
  type PreparedParseRequest,
  type PreparedSourceFile,
} from '../domain/request.js'

const REQUEST_FIELDS = new Set([
  'file_path', 'file_paths', 'pages', 'focus', 'model', 'ocr', 'language', 'formula', 'table', 'artifacts',
  'inline_images', 'poll_timeout_ms',
])

const SUPPORTED_EXTENSIONS = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.jp2', '.webp', '.gif', '.bmp', '.tif', '.tiff',
  '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
])

export interface RequestNormalizerOptions {
  readonly defaults: ParseDefaults
  readonly cwd?: string
  readonly maxFiles?: number
  readonly maxFileBytes?: number
}

export function normalizePages(input: unknown): string {
  try {
    if (typeof input === 'string') {
      return normalizePageRanges(input)
    }
    if (typeof input === 'number') {
      if (!Number.isSafeInteger(input) || input < 1 || input > 99999) throw new TypeError(`Invalid page number: ${String(input)}`)
      return String(input)
    }
    if (Array.isArray(input)) {
      const selected = normalizePageSelection(input)
      if (!selected || selected.size === 0) throw new TypeError('Page selection cannot be empty')
      const sorted = [...selected].sort((a, b) => a - b)
      const ranges: string[] = []
      let start = sorted[0]!
      let end = start
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] === end + 1) {
          end = sorted[i]!
        } else {
          ranges.push(start === end ? String(start) : `${String(start)}-${String(end)}`)
          start = sorted[i]!
          end = start
        }
      }
      ranges.push(start === end ? String(start) : `${String(start)}-${String(end)}`)
      return ranges.join(',')
    }
    throw new TypeError('Invalid page selection')
  } catch (error) {
    throw new MinerUError(failure(
      'INVALID_REQUEST',
      error instanceof Error ? error.message : 'Invalid page range',
    ), { cause: error })
  }
}

function resolvePaths(input: ParseRequestInput, maxFiles: number): readonly string[] {
  const paths: string[] = []
  if (typeof input.file_path === 'string' && input.file_path.trim() !== '') {
    paths.push(input.file_path.trim())
  }
  if (Array.isArray(input.file_paths)) {
    for (const path of input.file_paths) {
      if (typeof path === 'string' && path.trim() !== '' && !paths.includes(path.trim())) {
        paths.push(path.trim())
      }
    }
  }
  if (paths.length === 0) throw new MinerUError(failure('INVALID_REQUEST', 'Exactly one local document path is required'))
  if (paths.length > maxFiles) throw new MinerUError(failure('INVALID_REQUEST', `At most ${String(maxFiles)} file(s) may be submitted`))
  return paths
}

function resolveArtifacts(input: ParseRequestInput): readonly ArtifactKind[] {
  if (input.artifacts !== undefined) {
    for (const artifact of input.artifacts) {
      if (!(ARTIFACT_KINDS as readonly string[]).includes(artifact)) {
        throw new MinerUError(failure('INVALID_REQUEST', `Unknown artifact kind: ${String(artifact)}`))
      }
    }
    return normalizeArtifactKinds(input.artifacts)
  }
  return ARTIFACT_KINDS
}

async function prepareSource(
  rawPath: string,
  cwd: string | undefined,
  maxFileBytes: number | undefined,
  signal: AbortSignal,
): Promise<PreparedSourceFile> {
  const path = resolve(cwd ?? process.cwd(), rawPath)
  let before
  try {
    before = await stat(path)
  } catch (error) {
    throw new MinerUError(failure('FILE_NOT_FOUND', `Document does not exist: ${basename(path)}`), { cause: error })
  }
  if (!before.isFile()) throw new MinerUError(failure('INVALID_REQUEST', `${basename(path)} is not a regular file`))
  if (!SUPPORTED_EXTENSIONS.has(extname(path).toLowerCase())) {
    throw new MinerUError(failure('UNSUPPORTED_OPTION', `Unsupported document type: ${extname(path) || '(none)'}`))
  }
  if (maxFileBytes !== undefined && before.size > maxFileBytes) {
    throw new MinerUError(failure('FILE_TOO_LARGE', `${basename(path)} exceeds the configured file-size limit`))
  }
  const sha256 = await computeFileSha256(path, signal)
  const after = await stat(path)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.dev !== after.dev || before.ino !== after.ino) {
    throw new MinerUError(failure('INVALID_REQUEST', `${basename(path)} changed while it was being hashed`, true))
  }
  return {
    fileId: createFileId(sha256),
    name: basename(path),
    bytes: after.size,
    sha256,
    path,
    fingerprint: { size: after.size, mtimeMs: after.mtimeMs, device: after.dev, inode: after.ino },
  }
}

export async function assertSourcesUnchanged(sources: readonly PreparedSourceFile[], signal: AbortSignal): Promise<void> {
  for (const source of sources) {
    signal.throwIfAborted()
    let current
    try {
      current = await stat(source.path)
    } catch (error) {
      throw new MinerUError(failure('FILE_NOT_FOUND', `${source.name} disappeared after hashing and before upload`), { cause: error })
    }
    const expected = source.fingerprint
    if (!current.isFile() || current.size !== expected.size || current.mtimeMs !== expected.mtimeMs || current.dev !== expected.device || current.ino !== expected.inode) {
      throw new MinerUError(failure('INVALID_REQUEST', `${source.name} changed after hashing and before upload`, true))
    }
  }
}

export class RequestNormalizer {
  constructor(private readonly options: RequestNormalizerOptions) {}

  async normalize(input: ParseRequestInput, signal: AbortSignal): Promise<PreparedParseRequest> {
    signal.throwIfAborted()
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new MinerUError(failure('INVALID_REQUEST', 'Parse request must be an object'))
    }
    for (const key of Object.keys(input)) {
      if (!REQUEST_FIELDS.has(key)) {
        throw new MinerUError(failure('INVALID_REQUEST', `Parse request contains unsupported property ${key}`))
      }
    }
    const paths = resolvePaths(input, this.options.maxFiles ?? 1)
    const language = input.language ?? this.options.defaults.language
    if (language.trim() === '') throw new MinerUError(failure('INVALID_REQUEST', 'Language cannot be empty'))
    const model = input.model ?? this.options.defaults.model
    const parseMethod: ParseMethod = input.ocr === undefined
      ? this.options.defaults.parseMethod
      : input.ocr ? 'ocr' : 'auto'
    const ocr = parseMethod === 'ocr'
    const formula = input.formula ?? this.options.defaults.formula
    const table = input.table ?? this.options.defaults.table
    const pages = input.pages === undefined ? undefined : normalizePages(input.pages)
    const unhashedSources = await Promise.all(paths.map(path => prepareSource(
      path, this.options.cwd, this.options.maxFileBytes, signal,
    )))
    // File IDs must remain stable when the same source moves within an overlapping
    // batch. The ordinal is therefore per content hash rather than request index.
    const occurrences = new Map<string, number>()
    const sources = unhashedSources.map(source => {
      const occurrence = occurrences.get(source.sha256) ?? 0
      occurrences.set(source.sha256, occurrence + 1)
      return { ...source, fileId: createFileId(source.sha256, occurrence) }
    })
    return {
      sources,
      request: {
        schemaVersion: CANONICAL_PARSE_REQUEST_SCHEMA_VERSION,
        files: sources.map(({ fileId, name, bytes, sha256 }) => ({ fileId, name, bytes, sha256 })),
        semantics: { model, ocr, parseMethod, language, formula, table, ...(pages === undefined ? {} : { pages }) },
        requiredArtifacts: resolveArtifacts(input),
      },
    }
  }
}
