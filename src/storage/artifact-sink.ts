/**
 * artifact-sink.ts — Staging-backed ArtifactSink implementation for MinerU providers.
 *
 * Enforces:
 *   - Streaming I/O with on-the-fly SHA-256 and byte accounting
 *   - Per-artifact byte limit enforcement (throws RESULT_TOO_LARGE on breach)
 *   - Clean POSIX relative artifact paths within staging and result boundaries
 *   - Automatic temporary file cleanup on stream failure
 */

import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { link, mkdir, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { asFileId, asOperationId, type MinerUFileId, type OperationId } from '../domain/ids.js'
import { throwMinerU } from '../domain/errors.js'
import type { ArtifactKind } from '../domain/request.js'
import type { ArtifactRef } from '../domain/result.js'
import { assertSafeArtifactRelativePath, assertSafeFileName, parseArtifactKind, parseArtifactRef } from '../domain/schemas.js'
import type { ArtifactInput, ArtifactSink, ArtifactWriteOptions, TemporaryArtifact } from '../providers/provider.js'
import type { StoragePaths } from './paths.js'

function toNodeReadable(input: ArtifactInput): Readable {
  if (typeof input === 'string') {
    return Readable.from([Buffer.from(input, 'utf8')])
  }
  if (input instanceof Uint8Array) {
    return Readable.from([input])
  }
  if (input instanceof Readable) {
    return input
  }
  if (input !== null && typeof input === 'object' && 'getReader' in input && typeof (input as { getReader: unknown }).getReader === 'function') {
    return Readable.fromWeb(input as import('node:stream/web').ReadableStream<Uint8Array>)
  }
  throw new TypeError(`Unsupported artifact input type: ${typeof input}`)
}

async function streamToFile(
  input: ArtifactInput,
  destinationPath: string,
  maxBytes?: number,
  signal?: AbortSignal,
): Promise<{ bytes: number; sha256: string }> {
  signal?.throwIfAborted()
  await mkdir(dirname(destinationPath), { recursive: true })

  const hash = createHash('sha256')
  let totalBytes = 0
  const source = toNodeReadable(input)
  const temporaryPath = `${destinationPath}.part_${randomUUID().replaceAll('-', '')}`

  const byteTracker = new Transform({
    transform(chunk: Buffer | Uint8Array, _encoding, callback) {
      totalBytes += chunk.length
      if (maxBytes !== undefined && totalBytes > maxBytes) {
        callback(new Error('ARTIFACT_MAX_BYTES_EXCEEDED'))
        return
      }
      hash.update(chunk)
      callback(null, chunk)
    },
  })

  const destination = createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 })

  try {
    await pipeline(source, byteTracker, destination, { signal })
    await link(temporaryPath, destinationPath)
    await unlink(temporaryPath)
    return { bytes: totalBytes, sha256: hash.digest('hex') }
  } catch (err: unknown) {
    try {
      await unlink(temporaryPath)
    } catch {
      // Ignore cleanup error
    }
    if (err instanceof Error && err.message === 'ARTIFACT_MAX_BYTES_EXCEEDED') {
      throwMinerU('RESULT_TOO_LARGE', `Artifact output exceeded byte limit of ${String(maxBytes)} bytes`)
    }
    throw err
  }
}

function defaultArtifactFileName(kind: ArtifactKind, imageIndex: number): string {
  switch (kind) {
    case 'markdown':
      return 'full.md'
    case 'layout':
      return 'layout.json'
    case 'model-output':
      return 'model.json'
    case 'content-list':
      return 'content_list.json'
    case 'images':
      return `images/img_${String(imageIndex)}.png`
  }
}

export class StagingArtifactSink implements ArtifactSink {
  private imageCounter = 0
  readonly operationId: OperationId

  constructor(
    operationId: OperationId | string,
    public readonly paths: StoragePaths,
    private readonly signal?: AbortSignal,
    private readonly defaultMaxBytes?: number,
  ) {
    this.operationId = asOperationId(operationId)
  }

  async writeArtifact(
    fileId: MinerUFileId,
    kind: ArtifactKind,
    input: ArtifactInput,
    options: ArtifactWriteOptions,
  ): Promise<ArtifactRef> {
    const validFileId = asFileId(fileId)
    const validKind = parseArtifactKind(kind)

    let relativeSubPath: string
    if (options.relativeName !== undefined && options.relativeName.trim() !== '') {
      relativeSubPath = assertSafeArtifactRelativePath(options.relativeName, 'options.relativeName')
    } else {
      relativeSubPath = defaultArtifactFileName(validKind, this.imageCounter++)
    }

    const relativePath = assertSafeArtifactRelativePath(`files/${validFileId}/${relativeSubPath}`, 'artifact relativePath')
    const destinationPath = this.paths.resolveStagingArtifactPath(this.operationId, relativePath)

    const { bytes, sha256 } = await streamToFile(input, destinationPath, options.maxBytes ?? this.defaultMaxBytes, this.signal)

    const ref: ArtifactRef = {
      kind: validKind,
      relativePath,
      mediaType: options.mediaType,
      bytes,
      sha256,
    }

    return parseArtifactRef(ref)
  }

  async writeTemporary(name: string, input: ArtifactInput, maxBytes: number): Promise<TemporaryArtifact> {
    const safeName = assertSafeFileName(name, 'temporary artifact name')
    const destDir = this.paths.stagingTempDir(this.operationId)
    const destPath = `${destDir}/${safeName}`

    const { bytes, sha256 } = await streamToFile(input, destPath, maxBytes, this.signal)

    return {
      path: destPath,
      bytes,
      sha256,
    }
  }
}
