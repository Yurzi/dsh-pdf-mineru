import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { readFile, rm, stat } from 'node:fs/promises'
import { dirname, extname, join, posix } from 'node:path'
import { Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { TextDecoder } from 'node:util'
import yauzl, { type Entry, type ZipFile } from 'yauzl'
import { MinerUError, failure } from '../domain/errors.js'
import type { MinerUFileId } from '../domain/ids.js'
import type { ArtifactKind } from '../domain/request.js'
import type { ArtifactRef } from '../domain/result.js'
import type { ArtifactSink, ProviderCollectedFile } from './provider.js'
import type { ExtractZipTargetFile, SafeZipLimits } from './official-v4-types.js'

const MAX_JSON_VALIDATION_BYTES = 64 * 1024 * 1024
const IMAGE_MIME: Readonly<Record<string, string>> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.tif': 'image/tiff', '.tiff': 'image/tiff',
}

export interface SafeZipOptions {
  readonly zipPath: string
  readonly sink: ArtifactSink
  readonly files: readonly ExtractZipTargetFile[]
  readonly requiredArtifacts: readonly ArtifactKind[]
  readonly limits: SafeZipLimits
  readonly signal: AbortSignal
}

export interface ZipEntryMetadata {
  readonly fileName: string
  readonly directory: boolean
  readonly compressedBytes: number
  readonly uncompressedBytes: number
}

interface ArtifactClassification {
  readonly kind: ArtifactKind
  readonly relativeName: string
  readonly mediaType: string
  readonly json: boolean
}

interface EntryTarget {
  readonly file: ExtractZipTargetFile
  readonly subpath: string
}

function archiveError(message: string): MinerUError {
  return new MinerUError(failure('RESULT_ARCHIVE_INVALID', message))
}

function assertNotAborted(signal: AbortSignal, action: string): void {
  if (signal.aborted) throw new MinerUError(failure('CANCELLED', `${action} was cancelled`, true))
}

export function validateEntrySecurity(entry: Entry, limits: SafeZipLimits): void {
  if (entry.isEncrypted()) throw archiveError('Encrypted ZIP entries are not supported')
  const mode = (entry.externalFileAttributes >> 16) & 0xffff
  const type = mode & 0o170000
  const directory = entry.fileName.endsWith('/')
  if (type === 0o120000) throw archiveError('Symbolic links inside ZIP archives are prohibited')
  if (type !== 0 && type !== 0o100000 && !(directory && type === 0o040000)) {
    throw archiveError('Non-regular ZIP entries are prohibited')
  }

  const name = entry.fileName
  const raw = entry.fileNameRaw
  if (name.includes('\0') || raw?.includes(0x00)) throw archiveError('Entry path contains NUL byte')
  if (name.includes('\\') || raw?.includes(0x5c)) throw archiveError('Entry path contains backslash separator')
  if (/^[A-Za-z]:/.test(name)) throw archiveError('Entry path contains Windows drive prefix')
  if (name.startsWith('/') || name.startsWith('./') || name.startsWith('../')) {
    throw archiveError('Entry path is absolute or begins with traversal prefix')
  }
  for (const segment of name.split('/')) {
    if (segment === '.' || segment === '..') throw archiveError('Entry path contains traversal segment')
  }

  if (entry.uncompressedSize > limits.maxZipEntryBytes) {
    throw new MinerUError(failure('RESULT_TOO_LARGE', `ZIP entry ${name} exceeds the entry byte limit`))
  }
  if (entry.uncompressedSize > 0 && entry.compressedSize === 0) {
    throw archiveError(`ZIP entry ${name} has an invalid zero compressed size`)
  }
  if (entry.uncompressedSize > 64 * 1024
    && entry.uncompressedSize / Math.max(1, entry.compressedSize) > limits.maxZipCompressionRatio) {
    throw archiveError(`ZIP entry ${name} exceeds the compression ratio limit`)
  }
}

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false, decodeStrings: true, strictFileNames: false, validateEntrySizes: true }, (error, zip) => {
      if (error !== null || zip === undefined) reject(new MinerUError(failure('RESULT_ARCHIVE_INVALID', `Failed to open ZIP: ${error?.message ?? 'unknown error'}`), { cause: error ?? undefined }))
      else resolve(zip)
    })
  })
}

function scanZip(path: string, limits: SafeZipLimits, signal: AbortSignal): Promise<ZipEntryMetadata[]> {
  assertNotAborted(signal, 'ZIP scan')
  return openZip(path).then(zip => new Promise<ZipEntryMetadata[]>((resolve, reject) => {
    const entries: ZipEntryMetadata[] = []
    let declaredTotal = 0
    let settled = false
    const finish = (error?: unknown): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      try { zip.close() } catch { /* already closed */ }
      if (error === undefined) resolve(entries)
      else reject(error)
    }
    const onAbort = (): void => finish(new MinerUError(failure('CANCELLED', 'ZIP scan was cancelled', true)))
    signal.addEventListener('abort', onAbort, { once: true })
    zip.on('entry', (entry: Entry) => {
      if (settled) return
      try {
        if (entries.length + 1 > limits.maxZipEntries) throw archiveError('ZIP entries count exceeds configured limit')
        validateEntrySecurity(entry, limits)
        declaredTotal += entry.uncompressedSize
        if (declaredTotal > limits.maxZipTotalBytes) {
          throw new MinerUError(failure('RESULT_TOO_LARGE', 'ZIP declared uncompressed total exceeds configured limit'))
        }
        entries.push({
          fileName: entry.fileName,
          directory: entry.fileName.endsWith('/'),
          compressedBytes: entry.compressedSize,
          uncompressedBytes: entry.uncompressedSize,
        })
        zip.readEntry()
      } catch (error) { finish(error) }
    })
    zip.once('end', () => finish())
    zip.once('error', error => finish(archiveError(`ZIP parsing error: ${error.message}`)))
    zip.readEntry()
  }))
}

/** Security-focused compatibility helper: scans metadata and drains no entry into memory. */
export async function readAllZipEntries(
  zipPath: string, limits: SafeZipLimits, signal: AbortSignal,
): Promise<ZipEntryMetadata[]> {
  return scanZip(zipPath, limits, signal)
}

function classify(subpath: string): ArtifactClassification | undefined {
  const normalized = posix.normalize(subpath)
  const base = posix.basename(normalized).toLowerCase()
  if (normalized.startsWith('images/')) {
    const extension = extname(base).toLowerCase()
    const mediaType = IMAGE_MIME[extension]
    if (mediaType === undefined) return undefined
    const name = normalized.slice('images/'.length).replaceAll('/', '_').replace(/[^A-Za-z0-9_.-]/g, '_')
    return { kind: 'images', relativeName: `images/${name || 'image.bin'}`, mediaType, json: false }
  }
  if (base === 'full.md') return { kind: 'markdown', relativeName: 'full.md', mediaType: 'text/markdown; charset=utf-8', json: false }
  if (base === 'layout.json' || base === 'middle.json' || base.endsWith('_layout.json')) {
    return { kind: 'layout', relativeName: 'layout.json', mediaType: 'application/json', json: true }
  }
  if (base === 'content_list.json' || base.endsWith('_content_list.json')) {
    return { kind: 'content-list', relativeName: 'content_list.json', mediaType: 'application/json', json: true }
  }
  if (base === 'model.json' || base.endsWith('_model.json')) {
    return { kind: 'model-output', relativeName: 'model.json', mediaType: 'application/json', json: true }
  }
  return undefined
}

function structuredArchive(entries: readonly ZipEntryMetadata[], files: readonly ExtractZipTargetFile[]): boolean {
  const prefixes = new Set(files.flatMap(file => [file.dataId, String(file.fileId)]))
  return entries.some(entry => prefixes.has(entry.fileName.split('/')[0] ?? ''))
}

function targetsForEntry(
  name: string, files: readonly ExtractZipTargetFile[], structured: boolean,
): readonly EntryTarget[] {
  if (structured) {
    const slash = name.indexOf('/')
    if (slash <= 0) return []
    const prefix = name.slice(0, slash)
    const file = files.find(candidate => candidate.dataId === prefix || candidate.fileId === prefix)
    return file === undefined ? [] : [{ file, subpath: name.slice(slash + 1) }]
  }
  if (name.includes('/') && !name.startsWith('images/')) return []
  return files.map(file => ({ file, subpath: name }))
}

function assertUniqueArtifactOutputs(
  entries: readonly ZipEntryMetadata[],
  files: readonly ExtractZipTargetFile[],
  requiredArtifacts: readonly ArtifactKind[],
): void {
  const structured = structuredArchive(entries, files)
  const outputs = new Set<string>()
  for (const entry of entries) {
    if (entry.directory) continue
    for (const target of targetsForEntry(entry.fileName, files, structured)) {
      const classification = classify(target.subpath)
      if (classification === undefined || !requiredArtifacts.includes(classification.kind)) continue
      const key = `${target.file.fileId}:${classification.relativeName}`
      if (outputs.has(key)) {
        throw archiveError(`ZIP entries collide on normalized artifact ${classification.relativeName}`)
      }
      outputs.add(key)
    }
  }
}
function openEntryStream(zip: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error !== null || stream === undefined) reject(archiveError(`Failed to read ZIP entry ${entry.fileName}`))
      else resolve(stream)
    })
  })
}

function extractionTracker(
  entry: Entry, limits: SafeZipLimits, totals: { bytes: number },
): Transform {
  let entryBytes = 0
  return new Transform({
    transform(chunk: Buffer | Uint8Array, _encoding, callback) {
      entryBytes += chunk.byteLength
      totals.bytes += chunk.byteLength
      if (entryBytes > limits.maxZipEntryBytes) return callback(new MinerUError(failure('RESULT_TOO_LARGE', 'ZIP entry exceeded actual byte limit')))
      if (totals.bytes > limits.maxZipTotalBytes) return callback(new MinerUError(failure('RESULT_TOO_LARGE', 'ZIP actual uncompressed total exceeded limit')))
      if (entry.compressedSize > 0 && entryBytes > 64 * 1024
        && entryBytes / entry.compressedSize > limits.maxZipCompressionRatio) {
        return callback(archiveError('ZIP entry exceeded streaming compression ratio limit'))
      }
      callback(null, chunk)
    },
  })
}

export async function validateJsonFile(
  path: string, maxBytes = MAX_JSON_VALIDATION_BYTES, signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  const actualBytes = (await stat(path)).size
  if (actualBytes > maxBytes) throw new MinerUError(failure('RESULT_TOO_LARGE', 'JSON ZIP artifact exceeds validation limit'))
  signal?.throwIfAborted()
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error
    throw error
  }
  signal?.throwIfAborted()
  try {
    JSON.parse(content)
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error
    throw new MinerUError(failure('RESULT_ARCHIVE_INVALID', 'Invalid JSON artifact in archive'), { cause: error })
  }
}

async function consumeZip(
  options: SafeZipOptions, metadata: readonly ZipEntryMetadata[],
  onArtifact: (target: EntryTarget, classification: ArtifactClassification, tempPath: string) => Promise<void>,
): Promise<void> {
  const zip = await openZip(options.zipPath)
  const totals = { bytes: 0 }
  const structured = structuredArchive(metadata, options.files)
  let index = 0
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown): void => {
      if (settled) return
      settled = true
      options.signal.removeEventListener('abort', onAbort)
      try { zip.close() } catch { /* already closed */ }
      if (error === undefined) resolve()
      else reject(error)
    }
    const onAbort = (): void => finish(new MinerUError(failure('CANCELLED', 'ZIP extraction was cancelled', true)))
    options.signal.addEventListener('abort', onAbort, { once: true })
    zip.on('entry', (entry: Entry) => {
      if (settled) return
      const currentIndex = index++
      void (async () => {
        validateEntrySecurity(entry, options.limits)
        if (entry.fileName.endsWith('/')) return
        const targets = targetsForEntry(entry.fileName, options.files, structured)
        const classified = targets.map(target => ({ target, classification: classify(target.subpath) }))
          .filter((item): item is { target: EntryTarget; classification: ArtifactClassification } => item.classification !== undefined)
          .filter(item => options.requiredArtifacts.includes(item.classification.kind))
        const input = await openEntryStream(zip, entry)
        const tracker = extractionTracker(entry, options.limits, totals)
        if (classified.length === 0) {
          await pipeline(input, tracker, new Writable({ write(_chunk, _encoding, callback) { callback() } }), { signal: options.signal })
          return
        }
        const tempPath = join(dirname(options.zipPath), `.entry_${String(currentIndex)}_${randomUUID().replaceAll('-', '')}`)
        try {
          await pipeline(input, tracker, createWriteStream(tempPath, { flags: 'wx', mode: 0o600 }), { signal: options.signal })
          if (classified.some(item => item.classification.json)) await validateJsonFile(tempPath, MAX_JSON_VALIDATION_BYTES, options.signal)
          for (const item of classified) await onArtifact(item.target, item.classification, tempPath)
        } finally {
          await rm(tempPath, { force: true })
        }
      })().then(() => { if (!settled) zip.readEntry() }, finish)
    })
    zip.once('end', () => finish())
    zip.once('error', error => finish(archiveError(`ZIP extraction error: ${error.message}`)))
    zip.readEntry()
  })
}

export async function extractSafeZip(options: SafeZipOptions): Promise<ProviderCollectedFile[]> {
  assertNotAborted(options.signal, 'ZIP extraction')
  const metadata = await scanZip(options.zipPath, options.limits, options.signal)
  assertUniqueArtifactOutputs(metadata, options.files, options.requiredArtifacts)
  const artifacts = new Map<MinerUFileId, ArtifactRef[]>()
  const kinds = new Map<MinerUFileId, Set<ArtifactKind>>()
  for (const file of options.files) {
    artifacts.set(file.fileId, [])
    kinds.set(file.fileId, new Set())
  }

  await consumeZip(options, metadata, async (target, classification, tempPath) => {
    const ref = await options.sink.writeArtifact(
      target.file.fileId, classification.kind, createReadStream(tempPath),
      { mediaType: classification.mediaType, relativeName: classification.relativeName, maxBytes: options.limits.maxZipEntryBytes },
    )
    artifacts.get(target.file.fileId)?.push(ref)
    kinds.get(target.file.fileId)?.add(classification.kind)
  })

  const results: ProviderCollectedFile[] = []
  for (const file of options.files) {
    options.signal.throwIfAborted()
    const fileArtifacts = artifacts.get(file.fileId) ?? []
    const fileKinds = kinds.get(file.fileId) ?? new Set<ArtifactKind>()
    if (options.requiredArtifacts.includes('images') && !fileKinds.has('images')) {
      fileArtifacts.push(await options.sink.writeArtifact(
        file.fileId, 'images', JSON.stringify({ images: [] }),
        { mediaType: 'application/json', relativeName: 'images/index.json', maxBytes: options.limits.maxZipEntryBytes },
      ))
      fileKinds.add('images')
    }
    const missing = options.requiredArtifacts.filter(kind => !fileKinds.has(kind))
    results.push({
      fileId: file.fileId,
      name: file.name,
      artifacts: fileArtifacts,
      ...(missing.length === 0 ? {} : {
        failure: failure('REMOTE_PARSE_FAILED', `ZIP is missing required artifacts: ${missing.join(', ')}`, false, {
          provider: 'official-v4', fileId: file.fileId,
        }),
      }),
    })
  }
  return results
}
