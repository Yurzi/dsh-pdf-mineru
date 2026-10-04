/**
 * self-hosted-v1-api.ts — MinerU 4.x self-hosted "V1 API" protocol adapter.
 *
 * Wire contract (see scripts/http_api_example.sh in opendatalab/MinerU):
 *   POST /v1/uploads                  create an upload session (deduplicated files are already completed)
 *   PUT  {upload_url}                 stream the raw bytes with the service-provided upload headers
 *   POST /v1/uploads/{id}/complete    finalize the upload and obtain the file id
 *   POST /v1/parse/jobs               submit one parse job covering every uploaded file
 *   GET  /v1/parse/jobs/{job_id}      poll job/file status and per-file output references
 *   GET  /v1/files/{file_id}/content  download a parse output (the result archive)
 *
 * A job requests the `zip` output format, which is the complete MinerU output package
 * (`markdown.md`, `middle_json.json`, `structured_content.json`, `model_output.json`,
 * `images/*`). Collection therefore reuses the shared bounded ZIP extractor and only
 * canonicalizes the two documents whose MinerU 4.x shape differs from the plugin's
 * canonical artifact shape (layout page list and structured content).
 */

import { openAsBlob } from 'node:fs'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'
import type { MinerUFileState, MinerUJobState } from '../domain/job.js'
import type { MinerUFileId } from '../domain/ids.js'
import type { CanonicalParseRequest, MinerUModel, PreparedSourceFile } from '../domain/request.js'
import type { ArtifactRef } from '../domain/result.js'
import {
  MinerUError,
  failure,
  sanitizeDiagnostic,
  toMinerUFailure,
} from '../domain/errors.js'
import { assertSourcesUnchanged } from '../service/request-normalizer.js'
import type { ProviderHttpClient } from './http-client.js'
import { resolveProviderUrl } from './http-client.js'
import { extractSafeZip } from './safe-zip.js'
import {
  type ArtifactInput,
  type ArtifactSink,
  type ArtifactWriteOptions,
  type ProviderCallContext,
  type ProviderCollectedFile,
  type ProviderCollection,
  type ProviderFileSnapshot,
  type ProviderJobRef,
  type ProviderJobSnapshot,
  type ProviderProbeResult,
  type ProviderRetryOperation,
  type ProviderRetryOptions,
  type ProviderSubmission,
  type ProviderSubmittedFile,
  executeWithRetry,
  isRetryableHttpStatus,
  mergeRetryOptions,
  parseRetryAfter,
  readBoundedResponseText,
} from './provider.js'

/** The only output format the plugin consumes; it carries every canonical artifact. */
export const SELF_HOSTED_V1_ARCHIVE_FORMAT = 'zip'

/** Tiers advertised by the MinerU V1 API; other modelMap values fall back to the server default. */
export const SELF_HOSTED_V1_TIERS: ReadonlySet<string> = new Set(['flash', 'basic', 'standard', 'advanced'])

/**
 * Effective V1 parse tier: an explicitly configured tier wins; otherwise a modelMap value that
 * names a tier is honoured, and anything else keeps the server default tier. Shared with the
 * provider compatibility key so the cached result identity matches the submitted request.
 */
export function resolveSelfHostedTier(
  tier: string | undefined,
  modelMap: Readonly<Partial<Record<MinerUModel, string>>>,
  model: MinerUModel,
): string | undefined {
  if (typeof tier === 'string' && SELF_HOSTED_V1_TIERS.has(tier)) return tier
  const configured = modelMap[model]
  if (typeof configured !== 'string') return undefined
  const candidate = configured.trim().toLowerCase()
  return SELF_HOSTED_V1_TIERS.has(candidate) ? candidate : undefined
}

const EXTENSION_MIME_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jp2': 'image/jp2',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export interface SelfHostedV1HealthResponse {
  readonly status?: string
  readonly version?: string
  readonly features?: {
    readonly output_formats?: readonly string[]
    readonly sources?: readonly string[]
  }
}

export interface SelfHostedV1UsageResponse {
  readonly limits?: {
    readonly max_concurrent_jobs?: number
    readonly max_files_per_job?: number
  }
}

export interface SelfHostedV1UploadResponse {
  readonly id?: string
  readonly status?: string
  readonly upload_url?: string | null
  readonly upload_method?: string | null
  readonly upload_headers?: Readonly<Record<string, string>> | null
  readonly file?: { readonly id?: string } | null
}

export interface SelfHostedV1OutputFileRef {
  readonly file_id?: string
  readonly bytes?: number
}

export interface SelfHostedV1JobFile {
  readonly file_id?: string | null
  readonly name?: string
  readonly page_range?: string
  readonly status?: string
  readonly output_files?: Readonly<Record<string, SelfHostedV1OutputFileRef | null>> | null
  readonly error?: { readonly code?: string | null; readonly message?: string } | null
}

export interface SelfHostedV1JobResponse {
  readonly job_id?: string
  readonly status?: string
  readonly files?: readonly SelfHostedV1JobFile[]
  readonly progress?: { readonly completed?: number; readonly failed?: number; readonly total?: number } | null
}

export interface SelfHostedV1ApiAdapterOptions {
  readonly client: ProviderHttpClient
  readonly baseUrl: URL
  readonly retry: ProviderRetryOptions
  readonly modelMap: Readonly<Partial<Record<MinerUModel, string>>>
  /** Explicit V1 parse tier; absent keeps the upstream server default. */
  readonly tier?: string
}

function uploadFailed(message: string, retryable = false, details: { fileId?: MinerUFileId } = {}): MinerUError {
  return new MinerUError(failure('UPLOAD_FAILED', message, retryable, { provider: 'self-hosted-v2', ...details }))
}

function archiveInvalid(message: string, fileId?: MinerUFileId): MinerUError {
  return new MinerUError(failure('REMOTE_PARSE_FAILED', message, false, {
    provider: 'self-hosted-v2',
    ...(fileId === undefined ? {} : { fileId }),
  }))
}

export function mimeTypeForName(name: string): string {
  const match = /\.[^./\\]+$/.exec(name.toLowerCase())
  return (match === null ? undefined : EXTENSION_MIME_TYPES[match[0]]) ?? 'application/octet-stream'
}

function effectivePort(url: URL): string {
  return url.port !== '' ? url.port : (url.protocol === 'https:' ? '443' : '80')
}

/** Same scheme, host, and effective port; the only target that may receive the API key. */
export function isSameOriginUrl(target: URL, baseUrl: URL): boolean {
  return target.protocol === baseUrl.protocol
    && target.hostname.toLowerCase() === baseUrl.hostname.toLowerCase()
    && effectivePort(target) === effectivePort(baseUrl)
}

/** True when an HTTPS endpoint points the byte upload at a cleartext origin elsewhere. */
export function isInsecureCrossOriginUpload(target: URL, baseUrl: URL): boolean {
  return target.protocol === 'http:' && baseUrl.protocol !== 'http:' && !isSameOriginUrl(target, baseUrl)
}

/**
 * Maps a MinerU V1 job status to the plugin's aggregate job state.
 * `canceled` has no dedicated plugin state and is reported as a failed job.
 */
export function mapSelfHostedV1JobState(rawStatus: unknown): MinerUJobState {
  if (typeof rawStatus !== 'string') {
    throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'Missing job status from MinerU server response', false, { provider: 'self-hosted-v2' }))
  }
  switch (rawStatus.toLowerCase()) {
    case 'queued':
    case 'pending':
      return 'queued'
    case 'running':
    case 'processing':
      return 'processing'
    case 'completed':
      return 'completed'
    case 'partial':
      return 'partially-completed'
    case 'failed':
    case 'canceled':
    case 'cancelled':
      return 'failed'
    default:
      throw new MinerUError(failure('REMOTE_PARSE_FAILED', `Unknown remote job status: "${sanitizeDiagnostic(rawStatus)}"`, false, { provider: 'self-hosted-v2' }))
  }
}

/** Best-effort job state used where an unrecognized status must not fail the whole snapshot. */
function optionalSelfHostedV1JobState(rawStatus: unknown): MinerUJobState | undefined {
  try {
    return mapSelfHostedV1JobState(rawStatus)
  } catch {
    return undefined
  }
}

/** Maps a MinerU V1 per-file status to the plugin's file state. */
export function mapSelfHostedV1FileState(rawStatus: unknown): MinerUFileState {
  if (typeof rawStatus !== 'string') {
    throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'Missing file status from MinerU server response', false, { provider: 'self-hosted-v2' }))
  }
  switch (rawStatus.toLowerCase()) {
    case 'queued':
    case 'pending':
      return 'queued'
    case 'running':
    case 'processing':
      return 'processing'
    case 'completed':
      return 'completed'
    case 'failed':
    case 'canceled':
    case 'cancelled':
      return 'failed'
    default:
      throw new MinerUError(failure('REMOTE_PARSE_FAILED', `Unknown remote file status: "${sanitizeDiagnostic(rawStatus)}"`, false, { provider: 'self-hosted-v2' }))
  }
}

/**
 * Matches a submitted file to its upstream job entry. The V1 API echoes job files in
 * submission order, so the positional entry wins when its name agrees; otherwise a
 * unique name match is used.
 */
export function matchV1JobFile(
  jobFiles: readonly SelfHostedV1JobFile[],
  file: ProviderSubmittedFile,
  index: number,
): SelfHostedV1JobFile | undefined {
  const positional = jobFiles[index]
  if (positional !== undefined && (typeof positional.name !== 'string' || positional.name === file.name)) {
    return positional
  }
  const named = jobFiles.filter(candidate => candidate.name === file.name)
  return named.length === 1 ? named[0] : undefined
}

async function readArtifactInputText(input: ArtifactInput, maxBytes: number | undefined): Promise<string> {
  if (typeof input === 'string') return input
  const stream: Readable = input instanceof Uint8Array
    ? Readable.from([input])
    : input instanceof Readable
      ? input
      : Readable.fromWeb(input as NodeWebReadableStream<Uint8Array>)
  const chunks: Buffer[] = []
  let totalBytes = 0
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
      totalBytes += buffer.byteLength
      if (maxBytes !== undefined && totalBytes > maxBytes) {
        throw new MinerUError(failure('RESULT_TOO_LARGE', `Artifact input exceeded byte limit of ${String(maxBytes)} bytes`, false, { provider: 'self-hosted-v2' }))
      }
      chunks.push(buffer)
    }
  } catch (error) {
    stream.destroy()
    throw error
  }
  return Buffer.concat(chunks).toString('utf8')
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Positive shape check for the MinerU 4.x health document. The V1 schema always carries a
 * `version` and never the legacy `protocol_version`/queue counters, so a generic proxy or an
 * earlier self-hosted server answering 200 with some other JSON object is not mistaken for V1.
 */
export function isSelfHostedV1Health(value: unknown): value is SelfHostedV1HealthResponse {
  const health = asRecord(value)
  if (health === undefined) return false
  if (typeof health.version !== 'string' || health.version.trim() === '') return false
  if (health.protocol_version !== undefined || health.queued_tasks !== undefined) return false
  const status = health.status
  return status === undefined || status === 'ok' || status === 'healthy' || status === 'unhealthy'
}

function paragraphTitleLevel(type: string | undefined, source: Record<string, unknown>): number | undefined {
  const level = source.level
  if (type !== 'doc_title' && type !== 'paragraph_title' && type !== 'title') return undefined
  return typeof level === 'number' && Number.isSafeInteger(level) && level >= 1 ? level : undefined
}

/** MinerU 4.x captions/footnotes are strings or `{ bbox, content }` objects; the canonical artifact holds strings. */
function captionStrings(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  const captions: string[] = []
  for (const item of value) {
    const text = typeof item === 'string' ? item : asRecord(item)?.content
    if (typeof text === 'string' && text.trim() !== '') captions.push(text)
  }
  return captions
}

/**
 * Converts the MinerU 4.x `structured_content.json` document into the plugin's canonical
 * content-list array: the page container supplies each block's `page_idx`, MinerU title
 * types map onto the canonical heading fields, and image/table references map onto the
 * canonical caption and image-path fields. Unknown fields are preserved as-is.
 */
export function canonicalizeStructuredContent(parsed: unknown): readonly unknown[] | undefined {
  // Already a canonical content list.
  if (Array.isArray(parsed)) return undefined
  const document = asRecord(parsed)
  const pages = document?.pages
  if (!Array.isArray(pages)) return undefined

  const blocks: unknown[] = []
  for (const page of pages) {
    const pageRecord = asRecord(page)
    if (pageRecord === undefined) continue
    const pageBlocks = pageRecord.blocks
    if (!Array.isArray(pageBlocks)) continue
    const pageIndex = pageRecord.page_idx
    for (const block of pageBlocks) {
      const source = asRecord(block)
      if (source === undefined) continue
      const target: Record<string, unknown> = { ...source }
      if (typeof pageIndex === 'number' && Number.isSafeInteger(pageIndex) && pageIndex >= 0) {
        target.page_idx = pageIndex
      }

      const type = typeof source.type === 'string' ? source.type.toLowerCase() : undefined
      if (type === 'doc_title' || type === 'paragraph_title') {
        target.type = 'title'
      }
      const level = paragraphTitleLevel(type, source)
      if (level !== undefined) target.text_level = level
      delete target.level

      if (typeof source.image_source === 'string' && target.img_path === undefined) {
        target.img_path = source.image_source
      }
      delete target.image_source

      const isTable = type === 'table'
      const captions = captionStrings(source.captions)
      if (captions.length > 0) {
        if (isTable) target.table_caption = captions
        else target.image_caption = captions
      }
      const footnotes = captionStrings(source.footnotes)
      if (footnotes.length > 0) {
        if (isTable) target.table_footnote = footnotes
        else target.image_footnote = footnotes
      }
      delete target.captions
      delete target.footnotes
      blocks.push(target)
    }
  }
  return blocks
}

/**
 * The plugin's canonical layout document exposes the ordered page list as `pdf_info[]`.
 * MinerU 4.x publishes the same list as `pages[]`; keep the upstream document and add the
 * canonical alias so physical page bounds stay verifiable.
 */
export function canonicalizeLayoutDocument(parsed: unknown): Record<string, unknown> | undefined {
  const document = asRecord(parsed)
  if (document === undefined) return undefined
  if (Array.isArray(document.pdf_info)) return undefined
  const pages = document.pages
  if (!Array.isArray(pages)) return undefined
  return { ...document, pdf_info: pages }
}

/**
 * Rewrites the two MinerU 4.x document shapes into canonical artifacts on their way into
 * staging; every other entry is streamed through untouched.
 */
function canonicalizingSink(sink: ArtifactSink): ArtifactSink {
  return {
    writeTemporary: async (name, input, maxBytes) => await sink.writeTemporary(name, input, maxBytes),
    writeArtifact: async (
      fileId,
      kind,
      input: ArtifactInput,
      options: ArtifactWriteOptions,
    ): Promise<ArtifactRef> => {
      const canonicalize = kind === 'content-list'
        ? canonicalizeStructuredContent
        : kind === 'layout'
          ? canonicalizeLayoutDocument
          : undefined
      if (canonicalize === undefined) {
        return await sink.writeArtifact(fileId, kind, input, options)
      }
      const raw = await readArtifactInputText(input, options.maxBytes)
      let canonical: unknown
      try {
        canonical = canonicalize(JSON.parse(raw) as unknown)
      } catch {
        canonical = undefined
      }
      return canonical === undefined
        ? await sink.writeArtifact(fileId, kind, raw, options)
        : await sink.writeArtifact(fileId, kind, JSON.stringify(canonical), options)
    },
  }
}

export class SelfHostedV1ApiAdapter {
  private readonly options: SelfHostedV1ApiAdapterOptions

  constructor(options: SelfHostedV1ApiAdapterOptions) {
    this.options = options
  }

  /** Cheap protocol probe: answers whether the configured endpoint speaks the V1 API. */
  async health(context: ProviderCallContext): Promise<SelfHostedV1HealthResponse> {
    const health = await this.requestJson<unknown>(
      'GET',
      '/v1/health',
      undefined,
      {},
      context,
      [200],
      { operation: 'probe', retry: true },
    )
    if (!isSelfHostedV1Health(health)) {
      throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'Endpoint did not answer the MinerU 4.x V1 health document', false, { provider: 'self-hosted-v2' }))
    }
    return health
  }

  async probe(context: ProviderCallContext, health: SelfHostedV1HealthResponse): Promise<ProviderProbeResult> {
    const isHealthy = health.status === undefined || health.status === 'ok' || health.status === 'healthy'
    const hasCredential = typeof context.credential === 'string' && context.credential.trim() !== ''
    let authentication: ProviderProbeResult['authentication'] = hasCredential ? 'unknown' : 'not-configured'
    let queue: ProviderProbeResult['queue']
    let diagnostics: string | undefined

    // /v1/health is public; /v1/usage is the cheapest authenticated endpoint, so it both
    // validates the credential and reports the server concurrency limit.
    if (hasCredential) {
      try {
        const usage = await this.requestJson<SelfHostedV1UsageResponse>(
          'GET',
          '/v1/usage',
          undefined,
          {},
          context,
          [200],
          { operation: 'probe', retry: true },
        )
        authentication = 'valid'
        if (typeof usage?.limits?.max_concurrent_jobs === 'number') {
          queue = { maxConcurrent: usage.limits.max_concurrent_jobs }
        }
      } catch (error: unknown) {
        if (context.signal.aborted) {
          throw new MinerUError(failure('CANCELLED', 'Probe operation was cancelled', true))
        }
        const probeFailure = toMinerUFailure(error)
        if (probeFailure.code === 'AUTHENTICATION_FAILED') authentication = 'invalid'
        else diagnostics = sanitizeDiagnostic(probeFailure.message)
      }
    }

    return {
      available: isHealthy,
      provider: 'self-hosted-v2',
      authentication,
      protocolVersion: 'v1',
      ...(typeof health.version === 'string' ? { serverVersion: health.version } : {}),
      ...(queue === undefined ? {} : { queue }),
      ...(isHealthy ? {} : { diagnostics: diagnostics ?? 'Server reported unhealthy status' }),
    }
  }

  async submit(
    request: CanonicalParseRequest,
    sources: readonly PreparedSourceFile[],
    context: ProviderCallContext,
  ): Promise<ProviderSubmission> {
    context.signal.throwIfAborted()
    if (sources.length !== request.files.length) {
      throw new MinerUError(failure('INVALID_REQUEST', 'Prepared source files count does not match request files count'))
    }
    await assertSourcesUnchanged(sources, context.signal)

    const upstreamFileIds: string[] = []
    for (let index = 0; index < sources.length; index++) {
      context.signal.throwIfAborted()
      upstreamFileIds.push(await this.uploadSource(sources[index]!, context))
    }

    const pageRange = request.semantics.pages?.trim()
    const tier = this.resolveTier(request.semantics.model)
    const payload = {
      files: upstreamFileIds.map(fileId => ({
        source: { type: 'file_id', file_id: fileId },
        ...(pageRange === undefined || pageRange === '' ? {} : { page_range: pageRange }),
      })),
      ...(tier === undefined ? {} : { tier }),
      ocr_mode: request.semantics.parseMethod,
      output_formats: [SELF_HOSTED_V1_ARCHIVE_FORMAT],
    }

    const job = await this.requestJson<SelfHostedV1JobResponse>(
      'POST',
      '/v1/parse/jobs',
      JSON.stringify(payload),
      { 'content-type': 'application/json' },
      context,
      [200, 202],
      { operation: 'submit', retry: false },
    )
    const jobId = job?.job_id
    if (typeof jobId !== 'string' || jobId.trim() === '') {
      throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'MinerU server did not return a valid job_id', false, { provider: 'self-hosted-v2' }))
    }

    const submittedFiles: ProviderSubmittedFile[] = request.files.map(file => ({
      dataId: `data_${file.fileId}`,
      fileId: file.fileId,
      name: file.name,
    }))
    const ref: ProviderJobRef = { provider: 'self-hosted-v2', protocol: 'v1', taskId: jobId, files: submittedFiles }
    await context.onAccepted?.(ref)

    const snapshot = this.snapshotFromJob(ref, job, context)
    return { ref, state: snapshot.state, files: snapshot.files }
  }

  async inspect(ref: ProviderJobRef, context: ProviderCallContext): Promise<ProviderJobSnapshot> {
    context.signal.throwIfAborted()
    if (ref.provider !== 'self-hosted-v2' || ref.protocol !== 'v1') {
      throw new MinerUError(failure('INVALID_REQUEST', `Unsupported provider ref for the self-hosted V1 API adapter`))
    }
    const job = await this.requestJson<SelfHostedV1JobResponse>(
      'GET',
      `/v1/parse/jobs/${encodeURIComponent(ref.taskId)}`,
      undefined,
      {},
      context,
      [200],
      { operation: 'inspect', retry: true },
    )
    return this.snapshotFromJob(ref, job, context)
  }

  async collect(
    ref: ProviderJobRef,
    request: CanonicalParseRequest,
    sink: ArtifactSink,
    context: ProviderCallContext,
  ): Promise<ProviderCollection> {
    context.signal.throwIfAborted()
    if (ref.provider !== 'self-hosted-v2' || ref.protocol !== 'v1') {
      throw new MinerUError(failure('INVALID_REQUEST', `Unsupported provider ref for the self-hosted V1 API adapter`))
    }

    const job = await this.requestJson<SelfHostedV1JobResponse>(
      'GET',
      `/v1/parse/jobs/${encodeURIComponent(ref.taskId)}`,
      undefined,
      {},
      context,
      [200],
      { operation: 'collect', retry: true },
    )
    const jobFiles = Array.isArray(job?.files) ? job.files : []
    const collectedFiles: ProviderCollectedFile[] = []

    for (let index = 0; index < ref.files.length; index++) {
      context.signal.throwIfAborted()
      const file = ref.files[index]!
      const jobFile = matchV1JobFile(jobFiles, file, index)
      if (jobFile === undefined) {
        throw new MinerUError(failure('RESULT_NOT_READY', `Result for file "${file.name}" is not ready`, true, {
          provider: 'self-hosted-v2',
          fileId: file.fileId,
        }))
      }

      const fileState = mapSelfHostedV1FileState(jobFile.status)
      if (fileState === 'failed') {
        collectedFiles.push({
          fileId: file.fileId,
          name: file.name,
          artifacts: [],
          failure: failure(
            'REMOTE_PARSE_FAILED',
            sanitizeDiagnostic(jobFile.error?.message ?? 'Remote document extraction failed', [context.credential ?? '']),
            false,
            { provider: 'self-hosted-v2', fileId: file.fileId },
          ),
        })
        continue
      }
      if (fileState !== 'completed') {
        throw new MinerUError(failure('RESULT_NOT_READY', `Result for file "${file.name}" is not ready (state: ${String(jobFile.status)})`, true, {
          provider: 'self-hosted-v2',
          fileId: file.fileId,
        }))
      }

      const archive = jobFile.output_files?.[SELF_HOSTED_V1_ARCHIVE_FORMAT]
      const archiveFileId = archive?.file_id
      if (typeof archiveFileId !== 'string' || archiveFileId.trim() === '') {
        throw archiveInvalid(`Completed file "${file.name}" has no ${SELF_HOSTED_V1_ARCHIVE_FORMAT} output`, file.fileId)
      }

      const temporary = await this.downloadResultArchive(archiveFileId, sink, context, index)
      const extracted = await extractSafeZip({
        zipPath: temporary.path,
        sink: canonicalizingSink(sink),
        files: [{ fileId: file.fileId, dataId: file.dataId, name: file.name }],
        requiredArtifacts: request.requiredArtifacts,
        limits: context.limits,
        signal: context.signal,
      })
      collectedFiles.push(...extracted)
    }

    return { files: collectedFiles }
  }

  /**
   * Resolves the V1 tier for one request; shared with the compatibility key so both agree.
   */
  private resolveTier(model: MinerUModel): string | undefined {
    return resolveSelfHostedTier(this.options.tier, this.options.modelMap, model)
  }

  private snapshotFromJob(
    ref: Extract<ProviderJobRef, { readonly provider: 'self-hosted-v2' }>,
    job: SelfHostedV1JobResponse,
    context: ProviderCallContext,
  ): { state: MinerUJobState; files: readonly ProviderFileSnapshot[] } {
    const jobFiles = Array.isArray(job?.files) ? job.files : []

    // Some responses (for example a canceled job) omit the per-file list; fall back to the
    // job status for every submitted file.
    if (jobFiles.length === 0) {
      const state = mapSelfHostedV1JobState(job?.status)
      const fileState: MinerUFileState = state === 'queued' || state === 'processing' ? state : 'failed'
      return {
        state,
        files: ref.files.map(file => ({
          fileId: file.fileId,
          state: fileState,
          rawState: typeof job?.status === 'string' ? job.status : undefined,
          ...(fileState === 'failed'
            ? { failure: failure('REMOTE_PARSE_FAILED', 'Remote parse job did not complete', false, { provider: 'self-hosted-v2', fileId: file.fileId }) }
            : {}),
        })),
      }
    }

    const snapshots: ProviderFileSnapshot[] = []
    let hasNonTerminal = false
    let everyQueued = true
    let allCompleted = true
    let allFailed = true
    // A terminal job that never lists a submitted file will never list it later, so the
    // file is reported as failed instead of being polled until the caller's timeout.
    const terminalJob = optionalSelfHostedV1JobState(job?.status)
    const jobFinished = terminalJob === 'completed' || terminalJob === 'failed' || terminalJob === 'partially-completed'

    for (let index = 0; index < ref.files.length; index++) {
      const file = ref.files[index]!
      const jobFile = matchV1JobFile(jobFiles, file, index)
      if (jobFile === undefined) {
        const missingState: MinerUFileState = jobFinished ? 'failed' : 'processing'
        snapshots.push({
          fileId: file.fileId,
          state: missingState,
          rawState: 'pending',
          ...(missingState === 'failed'
            ? { failure: failure('REMOTE_PARSE_FAILED', 'Remote parse job finished without a result for this file', false, { provider: 'self-hosted-v2', fileId: file.fileId }) }
            : {}),
        })
        if (missingState === 'processing') hasNonTerminal = true
        everyQueued = false
        allCompleted = false
        if (missingState !== 'failed') allFailed = false
        continue
      }

      const fileState = mapSelfHostedV1FileState(jobFile.status)
      snapshots.push({
        fileId: file.fileId,
        state: fileState,
        rawState: typeof jobFile.status === 'string' ? jobFile.status : undefined,
        ...(fileState === 'failed'
          ? {
              failure: failure(
                'REMOTE_PARSE_FAILED',
                sanitizeDiagnostic(jobFile.error?.message ?? 'Remote document extraction failed', [context.credential ?? '']),
                false,
                { provider: 'self-hosted-v2', fileId: file.fileId },
              ),
            }
          : {}),
      })

      if (fileState !== 'completed' && fileState !== 'failed') hasNonTerminal = true
      if (fileState !== 'queued') everyQueued = false
      if (fileState !== 'completed') allCompleted = false
      if (fileState !== 'failed') allFailed = false
    }

    let state: MinerUJobState
    if (hasNonTerminal) state = everyQueued ? 'queued' : 'processing'
    else if (allCompleted) state = 'completed'
    else if (allFailed) state = 'failed'
    else state = 'partially-completed'

    return { state, files: snapshots }
  }

  private async uploadSource(source: PreparedSourceFile, context: ProviderCallContext): Promise<string> {
    const created = await this.requestJson<SelfHostedV1UploadResponse>(
      'POST',
      '/v1/uploads',
      JSON.stringify({
        filename: source.name,
        bytes: source.bytes,
        mime_type: mimeTypeForName(source.name),
        purpose: 'parse',
        sha256sum: source.sha256,
      }),
      { 'content-type': 'application/json' },
      context,
      [200],
      { operation: 'submit', retry: false },
    )

    // Upload deduplication: an identical file is already stored and needs no byte transfer.
    if (created?.status === 'completed') return this.requireFileId(created, source.name)
    if (created?.status !== 'pending') {
      throw uploadFailed(`MinerU upload session entered unsupported state "${sanitizeDiagnostic(String(created?.status))}"`, false, { fileId: source.fileId })
    }

    const uploadId = created.id
    const uploadUrl = created.upload_url
    if (typeof uploadId !== 'string' || uploadId.trim() === '' || typeof uploadUrl !== 'string' || uploadUrl.trim() === '') {
      throw uploadFailed('MinerU server returned an incomplete upload session', false, { fileId: source.fileId })
    }
    if (created.upload_method !== undefined && created.upload_method !== null && created.upload_method !== 'PUT') {
      throw uploadFailed(`MinerU server requested unsupported upload method "${sanitizeDiagnostic(String(created.upload_method))}"`, false, { fileId: source.fileId })
    }

    await this.putUploadBytes(uploadUrl, created.upload_headers ?? {}, source, context)

    const completed = await this.requestJson<SelfHostedV1UploadResponse>(
      'POST',
      `/v1/uploads/${encodeURIComponent(uploadId)}/complete`,
      JSON.stringify({}),
      { 'content-type': 'application/json' },
      context,
      [200],
      { operation: 'submit', retry: false },
    )
    return this.requireFileId(completed, source.name)
  }

  private requireFileId(upload: SelfHostedV1UploadResponse | undefined, name: string): string {
    const fileId = upload?.file?.id
    if (typeof fileId !== 'string' || fileId.trim() === '') {
      throw uploadFailed(`MinerU server did not return a file id for "${name}"`)
    }
    return fileId
  }

  /**
   * Streams source bytes to the service-provided upload URL. The API key is attached only
   * when the target is same-origin with the configured endpoint; service-provided upload
   * headers are otherwise preserved verbatim. PUT is idempotent, so transient failures retry
   * with a freshly opened source file.
   */
  private async putUploadBytes(
    rawUploadUrl: string,
    uploadHeaders: Readonly<Record<string, string>>,
    source: PreparedSourceFile,
    context: ProviderCallContext,
  ): Promise<void> {
    const target = this.resolveUploadUrl(rawUploadUrl)
    const sameOrigin = this.isSameOrigin(target)
    const headers: Record<string, string> = {}
    let serviceAuthorization = false
    for (const [key, value] of Object.entries(uploadHeaders)) {
      // Service-provided headers are forwarded verbatim, but never as header-injection vectors.
      if (typeof value !== 'string' || /[\r\n]/.test(key) || /[\r\n]/.test(value)) {
        throw uploadFailed('MinerU server returned an invalid upload header')
      }
      if (key.toLowerCase() === 'authorization') serviceAuthorization = true
      headers[key] = value
    }
    // A service-provided Authorization describes the upload target itself and must win;
    // HTTP header names are case-insensitive, so a second spelling would be merged into one
    // corrupted value instead of overriding it.
    if (sameOrigin && !serviceAuthorization
      && typeof context.credential === 'string' && context.credential.trim() !== '') {
      headers['authorization'] = `Bearer ${context.credential}`
    }

    await executeWithRetry({
      provider: 'self-hosted-v2',
      operation: 'upload-put',
      signal: context.signal,
      retryOptions: mergeRetryOptions(this.options.retry, context.retry),
      fn: async () => {
        context.signal.throwIfAborted()
        await assertSourcesUnchanged([source], context.signal)

        const controller = new AbortController()
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          controller.abort(new DOMException(`Upload timed out after ${String(context.timeoutMs)}ms`, 'TimeoutError'))
        }, context.timeoutMs)
        const onParentAbort = (): void => { controller.abort(context.signal.reason) }
        context.signal.addEventListener('abort', onParentAbort, { once: true })

        try {
          // A Blob body makes the runtime send Content-Length, which presigned and
          // size-checking upload targets require; it is reopened on every attempt.
          const blob = await openAsBlob(source.path)
          const requestInit: RequestInit = {
            method: 'PUT',
            headers,
            body: blob,
            signal: controller.signal,
            redirect: 'error',
          }
          let response: Response
          try {
            response = await fetch(target.toString(), requestInit)
          } catch (error: unknown) {
            if (context.signal.aborted) throw new MinerUError(failure('CANCELLED', 'Upload was cancelled', true))
            if (timedOut) {
              const timeoutError = uploadFailed(`Upload to MinerU server timed out after ${String(context.timeoutMs)}ms`, true, { fileId: source.fileId })
              Object.assign(timeoutError, { httpStatus: 408 })
              throw timeoutError
            }
            const message = error instanceof Error ? error.message : String(error)
            throw uploadFailed(`Failed to upload source bytes: ${sanitizeDiagnostic(message)}`, true, { fileId: source.fileId })
          }

          if (response.status !== 200 && response.status !== 204) {
            let errorBody = ''
            try {
              errorBody = await readBoundedResponseText(response, 2048, controller.signal)
            } catch {
              if (response.body) { try { await response.body.cancel() } catch {} }
            }
            const error = uploadFailed(
              `Upload failed with HTTP status ${String(response.status)}${errorBody === '' ? '' : `: ${sanitizeDiagnostic(errorBody, [context.credential ?? ''])}`}`,
              isRetryableHttpStatus(response.status),
              { fileId: source.fileId },
            )
            Object.assign(error, {
              httpStatus: response.status,
              retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
            })
            throw error
          }
          if (response.body) { try { await response.body.cancel() } catch {} }
        } finally {
          clearTimeout(timer)
          context.signal.removeEventListener('abort', onParentAbort)
        }
      },
    })
  }

  private resolveUploadUrl(raw: string): URL {
    let target: URL
    try {
      target = new URL(raw, this.options.baseUrl)
    } catch {
      throw uploadFailed('MinerU server returned an invalid upload URL')
    }
    if ((target.protocol !== 'https:' && target.protocol !== 'http:') || target.username !== '' || target.password !== '') {
      throw uploadFailed('MinerU server returned an unsupported upload URL')
    }
    // Never let an HTTPS-configured endpoint downgrade the byte transfer to cleartext elsewhere.
    if (isInsecureCrossOriginUpload(target, this.options.baseUrl)) {
      throw uploadFailed('MinerU server returned an insecure cross-origin upload URL')
    }
    return target
  }

  private isSameOrigin(target: URL): boolean {
    return isSameOriginUrl(target, this.options.baseUrl)
  }

  /** Downloads the result archive of a completed file into a bounded staging temporary file. */
  private async downloadResultArchive(
    fileId: string,
    sink: ArtifactSink,
    context: ProviderCallContext,
    index: number,
  ): Promise<{ path: string }> {
    const url = resolveProviderUrl(this.options.baseUrl, `/v1/files/${encodeURIComponent(fileId)}/content`)
    const headers: Record<string, string> = {}
    if (typeof context.credential === 'string' && context.credential.trim() !== '') {
      headers['authorization'] = `Bearer ${context.credential}`
    }

    return await executeWithRetry({
      provider: 'self-hosted-v2',
      operation: 'result-download',
      signal: context.signal,
      retryOptions: mergeRetryOptions(this.options.retry, context.retry),
      fn: async () => {
        context.signal.throwIfAborted()

        const controller = new AbortController()
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          controller.abort(new DOMException(`Download timed out after ${String(context.timeoutMs)}ms`, 'TimeoutError'))
        }, context.timeoutMs)
        const onParentAbort = (): void => { controller.abort(context.signal.reason) }
        context.signal.addEventListener('abort', onParentAbort, { once: true })

        try {
          let response: Response
          try {
            response = await fetch(url, { method: 'GET', headers, signal: controller.signal, redirect: 'error' })
          } catch (error: unknown) {
            if (context.signal.aborted) throw new MinerUError(failure('CANCELLED', 'Download was cancelled', true))
            if (timedOut) {
              const timeoutError = new MinerUError(failure('RESULT_DOWNLOAD_FAILED', `Result download timed out after ${String(context.timeoutMs)}ms`, true, { provider: 'self-hosted-v2' }))
              Object.assign(timeoutError, { httpStatus: 408 })
              throw timeoutError
            }
            const message = error instanceof Error ? error.message : String(error)
            throw new MinerUError(failure('RESULT_DOWNLOAD_FAILED', `Failed to download result archive: ${sanitizeDiagnostic(message)}`, true, { provider: 'self-hosted-v2' }))
          }

          if (response.status !== 200) {
            if (response.body) { try { await response.body.cancel() } catch {} }
            const error = new MinerUError(failure('RESULT_DOWNLOAD_FAILED', `Failed to download result archive, HTTP status ${String(response.status)}`, isRetryableHttpStatus(response.status), { provider: 'self-hosted-v2' }))
            Object.assign(error, {
              httpStatus: response.status,
              retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
            })
            throw error
          }
          const body = response.body
          if (body === null) {
            throw new MinerUError(failure('RESULT_DOWNLOAD_FAILED', 'Result archive response body is empty', false, { provider: 'self-hosted-v2' }))
          }

          const nodeStream = Readable.fromWeb(body as NodeWebReadableStream<Uint8Array>)
          // An accepted response whose body then breaks is a transport failure and stays
          // retryable; failures raised by staging itself (byte limits, local writes) are not.
          let bodyFailed = false
          const onBodyError = (): void => { bodyFailed = true }
          nodeStream.once('error', onBodyError)
          try {
            // The submitted-file index keeps two files that resolve to the same archive id
            // from colliding on one staging temporary name.
            return await sink.writeTemporary(
              `mineru_v1_${String(index)}_${fileId.replace(/[^A-Za-z0-9._-]/g, '_')}.zip`,
              nodeStream,
              context.limits.maxZipDownloadBytes,
            )
          } catch (error) {
            nodeStream.destroy()
            if (context.signal.aborted) {
              throw new MinerUError(failure('CANCELLED', 'Download was cancelled', true))
            }
            if (error instanceof MinerUError) throw error
            const message = sanitizeDiagnostic(error instanceof Error ? error.message : String(error))
            if (bodyFailed) {
              const interrupted = new MinerUError(failure(
                'RESULT_DOWNLOAD_FAILED',
                `Result archive transfer was interrupted after HTTP 200: ${message}`,
                true,
                { provider: 'self-hosted-v2' },
              ))
              if (timedOut) Object.assign(interrupted, { httpStatus: 408 })
              throw interrupted
            }
            throw new MinerUError(failure(
              'RESULT_DOWNLOAD_FAILED',
              `Failed to stage the downloaded result archive: ${message}`,
              false,
              { provider: 'self-hosted-v2' },
            ))
          } finally {
            nodeStream.removeListener('error', onBodyError)
          }
        } finally {
          clearTimeout(timer)
          context.signal.removeEventListener('abort', onParentAbort)
        }
      },
    })
  }

  private async requestJson<T>(
    method: string,
    path: string,
    body: BodyInit | undefined,
    headers: Record<string, string>,
    context: ProviderCallContext,
    acceptedStatuses: readonly number[] = [200],
    options?: { operation?: ProviderRetryOperation; retry?: boolean },
  ): Promise<T> {
    return await this.options.client.requestJson<T>({
      method,
      path,
      ...(body === undefined ? {} : { body }),
      headers,
      context,
      acceptedStatuses,
      operation: options?.operation,
      retry: options?.retry,
    })
  }
}
