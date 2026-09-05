import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { TextDecoder } from 'node:util'
import {
  asCacheKey,
  asOperationId,
  assertSafePathSegment,
  resultIdForCacheKey,
  type CacheKey,
  type MinerUFileId,
  type MinerUResultId,
  type OperationId,
} from '../domain/ids.js'
import { MinerUError, failure } from '../domain/errors.js'
import type { ArtifactKind, CanonicalParseRequest, CanonicalSourceFile } from '../domain/request.js'
import type { ArtifactRef, MinerUResultManifest, ResultProducer } from '../domain/result.js'
import { parseMinerUResultManifest } from '../domain/schemas.js'
import { canonicalJson, computeCacheKey } from '../service/cache-key.js'
import { computeFileSha256 } from '../utils/crypto.js'
import type { ArtifactInput, ArtifactSink, ArtifactWriteOptions, TemporaryArtifact } from '../providers/provider.js'
import { StagingArtifactSink } from './artifact-sink.js'
import type { StoragePaths } from './paths.js'
import type { ProcessLock } from './process-lock.js'

const DEFAULT_MAX_JSON_VALIDATION_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_MANIFEST_BYTES = 16 * 1024 * 1024

type ResultInspectionStatus = 'valid' | 'missing' | 'corrupt' | 'unreadable'
type ResultInspectionReason =
  | 'absent'
  | 'missing-entry'
  | 'unsafe-entry'
  | 'manifest-invalid'
  | 'artifact-invalid'
  | 'io-error'

/**
 * A non-mutating verification outcome for one published content-addressed result.
 * inspectPublished never quarantines; callers that need isolation must invoke it
 * separately after receiving a non-valid outcome.
 */
export type PublishedResultInspection =
  | { readonly status: 'valid'; readonly manifest: MinerUResultManifest }
  | {
    readonly status: Exclude<ResultInspectionStatus, 'valid'>
    readonly reason: ResultInspectionReason
  }

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError')
}

function inspectionFailure(error: unknown, fallback: ResultInspectionReason): Exclude<PublishedResultInspection, { readonly status: 'valid' }> {
  const code = errnoCode(error)
  if (code === 'ENOENT') return { status: 'missing', reason: 'missing-entry' }
  if (code === 'EACCES' || code === 'EPERM' || code === 'EIO' || code === 'EBUSY') {
    return { status: 'unreadable', reason: 'io-error' }
  }
  return { status: 'corrupt', reason: fallback }
}

function containedSegments(root: string, candidate: string): readonly string[] | undefined {
  const relativePath = relative(root, candidate)
  if (relativePath === '' || isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith('..' + sep)) {
    return undefined
  }
  return relativePath.split(sep)
}

function assertQuarantineSourcePath(paths: StoragePaths, sourcePath: string): string {
  const candidate = resolve(sourcePath)
  const staging = containedSegments(paths.stagingDir(), candidate)
  if (staging?.length === 1) {
    const operationId = asOperationId(staging[0]!)
    if (candidate === paths.stagingDir(operationId)) return candidate
  }

  const published = containedSegments(paths.resultsDir(), candidate)
  if (published?.length === 2 && /^[a-f0-9]{2}$/.test(published[0]!)) {
    const cacheKey = asCacheKey(published[1]!)
    if (published[0] === cacheKey.slice(0, 2) && candidate === paths.resultDir(cacheKey)) return candidate
  }
  throw new TypeError('Only a complete staging operation or published result directory can be quarantined')
}

async function assertRegularDirectoryWithin(rootDir: string, directoryPath: string): Promise<void> {
  const relativePath = relative(rootDir, directoryPath)
  if (relativePath === '' || isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith('..' + sep)) {
    throw new TypeError('Result directory escapes its storage root')
  }

  const root = await lstat(rootDir)
  if (root.isSymbolicLink() || !root.isDirectory()) {
    throw new TypeError('Result storage root is not a regular directory')
  }

  let current = rootDir
  for (const segment of relativePath.split(sep)) {
    if (segment === '') throw new TypeError('Result directory contains an empty segment')
    current = join(current, segment)
    const details = await lstat(current)
    if (details.isSymbolicLink() || !details.isDirectory()) {
      throw new TypeError('Result storage must not contain symlinked directories')
    }
  }
}

/** Refuse symlinked path components before opening a published artifact. */
async function assertRegularFileWithin(rootDir: string, filePath: string): Promise<void> {
  const relativePath = relative(rootDir, filePath)
  if (relativePath === '' || isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith('..' + sep)) {
    throw new TypeError('Artifact path escapes its result directory')
  }

  const root = await lstat(rootDir)
  if (root.isSymbolicLink() || !root.isDirectory()) {
    throw new TypeError('Result directory is not a regular directory')
  }

  const segments = relativePath.split(sep)
  let current = rootDir
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    if (segment === undefined || segment === '') throw new TypeError('Artifact path contains an empty segment')
    current = join(current, segment)
    const details = await lstat(current)
    if (details.isSymbolicLink()) throw new TypeError('Result data must not contain symlinks')
    if (index === segments.length - 1) {
      if (!details.isFile()) throw new TypeError('Artifact is not a regular file')
    } else if (!details.isDirectory()) {
      throw new TypeError('Artifact parent is not a regular directory')
    }
  }
}

async function readUtf8Bounded(path: string, maxBytes: number, label: string, signal?: AbortSignal): Promise<string> {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const stream = createReadStream(path)
  const onAbort = (): void => { stream.destroy(signal?.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError')) }
  signal?.addEventListener('abort', onAbort, { once: true })
  let totalBytes = 0
  let text = ''
  try {
    signal?.throwIfAborted()
    for await (const chunk of stream) {
      signal?.throwIfAborted()
      const buffer = chunk as Buffer
      totalBytes += buffer.byteLength
      if (totalBytes > maxBytes) {
        throw new MinerUError(failure('RESULT_TOO_LARGE', label + ' exceeds its validation limit'))
      }
      text += decoder.decode(buffer, { stream: true })
    }
    text += decoder.decode()
    return text
  } finally {
    signal?.removeEventListener('abort', onAbort)
    stream.destroy()
  }
}

async function validateUtf8(path: string, signal?: AbortSignal): Promise<void> {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const stream = createReadStream(path)
  const onAbort = (): void => { stream.destroy(signal?.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError')) }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    signal?.throwIfAborted()
    for await (const chunk of stream) {
      signal?.throwIfAborted()
      decoder.decode(chunk as Buffer, { stream: true })
    }
    decoder.decode()
  } finally {
    signal?.removeEventListener('abort', onAbort)
    stream.destroy()
  }
}

function samePublishedContent(left: MinerUResultManifest, right: MinerUResultManifest): boolean {
  if (left.cacheKey !== right.cacheKey || left.sourceSha256 !== right.sourceSha256) return false
  const byPath = (manifest: MinerUResultManifest): readonly ArtifactRef[] =>
    [...manifest.files[0].artifacts].sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  return canonicalJson(byPath(left)) === canonicalJson(byPath(right))
}

export class ResultTransaction implements ArtifactSink {
  readonly operationId: OperationId
  readonly stagingDir: string
  private readonly sink: StagingArtifactSink

  constructor(
    operationId: OperationId | string,
    public readonly request: CanonicalParseRequest,
    public readonly producer: ResultProducer,
    public readonly paths: StoragePaths,
    signal?: AbortSignal,
    maxArtifactBytes?: number,
  ) {
    this.operationId = asOperationId(operationId)
    this.stagingDir = paths.stagingDir(this.operationId)
    this.sink = new StagingArtifactSink(this.operationId, paths, signal, maxArtifactBytes)
  }

  writeArtifact(
    fileId: MinerUFileId,
    kind: ArtifactKind,
    input: ArtifactInput,
    options: ArtifactWriteOptions,
  ): Promise<ArtifactRef> {
    return this.sink.writeArtifact(fileId, kind, input, options)
  }

  writeTemporary(name: string, input: ArtifactInput, maxBytes: number): Promise<TemporaryArtifact> {
    return this.sink.writeTemporary(name, input, maxBytes)
  }

  buildManifest(file: CanonicalSourceFile, artifacts: readonly ArtifactRef[]): MinerUResultManifest {
    if (this.request.files.length !== 1 || this.request.files[0]?.fileId !== file.fileId) {
      throw new TypeError('Result manifests are single-file and must use the transaction request file')
    }
    const cacheKey = computeCacheKey(this.request, file, this.producer.compatibilityKey)
    return parseMinerUResultManifest({
      schemaVersion: 1,
      id: resultIdForCacheKey(cacheKey),
      cacheKey,
      sourceSha256: file.sha256,
      request: this.request,
      producer: this.producer,
      files: [{ fileId: file.fileId, name: file.name, artifacts }],
      createdAt: Date.now(),
    })
  }

  async abort(): Promise<void> {
    await rm(this.stagingDir, { recursive: true, force: true })
  }
}

export interface ResultRepositoryOptions {
  readonly maxJsonValidationBytes?: number
  readonly maxManifestBytes?: number
  readonly maxArtifactBytes?: number
}

export class ResultRepository {
  private readonly maxJsonValidationBytes: number
  private readonly maxManifestBytes: number
  private readonly maxArtifactBytes: number | undefined

  constructor(
    public readonly paths: StoragePaths,
    options: ResultRepositoryOptions = {},
    public readonly lock?: ProcessLock,
  ) {
    this.maxJsonValidationBytes = options.maxJsonValidationBytes ?? DEFAULT_MAX_JSON_VALIDATION_BYTES
    this.maxManifestBytes = options.maxManifestBytes ?? DEFAULT_MAX_MANIFEST_BYTES
    if (!Number.isSafeInteger(this.maxManifestBytes) || this.maxManifestBytes <= 0) {
      throw new TypeError('maxManifestBytes must be a positive safe integer')
    }
    this.maxArtifactBytes = options.maxArtifactBytes
  }

  beginTransaction(
    operationId: OperationId | string,
    request: CanonicalParseRequest,
    producer: ResultProducer,
    signal?: AbortSignal,
  ): ResultTransaction {
    return new ResultTransaction(operationId, request, producer, this.paths, signal, this.maxArtifactBytes)
  }

  private assertManifestConsistency(tx: ResultTransaction | undefined, manifest: MinerUResultManifest): void {
    const source = manifest.request.files[0]
    const document = manifest.files[0]
    if (manifest.request.files.length !== 1 || source === undefined) throw new TypeError('Result manifest request must contain exactly one file')
    if (manifest.sourceSha256 !== source.sha256 || document.fileId !== source.fileId) throw new TypeError('Result manifest source metadata is inconsistent')
    const expectedKey = computeCacheKey(manifest.request, source, manifest.producer.compatibilityKey)
    if (manifest.cacheKey !== expectedKey || manifest.id !== resultIdForCacheKey(expectedKey)) {
      throw new TypeError('Result manifest content-addressed identifiers are inconsistent')
    }
    if (tx !== undefined && (canonicalJson(tx.request) !== canonicalJson(manifest.request) || canonicalJson(tx.producer) !== canonicalJson(manifest.producer))) {
      throw new TypeError('Result manifest does not belong to its transaction')
    }
    const required = new Set(manifest.request.requiredArtifacts)
    const present = new Set(document.artifacts.map(artifact => artifact.kind))
    for (const kind of required) {
      if (!present.has(kind)) throw new TypeError(`Result manifest is missing required artifact ${kind}`)
    }
    const paths = new Set<string>()
    const prefix = `files/${document.fileId}/`
    for (const artifact of document.artifacts) {
      if (!artifact.relativePath.startsWith(prefix)) throw new TypeError('Artifact path does not belong to the manifest file')
      if (paths.has(artifact.relativePath)) throw new TypeError('Result manifest contains duplicate artifact paths')
      paths.add(artifact.relativePath)
    }
  }

  private async verifyArtifact(rootDir: string, path: string, artifact: ArtifactRef, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    await assertRegularFileWithin(rootDir, path)
    const details = await lstat(path)
    if (details.size !== artifact.bytes) throw new TypeError(`Artifact ${artifact.relativePath} size mismatch`)
    if (await computeFileSha256(path, signal) !== artifact.sha256) throw new TypeError(`Artifact ${artifact.relativePath} SHA-256 mismatch`)
    if (artifact.kind === 'markdown') await validateUtf8(path, signal)
    if (artifact.kind === 'layout' || artifact.kind === 'model-output' || artifact.kind === 'content-list') {
      if (artifact.bytes > this.maxJsonValidationBytes) {
        throw new MinerUError(failure('RESULT_TOO_LARGE', `JSON artifact ${artifact.relativePath} exceeds validation limit`))
      }
      const json = await readUtf8Bounded(path, this.maxJsonValidationBytes, 'JSON artifact', signal)
      JSON.parse(json)
    }
  }

  private async verifyManifestArtifacts(
    manifest: MinerUResultManifest,
    rootDir: string,
    resolvePath: (relativePath: string) => string,
    signal?: AbortSignal,
  ): Promise<void> {
    for (const artifact of manifest.files[0].artifacts) {
      await this.verifyArtifact(rootDir, resolvePath(artifact.relativePath), artifact, signal)
    }
  }

  private async assertPublishedTreeContents(
    rootDir: string,
    manifest: MinerUResultManifest,
    signal?: AbortSignal,
  ): Promise<void> {
    const expectedFiles = new Set<string>(['manifest.json'])
    const expectedDirectories = new Set<string>()
    for (const artifact of manifest.files[0].artifacts) {
      expectedFiles.add(artifact.relativePath)
      const segments = artifact.relativePath.split('/')
      for (let index = 1; index < segments.length; index++) {
        expectedDirectories.add(segments.slice(0, index).join('/'))
      }
    }

    const walk = async (directory: string, relativeDirectory: string): Promise<void> => {
      signal?.throwIfAborted()
      const details = await lstat(directory)
      if (details.isSymbolicLink() || !details.isDirectory()) {
        throw new TypeError('Published result contains an unsafe directory')
      }
      const entries = await readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        signal?.throwIfAborted()
        assertSafePathSegment(entry.name, 'published result entry')
        const relativePath = relativeDirectory === '' ? entry.name : relativeDirectory + '/' + entry.name
        const path = join(directory, entry.name)
        const child = await lstat(path)
        if (child.isSymbolicLink()) throw new TypeError('Published result contains a symlink')
        if (child.isDirectory()) {
          if (!expectedDirectories.has(relativePath)) throw new TypeError('Published result contains an undeclared directory')
          await walk(path, relativePath)
        } else if (child.isFile()) {
          if (!expectedFiles.has(relativePath)) throw new TypeError('Published result contains an undeclared file')
        } else {
          throw new TypeError('Published result contains an unsupported filesystem entry')
        }
      }
    }

    await walk(rootDir, '')
  }

  async commitTransaction(
    tx: ResultTransaction,
    manifest: MinerUResultManifest,
    signal?: AbortSignal,
  ): Promise<{ resultId: MinerUResultId; cacheKey: CacheKey; manifest: MinerUResultManifest }> {
    signal?.throwIfAborted()
    const validated = parseMinerUResultManifest(manifest)
    this.assertManifestConsistency(tx, validated)
    try {
      await this.verifyManifestArtifacts(
        validated,
        tx.stagingDir,
        relativePath => this.paths.resolveStagingArtifactPath(tx.operationId, relativePath),
        signal,
      )
    } catch (error) {
      await tx.abort()
      if (error instanceof MinerUError) throw error
      throw new MinerUError(failure('CACHE_CORRUPT', error instanceof Error ? error.message : String(error)))
    }

    const stagingManifestPath = this.paths.stagingManifestFile(tx.operationId)
    const serializedManifest = JSON.stringify(validated, null, 2)
    if (Buffer.byteLength(serializedManifest, 'utf8') > this.maxManifestBytes) {
      await tx.abort()
      throw new MinerUError(failure('RESULT_TOO_LARGE', 'Result manifest exceeds its publication limit'))
    }
    await writeFile(stagingManifestPath, serializedManifest, { encoding: 'utf8', mode: 0o600 })
    await rm(this.paths.stagingTempDir(tx.operationId), { recursive: true, force: true })
    try {
      await this.assertPublishedTreeContents(tx.stagingDir, validated, signal)
    } catch (error) {
      await tx.abort()
      if (error instanceof MinerUError) throw error
      throw new MinerUError(failure('CACHE_CORRUPT', error instanceof Error ? error.message : String(error)))
    }

    const targetDir = this.paths.resultDir(validated.cacheKey)
    await mkdir(dirname(targetDir), { recursive: true, mode: 0o700 })

    const resolveExisting = async (): Promise<MinerUResultManifest | undefined> => {
      const existing = await this.get(validated.cacheKey, undefined, signal)
      if (existing === undefined) return undefined
      if (!samePublishedContent(existing, validated)) {
        await this.quarantine(tx.stagingDir, 'conflict')
        throw new MinerUError(failure('CACHE_CONFLICT', `Cache conflict detected for key ${validated.cacheKey}`))
      }
      await tx.abort()
      return existing
    }

    const doCommit = async () => {
      const before = await resolveExisting()
      if (before !== undefined) {
        await tx.abort().catch(() => undefined)
        return { resultId: before.id, cacheKey: before.cacheKey, manifest: before }
      }

      for (let attempt = 0; attempt < 2; attempt++) {
        signal?.throwIfAborted()
        try {
          // Staging and results share one configured root; EXDEV is a configuration/filesystem error.
          await rename(tx.stagingDir, targetDir)
          return { resultId: validated.id, cacheKey: validated.cacheKey, manifest: validated }
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (code === 'EEXIST' || code === 'ENOTEMPTY') {
            const raced = await resolveExisting()
            if (raced !== undefined) {
              await tx.abort().catch(() => undefined)
              return { resultId: raced.id, cacheKey: raced.cacheKey, manifest: raced }
            }
            continue
          }
          await this.quarantine(tx.stagingDir, 'commit_failed').catch(() => undefined)
          throw error
        }
      }
      await this.quarantine(tx.stagingDir, 'commit_race').catch(() => undefined)
      throw new MinerUError(failure('CACHE_CONFLICT', `Could not atomically publish cache key ${validated.cacheKey}`))
    }

    if (this.lock !== undefined) {
      return await this.lock.withLock(doCommit, signal)
    }
    return await doCommit()
  }

  /**
   * Strictly verifies one published result without moving or modifying it.
   * This is the maintenance-safe counterpart to get(), whose cache-hit path
   * still quarantines invalid entries before returning a miss.
   */
  async inspectPublished(
    cacheKey: CacheKey | string,
    signal?: AbortSignal,
  ): Promise<PublishedResultInspection> {
    signal?.throwIfAborted()
    const key = asCacheKey(cacheKey)
    const resultDir = this.paths.resultDir(key)

    try {
      await assertRegularDirectoryWithin(this.paths.resultsDir(), resultDir)
    } catch (error) {
      if (isAbort(error, signal)) throw signal?.reason ?? error
      if (errnoCode(error) === 'ENOENT') return { status: 'missing', reason: 'absent' }
      return inspectionFailure(error, 'unsafe-entry')
    }

    let raw: string
    try {
      const manifestPath = this.paths.manifestFile(key)
      await assertRegularFileWithin(resultDir, manifestPath)
      raw = await readUtf8Bounded(manifestPath, this.maxManifestBytes, 'Result manifest', signal)
    } catch (error) {
      if (isAbort(error, signal)) throw signal?.reason ?? error
      return inspectionFailure(error, 'unsafe-entry')
    }

    let manifest: MinerUResultManifest
    try {
      manifest = parseMinerUResultManifest(JSON.parse(raw))
      this.assertManifestConsistency(undefined, manifest)
      if (manifest.cacheKey !== key) throw new TypeError('Manifest cache key does not match its directory')
    } catch (error) {
      if (isAbort(error, signal)) throw signal?.reason ?? error
      return { status: 'corrupt', reason: 'manifest-invalid' }
    }

    try {
      await this.verifyManifestArtifacts(
        manifest,
        resultDir,
        relativePath => this.paths.resolveArtifactPath(key, relativePath),
        signal,
      )
      await this.assertPublishedTreeContents(resultDir, manifest, signal)
    } catch (error) {
      if (isAbort(error, signal)) throw signal?.reason ?? error
      return inspectionFailure(error, 'artifact-invalid')
    }

    return { status: 'valid', manifest }
  }

  async get(
    cacheKey: CacheKey | string,
    requiredArtifacts?: readonly ArtifactKind[],
    signal?: AbortSignal,
  ): Promise<MinerUResultManifest | undefined> {
    signal?.throwIfAborted()
    const key = asCacheKey(cacheKey)
    const inspection = await this.inspectPublished(key, signal)
    if (inspection.status !== 'valid') {
      if (inspection.status === 'unreadable') {
        throw new MinerUError(failure('CACHE_CORRUPT', 'Published MinerU cache data could not be read'))
      }
      if (inspection.reason !== 'absent') {
        await this.quarantine(this.paths.resultDir(key), inspection.status === 'missing' ? 'missing_manifest' : 'corrupt').catch(() => undefined)
      }
      return undefined
    }

    const manifest = inspection.manifest
    if (requiredArtifacts !== undefined) {
      const present = new Set(manifest.files[0].artifacts.map(artifact => artifact.kind))
      if (requiredArtifacts.some(kind => !present.has(kind))) return undefined
    }
    return manifest
  }

  resolveArtifactAbsolutePath(cacheKey: CacheKey | string, relativePath: string): string {
    return this.paths.resolveArtifactPath(cacheKey, relativePath)
  }

  manifestAbsolutePath(cacheKey: CacheKey | string): string {
    return this.paths.manifestFile(cacheKey)
  }

  async quarantine(sourcePath: string, reason = 'quarantine'): Promise<string> {
    const doQuarantine = async () => {
      const safeSourcePath = assertQuarantineSourcePath(this.paths, sourcePath)
      const id = `${String(Date.now())}_${reason}_${randomUUID().slice(0, 8)}`
      const destination = this.paths.quarantineDir(id)
      try {
        const source = await lstat(safeSourcePath)
        if (source.isSymbolicLink() || !source.isDirectory()) {
          throw new TypeError('Only regular directories can be quarantined')
        }
      } catch (error) {
        if (errnoCode(error) === 'ENOENT') return destination
        throw new MinerUError(failure('CACHE_CORRUPT', 'Failed to isolate corrupt MinerU data safely'))
      }

      await mkdir(this.paths.quarantineDir(), { recursive: true })
      try {
        await rename(safeSourcePath, destination)
        return destination
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return destination
        throw new MinerUError(failure('CACHE_CORRUPT', 'Failed to isolate corrupt MinerU data'))
      }
    }

    if (this.lock !== undefined) {
      return await this.lock.withLock(doQuarantine)
    }
    return await doQuarantine()
  }

  async cleanupStaging(
    ttlMs: number,
    activeOperationIds: ReadonlySet<OperationId | string> = new Set(),
    signal?: AbortSignal,
  ): Promise<number> {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new TypeError('staging TTL must be a positive safe integer')
    let entries: string[]
    try {
      entries = await readdir(this.paths.stagingDir())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw error
    }
    let cleaned = 0
    const now = Date.now()
    for (const entry of entries) {
      signal?.throwIfAborted()
      let operationId: OperationId
      try { operationId = asOperationId(entry) } catch { continue }
      if (activeOperationIds.has(operationId)) continue
      const path = this.paths.stagingDir(operationId)
      try {
        const details = await lstat(path)
        if (!details.isSymbolicLink() && details.isDirectory() && now - details.mtimeMs > ttlMs) {
          await rm(path, { recursive: true, force: true })
          cleaned++
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    return cleaned
  }
}
