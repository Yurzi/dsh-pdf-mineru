import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { PassThrough, Readable } from 'node:stream'
import FormData from 'form-data'
import {
  type MinerUFileId,
  type ProviderConfigId,
  asProviderConfigId,
} from '../domain/ids.js'
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
  MinerUModel,
  PreparedSourceFile,
} from '../domain/request.js'
import type { ArtifactRef } from '../domain/result.js'
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
  executeWithRetry,
  mergeRetryOptions,
  readBoundedResponseText,
  parseRetryAfter,
  validateProviderCapabilities,
} from './provider.js'

export interface SelfHostedV2ProviderConfig {
  readonly id: ProviderConfigId
  readonly type: 'self-hosted-v2'
  readonly baseURL: string
  readonly apiKeyEnv?: string
  readonly modelMap: Readonly<Partial<Record<MinerUModel, string>>>
  readonly configuredVersion?: string
  readonly allowInsecureHttp?: boolean
}

export interface SelfHostedHealthResponse {
  readonly status: 'healthy' | 'unhealthy' | string
  readonly version?: string
  readonly protocol_version?: number
  readonly queued_tasks?: number
  readonly processing_tasks?: number
  readonly completed_tasks?: number
  readonly failed_tasks?: number
  readonly max_concurrent_requests?: number
}

export interface SelfHostedTaskSubmitResponse {
  readonly task_id: string
  readonly status: string
  readonly backend?: string
  readonly file_names?: readonly string[]
  readonly created_at?: string | null
  readonly started_at?: string | null
  readonly completed_at?: string | null
  readonly error?: string | null
  readonly status_url?: string
  readonly result_url?: string
  readonly queued_ahead?: number
}

export interface SelfHostedFileParseResult {
  readonly md_content?: string | null
  readonly middle_json?: unknown
  readonly model_output?: unknown
  readonly content_list?: unknown
  readonly images?: Readonly<Record<string, string>> | null
}

export interface SelfHostedTaskResultResponse {
  readonly backend?: string
  readonly version?: string
  readonly results?: Readonly<Record<string, SelfHostedFileParseResult>>
}

function validateAndNormalizeBaseURL(rawUrl: string, allowInsecureHttp?: boolean): URL {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new MinerUError(failure('INVALID_REQUEST', 'Provider baseURL must be a non-empty string'))
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
  if (parsed.protocol === 'http:') {
    if (!allowInsecureHttp) {
      throw new MinerUError(
        failure('INVALID_REQUEST', 'Insecure HTTP baseURL is not allowed unless allowInsecureHttp is explicitly enabled'),
      )
    }
  } else if (parsed.protocol !== 'https:') {
    throw new MinerUError(
      failure('INVALID_REQUEST', `Unsupported protocol in baseURL: ${parsed.protocol}`),
    )
  }
  if (parsed.username || parsed.password) {
    throw new MinerUError(failure('INVALID_REQUEST', 'Provider baseURL must not contain embedded credentials'))
  }
  if (parsed.search || parsed.hash) {
    throw new MinerUError(failure('INVALID_REQUEST', 'Provider baseURL must not contain a query or fragment'))
  }
  return parsed
}

function mapSelfHostedStatus(rawStatus: unknown): MinerUJobState {
  if (typeof rawStatus !== 'string') {
    throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'Missing task status from MinerU server response'))
  }
  switch (rawStatus.toLowerCase()) {
    case 'pending':
    case 'waiting':
    case 'queued':
      return 'queued'
    case 'processing':
    case 'running':
    case 'converting':
      return 'processing'
    case 'completed':
    case 'done':
    case 'success':
      return 'completed'
    case 'failed':
    case 'error':
      return 'failed'
    default:
      throw new MinerUError(failure('REMOTE_PARSE_FAILED', `Unknown remote task status: "${sanitizeDiagnostic(rawStatus)}"`))
  }
}

function jsonArtifact(value: unknown): string {
  if (typeof value !== 'string') return JSON.stringify(value)
  try {
    JSON.parse(value)
    return value
  } catch {
    return JSON.stringify(value)
  }
}

function decodeBase64Image(value: string, fileId: MinerUFileId): Uint8Array {
  const compact = value.replace(/\s+/g, '')
  if (compact.length === 0 || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'Self-hosted result contains invalid base64 image data', false, {
      provider: 'self-hosted-v2',
      fileId,
    }))
  }
  return Buffer.from(compact, 'base64')
}

function findFileResult(
  file: ProviderSubmittedFile,
  results: Readonly<Record<string, SelfHostedFileParseResult>>,
  allFiles: readonly ProviderSubmittedFile[],
): SelfHostedFileParseResult | undefined {
  if (Object.prototype.hasOwnProperty.call(results, file.name)) {
    return results[file.name]
  }

  const stem = file.name.replace(/\.[^/.]+$/, '')
  if (Object.prototype.hasOwnProperty.call(results, stem)) {
    if (allFiles.length > 1) {
      const matchingFiles = allFiles.filter(f => f.name.replace(/\.[^/.]+$/, '') === stem)
      if (matchingFiles.length === 1) {
        return results[stem]
      }
      return undefined
    }
    return results[stem]
  }

  if (allFiles.length === 1) {
    const keys = Object.keys(results)
    if (keys.length === 1 && keys[0] !== undefined) {
      return results[keys[0]]
    }
  }

  return undefined
}

export class SelfHostedV2Provider implements MinerUProvider {
  readonly id = 'self-hosted-v2' as const
  readonly config: SelfHostedV2ProviderConfig
  readonly capabilities: ProviderCapabilities
  private readonly parsedBaseUrl: URL
  private readonly retryOptions: ProviderRetryOptions

  constructor(config: SelfHostedV2ProviderConfig, options?: ProviderOptions) {
    asProviderConfigId(config.id)
    this.config = config
    this.retryOptions = options?.retry ?? {}
    this.parsedBaseUrl = validateAndNormalizeBaseURL(config.baseURL, config.allowInsecureHttp)

    const supportedModels = (['pipeline', 'vlm'] as const).filter(
      m => typeof config.modelMap[m] === 'string' && config.modelMap[m].trim() !== '',
    )

    this.capabilities = {
      models: supportedModels.length > 0 ? supportedModels : ['pipeline', 'vlm'],
      parseMethods: ['auto', 'txt', 'ocr'],
      supportsOcr: true,
      supportsLanguage: true,
      supportsFormula: true,
      supportsTable: true,
      supportsPageRanges: true,
      supportedArtifacts: ['markdown', 'layout', 'model-output', 'content-list', 'images'],
      maxFilesPerSubmission: 10,
    }
  }

  async compatibilityKey(
    request: CanonicalParseRequest,
    context: ProviderCompatibilityContext,
  ): Promise<string> {
    const originAndPath = `${this.parsedBaseUrl.origin}${this.parsedBaseUrl.pathname.replace(/\/+$/, '')}`
    const backend = this.config.modelMap[request.semantics.model]
    const behaviorHash = createHash('sha256').update(JSON.stringify({
      originAndPath,
      configuredVersion: context.configuredVersion ?? this.config.configuredVersion ?? 'v2',
      model: request.semantics.model,
      backend,
    }), 'utf8').digest('hex').slice(0, 24)
    return `self-hosted-v2:${behaviorHash}`
  }

  async probe(context: ProviderCallContext): Promise<ProviderProbeResult> {
    try {
      const data = await this.requestJson<SelfHostedHealthResponse>(
        'GET',
        '/health',
        undefined,
        {},
        context,
        [200],
        { operation: 'probe', retry: true },
      )

      const isHealthy = data.status === 'healthy'
      const protocolVersion = data.protocol_version !== undefined ? `v${String(data.protocol_version)}` : 'v2'
      const serverVersion = typeof data.version === 'string' ? data.version : undefined

      return {
        available: isHealthy,
        provider: 'self-hosted-v2',
        authentication: context.credential && context.credential.trim() !== '' ? 'valid' : 'not-configured',
        protocolVersion,
        ...(serverVersion !== undefined ? { serverVersion } : {}),
        queue: {
          queued: typeof data.queued_tasks === 'number' ? data.queued_tasks : undefined,
          processing: typeof data.processing_tasks === 'number' ? data.processing_tasks : undefined,
          completed: typeof data.completed_tasks === 'number' ? data.completed_tasks : undefined,
          failed: typeof data.failed_tasks === 'number' ? data.failed_tasks : undefined,
          maxConcurrent: typeof data.max_concurrent_requests === 'number' ? data.max_concurrent_requests : undefined,
        },
        ...(isHealthy ? {} : { diagnostics: 'Server reported unhealthy status' }),
      }
    } catch (error: unknown) {
      if (context.signal.aborted) {
        throw new MinerUError(failure('CANCELLED', 'Probe operation was cancelled', true))
      }
      const minerUFailure = toMinerUFailure(error)
      const isAuthError = minerUFailure.code === 'AUTHENTICATION_FAILED'
      return {
        available: false,
        provider: 'self-hosted-v2',
        authentication: isAuthError ? 'invalid' : context.credential && context.credential.trim() !== '' ? 'unknown' : 'not-configured',
        protocolVersion: 'v2',
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

    const backend = this.config.modelMap[request.semantics.model]
    if (typeof backend !== 'string' || backend.trim() === '') {
      throw new MinerUError(
        failure('UNSUPPORTED_OPTION', `Model "${request.semantics.model}" is not configured in provider modelMap`),
      )
    }

    if (sources.length !== request.files.length) {
      throw new MinerUError(failure('INVALID_REQUEST', 'Prepared source files count does not match request files count'))
    }

    // Pre-submission verification: ensure files have not changed
    for (const source of sources) {
      context.signal.throwIfAborted()
      let currentStat
      try {
        currentStat = await stat(source.path)
      } catch (err) {
        throw new MinerUError(failure('FILE_NOT_FOUND', `Source file missing before upload: ${source.name}`), { cause: err })
      }
      if (
        currentStat.size !== source.fingerprint.size ||
        currentStat.mtimeMs !== source.fingerprint.mtimeMs ||
        currentStat.dev !== source.fingerprint.device ||
        currentStat.ino !== source.fingerprint.inode
      ) {
        throw new MinerUError(failure('INVALID_REQUEST', `Source file ${source.name} changed before upload`, true))
      }
    }

    let pageInterval: { start: number; end: number } | undefined
    if (request.semantics.pages !== undefined) {
      const intervals = request.semantics.pages.split(',').map(token => {
        const parts = token.trim().split('-')
        const start = Number(parts[0])
        const end = parts[1] !== undefined ? Number(parts[1]) : start
        return { start, end }
      })
      if (intervals.length !== 1 || intervals[0] === undefined) {
        throw new MinerUError(
          failure('UNSUPPORTED_OPTION', 'Self-hosted v2 provider only supports a single continuous page range'),
        )
      }
      pageInterval = intervals[0]
    }
    const form = new FormData()
    const sourceStreams = sources.map(source => createReadStream(source.path))
    const onAbort = (): void => {
      for (const stream of sourceStreams) stream.destroy(new DOMException('Aborted', 'AbortError'))
    }
    context.signal.addEventListener('abort', onAbort, { once: true })
    for (const [index, source] of sources.entries()) {
      const stream = sourceStreams[index]
      if (stream === undefined) throw new TypeError('source stream index mismatch')
      form.append('files', stream, { filename: source.name, knownLength: source.bytes })
    }

    form.append('backend', backend)
    form.append('parse_method', request.semantics.parseMethod)
    form.append('lang_list', request.semantics.language)
    form.append('formula_enable', String(request.semantics.formula))
    form.append('table_enable', String(request.semantics.table))

    if (pageInterval !== undefined) {
      form.append('start_page_id', String(pageInterval.start - 1))
      form.append('end_page_id', String(pageInterval.end - 1))
    }

    const requiredSet = new Set(request.requiredArtifacts)
    form.append('return_md', String(requiredSet.has('markdown')))
    form.append('return_middle_json', String(requiredSet.has('layout')))
    form.append('return_model_output', String(requiredSet.has('model-output')))
    form.append('return_content_list', String(requiredSet.has('content-list')))
    form.append('return_images', String(requiredSet.has('images')))

    const formHeaders = form.getHeaders()
    const pass = new PassThrough()
    form.on('error', err => pass.destroy(err))
    form.pipe(pass)

    let data: SelfHostedTaskSubmitResponse
    try {
      data = await this.requestJson<SelfHostedTaskSubmitResponse>(
        'POST',
        '/tasks',
        pass,
        formHeaders,
        context,
        [200, 202],
        { operation: 'submit', retry: false },
      )
    } finally {
      context.signal.removeEventListener('abort', onAbort)
      for (const stream of sourceStreams) stream.destroy()
    }

    if (!data || typeof data.task_id !== 'string' || data.task_id.trim() === '') {
      throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'MinerU server did not return a valid task_id'))
    }

    const state = mapSelfHostedStatus(data.status)
    const submittedFiles: ProviderSubmittedFile[] = request.files.map(f => ({
      dataId: `data_${f.fileId}`,
      fileId: f.fileId,
      name: f.name,
    }))

    const ref: ProviderJobRef = {
      provider: 'self-hosted-v2',
      taskId: data.task_id,
      files: submittedFiles,
    }
    await context.onAccepted?.(ref)

    const fileSnapshots: ProviderFileSnapshot[] = request.files.map(f => ({
      fileId: f.fileId,
      state: (state === 'queued' ? 'queued' : state === 'processing' ? 'processing' : state === 'completed' ? 'completed' : 'failed') as MinerUFileState,
      rawState: data.status,
      failure: state === 'failed'
        ? failure('REMOTE_PARSE_FAILED', sanitizeDiagnostic(data.error ?? 'Remote task submission failed', [context.credential ?? '']), false, { provider: 'self-hosted-v2', fileId: f.fileId })
        : undefined,
    }))

    return {
      ref,
      state,
      files: fileSnapshots,
    }
  }

  async inspect(ref: ProviderJobRef, context: ProviderCallContext): Promise<ProviderJobSnapshot> {
    context.signal.throwIfAborted()
    if (ref.provider !== 'self-hosted-v2') {
      throw new MinerUError(failure('INVALID_REQUEST', `Unsupported provider ref "${ref.provider}" for SelfHostedV2Provider`))
    }

    const data = await this.requestJson<SelfHostedTaskSubmitResponse>(
      'GET',
      `/tasks/${encodeURIComponent(ref.taskId)}`,
      undefined,
      {},
      context,
      [200],
      { operation: 'inspect', retry: true },
    )

    const state = mapSelfHostedStatus(data.status)
    const fileState: MinerUFileState = state === 'queued' ? 'queued' : state === 'processing' ? 'processing' : state === 'completed' ? 'completed' : 'failed'
    const fileFailure = state === 'failed'
      ? failure('REMOTE_PARSE_FAILED', sanitizeDiagnostic(data.error ?? 'Remote task failed', [context.credential ?? '']), false, { provider: 'self-hosted-v2' })
      : undefined

    return {
      state,
      files: ref.files.map(f => ({
        fileId: f.fileId,
        state: fileState,
        rawState: data.status,
        failure: fileFailure ? { ...fileFailure, fileId: f.fileId } : undefined,
      })),
      rawState: data.status,
      queuedAhead: typeof data.queued_ahead === 'number' ? data.queued_ahead : undefined,
    }
  }

  async collect(
    ref: ProviderJobRef,
    request: CanonicalParseRequest,
    sink: ArtifactSink,
    context: ProviderCallContext,
  ): Promise<ProviderCollection> {
    context.signal.throwIfAborted()
    if (ref.provider !== 'self-hosted-v2') {
      throw new MinerUError(failure('INVALID_REQUEST', `Unsupported provider ref "${ref.provider}" for SelfHostedV2Provider`))
    }

    const data = await this.requestJson<SelfHostedTaskResultResponse>(
      'GET',
      `/tasks/${encodeURIComponent(ref.taskId)}/result`,
      undefined,
      {},
      context,
      [200],
      { operation: 'collect', retry: true },
    )

    if (!data || typeof data.results !== 'object' || data.results === null) {
      throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'MinerU server returned empty or invalid results'))
    }

    const collectedFiles: ProviderCollectedFile[] = []
    const requiredSet = new Set(request.requiredArtifacts)

    for (const file of ref.files) {
      const fileResult = findFileResult(file, data.results, ref.files)
      if (!fileResult) {
        collectedFiles.push({
          fileId: file.fileId,
          name: file.name,
          artifacts: [],
          failure: failure('REMOTE_PARSE_FAILED', `No parse result found for file "${file.name}"`, false, { provider: 'self-hosted-v2', fileId: file.fileId }),
        })
        continue
      }

      const artifacts: ArtifactRef[] = []

      // 1. markdown
      if (requiredSet.has('markdown') && typeof fileResult.md_content === 'string') {
        const artifactRef = await sink.writeArtifact(
          file.fileId,
          'markdown',
          fileResult.md_content,
          { mediaType: 'text/markdown; charset=utf-8', relativeName: 'full.md' },
        )
        artifacts.push(artifactRef)
      }

      // 2. layout (middle_json)
      if (requiredSet.has('layout') && fileResult.middle_json !== null && fileResult.middle_json !== undefined) {
        const content = jsonArtifact(fileResult.middle_json)
        const artifactRef = await sink.writeArtifact(
          file.fileId,
          'layout',
          content,
          { mediaType: 'application/json', relativeName: 'layout.json' },
        )
        artifacts.push(artifactRef)
      }

      // 3. model-output
      if (requiredSet.has('model-output') && fileResult.model_output !== null && fileResult.model_output !== undefined) {
        const content = jsonArtifact(fileResult.model_output)
        const artifactRef = await sink.writeArtifact(
          file.fileId,
          'model-output',
          content,
          { mediaType: 'application/json', relativeName: 'model.json' },
        )
        artifacts.push(artifactRef)
      }

      // 4. content-list
      if (requiredSet.has('content-list') && fileResult.content_list !== null && fileResult.content_list !== undefined) {
        const content = jsonArtifact(fileResult.content_list)
        const artifactRef = await sink.writeArtifact(
          file.fileId,
          'content-list',
          content,
          { mediaType: 'application/json', relativeName: 'content_list.json' },
        )
        artifacts.push(artifactRef)
      }

      // 5. images
      if (requiredSet.has('images')) {
        const imagePaths: string[] = []
        for (const [imgName, dataUrl] of Object.entries(fileResult.images ?? {})) {
          if (typeof dataUrl !== 'string' || dataUrl.trim() === '') continue

          let mediaType = 'image/png'
          let base64Payload = dataUrl
          const dataUrlMatch = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl)
          if (dataUrlMatch && dataUrlMatch[1] && dataUrlMatch[2]) {
            mediaType = dataUrlMatch[1]
            base64Payload = dataUrlMatch[2]
          }

          const buffer = decodeBase64Image(base64Payload, file.fileId)
          const baseName = imgName.split(/[/\\]/).filter(Boolean).filter(s => s !== '.' && s !== '..').join('_')
          const cleanName = baseName.replace(/[^A-Za-z0-9_.-]/g, '_')
          const relativeName = `images/${cleanName === 'index.json' ? 'source_index.json' : cleanName || 'img.png'}`
          imagePaths.push(relativeName)

          const artifactRef = await sink.writeArtifact(
            file.fileId,
            'images',
            buffer,
            { mediaType, relativeName },
          )
          artifacts.push(artifactRef)
        }
        artifacts.push(await sink.writeArtifact(
          file.fileId,
          'images',
          JSON.stringify({ images: imagePaths }),
          { mediaType: 'application/json', relativeName: 'images/index.json' },
        ))
      }

      const producedKinds = new Set(artifacts.map(artifact => artifact.kind))
      const missingKinds = request.requiredArtifacts.filter(kind => !producedKinds.has(kind))
      if (missingKinds.length > 0) {
        collectedFiles.push({
          fileId: file.fileId,
          name: file.name,
          artifacts,
          failure: failure(
            'REMOTE_PARSE_FAILED',
            `Provider result is missing required artifacts: ${missingKinds.join(', ')}`,
            false,
            { provider: 'self-hosted-v2', fileId: file.fileId },
          ),
        })
      } else {
        collectedFiles.push({
          fileId: file.fileId,
          name: file.name,
          artifacts,
        })
      }
    }

    return {
      files: collectedFiles,
    }
  }

  private async requestJson<T>(
    method: string,
    path: string,
    bodyStream: PassThrough | undefined,
    headers: Record<string, string>,
    context: ProviderCallContext,
    acceptedStatuses: readonly number[] = [200],
    options?: { operation?: ProviderRetryOperation; retry?: boolean },
  ): Promise<T> {
    const allowRetry = options?.retry ?? (method.toUpperCase() === 'GET')
    const operation = options?.operation ?? (path.startsWith('/health') ? 'probe' : 'api-json')

    const executeOnce = async (): Promise<T> => {
      context.signal.throwIfAborted()

      const url = `${this.parsedBaseUrl.origin}${this.parsedBaseUrl.pathname.replace(/\/+$/, '')}${path}`
      const controller = new AbortController()
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort(new DOMException(`Request timed out after ${context.timeoutMs}ms`, 'TimeoutError'))
      }, context.timeoutMs)

      const onParentAbort = () => {
        controller.abort(context.signal.reason)
      }
      context.signal.addEventListener('abort', onParentAbort, { once: true })

      try {
        const requestHeaders: Record<string, string> = { ...headers }
        if (context.credential && context.credential.trim() !== '') {
          requestHeaders['authorization'] = `Bearer ${context.credential}`
        }

        let response: Response
        try {
          const body = bodyStream !== undefined
            ? (Readable.toWeb(bodyStream) as unknown as BodyInit)
            : undefined
          const requestInit: RequestInit & { duplex?: 'half' } = {
            method,
            headers: requestHeaders,
            body,
            signal: controller.signal,
            redirect: 'error',
            ...(body !== undefined ? { duplex: 'half' } : {}),
          }
          response = await fetch(url, requestInit)
        } catch (err: unknown) {
          if (context.signal.aborted) {
            throw new MinerUError(failure('CANCELLED', 'Operation was cancelled', true))
          }
          if (timedOut) {
            const timeoutErr = new MinerUError(
              failure('PROVIDER_UNAVAILABLE', `Request to MinerU server timed out after ${context.timeoutMs}ms`, true),
            )
            Object.assign(timeoutErr, { httpStatus: 408 })
            throw timeoutErr
          }
          const message = err instanceof Error ? err.message : String(err)
          throw new MinerUError(
            failure('PROVIDER_UNAVAILABLE', `Failed to connect to MinerU server: ${sanitizeDiagnostic(message)}`, true),
            { cause: err },
          )
        }

        const status = response.status
        if (!acceptedStatuses.includes(status)) {
          let errorBody = ''
          try {
            errorBody = await readBoundedResponseText(response, context.limits.maxApiResponseBytes, controller.signal)
          } catch {
            if (response.body) {
              try { await response.body.cancel() } catch {}
            }
          }

          let parsedError: string | undefined
          try {
            const parsed: unknown = JSON.parse(errorBody)
            if (typeof parsed === 'object' && parsed !== null) {
              const json = parsed as Record<string, unknown>
              if (typeof json.detail === 'string') parsedError = json.detail
              else if (typeof json.message === 'string') parsedError = json.message
              else if (typeof json.error === 'string') parsedError = json.error
            }
          } catch {
            parsedError = errorBody.slice(0, 500)
          }

          const diagnostic = parsedError
            ? `: ${sanitizeDiagnostic(parsedError, [context.credential ?? ''])}`
            : ''
          const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
          let err: MinerUError

          if (status === 401 || status === 403) {
            err = new MinerUError(failure('AUTHENTICATION_FAILED', `Authentication failed (${status})${diagnostic}`, false, { provider: 'self-hosted-v2' }))
          } else if (status === 404) {
            err = new MinerUError(failure('JOB_NOT_FOUND', `Resource not found (${status})${diagnostic}`, false, { provider: 'self-hosted-v2' }))
          } else if (status === 413) {
            err = new MinerUError(failure('FILE_TOO_LARGE', `Uploaded file is too large (${status})${diagnostic}`, false, { provider: 'self-hosted-v2' }))
          } else if (status === 429) {
            err = new MinerUError(failure('PROVIDER_RATE_LIMITED', `Provider rate limit exceeded (${status})${diagnostic}`, true, { provider: 'self-hosted-v2' }))
          } else if (status === 408) {
            err = new MinerUError(failure('PROVIDER_UNAVAILABLE', `MinerU server request timeout (${status})${diagnostic}`, true, { provider: 'self-hosted-v2' }))
          } else if (status >= 500) {
            err = new MinerUError(failure('PROVIDER_UNAVAILABLE', `MinerU server error (${status})${diagnostic}`, true, { provider: 'self-hosted-v2' }))
          } else {
            err = new MinerUError(failure('REMOTE_PARSE_FAILED', `MinerU returned unexpected status ${status}${diagnostic}`, false, { provider: 'self-hosted-v2' }))
          }

          Object.assign(err, { httpStatus: status, retryAfterMs })
          throw err
        }

        const contentType = response.headers.get('content-type') ?? ''
        if (!contentType.toLowerCase().includes('application/json')) {
          if (response.body) {
            try { await response.body.cancel() } catch {}
          }
          throw new MinerUError(failure('REMOTE_PARSE_FAILED', `Expected application/json response, got ${contentType || 'unknown'}`))
        }

        const rawText = await readBoundedResponseText(response, context.limits.maxApiResponseBytes, controller.signal)
        try {
          const parsed: unknown = JSON.parse(rawText)
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'MinerU response must be an object', false, { provider: 'self-hosted-v2' }))
          }
          return parsed as T
        } catch (err) {
          if (err instanceof MinerUError) throw err
          throw new MinerUError(
            failure('REMOTE_PARSE_FAILED', `Failed to parse JSON response: ${sanitizeDiagnostic(err instanceof Error ? err.message : String(err))}`),
            { cause: err },
          )
        }
      } finally {
        clearTimeout(timer)
        context.signal.removeEventListener('abort', onParentAbort)
        if (bodyStream !== undefined && !bodyStream.destroyed) {
          bodyStream.destroy()
        }
      }
    }

    if (!allowRetry) {
      return await executeOnce()
    }

    return await executeWithRetry({
      provider: 'self-hosted-v2',
      operation,
      signal: context.signal,
      retryOptions: mergeRetryOptions(this.retryOptions, context.retry),
      fn: executeOnce,
    })
  }

}