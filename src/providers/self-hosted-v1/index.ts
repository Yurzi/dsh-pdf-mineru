/**
 * self-hosted-v1.ts — MinerU 4.x self-hosted "V1 API" protocol adapter.
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

import { createHash } from 'node:crypto'
import { SelfHostedV1Uploader } from './upload.js'
import { canonicalizingSink } from './canonical-artifacts.js'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'
import type { MinerUFileState, MinerUJobState } from '../../domain/job.js'
import type { MinerUFileId } from '../../domain/ids.js'
import { SELF_HOSTED_TIERS, type SelfHostedV1Config } from '../../config/model.js'
import type { CanonicalParseRequest, PreparedSourceFile } from '../../domain/request.js'
import {
  MinerUError,
  failure,
  sanitizeDiagnostic,
  toMinerUFailure,
} from '../../domain/errors.js'
import { assertSourcesUnchanged } from '../../source/prepared-source.js'
import { ProviderHttpClient, resolveProviderUrl } from '../http/http-client.js'
import { extractSafeZip } from '../http/safe-zip.js'
import {
  type MinerUProvider,
  type ProviderCapabilities,
  type ProviderCallContext,
  type ProviderCollectedFile,
  type ProviderCollection,
  type ProviderFileSnapshot,
  type ProviderJobRef,
  type ProviderJobSnapshot,
  type ProviderProbeResult,
  type ProviderSubmission,
  type ProviderSubmittedFile,
} from '../contract.js'
import {
  type ArtifactSink,
} from '../../storage/artifact-port.js'
import {
  type ProviderRetryOperation,
  executeWithRetry,
  isRetryableHttpStatus,
  parseRetryAfter,
} from '../http/retry.js'

/** The only output format the plugin consumes; it carries every canonical artifact. */
export const SELF_HOSTED_V1_ARCHIVE_FORMAT = 'zip'

export interface SelfHostedV1HealthResponse {
  readonly status?: string
  readonly version?: string
  readonly features?: {
    readonly output_formats?: readonly string[]
    readonly sources?: readonly string[]
  }
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

interface SelfHostedV1AdapterOptions {
  readonly client: ProviderHttpClient
  readonly baseUrl: URL
}

function archiveInvalid(message: string, fileId?: MinerUFileId): MinerUError {
  return new MinerUError(failure('REMOTE_PARSE_FAILED', message, false, {
    provider: 'self-hosted-v1',
    ...(fileId === undefined ? {} : { fileId }),
  }))
}

/**
 * Maps a MinerU V1 job status to the plugin's aggregate job state.
 * `canceled` has no dedicated plugin state and is reported as a failed job.
 */
export function mapSelfHostedV1JobState(rawStatus: unknown): MinerUJobState {
  if (typeof rawStatus !== 'string') {
    throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'Missing job status from MinerU server response', false, { provider: 'self-hosted-v1' }))
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
      throw new MinerUError(failure('REMOTE_PARSE_FAILED', `Unknown remote job status: "${rawStatus}"`, false, { provider: 'self-hosted-v1' }))
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
    throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'Missing file status from MinerU server response', false, { provider: 'self-hosted-v1' }))
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
      throw new MinerUError(failure('REMOTE_PARSE_FAILED', `Unknown remote file status: "${rawStatus}"`, false, { provider: 'self-hosted-v1' }))
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

export class SelfHostedV1Provider implements MinerUProvider {
  readonly id = 'self-hosted-v1' as const
  readonly config: SelfHostedV1Config
  readonly capabilities: ProviderCapabilities = {
    models: ['pipeline'], parseMethods: ['auto', 'txt', 'ocr'], supportsOcr: true,
    supportsLanguage: false, supportsFormula: false, supportsTable: false,
    supportsPageRanges: true, supportedArtifacts: ['markdown', 'layout', 'model-output', 'content-list', 'images'],
    maxFilesPerSubmission: 10,
  }
  private readonly options: SelfHostedV1AdapterOptions
  private readonly uploader: SelfHostedV1Uploader

  constructor(config: SelfHostedV1Config) {
    this.config = config
    const baseUrl = new URL(config.baseURL)
    this.options = { baseUrl,
      client: new ProviderHttpClient({ baseURL: baseUrl, provider: this.id }) }
    this.uploader = new SelfHostedV1Uploader(baseUrl, this.options.client)
  }

  compatibilityKey(_request: CanonicalParseRequest): string {
    const { origin, pathname } = this.options.baseUrl
    const hash = createHash('sha256').update(JSON.stringify({
      originAndPath: origin + pathname.replace(/\/+$/, ''),
      configuredVersion: this.config.configuredVersion ?? 'v1',
      tier: this.config.tier ?? null,
    }), 'utf8').digest('hex').slice(0, 24)
    return 'self-hosted-v1:' + hash
  }

  async probe(context: ProviderCallContext): Promise<ProviderProbeResult> {
    try {
      return await this.probeHealth(context, await this.health(context))
    } catch (error) {
      if (context.signal.aborted) throw new MinerUError(failure('CANCELLED', 'Probe operation was cancelled', true))
      const reason = toMinerUFailure(error)
      return { available: false, provider: this.id, protocolVersion: 'v1',
        authentication: reason.code === 'AUTHENTICATION_FAILED' ? 'invalid' : context.credential ? 'unknown' : 'not-configured',
        diagnostics: sanitizeDiagnostic(reason.message, [context.credential ?? '']) }
    }
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
      throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'Endpoint did not answer the MinerU 4.x V1 health document', false, { provider: 'self-hosted-v1' }))
    }
    return health
  }

  private async discoverDeployment(context: ProviderCallContext, health: SelfHostedV1HealthResponse) {
    const response = await this.requestJson<{ readonly data?: readonly { readonly id?: unknown }[] }>(
      'GET', '/v1/tiers', undefined, {}, context, [200], { operation: 'probe', retry: true },
    )
    if (!Array.isArray(response?.data)) throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'Invalid V1 tiers response', false, { provider: this.id }))
    const availableTiers = [...new Set(response.data.map(item => item?.id).filter((id): id is string => typeof id === 'string' && (SELF_HOSTED_TIERS as readonly string[]).includes(id)))]
    const outputFormats = Array.isArray(health.features?.output_formats)
      ? [...new Set(health.features.output_formats.filter(value => ['markdown', 'middle_json', 'structured_content', 'zip'].includes(value)))] : []
    const sourceTypes = Array.isArray(health.features?.sources)
      ? [...new Set(health.features.sources.filter(value => ['file_id', 'url', 'inline'].includes(value)))] : []
    return { availableTiers, outputFormats, sourceTypes }
  }

  private deploymentIssue(deployment: { availableTiers: readonly string[]; outputFormats: readonly string[]; sourceTypes: readonly string[] }): string | undefined {
    if (!deployment.outputFormats.includes('zip')) return 'This V1 deployment does not advertise the required zip output'
    if (!deployment.sourceTypes.includes('file_id')) return 'This V1 deployment does not advertise uploaded file_id sources'
    if (deployment.availableTiers.length === 0) return 'This V1 deployment advertises no supported parse tiers'
    if (this.config.tier !== undefined && !deployment.availableTiers.includes(this.config.tier)) return 'The configured V1 tier is not available on this deployment'
    return undefined
  }

  private async probeHealth(context: ProviderCallContext, health: SelfHostedV1HealthResponse): Promise<ProviderProbeResult> {
    const deployment = await this.discoverDeployment(context, health)
    const healthy = health.status === undefined || health.status === 'ok' || health.status === 'healthy'
    const diagnostics = healthy ? this.deploymentIssue(deployment) : 'Server reported unhealthy status'
    return {
      available: healthy && diagnostics === undefined, provider: this.id, protocolVersion: 'v1',
      authentication: context.credential?.trim() ? 'valid' : 'not-configured',
      ...(typeof health.version === 'string' ? { serverVersion: health.version } : {}),
      ...deployment, ...(diagnostics === undefined ? {} : { diagnostics }),
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
    const health = await this.health(context)
    if (health.status !== undefined && health.status !== 'ok' && health.status !== 'healthy') {
      throw new MinerUError(failure('PROVIDER_UNAVAILABLE', 'V1 server reported unhealthy status', true, { provider: this.id }))
    }
    const issue = this.deploymentIssue(await this.discoverDeployment(context, health))
    if (issue !== undefined) throw new MinerUError(failure('UNSUPPORTED_OPTION', issue, false, { provider: this.id }))

    const upstreamFileIds: string[] = []
    for (let index = 0; index < sources.length; index++) {
      context.signal.throwIfAborted()
      upstreamFileIds.push(await this.uploader.uploadSource(sources[index]!, context))
    }

    const pageRange = request.semantics.pages?.trim()
    const tier = this.config.tier
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
      throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'MinerU server did not return a valid job_id', false, { provider: 'self-hosted-v1' }))
    }

    const submittedFiles: ProviderSubmittedFile[] = request.files.map(file => ({
      dataId: `data_${file.fileId}`,
      fileId: file.fileId,
      name: file.name,
    }))
    const ref: ProviderJobRef = { provider: 'self-hosted-v1', taskId: jobId, files: submittedFiles }

    const snapshot = this.snapshotFromJob(ref, job, context)
    return { ref, state: snapshot.state, files: snapshot.files }
  }

  async inspect(ref: ProviderJobRef, context: ProviderCallContext): Promise<ProviderJobSnapshot> {
    context.signal.throwIfAborted()
    if (ref.provider !== 'self-hosted-v1') {
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
    if (ref.provider !== 'self-hosted-v1') {
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
          provider: 'self-hosted-v1',
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
            { provider: 'self-hosted-v1', fileId: file.fileId },
          ),
        })
        continue
      }
      if (fileState !== 'completed') {
        throw new MinerUError(failure('RESULT_NOT_READY', `Result for file "${file.name}" is not ready (state: ${String(jobFile.status)})`, true, {
          provider: 'self-hosted-v1',
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

  private snapshotFromJob(
    ref: Extract<ProviderJobRef, { readonly provider: 'self-hosted-v1' }>,
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
            ? { failure: failure('REMOTE_PARSE_FAILED', 'Remote parse job did not complete', false, { provider: 'self-hosted-v1', fileId: file.fileId }) }
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
            ? { failure: failure('REMOTE_PARSE_FAILED', 'Remote parse job finished without a result for this file', false, { provider: 'self-hosted-v1', fileId: file.fileId }) }
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
                { provider: 'self-hosted-v1', fileId: file.fileId },
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
      provider: 'self-hosted-v1',
      operation: 'result-download',
      signal: context.signal,
      retryOptions: context.retry,
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
              const timeoutError = new MinerUError(failure('RESULT_DOWNLOAD_FAILED', `Result download timed out after ${String(context.timeoutMs)}ms`, true, { provider: 'self-hosted-v1' }), { http: { status: 408 } })
              throw timeoutError
            }
            const message = error instanceof Error ? error.message : String(error)
            throw new MinerUError(failure('RESULT_DOWNLOAD_FAILED', `Failed to download result archive: ${message}`, true, { provider: 'self-hosted-v1' }))
          }

          if (response.status !== 200) {
            if (response.body) { try { await response.body.cancel() } catch {} }
            const error = new MinerUError(
              failure('RESULT_DOWNLOAD_FAILED', `Failed to download result archive, HTTP status ${String(response.status)}`, isRetryableHttpStatus(response.status), { provider: 'self-hosted-v1' }),
              { http: { status: response.status, retryAfterMs: parseRetryAfter(response.headers.get('retry-after')) } },
            )
            throw error
          }
          const body = response.body
          if (body === null) {
            throw new MinerUError(failure('RESULT_DOWNLOAD_FAILED', 'Result archive response body is empty', false, { provider: 'self-hosted-v1' }))
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
            const message = error instanceof Error ? error.message : String(error)
            if (bodyFailed) {
              const interrupted = new MinerUError(failure(
                'RESULT_DOWNLOAD_FAILED',
                `Result archive transfer was interrupted after HTTP 200: ${message}`,
                true,
                { provider: 'self-hosted-v1' },
              ), { http: timedOut ? { status: 408 } : undefined })
              throw interrupted
            }
            throw new MinerUError(failure(
              'RESULT_DOWNLOAD_FAILED',
              `Failed to stage the downloaded result archive: ${message}`,
              false,
              { provider: 'self-hosted-v1' },
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
