import type { Readable } from 'node:stream'
import type { MinerUFailure, MinerUProviderId } from '../domain/errors.js'
import { MinerUError, failure } from '../domain/errors.js'
import type { MinerUFileState, MinerUJobState } from '../domain/job.js'
import type { MinerUFileId } from '../domain/ids.js'
import type { ArtifactRef } from '../domain/result.js'
import type { ArtifactKind, CanonicalParseRequest, MinerUModel, ParseMethod, PreparedSourceFile } from '../domain/request.js'

export interface ProviderCapabilities {
  readonly models: readonly MinerUModel[]
  readonly parseMethods: readonly ParseMethod[]
  readonly supportsOcr: boolean
  readonly supportsLanguage: boolean
  readonly supportsFormula: boolean
  readonly supportsTable: boolean
  readonly supportsPageRanges: boolean
  readonly supportedArtifacts: readonly ArtifactKind[]
  readonly maxFilesPerSubmission: number
  readonly maxFileBytes?: number
  readonly maxPagesPerFile?: number
}

export interface ProviderCallLimits {
  readonly maxApiResponseBytes: number
  readonly maxZipDownloadBytes: number
  readonly maxZipEntries: number
  readonly maxZipEntryBytes: number
  readonly maxZipTotalBytes: number
  readonly maxZipCompressionRatio: number
}

export interface ProviderCallContext {
  readonly signal: AbortSignal
  readonly credential?: string
  readonly timeoutMs: number
  readonly limits: ProviderCallLimits
}

export interface ProviderCompatibilityContext {
  readonly configuredVersion?: string
}

export interface ProviderProbeResult {
  readonly available: boolean
  readonly provider: MinerUProviderId
  readonly authentication: 'valid' | 'invalid' | 'not-configured' | 'unknown'
  readonly protocolVersion: string
  readonly serverVersion?: string
  readonly queue?: {
    readonly queued?: number
    readonly processing?: number
    readonly completed?: number
    readonly failed?: number
    readonly maxConcurrent?: number
  }
  readonly diagnostics?: string
}

export interface ProviderSubmittedFile {
  readonly dataId: string
  readonly fileId: MinerUFileId
  readonly name: string
}

export type ProviderJobRef =
  | { readonly provider: 'self-hosted-v2'; readonly taskId: string; readonly files: readonly ProviderSubmittedFile[] }
  | { readonly provider: 'official-v4'; readonly batchId: string; readonly files: readonly ProviderSubmittedFile[] }

export interface ProviderSubmission {
  readonly ref: ProviderJobRef
  readonly state: MinerUJobState
  readonly files: readonly ProviderFileSnapshot[]
}

export interface ProviderFileSnapshot {
  readonly fileId: MinerUFileId
  readonly state: MinerUFileState
  readonly rawState?: string
  readonly progress?: { readonly completed: number; readonly total: number }
  readonly failure?: MinerUFailure
}

export interface ProviderJobSnapshot {
  readonly state: MinerUJobState
  readonly files: readonly ProviderFileSnapshot[]
  readonly rawState?: string
  readonly queuedAhead?: number
}

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

export interface ProviderCollectedFile {
  readonly fileId: MinerUFileId
  readonly name: string
  readonly artifacts: readonly ArtifactRef[]
  readonly failure?: MinerUFailure
}

export interface ProviderCollection {
  readonly files: readonly ProviderCollectedFile[]
}

export interface MinerUProvider {
  readonly id: MinerUProviderId
  readonly capabilities: ProviderCapabilities

  probe(context: ProviderCallContext): Promise<ProviderProbeResult>
  compatibilityKey(request: CanonicalParseRequest, context: ProviderCompatibilityContext): Promise<string>
  submit(
    request: CanonicalParseRequest,
    sources: readonly PreparedSourceFile[],
    context: ProviderCallContext,
  ): Promise<ProviderSubmission>
  inspect(ref: ProviderJobRef, context: ProviderCallContext): Promise<ProviderJobSnapshot>
  collect(
    ref: ProviderJobRef,
    request: CanonicalParseRequest,
    sink: ArtifactSink,
    context: ProviderCallContext,
  ): Promise<ProviderCollection>
}

export function validateProviderCapabilities(request: CanonicalParseRequest, capabilities: ProviderCapabilities): void {
  const semantics = request.semantics
  const unsupported = (message: string): never => {
    throw new MinerUError(failure('UNSUPPORTED_OPTION', message))
  }
  if (!capabilities.models.includes(semantics.model)) unsupported(`Provider does not support model ${semantics.model}`)
  if (!capabilities.parseMethods.includes(semantics.parseMethod)) unsupported(`Provider does not support parse method ${semantics.parseMethod}`)
  if (semantics.ocr && !capabilities.supportsOcr) unsupported('Provider does not support OCR')
  if (semantics.language && !capabilities.supportsLanguage) unsupported('Provider does not support language selection')
  if (!capabilities.supportsFormula && semantics.formula) unsupported('Provider does not support formula parsing')
  if (!capabilities.supportsTable && semantics.table) unsupported('Provider does not support table parsing')
  if (semantics.pages !== undefined && !capabilities.supportsPageRanges) unsupported('Provider does not support page ranges')
  for (const artifact of request.requiredArtifacts) {
    if (!capabilities.supportedArtifacts.includes(artifact)) unsupported(`Provider does not support artifact ${artifact}`)
  }
  if (request.files.length > capabilities.maxFilesPerSubmission) {
    unsupported(`Provider accepts at most ${String(capabilities.maxFilesPerSubmission)} files per submission`)
  }
  if (capabilities.maxFileBytes !== undefined) {
    for (const file of request.files) {
      if (file.bytes > capabilities.maxFileBytes) {
        throw new MinerUError(failure('FILE_TOO_LARGE', `${file.name} exceeds the provider file-size limit`))
      }
    }
  }
}
