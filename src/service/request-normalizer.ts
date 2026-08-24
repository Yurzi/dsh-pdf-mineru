import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import { createFileId } from '../domain/ids.js'
import { MinerUError, failure } from '../domain/errors.js'
import {
  ARTIFACT_KINDS,
  CANONICAL_PARSE_REQUEST_SCHEMA_VERSION,
  normalizeArtifactKinds,
  type ArtifactKind,
  type MinerUModel,
  type ParseDefaults,
  type ParseMethod,
  type ParseRequestInput,
  type PreparedParseRequest,
  type PreparedSourceFile,
} from '../domain/request.js'

const SUPPORTED_EXTENSIONS = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.jp2', '.webp', '.gif', '.bmp', '.tif', '.tiff',
  '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
])

export interface RequestNormalizerOptions {
  readonly defaults: ParseDefaults
  readonly cwd?: string
  readonly maxFiles?: number
  readonly maxFileBytes?: number
  /** Explicit reverse mapping used only by the legacy backend alias. */
  readonly legacyBackendModels?: Readonly<Record<string, MinerUModel>>
}

interface PageInterval { start: number; end: number }

export function normalizePages(input: string): string {
  const intervals: PageInterval[] = []
  for (const token of input.split(',')) {
    const trimmed = token.trim()
    const match = /^(\d+)(?:-(\d+))?$/.exec(trimmed)
    if (match === null) throw new MinerUError(failure('INVALID_REQUEST', `Invalid page range token: ${trimmed}`))
    const start = Number(match[1])
    const end = match[2] === undefined ? start : Number(match[2])
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > 99999) {
      throw new MinerUError(failure('INVALID_REQUEST', `Invalid page range token: ${trimmed}`))
    }
    intervals.push({ start, end })
  }
  if (intervals.length === 0) throw new MinerUError(failure('INVALID_REQUEST', 'Page range cannot be empty'))
  intervals.sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: PageInterval[] = []
  for (const current of intervals) {
    const previous = merged.at(-1)
    if (previous !== undefined && current.start <= previous.end + 1) previous.end = Math.max(previous.end, current.end)
    else merged.push({ ...current })
  }
  return merged.map(({ start, end }) => start === end ? String(start) : `${String(start)}-${String(end)}`).join(',')
}

function compatibleValue<T>(modern: T | undefined, legacy: T | undefined, label: string): T | undefined {
  if (modern !== undefined && legacy !== undefined && modern !== legacy) {
    throw new MinerUError(failure('INVALID_REQUEST', `Conflicting ${label} and legacy alias`))
  }
  return modern ?? legacy
}

function resolvePaths(input: ParseRequestInput, maxFiles: number): readonly string[] {
  if (input.file_path !== undefined && input.file_paths !== undefined) {
    throw new MinerUError(failure('INVALID_REQUEST', 'Use file_paths or legacy file_path, not both'))
  }
  const paths = input.file_paths ?? (input.file_path === undefined ? [] : [input.file_path])
  if (paths.length === 0) throw new MinerUError(failure('INVALID_REQUEST', 'Exactly one local document path is required'))
  if (paths.length > maxFiles) throw new MinerUError(failure('INVALID_REQUEST', `At most ${String(maxFiles)} file(s) may be submitted`))
  if (paths.some(path => typeof path !== 'string' || path.trim() === '')) {
    throw new MinerUError(failure('INVALID_REQUEST', 'File paths must be non-empty strings'))
  }
  return paths
}

function resolveLegacyPages(input: ParseRequestInput): string | undefined {
  if (input.pages !== undefined && (input.start_page_id !== undefined || input.end_page_id !== undefined)) {
    throw new MinerUError(failure('INVALID_REQUEST', 'Use pages or legacy page indexes, not both'))
  }
  if (input.pages !== undefined) return normalizePages(input.pages)
  if (input.start_page_id === undefined && input.end_page_id === undefined) return undefined
  const start = input.start_page_id ?? 0
  const end = input.end_page_id ?? 99999
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
    throw new MinerUError(failure('INVALID_REQUEST', 'Legacy page indexes must be non-negative and ordered'))
  }
  if (start === 0 && end === 99999) return undefined
  return normalizePages(`${String(start + 1)}-${String(end + 1)}`)
}

function resolveArtifacts(input: ParseRequestInput, defaults: ParseDefaults): readonly ArtifactKind[] {
  const artifacts = [...(input.artifacts ?? defaults.artifacts)]
  if (input.return_middle_json) artifacts.push('layout')
  if (input.return_model_output) artifacts.push('model-output')
  if (input.return_content_list) artifacts.push('content-list')
  if (input.return_images) artifacts.push('images')
  for (const artifact of artifacts) {
    if (!(ARTIFACT_KINDS as readonly string[]).includes(artifact)) {
      throw new MinerUError(failure('INVALID_REQUEST', `Unknown artifact kind: ${String(artifact)}`))
    }
  }
  return normalizeArtifactKinds(artifacts)
}

async function hashFile(path: string, signal: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(path)
  const onAbort = (): void => { stream.destroy(new DOMException('Aborted', 'AbortError')) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    signal.throwIfAborted()
    for await (const chunk of stream) {
      signal.throwIfAborted()
      hash.update(chunk as Buffer)
    }
    return hash.digest('hex')
  } finally {
    signal.removeEventListener('abort', onAbort)
    stream.destroy()
  }
}

async function prepareSource(
  rawPath: string,
  index: number,
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
  const sha256 = await hashFile(path, signal)
  const after = await stat(path)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.dev !== after.dev || before.ino !== after.ino) {
    throw new MinerUError(failure('INVALID_REQUEST', `${basename(path)} changed while it was being hashed`, true))
  }
  return {
    fileId: createFileId(sha256, index),
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
    const current = await stat(source.path)
    const expected = source.fingerprint
    if (current.size !== expected.size || current.mtimeMs !== expected.mtimeMs || current.dev !== expected.device || current.ino !== expected.inode) {
      throw new MinerUError(failure('INVALID_REQUEST', `${source.name} changed after hashing and before upload`, true))
    }
  }
}

export class RequestNormalizer {
  constructor(private readonly options: RequestNormalizerOptions) {}

  async normalize(input: ParseRequestInput, signal: AbortSignal): Promise<PreparedParseRequest> {
    signal.throwIfAborted()
    const paths = resolvePaths(input, this.options.maxFiles ?? 1)
    const legacyLanguage = input.lang_list === undefined ? undefined : (() => {
      if (input.lang_list.length !== 1 || input.lang_list[0] === undefined) {
        throw new MinerUError(failure('INVALID_REQUEST', 'Legacy lang_list must contain exactly one language'))
      }
      return input.lang_list[0]
    })()
    const language = compatibleValue(input.language, legacyLanguage, 'language') ?? this.options.defaults.language
    if (language.trim() === '') throw new MinerUError(failure('INVALID_REQUEST', 'Language cannot be empty'))

    const legacyModel = input.backend === undefined ? undefined : this.options.legacyBackendModels?.[input.backend]
    if (input.backend !== undefined && legacyModel === undefined) {
      throw new MinerUError(failure('UNSUPPORTED_OPTION', `Legacy backend is not mapped: ${input.backend}`))
    }
    const model = compatibleValue(input.model, legacyModel, 'model') ?? this.options.defaults.model
    const parseMethod: ParseMethod = input.parse_method
      ?? (input.ocr === undefined ? this.options.defaults.parseMethod : input.ocr ? 'ocr' : 'auto')
    const ocr = parseMethod === 'ocr'
    if (input.ocr !== undefined && input.ocr !== ocr) {
      throw new MinerUError(failure('INVALID_REQUEST', 'Conflicting ocr and legacy parse_method'))
    }
    const formula = compatibleValue(input.formula, input.formula_enable, 'formula') ?? this.options.defaults.formula
    const table = compatibleValue(input.table, input.table_enable, 'table') ?? this.options.defaults.table
    const pages = resolveLegacyPages(input)
    const sources = await Promise.all(paths.map((path, index) => prepareSource(
      path, index, this.options.cwd, this.options.maxFileBytes, signal,
    )))
    return {
      sources,
      request: {
        schemaVersion: CANONICAL_PARSE_REQUEST_SCHEMA_VERSION,
        files: sources.map(({ fileId, name, bytes, sha256 }) => ({ fileId, name, bytes, sha256 })),
        semantics: { model, ocr, parseMethod, language, formula, table, ...(pages === undefined ? {} : { pages }) },
        requiredArtifacts: resolveArtifacts(input, this.options.defaults),
      },
    }
  }
}
