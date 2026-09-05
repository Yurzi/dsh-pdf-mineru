import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { assertSourcesUnchanged } from '../service/request-normalizer.js'
import { ProviderHttpClient } from './http-client.js'
import { asProviderConfigId } from '../domain/ids.js'
import {
  MinerUError,
  failure,
  sanitizeDiagnostic,
  toMinerUFailure,
} from '../domain/errors.js'
import type {
  MinerUFileState,
  MinerUJobState,
} from '../domain/job.js'
import type {
  CanonicalParseRequest,
  PreparedSourceFile,
} from '../domain/request.js'
import {
  type ArtifactSink,
  type MinerUProvider,
  type ProviderCallContext,
  type ProviderCapabilities,
  type ProviderCollectedFile,
  type ProviderCollection,
  type ProviderCompatibilityContext,
  type ProviderFileSnapshot,
  type ProviderJobRef,
  type ProviderJobSnapshot,
  type ProviderOptions,
  type ProviderProbeResult,
  type ProviderRetryOperation,
  type ProviderRetryOptions,
  type ProviderSubmission,
  type ProviderSubmittedFile,
  type TemporaryArtifact,
  executeWithRetry,
  mergeRetryOptions,
  readBoundedResponseText,
  isRetryableHttpStatus,
  parseRetryAfter,
  validateProviderCapabilities,
} from './provider.js'
import type { OfficialV4Config } from '../config.js'
import type {
  OfficialV4ApiResponse,
  OfficialV4BatchSubmitData,
  OfficialV4BatchSubmitRequest,
  OfficialV4ExtractResultItem,
  OfficialV4ExtractResultsData,
} from './official-v4-types.js'
import { extractSafeZip } from './safe-zip.js'

function validateAndNormalizeOfficialBaseURL(rawUrl: string): URL {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new MinerUError(failure('INVALID_REQUEST', 'Official v4 baseURL must be a non-empty string'))
  }
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch (err) {
    throw new MinerUError(
      failure('INVALID_REQUEST', `Invalid provider baseURL: "${sanitizeDiagnostic(rawUrl)}"`),
      { cause: err },
    )
  }
  if (parsed.protocol !== 'https:') {
    throw new MinerUError(failure('INVALID_REQUEST', 'Official v4 baseURL must use HTTPS'))
  }
  if (parsed.username || parsed.password) {
    throw new MinerUError(failure('INVALID_REQUEST', 'Provider baseURL must not contain embedded credentials'))
  }
  if (parsed.search || parsed.hash) {
    throw new MinerUError(failure('INVALID_REQUEST', 'Provider baseURL must not contain query parameters or fragments'))
  }
  return parsed
}

function mapOfficialFileState(rawState: string | undefined): MinerUFileState {
  if (typeof rawState !== 'string') throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'Official result is missing file state'))
  switch (rawState.toLowerCase()) {
    case 'waiting-file':
    case 'pending':
    case 'queued':
      return 'queued'
    case 'running':
    case 'converting':
    case 'processing':
      return 'processing'
    case 'done':
    case 'completed':
    case 'success':
      return 'completed'
    case 'failed':
    case 'error':
      return 'failed'
    default:
      throw new MinerUError(failure('REMOTE_PARSE_FAILED', `Unknown official file state: ${sanitizeDiagnostic(rawState)}`, false, { provider: 'official-v4' }))
  }
}

function isMissingBatchProbeSentinel(code: number | string, message: string): boolean {
  const normalizedCode = String(code).toUpperCase()
  if (normalizedCode === 'BATCH_NOT_FOUND') return true
  return (normalizedCode === '-500' || normalizedCode === '-60012')
    && /^task not found or expire(?:d)?[.!]?$/i.test(message.trim())
}

function officialBusinessFailure(code: number | string, message: string, traceId?: string): MinerUError {
  const providerCode = String(code)
  const normalized = providerCode.toUpperCase()
  const details = { provider: 'official-v4' as const, providerCode, ...(traceId === undefined ? {} : { traceId }) }
  if (normalized === 'A0202' || normalized === 'A0211' || normalized === '401') {
    return new MinerUError(failure('AUTHENTICATION_FAILED', message, false, details))
  }
  if (normalized === '-60018' || normalized === '-60019') {
    return new MinerUError(failure('PROVIDER_QUOTA_EXHAUSTED', message, false, details))
  }
  if (normalized === '-60005') return new MinerUError(failure('FILE_TOO_LARGE', message, false, details))
  if (normalized === '429') return new MinerUError(failure('PROVIDER_RATE_LIMITED', message, true, details))
  return new MinerUError(failure('REMOTE_PARSE_FAILED', message, false, details))
}

function externalHttpsUrl(raw: string, label: string): string {
  let url: URL
  try { url = new URL(raw) } catch { throw new MinerUError(failure('REMOTE_PARSE_FAILED', `${label} is not a valid URL`)) }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new MinerUError(failure('REMOTE_PARSE_FAILED', `${label} must be an HTTPS URL without embedded credentials`))
  }
  return url.toString()
}

function parseProgress(extractProgress: unknown): { completed: number; total: number } | undefined {
  if (typeof extractProgress === 'object' && extractProgress !== null) {
    const obj = extractProgress as Record<string, unknown>
    const extracted = typeof obj['extracted_pages'] === 'number' ? obj['extracted_pages'] : undefined
    const total = typeof obj['total_pages'] === 'number' ? obj['total_pages'] : undefined
    if (extracted !== undefined && total !== undefined
      && Number.isSafeInteger(extracted) && Number.isSafeInteger(total)
      && extracted >= 0 && total > 0 && extracted <= total) {
      return { completed: extracted, total }
    }
  }
  if (Number.isSafeInteger(extractProgress)
    && (extractProgress as number) >= 0 && (extractProgress as number) <= 100) {
    return { completed: extractProgress as number, total: 100 }
  }
  return undefined
}

function indexExtractResults(
  extractResults: readonly OfficialV4ExtractResultItem[],
  ref: Extract<ProviderJobRef, { readonly provider: 'official-v4' }>,
): ReadonlyMap<string, OfficialV4ExtractResultItem> {
  const expected = new Set(ref.files.map(file => file.dataId))
  if (expected.size !== ref.files.length) {
    throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'Official provider reference contains duplicate data_id mappings', false, { provider: 'official-v4' }))
  }
  const results = new Map<string, OfficialV4ExtractResultItem>()
  for (const item of extractResults) {
    if (typeof item.data_id !== 'string' || item.data_id.trim() === '') {
      throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'Official result item is missing data_id', false, { provider: 'official-v4' }))
    }
    if (!expected.has(item.data_id)) {
      throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'Official result contains an unknown data_id', false, { provider: 'official-v4' }))
    }
    if (results.has(item.data_id)) {
      throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'Official result contains a duplicate data_id', false, { provider: 'official-v4' }))
    }
    results.set(item.data_id, item)
  }
  return results
}

export class OfficialV4Provider implements MinerUProvider {
  readonly id = 'official-v4' as const
  readonly config: OfficialV4Config
  readonly capabilities: ProviderCapabilities
  private readonly parsedBaseUrl: URL
  private readonly retryOptions: ProviderRetryOptions
  private readonly client: ProviderHttpClient

  constructor(config: OfficialV4Config, options?: ProviderOptions) {
    asProviderConfigId(config.id)
    this.config = config
    this.retryOptions = options?.retry ?? {}
    this.parsedBaseUrl = validateAndNormalizeOfficialBaseURL(config.baseURL)
    this.client = new ProviderHttpClient({
      baseURL: this.parsedBaseUrl,
      provider: 'official-v4',
      defaultRetry: this.retryOptions,
      providerLabel: 'MinerU official API',
    })

    const supportedModels = config.models.length > 0 ? config.models : (['pipeline', 'vlm'] as const)

    this.capabilities = {
      models: supportedModels,
      parseMethods: ['auto', 'ocr'],
      supportsOcr: true,
      supportsLanguage: true,
      supportsFormula: true,
      supportsTable: true,
      supportsPageRanges: true,
      supportedArtifacts: ['markdown', 'layout', 'model-output', 'content-list', 'images'],
      maxFilesPerSubmission: 200,
      maxFileBytes: 200 * 1024 * 1024,
      maxPagesPerFile: 200,
    }
  }

  async compatibilityKey(
    request: CanonicalParseRequest,
    context: ProviderCompatibilityContext,
  ): Promise<string> {
    const originAndPath = `${this.parsedBaseUrl.origin}${this.parsedBaseUrl.pathname.replace(/\/+$/, '')}`
    const behaviorHash = createHash('sha256').update(JSON.stringify({
      originAndPath,
      configuredVersion: context.configuredVersion ?? this.config.configuredVersion ?? 'v4',
      model: request.semantics.model,
    }), 'utf8').digest('hex').slice(0, 24)
    return `official-v4:${behaviorHash}`
  }

  async probe(context: ProviderCallContext): Promise<ProviderProbeResult> {
    if (!context.credential || context.credential.trim() === '') {
      return {
        available: false,
        provider: 'official-v4',
        authentication: 'not-configured',
        protocolVersion: 'v4',
        diagnostics: 'API key is not configured',
      }
    }

    try {
      // Send a lightweight probe query to check connectivity and auth without creating parsing jobs
      await this.requestJson<OfficialV4ApiResponse<OfficialV4ExtractResultsData>>(
        'GET',
        '/extract-results/batch/__dsh_probe__',
        undefined,
        {},
        context,
        [200, 404],
        { operation: 'probe', retry: true, businessValidation: 'probe' },
      )

      return {
        available: true,
        provider: 'official-v4',
        authentication: 'valid',
        protocolVersion: 'v4',
      }
    } catch (error: unknown) {
      if (context.signal.aborted) {
        throw new MinerUError(failure('CANCELLED', 'Probe operation was cancelled', true))
      }
      const minerUFailure = toMinerUFailure(error)
      const isAuthError = minerUFailure.code === 'AUTHENTICATION_FAILED'

      return {
        available: false,
        provider: 'official-v4',
        authentication: isAuthError ? 'invalid' : 'unknown',
        protocolVersion: 'v4',
        diagnostics: sanitizeDiagnostic(minerUFailure.message),
      }
    }
  }

  async submit(
    request: CanonicalParseRequest,
    sources: readonly PreparedSourceFile[],
    context: ProviderCallContext,
  ): Promise<ProviderSubmission> {
    context.signal.throwIfAborted()
    validateProviderCapabilities(request, this.capabilities)

    if (sources.length !== request.files.length) {
      throw new MinerUError(failure('INVALID_REQUEST', 'Prepared source files count does not match request files count'))
    }

    // Pre-submission verification: ensure files exist and fingerprints match
    await assertSourcesUnchanged(sources, context.signal)

    const submittedFiles: ProviderSubmittedFile[] = request.files.map(f => ({
      dataId: `data_${f.fileId}`,
      fileId: f.fileId,
      name: f.name,
    }))

    const payload: OfficialV4BatchSubmitRequest = {
      files: request.files.map((file, i) => {
        const sub = submittedFiles[i]!
        return {
          name: file.name,
          data_id: sub.dataId,
          is_ocr: request.semantics.ocr,
          enable_formula: request.semantics.formula,
          enable_table: request.semantics.table,
          language: request.semantics.language,
          ...(request.semantics.pages !== undefined ? { page_ranges: request.semantics.pages } : {}),
        }
      }),
      model_version: request.semantics.model,
    }

    const submitResponse = await this.requestJson<OfficialV4ApiResponse<OfficialV4BatchSubmitData>>(
      'POST',
      '/file-urls/batch',
      JSON.stringify(payload),
      { 'content-type': 'application/json' },
      context,
      [200],
      { operation: 'submit', retry: false },
    )

    if (!submitResponse || typeof submitResponse !== 'object') {
      throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'MinerU server returned empty or invalid response', false, { provider: 'official-v4' }))
    }

    const batchId = submitResponse.data?.batch_id
    const fileUrls = submitResponse.data?.file_urls

    if (!batchId || typeof batchId !== 'string' || batchId.trim() === '') {
      throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'MinerU server did not return a valid batch_id', false, { provider: 'official-v4', traceId: submitResponse.trace_id }))
    }

    if (!Array.isArray(fileUrls) || fileUrls.length !== sources.length) {
      throw new MinerUError(
        failure(
          'REMOTE_PARSE_FAILED',
          `MinerU returned ${String(fileUrls?.length ?? 0)} upload URLs, expected ${String(sources.length)}`,
          false,
          { provider: 'official-v4', traceId: submitResponse.trace_id },
        ),
      )
    }

    const ref: ProviderJobRef = {
      provider: 'official-v4',
      batchId,
      files: submittedFiles,
    }
    await context.onAccepted?.(ref)

    // Bare PUT upload for each file in order
    for (let i = 0; i < sources.length; i++) {
      context.signal.throwIfAborted()
      const source = sources[i]!
      const uploadUrl = externalHttpsUrl(fileUrls[i]!, 'Official presigned upload URL')
      await this.barePutStream(uploadUrl, source, context)
    }

    const fileSnapshots: ProviderFileSnapshot[] = request.files.map(f => ({
      fileId: f.fileId,
      state: 'processing' as MinerUFileState,
      rawState: 'running',
    }))

    return {
      ref,
      state: 'processing',
      files: fileSnapshots,
    }
  }

  async inspect(ref: ProviderJobRef, context: ProviderCallContext): Promise<ProviderJobSnapshot> {
    context.signal.throwIfAborted()
    if (ref.provider !== 'official-v4') {
      throw new MinerUError(failure('INVALID_REQUEST', `Unsupported provider ref "${ref.provider}" for OfficialV4Provider`))
    }

    const data = await this.requestJson<OfficialV4ApiResponse<OfficialV4ExtractResultsData>>(
      'GET',
      `/extract-results/batch/${encodeURIComponent(ref.batchId)}`,
      undefined,
      {},
      context,
      [200],
      { operation: 'inspect', retry: true },
    )

    if (!data || typeof data !== 'object') {
      throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'MinerU server returned empty status response', false, { provider: 'official-v4' }))
    }

    const extractResults = Array.isArray(data.data?.extract_result) ? data.data.extract_result : []
    const resultsByDataId = indexExtractResults(extractResults, ref)

    const fileSnapshots: ProviderFileSnapshot[] = []
    let hasNonTerminal = false
    let allCompleted = true
    let allFailed = true

    for (const file of ref.files) {
      const item = resultsByDataId.get(file.dataId)
      if (!item) {
        // Not yet in results list -> still queued/processing
        fileSnapshots.push({
          fileId: file.fileId,
          state: 'processing',
          rawState: 'pending',
        })
        hasNonTerminal = true
        allCompleted = false
        allFailed = false
        continue
      }

      const fileState = mapOfficialFileState(item.state)
      const progress = parseProgress(item.extract_progress)
      const fileFailure = fileState === 'failed'
        ? failure('REMOTE_PARSE_FAILED', sanitizeDiagnostic(item.err_msg || 'Remote document extraction failed', [context.credential ?? '']), false, {
            provider: 'official-v4',
            fileId: file.fileId,
            traceId: data.trace_id,
          })
        : undefined

      fileSnapshots.push({
        fileId: file.fileId,
        state: fileState,
        rawState: item.state,
        ...(progress !== undefined ? { progress } : {}),
        ...(fileFailure !== undefined ? { failure: fileFailure } : {}),
      })

      if (fileState !== 'completed' && fileState !== 'failed') {
        hasNonTerminal = true
      }
      if (fileState !== 'completed') {
        allCompleted = false
      }
      if (fileState !== 'failed') {
        allFailed = false
      }
    }

    let batchState: MinerUJobState
    if (hasNonTerminal) {
      batchState = 'processing'
    } else if (allCompleted) {
      batchState = 'completed'
    } else if (allFailed) {
      batchState = 'failed'
    } else {
      batchState = 'partially-completed'
    }

    return {
      state: batchState,
      files: fileSnapshots,
    }
  }

  async collect(
    ref: ProviderJobRef,
    request: CanonicalParseRequest,
    sink: ArtifactSink,
    context: ProviderCallContext,
  ): Promise<ProviderCollection> {
    context.signal.throwIfAborted()
    if (ref.provider !== 'official-v4') {
      throw new MinerUError(failure('INVALID_REQUEST', `Unsupported provider ref "${ref.provider}" for OfficialV4Provider`))
    }

    const data = await this.requestJson<OfficialV4ApiResponse<OfficialV4ExtractResultsData>>(
      'GET',
      `/extract-results/batch/${encodeURIComponent(ref.batchId)}`,
      undefined,
      {},
      context,
      [200],
      { operation: 'collect', retry: true },
    )

    if (!data || typeof data !== 'object') {
      throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'MinerU server returned empty result response', false, { provider: 'official-v4' }))
    }

    const extractResults = Array.isArray(data.data?.extract_result) ? data.data.extract_result : []
    const resultsByDataId = indexExtractResults(extractResults, ref)

    const completedFilesByZipUrl = new Map<string, ProviderSubmittedFile[]>()
    const collectedFiles: ProviderCollectedFile[] = []

    for (const file of ref.files) {
      const item = resultsByDataId.get(file.dataId)
      if (!item) {
        throw new MinerUError(
          failure('RESULT_NOT_READY', `Result for file "${file.name}" is not ready`, true, {
            provider: 'official-v4',
            fileId: file.fileId,
          }),
        )
      }

      const fileState = mapOfficialFileState(item.state)

      if (fileState === 'failed') {
        collectedFiles.push({
          fileId: file.fileId,
          name: file.name,
          artifacts: [],
          failure: failure('REMOTE_PARSE_FAILED', sanitizeDiagnostic(item.err_msg || 'Remote extraction failed', [context.credential ?? '']), false, {
            provider: 'official-v4',
            fileId: file.fileId,
            traceId: data.trace_id,
          }),
        })
        continue
      }

      if (fileState !== 'completed') {
        throw new MinerUError(
          failure('RESULT_NOT_READY', `Result for file "${file.name}" is not ready (state: ${item.state})`, true, {
            provider: 'official-v4',
            fileId: file.fileId,
          }),
        )
      }

      const zipUrl = item.full_zip_url
      if (!zipUrl || typeof zipUrl !== 'string' || zipUrl.trim() === '') {
        throw new MinerUError(
          failure('REMOTE_PARSE_FAILED', `Completed file "${file.name}" is missing full_zip_url`, false, {
            provider: 'official-v4',
            fileId: file.fileId,
            traceId: data.trace_id,
          }),
        )
      }

      const safeZipUrl = externalHttpsUrl(zipUrl, 'Official result ZIP URL')
      const list = completedFilesByZipUrl.get(safeZipUrl) ?? []
      list.push(file)
      completedFilesByZipUrl.set(safeZipUrl, list)
    }

    // For each unique full_zip_url, download and unpack
    for (const [zipUrl, targetFiles] of completedFilesByZipUrl.entries()) {
      context.signal.throwIfAborted()
      const tempZip = await this.downloadZipToTemporary(zipUrl, sink, context)

      const extracted = await extractSafeZip({
        zipPath: tempZip.path,
        sink,
        files: targetFiles,
        requiredArtifacts: request.requiredArtifacts,
        limits: context.limits,
        signal: context.signal,
      })

      collectedFiles.push(...extracted)
    }

    return {
      files: collectedFiles,
    }
  }

  // 1. Official API JSON Request builder (Bearer auth, JSON, error handling)
  private async requestJson<T>(
    method: string,
    path: string,
    bodyText: string | undefined,
    headers: Record<string, string>,
    context: ProviderCallContext,
    acceptedStatuses: readonly number[] = [200],
    options?: {
      operation?: ProviderRetryOperation
      retry?: boolean
      businessValidation?: 'strict' | 'probe'
    },
  ): Promise<T> {
    const businessValidation = options?.businessValidation ?? 'strict'
    return await this.client.requestJson<T>({
      method,
      path,
      body: bodyText,
      headers,
      context,
      acceptedStatuses,
      operation: options?.operation,
      retry: options?.retry,
      validateResponse: (parsed, response) => {
        if (!('code' in parsed)) {
          throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'Official MinerU response is missing its business code', false, { provider: 'official-v4' }))
        }
        const envelope = parsed as unknown as OfficialV4ApiResponse<unknown>
        if (envelope.code !== 0) {
          const normalizedCode = String(envelope.code).toUpperCase()
          const probeSentinel = businessValidation === 'probe'
            && isMissingBatchProbeSentinel(envelope.code, envelope.msg)
          if (probeSentinel) return parsed as T
          const businessError = officialBusinessFailure(
            envelope.code,
            sanitizeDiagnostic(envelope.msg || `Official API failed with code ${String(envelope.code)}`, [context.credential ?? '']),
            envelope.trace_id,
          )
          if (normalizedCode === '429') {
            Object.assign(businessError, {
              httpStatus: 429,
              retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
            })
          }
          throw businessError
        }
        return parsed as T
      },
    })
  }

  // 2. Bare PUT Request builder (Strictly empty headers, fresh stream upload to presigned OSS URL per attempt)
  private async barePutStream(
    uploadUrl: string,
    source: PreparedSourceFile,
    context: ProviderCallContext,
  ): Promise<void> {
    context.signal.throwIfAborted()
    const safeUploadUrl = externalHttpsUrl(uploadUrl, 'Official presigned upload URL')

    await executeWithRetry({
      provider: 'official-v4',
      operation: 'presigned-put',
      signal: context.signal,
      retryOptions: mergeRetryOptions(this.retryOptions, context.retry),
      fn: async () => {
        context.signal.throwIfAborted()

        // Re-verify file stat right before streaming
        await assertSourcesUnchanged([source], context.signal)

        const controller = new AbortController()
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          controller.abort(new DOMException(`Upload timed out after ${String(context.timeoutMs)}ms`, 'TimeoutError'))
        }, context.timeoutMs)

        const onParentAbort = () => {
          controller.abort(context.signal.reason)
        }
        context.signal.addEventListener('abort', onParentAbort, { once: true })

        const stream = createReadStream(source.path)
        const onStreamAbort = () => {
          stream.destroy(new DOMException('Aborted', 'AbortError'))
        }
        context.signal.addEventListener('abort', onStreamAbort, { once: true })

        try {
          const webStream = Readable.toWeb(stream) as unknown as BodyInit
          // Request headers MUST be strictly empty. NO Authorization, NO Content-Type, NO custom headers.
          const requestInit: RequestInit & { duplex?: 'half' } = {
            method: 'PUT',
            headers: {},
            body: webStream,
            signal: controller.signal,
            redirect: 'error',
            duplex: 'half',
          }

          let response: Response
          try {
            response = await fetch(safeUploadUrl, requestInit)
          } catch (err: unknown) {
            if (context.signal.aborted) {
              throw new MinerUError(failure('CANCELLED', 'Upload was cancelled', true))
            }
            if (timedOut) {
              const err = new MinerUError(failure('UPLOAD_FAILED', `Upload timed out after ${String(context.timeoutMs)}ms`, true))
              Object.assign(err, { httpStatus: 408 })
              throw err
            }
            const message = err instanceof Error ? err.message : String(err)
            throw new MinerUError(
              failure('UPLOAD_FAILED', `Failed to upload file to storage: ${sanitizeDiagnostic(message)}`, true),
              { cause: err },
            )
          }

          if (response.status !== 200 && response.status !== 204) {
            let errText = ''
            try {
              errText = await readBoundedResponseText(response, 2048, controller.signal)
            } catch {
              if (response.body) {
                try { await response.body.cancel() } catch {}
              }
            }
            const retryAfter = parseRetryAfter(response.headers.get('retry-after'))
            const retryable = isRetryableHttpStatus(response.status)
            const err = new MinerUError(
              failure(
                'UPLOAD_FAILED',
                `Storage upload failed with HTTP status ${String(response.status)}${errText ? `: ${sanitizeDiagnostic(errText)}` : ''}`,
                retryable,
              ),
            )
            Object.assign(err, { httpStatus: response.status, retryAfterMs: retryAfter })
            throw err
          }
          if (response.body) {
            try { await response.body.cancel() } catch {}
          }
        } finally {
          clearTimeout(timer)
          context.signal.removeEventListener('abort', onParentAbort)
          context.signal.removeEventListener('abort', onStreamAbort)
          if (!stream.destroyed) {
            stream.destroy()
          }
        }
      },
    })
  }

  // 3. CDN Download Request builder (NO Authorization header, stream download of ZIP)
  private async downloadZipToTemporary(
    cdnUrl: string,
    sink: ArtifactSink,
    context: ProviderCallContext,
  ): Promise<TemporaryArtifact> {
    context.signal.throwIfAborted()
    const safeCdnUrl = externalHttpsUrl(cdnUrl, 'Official result ZIP URL')

    return await executeWithRetry({
      provider: 'official-v4',
      operation: 'cdn-download',
      signal: context.signal,
      retryOptions: mergeRetryOptions(this.retryOptions, context.retry),
      fn: async () => {
        context.signal.throwIfAborted()

        const controller = new AbortController()
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          controller.abort(new DOMException(`Download timed out after ${String(context.timeoutMs)}ms`, 'TimeoutError'))
        }, context.timeoutMs)

        const onParentAbort = () => {
          controller.abort(context.signal.reason)
        }
        context.signal.addEventListener('abort', onParentAbort, { once: true })

        try {
          // Must NOT include Authorization header
          const requestInit: RequestInit = {
            method: 'GET',
            headers: {},
            signal: controller.signal,
            redirect: 'error',
          }

          let response: Response
          try {
            response = await fetch(safeCdnUrl, requestInit)
          } catch (err: unknown) {
            if (context.signal.aborted) {
              throw new MinerUError(failure('CANCELLED', 'Download was cancelled', true))
            }
            if (timedOut) {
              const err = new MinerUError(failure('RESULT_DOWNLOAD_FAILED', `Download timed out after ${String(context.timeoutMs)}ms`, true))
              Object.assign(err, { httpStatus: 408 })
              throw err
            }
            const message = err instanceof Error ? err.message : String(err)
            throw new MinerUError(
              failure('RESULT_DOWNLOAD_FAILED', `Failed to download result archive: ${sanitizeDiagnostic(message)}`, true),
              { cause: err },
            )
          }

          if (response.status !== 200) {
            if (response.body) {
              try { await response.body.cancel() } catch {}
            }
            const retryAfter = parseRetryAfter(response.headers.get('retry-after'))
            const retryable = isRetryableHttpStatus(response.status)
            const err = new MinerUError(
              failure('RESULT_DOWNLOAD_FAILED', `Failed to download result archive, HTTP status ${String(response.status)}`, retryable),
            )
            Object.assign(err, { httpStatus: response.status, retryAfterMs: retryAfter })
            throw err
          }

          const body = response.body
          if (!body) {
            throw new MinerUError(failure('RESULT_DOWNLOAD_FAILED', 'Result archive response body is empty', false))
          }

          const nodeStream = Readable.fromWeb(body as import('node:stream/web').ReadableStream<Uint8Array>)
          const tempName = `mineru_v4_${createHash('sha256').update(safeCdnUrl).digest('hex').slice(0, 16)}.zip`

          try {
            return await sink.writeTemporary(tempName, nodeStream, context.limits.maxZipDownloadBytes)
          } catch (error) {
            nodeStream.destroy()
            throw error
          }
        } finally {
          clearTimeout(timer)
          context.signal.removeEventListener('abort', onParentAbort)
        }
      },
    })
  }

}
