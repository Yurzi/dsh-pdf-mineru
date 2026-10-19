import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { onTestFinished } from 'vitest'
import { ZipFile } from 'yazl'
import { DEFAULT_PARSE_DEFAULTS } from '../../src/config/model.js'
import { MinerUError, failure } from '../../src/domain/errors.js'
import { createFileId, type MinerUFileId } from '../../src/domain/ids.js'
import {
  CANONICAL_PARSE_REQUEST_SCHEMA_VERSION,
  type ArtifactKind, type CanonicalParseRequest, type CanonicalSourceFile, type ParseSemantics, type PreparedSourceFile,
} from '../../src/domain/request.js'
import type { ArtifactRef } from '../../src/domain/result.js'
import type { ProviderCallContext, ProviderCallLimits } from '../../src/providers/contract.js'
import type { ProviderRetryEvent, ProviderRetryOptions, ProviderRetryPolicy } from '../../src/providers/http/retry.js'
import type { ArtifactInput, ArtifactSink, ArtifactWriteOptions, TemporaryArtifact } from '../../src/storage/artifact-port.js'

export const SHA256_A = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
export const SHA256_B = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'

/** Temporary directory removed when the current test finishes. */
export async function tempDir(prefix = 'mineru-test-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  return dir
}

// Call context -------------------------------------------------------------------------------

export const TEST_LIMITS: ProviderCallLimits = {
  maxApiResponseBytes: 1024 * 1024,
  maxZipDownloadBytes: 10 * 1024 * 1024,
  maxZipEntries: 100,
  maxZipEntryBytes: 5 * 1024 * 1024,
  maxZipTotalBytes: 20 * 1024 * 1024,
  maxZipCompressionRatio: 50,
}

/** Retries back off instantly so retry tests never wait on real timers. */
export const FAST_RETRY: ProviderRetryOptions = { initialDelayMs: 1, maxDelayMs: 5, jitter: false, sleep: async () => {} }

export type CallContextOptions = Omit<Partial<ProviderCallContext>, 'limits'> & { readonly limits?: Partial<ProviderCallLimits> }

/** A provider call context; limits and retry options merge over fast, generous test defaults. */
export function callContext(options: CallContextOptions = {}): ProviderCallContext {
  return {
    signal: new AbortController().signal,
    timeoutMs: 5000,
    ...options,
    limits: { ...TEST_LIMITS, ...options.limits },
    retry: { ...FAST_RETRY, ...options.retry },
  }
}

/** Retry options that record every sanitized onRetry event. */
export function retryLog(policy: ProviderRetryPolicy = {}): { readonly events: ProviderRetryEvent[]; readonly retry: ProviderRetryOptions } {
  const events: ProviderRetryEvent[] = []
  return { events, retry: { ...FAST_RETRY, maxRetries: 2, ...policy, onRetry: event => { events.push(event) } } }
}

// Sources and requests -----------------------------------------------------------------------

/** A real source file on disk with its canonical identity and stat fingerprint. */
export async function preparedSource(name: string, body: string | Uint8Array = '%PDF-1.4 test', index = 0): Promise<PreparedSourceFile> {
  const path = join(await tempDir('mineru-source-'), name)
  await writeFile(path, body)
  const info = await stat(path)
  const sha256 = createHash('sha256').update(body).digest('hex')
  return {
    fileId: createFileId(sha256, index), name, bytes: info.size, sha256, path,
    fingerprint: { size: info.size, mtimeMs: info.mtimeMs, device: info.dev, inode: info.ino },
  }
}

/** Canonical file identity without a local source (collect/inspect-only tests). */
export function canonicalFile(name: string, sha256 = SHA256_A, index = 0): CanonicalSourceFile {
  return { fileId: createFileId(sha256, index), name, bytes: 100, sha256 }
}

export interface CanonicalRequestOptions {
  readonly files?: readonly CanonicalSourceFile[]
  readonly semantics?: Partial<ParseSemantics>
  readonly requiredArtifacts?: readonly ArtifactKind[]
}

/** A canonical request; prepared sources are reduced to their persisted identity (never the path). */
export function canonicalRequest(options: CanonicalRequestOptions = {}): CanonicalParseRequest {
  return {
    schemaVersion: CANONICAL_PARSE_REQUEST_SCHEMA_VERSION,
    files: (options.files ?? []).map(({ fileId, name, bytes, sha256 }) => ({ fileId, name, bytes, sha256 })),
    semantics: { ...DEFAULT_PARSE_DEFAULTS, ...options.semantics },
    requiredArtifacts: options.requiredArtifacts ?? ['markdown'],
  }
}

// Artifact sink ------------------------------------------------------------------------------

function toReadable(input: ArtifactInput): Readable {
  if (typeof input === 'string' || input instanceof Uint8Array) return Readable.from([Buffer.from(input)])
  return input instanceof Readable ? input : Readable.fromWeb(input as NodeReadableStream<Uint8Array>)
}

function byteLimit(maxBytes: number | undefined): Transform {
  let total = 0
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.byteLength
      if (maxBytes !== undefined && total > maxBytes) {
        callback(new MinerUError(failure('RESULT_TOO_LARGE', `Artifact output exceeded byte limit of ${String(maxBytes)} bytes`)))
      } else callback(null, chunk)
    },
  })
}

async function collectBytes(input: ArtifactInput, maxBytes: number | undefined): Promise<Buffer> {
  const chunks: Buffer[] = []
  await pipeline(toReadable(input), byteLimit(maxBytes), async (source: AsyncIterable<Buffer>) => {
    for await (const chunk of source) chunks.push(chunk)
  })
  return Buffer.concat(chunks)
}

export interface WrittenArtifact {
  readonly fileId: MinerUFileId
  readonly kind: ArtifactKind
  readonly content: Buffer
  readonly options: ArtifactWriteOptions
}

/** In-memory ArtifactSink that, like the staging sink, enforces maxBytes with RESULT_TOO_LARGE. */
export class RecordingSink implements ArtifactSink {
  readonly written: WrittenArtifact[] = []
  readonly temporaries: { readonly name: string; readonly path: string; readonly maxBytes: number }[] = []

  async writeArtifact(fileId: MinerUFileId, kind: ArtifactKind, input: ArtifactInput, options: ArtifactWriteOptions): Promise<ArtifactRef> {
    const content = await collectBytes(input, options.maxBytes)
    this.written.push({ fileId, kind, content, options })
    return {
      kind, relativePath: `files/${String(fileId)}/${options.relativeName ?? 'artifact.bin'}`, mediaType: options.mediaType,
      bytes: content.byteLength, sha256: createHash('sha256').update(content).digest('hex'),
    }
  }

  async writeTemporary(name: string, input: ArtifactInput, maxBytes: number): Promise<TemporaryArtifact> {
    const path = join(await tempDir('mineru-sink-'), name)
    const hash = createHash('sha256')
    let bytes = 0
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) { hash.update(chunk); bytes += chunk.byteLength; callback(null, chunk) },
    })
    await pipeline(toReadable(input), byteLimit(maxBytes), meter, createWriteStream(path))
    this.temporaries.push({ name, path, maxBytes })
    return { path, bytes, sha256: hash.digest('hex') }
  }

  /** Content of the first artifact of a kind. */
  artifact(kind: ArtifactKind): Buffer | undefined {
    return this.written.find(entry => entry.kind === kind)?.content
  }
}

// ZIP builder --------------------------------------------------------------------------------

export interface ZipEntrySpec {
  readonly name: string
  readonly content: string | Uint8Array
  /** Unix mode bits, e.g. 0o120777 for a symlink entry. */
  readonly mode?: number
}

/** Builds a ZIP archive in memory with yazl. */
export async function zip(entries: Readonly<Record<string, string | Uint8Array>> | readonly ZipEntrySpec[]): Promise<Buffer> {
  const list: readonly ZipEntrySpec[] = Array.isArray(entries)
    ? entries
    : Object.entries(entries).map(([name, content]) => ({ name, content }))
  const archive = new ZipFile()
  const done = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    archive.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk))
    archive.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
    archive.outputStream.on('error', reject)
  })
  for (const entry of list) {
    archive.addBuffer(Buffer.from(entry.content), entry.name, entry.mode === undefined ? {} : { mode: entry.mode })
  }
  archive.end()
  return await done
}
