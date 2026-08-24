import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { TextDecoder } from 'node:util'
import {
  asCacheKey,
  asOperationId,
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
import type { ArtifactInput, ArtifactSink, ArtifactWriteOptions, TemporaryArtifact } from '../providers/provider.js'
import { StagingArtifactSink } from './artifact-sink.js'
import type { StoragePaths } from './paths.js'

const DEFAULT_MAX_JSON_VALIDATION_BYTES = 64 * 1024 * 1024

async function setReadOnlyRecursive(dirPath: string): Promise<void> {
  try {
    const items = await readdir(dirPath, { withFileTypes: true })
    for (const item of items) {
      const full = join(dirPath, item.name)
      if (item.isDirectory()) {
        await setReadOnlyRecursive(full)
        await chmod(full, 0o555).catch(() => undefined)
      } else if (item.isFile()) {
        await chmod(full, 0o444).catch(() => undefined)
      }
    }
    await chmod(dirPath, 0o555).catch(() => undefined)
  } catch {
    // Read-only permissions are a secondary guard; content addressing is authoritative.
  }
}

async function sha256File(path: string, signal?: AbortSignal): Promise<string> {
  const digest = createHash('sha256')
  const stream = createReadStream(path)
  const onAbort = (): void => { stream.destroy(signal?.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError')) }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    signal?.throwIfAborted()
    for await (const chunk of stream) {
      signal?.throwIfAborted()
      digest.update(chunk as Buffer)
    }
    return digest.digest('hex')
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
  readonly maxArtifactBytes?: number
}

export class ResultRepository {
  private readonly maxJsonValidationBytes: number
  private readonly maxArtifactBytes: number | undefined

  constructor(public readonly paths: StoragePaths, options: ResultRepositoryOptions = {}) {
    this.maxJsonValidationBytes = options.maxJsonValidationBytes ?? DEFAULT_MAX_JSON_VALIDATION_BYTES
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

  private async verifyArtifact(path: string, artifact: ArtifactRef, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const details = await stat(path)
    if (!details.isFile() || details.size !== artifact.bytes) throw new TypeError(`Artifact ${artifact.relativePath} size or type mismatch`)
    if (await sha256File(path, signal) !== artifact.sha256) throw new TypeError(`Artifact ${artifact.relativePath} SHA-256 mismatch`)
    if (artifact.kind === 'markdown') await validateUtf8(path, signal)
    if (artifact.kind === 'layout' || artifact.kind === 'model-output' || artifact.kind === 'content-list') {
      if (artifact.bytes > this.maxJsonValidationBytes) {
        throw new MinerUError(failure('RESULT_TOO_LARGE', `JSON artifact ${artifact.relativePath} exceeds validation limit`))
      }
      const json = await readFile(path, 'utf8')
      JSON.parse(json)
    }
  }

  private async verifyManifestArtifacts(
    manifest: MinerUResultManifest,
    resolvePath: (relativePath: string) => string,
    signal?: AbortSignal,
  ): Promise<void> {
    for (const artifact of manifest.files[0].artifacts) {
      await this.verifyArtifact(resolvePath(artifact.relativePath), artifact, signal)
    }
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
        relativePath => this.paths.resolveStagingArtifactPath(tx.operationId, relativePath),
        signal,
      )
    } catch (error) {
      await tx.abort()
      if (error instanceof MinerUError) throw error
      throw new MinerUError(failure('CACHE_CORRUPT', error instanceof Error ? error.message : String(error)))
    }

    const stagingManifestPath = this.paths.stagingManifestFile(tx.operationId)
    await writeFile(stagingManifestPath, JSON.stringify(validated, null, 2), { encoding: 'utf8', mode: 0o600 })
    await rm(this.paths.stagingTempDir(tx.operationId), { recursive: true, force: true })

    const targetDir = this.paths.resultDir(validated.cacheKey)
    await mkdir(dirname(targetDir), { recursive: true })

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

    const before = await resolveExisting()
    if (before !== undefined) return { resultId: before.id, cacheKey: before.cacheKey, manifest: before }

    for (let attempt = 0; attempt < 2; attempt++) {
      signal?.throwIfAborted()
      try {
        // Staging and results share one configured root; EXDEV is a configuration/filesystem error.
        await rename(tx.stagingDir, targetDir)
        await setReadOnlyRecursive(targetDir)
        return { resultId: validated.id, cacheKey: validated.cacheKey, manifest: validated }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'EEXIST' || code === 'ENOTEMPTY') {
          const raced = await resolveExisting()
          if (raced !== undefined) return { resultId: raced.id, cacheKey: raced.cacheKey, manifest: raced }
          continue
        }
        await this.quarantine(tx.stagingDir, 'commit_failed').catch(() => undefined)
        throw error
      }
    }
    await this.quarantine(tx.stagingDir, 'commit_race').catch(() => undefined)
    throw new MinerUError(failure('CACHE_CONFLICT', `Could not atomically publish cache key ${validated.cacheKey}`))
  }

  async get(
    cacheKey: CacheKey | string,
    requiredArtifacts?: readonly ArtifactKind[],
    signal?: AbortSignal,
  ): Promise<MinerUResultManifest | undefined> {
    signal?.throwIfAborted()
    const key = asCacheKey(cacheKey)
    const resultDir = this.paths.resultDir(key)
    let raw: string
    try {
      raw = await readFile(this.paths.manifestFile(key), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        try {
          if ((await stat(resultDir)).isDirectory()) await this.quarantine(resultDir, 'missing_manifest')
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError
        }
        return undefined
      }
      throw error
    }

    let manifest: MinerUResultManifest
    try {
      manifest = parseMinerUResultManifest(JSON.parse(raw))
      this.assertManifestConsistency(undefined, manifest)
      if (manifest.cacheKey !== key) throw new TypeError('Manifest cache key does not match its directory')
      await this.verifyManifestArtifacts(manifest, relativePath => this.paths.resolveArtifactPath(key, relativePath), signal)
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      if (error instanceof Error && error.name === 'AbortError') throw error
      await this.quarantine(resultDir, 'corrupt')
      return undefined
    }

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
    const id = `${String(Date.now())}_${reason}_${randomUUID().slice(0, 8)}`
    const destination = this.paths.quarantineDir(id)
    await mkdir(this.paths.quarantineDir(), { recursive: true })
    // Published roots are read-only; restore owner traversal before moving the whole tree.
    await chmod(sourcePath, 0o755).catch(() => undefined)
    try {
      await rename(sourcePath, destination)
      return destination
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return destination
      throw new MinerUError(failure('CACHE_CORRUPT', `Failed to isolate corrupt MinerU data: ${error instanceof Error ? error.message : String(error)}`))
    }
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
        const details = await stat(path)
        if (details.isDirectory() && now - details.mtimeMs > ttlMs) {
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
