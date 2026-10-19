import type { Readable } from 'node:stream'
import type { MinerUFileId } from '../domain/ids.js'
import type { ArtifactKind } from '../domain/request.js'
import type { ArtifactRef } from '../domain/result.js'

export type ArtifactInput = Readable | ReadableStream<Uint8Array> | Uint8Array | string

export interface ArtifactWriteOptions {
  readonly mediaType: string
  readonly relativeName?: string
  readonly maxBytes?: number
}

export interface TemporaryArtifact {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
}

export interface ArtifactSink {
  writeArtifact(
    fileId: MinerUFileId,
    kind: ArtifactKind,
    input: ArtifactInput,
    options: ArtifactWriteOptions,
  ): Promise<ArtifactRef>
  writeTemporary(name: string, input: ArtifactInput, maxBytes: number): Promise<TemporaryArtifact>
}
