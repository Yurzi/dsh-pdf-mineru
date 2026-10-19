import { stat } from 'node:fs/promises'
import { basename, extname, isAbsolute } from 'node:path'
import { computeFileSha256 } from '../utils/crypto.js'
import { createFileId } from '../domain/ids.js'
import { MinerUError, failure } from '../domain/errors.js'
import {
  ARTIFACT_KINDS,
  CANONICAL_PARSE_REQUEST_SCHEMA_VERSION,
  type CanonicalParseRequest,
  type ParseDefaults,
  type PreparedSourceFile,
} from '../domain/request.js'

const SUPPORTED_EXTENSIONS = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.jp2', '.webp', '.gif', '.bmp', '.tif', '.tiff',
  '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
])

/** Stat, bound and stream-hash one absolute local source; the path stays ephemeral. */
export async function prepareSource(path: string, maxFileBytes: number, signal: AbortSignal): Promise<PreparedSourceFile> {
  signal.throwIfAborted()
  if (!isAbsolute(path)) throw new TypeError('Source path must be absolute')
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
  if (before.size > maxFileBytes) {
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

/** Re-stat hashed sources immediately before upload. */
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

/** Canonical single-file request; semantics come only from the effective parse defaults. */
export function canonicalParseRequest(defaults: ParseDefaults, source: PreparedSourceFile): CanonicalParseRequest {
  const { model, parseMethod, language, formula, table } = defaults
  return {
    schemaVersion: CANONICAL_PARSE_REQUEST_SCHEMA_VERSION,
    files: [{ fileId: source.fileId, name: source.name, bytes: source.bytes, sha256: source.sha256 }],
    semantics: { model, ocr: parseMethod === 'ocr', parseMethod, language, formula, table },
    requiredArtifacts: ARTIFACT_KINDS,
  }
}
