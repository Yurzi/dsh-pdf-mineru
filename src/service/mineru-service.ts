import { open } from 'node:fs/promises'
import { TextDecoder } from 'node:util'
import type { MinerUConfig, ProviderConfig } from '../config.js'
import type { MinerUFailure, MinerUProviderId } from '../domain/errors.js'
import { MinerUError, failure, toMinerUFailure } from '../domain/errors.js'
import {
  asSessionId,
  createJobId,
  type CacheKey,
  type MinerUJobId,
  type MinerUResultId,
  type SessionId,
} from '../domain/ids.js'
import {
  MINERU_JOB_SCHEMA_VERSION,
  isTerminalJobState,
  type JobResolution,
  type MinerUFileStatus,
  type MinerUJobRecord,
  type MinerUJobState,
} from '../domain/job.js'
import type { ParseRequestInput, PreparedParseRequest } from '../domain/request.js'
import type { ArtifactRef, MinerUResultManifest } from '../domain/result.js'
import type { ProviderCallContext, ProviderJobRef, ProviderJobSnapshot, ProviderRetryEvent } from '../providers/provider.js'
import { validateProviderCapabilities } from '../providers/provider.js'
import { ProviderRegistry, type ResolvedProvider } from '../providers/registry.js'
import { computeCacheKey } from './cache-key.js'
import { RequestNormalizer, assertSourcesUnchanged } from './request-normalizer.js'
import { SharedOperationRegistry, type SharedOperation, type SharedOutcome, type SharedSubmission } from './shared-operations.js'
import type { JobRepository, SessionIdentifier } from '../storage/job-repository.js'
import type { ResultRepository, ResultTransaction } from '../storage/result-repository.js'
import { emitDiagnostic, type MinerUDiagnosticEvent, type MinerUDiagnosticSink } from '../observability.js'

export interface ServiceSession extends SessionIdentifier {
  readonly header: { readonly id: SessionId | string; readonly cwd?: string }
}

const MAX_POLL_TIMEOUT_MS = 24 * 60 * 60 * 1000

export type CredentialResolver = (reference: string, signal: AbortSignal) => Promise<string | undefined>
export type SubmissionSource = 'cache' | 'shared-operation' | 'provider'

export interface FileStatusView {
  readonly file_id: string
  readonly name: string
  readonly state: string
  readonly progress?: { readonly completed: number; readonly total: number }
  readonly failure?: MinerUFailure
}

export interface SubmitView {
  readonly job_id: string
  readonly state: MinerUJobState
  readonly source: SubmissionSource
  readonly provider: MinerUProviderId
  readonly files: readonly FileStatusView[]
  readonly result_available: boolean
  readonly failure?: MinerUFailure
}

export interface StatusView extends SubmitView {
  readonly created_at: number
  readonly updated_at: number
}

export interface ArtifactView {
  readonly kind: string
  readonly path: string
  readonly bytes: number
}

export interface ResultFileView {
  readonly file_id: string
  readonly name: string
  readonly artifacts: readonly ArtifactView[]
  readonly artifacts_truncated?: boolean
}

export interface ResultView {
  readonly job_id: string
  readonly state: Extract<MinerUJobState, 'completed' | 'partially-completed'>
  readonly cache_hit: boolean
  readonly result_id: string
  readonly files: readonly ResultFileView[]
  readonly markdown_preview?: string
  readonly preview_truncated: boolean
  readonly manifest_path: string
  readonly output_limit_chars: number
}

export interface ProbeView {
  readonly available: boolean
  readonly provider: MinerUProviderId
  readonly authentication: 'valid' | 'invalid' | 'not-configured' | 'unknown'
  readonly protocol_version: string
  readonly server_version?: string
  readonly queue?: {
    readonly queued?: number
    readonly processing?: number
    readonly completed?: number
    readonly failed?: number
    readonly max_concurrent?: number
  }
  readonly diagnostics?: string
}

export type ParseDocumentView = ResultView | (StatusView & { readonly poll_timed_out?: true })

export interface MinerUServiceOptions {
  readonly getConfig: () => MinerUConfig
  readonly providers: ProviderRegistry
  readonly jobs: JobRepository
  readonly results: ResultRepository
  readonly operations: SharedOperationRegistry
  readonly resolveCredential: CredentialResolver
  readonly diagnostics?: MinerUDiagnosticSink
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
  return new Promise((resolve, reject) => {
    const finish = (): void => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function providerRef(job: MinerUJobRecord): ProviderJobRef | undefined {
  return job.resolution.kind === 'cache-hit' ? undefined : job.resolution.ref
}

function withProviderRef(resolution: JobResolution, ref: ProviderJobRef): JobResolution {
  if (resolution.kind === 'shared-operation') return { ...resolution, ref }
  if (resolution.kind === 'provider') return { kind: 'provider', ref }
  return resolution
}

function sourceForJob(job: MinerUJobRecord): SubmissionSource {
  if (job.resolution.kind === 'cache-hit') return 'cache'
  if (job.resolution.kind === 'shared-operation') return 'shared-operation'
  return 'provider'
}

function fileViews(job: MinerUJobRecord): readonly FileStatusView[] {
  return job.files.map(file => ({
    file_id: file.fileId,
    name: file.name,
    state: file.state,
    ...(file.progress === undefined ? {} : { progress: file.progress }),
    ...(file.failure === undefined ? {} : { failure: file.failure }),
  }))
}

function statusView(job: MinerUJobRecord): StatusView {
  return {
    job_id: job.id,
    state: job.state,
    source: sourceForJob(job),
    provider: job.providerId,
    files: fileViews(job),
    result_available: job.resultId !== undefined && (job.state === 'completed' || job.state === 'partially-completed'),
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    ...(job.failure === undefined ? {} : { failure: job.failure }),
  }
}

function submitView(job: MinerUJobRecord): SubmitView {
  const status = statusView(job)
  return {
    job_id: status.job_id,
    state: status.state,
    source: status.source,
    provider: status.provider,
    files: status.files,
    result_available: status.result_available,
    ...(status.failure === undefined ? {} : { failure: status.failure }),
  }
}

export class MinerUService {
  constructor(private readonly options: MinerUServiceOptions) {}

  private config(): MinerUConfig {
    return this.options.getConfig()
  }

  private diagnostic(event: MinerUDiagnosticEvent): void {
    emitDiagnostic(this.options.diagnostics, event)
  }

  private async callContext(
    config: ProviderConfig,
    signal: AbortSignal,
    operationId?: string,
    onAccepted?: (ref: ProviderJobRef) => Promise<void>,
    allowMissingCredential = false,
  ): Promise<ProviderCallContext> {
    signal.throwIfAborted()
    const reference = config.apiKeyEnv
    const credential = reference === undefined ? undefined : await this.options.resolveCredential(reference, signal)
    signal.throwIfAborted()
    if (config.type === 'official-v4' && credential === undefined && !allowMissingCredential) {
      throw new MinerUError(failure('CREDENTIAL_MISSING', `Credential ${config.apiKeyEnv} is not configured`))
    }
    const current = this.config()
    return {
      signal,
      ...(credential === undefined ? {} : { credential }),
      timeoutMs: current.polling.requestTimeoutMs,
      ...(onAccepted === undefined ? {} : { onAccepted }),
      retry: {
        maxRetries: current.retry.maxAttempts - 1,
        initialDelayMs: current.retry.baseDelayMs,
        maxDelayMs: current.retry.maxDelayMs,
        onRetry: (event: ProviderRetryEvent) => {
          this.diagnostic({
            level: 'warn', phase: 'provider-retry', provider: event.provider,
            ...(operationId === undefined ? {} : { operationId }),
            providerOperation: event.operation, attempt: event.attempt, maxAttempts: event.maxRetries + 1,
            delayMs: event.delayMs, reason: event.reason, ...(event.status === undefined ? {} : { status: event.status }),
          })
        },
      },
      limits: {
        maxApiResponseBytes: current.limits.maxApiResponseBytes,
        maxZipDownloadBytes: current.limits.maxZipDownloadBytes,
        maxZipEntries: current.limits.maxZipEntries,
        maxZipEntryBytes: current.limits.maxZipEntryBytes,
        maxZipTotalBytes: current.limits.maxZipTotalBytes,
        maxZipCompressionRatio: current.limits.maxZipCompressionRatio,
      },
    }
  }

  async probe(signal: AbortSignal, draft?: ProviderConfig): Promise<ProbeView> {
    const resolved = draft === undefined ? this.options.providers.active() : { config: draft, provider: this.options.providers.create(draft) }
    const result = await resolved.provider.probe(await this.callContext(resolved.config, signal, undefined, undefined, true))
    return {
      available: result.available,
      provider: result.provider,
      authentication: result.authentication,
      protocol_version: result.protocolVersion,
      ...(result.serverVersion === undefined ? {} : { server_version: result.serverVersion }),
      ...(result.queue === undefined ? {} : {
        queue: {
          ...(result.queue.queued === undefined ? {} : { queued: result.queue.queued }),
          ...(result.queue.processing === undefined ? {} : { processing: result.queue.processing }),
          ...(result.queue.completed === undefined ? {} : { completed: result.queue.completed }),
          ...(result.queue.failed === undefined ? {} : { failed: result.queue.failed }),
          ...(result.queue.maxConcurrent === undefined ? {} : { max_concurrent: result.queue.maxConcurrent }),
        },
      }),
      ...(result.diagnostics === undefined ? {} : { diagnostics: result.diagnostics }),
    }
  }

  async submit(session: ServiceSession, input: ParseRequestInput, signal: AbortSignal): Promise<SubmitView> {
    const sessionId = asSessionId(String(session.header.id))
    const active = this.options.providers.active()
    const current = this.config()
    const normalizer = new RequestNormalizer({
      defaults: current.defaults,
      cwd: session.header.cwd,
      maxFiles: 1,
      maxFileBytes: Math.min(current.limits.maxFileBytes, active.provider.capabilities.maxFileBytes ?? current.limits.maxFileBytes),
    })
    const prepared = await normalizer.normalize(input, signal)
    if (prepared.request.files.length !== 1) {
      throw new MinerUError(failure('INVALID_REQUEST', 'This release accepts exactly one file per model tool submission'))
    }
    validateProviderCapabilities(prepared.request, active.provider.capabilities)
    const compatibility = await active.provider.compatibilityKey(prepared.request, {
      configuredVersion: 'configuredVersion' in active.config ? active.config.configuredVersion : undefined,
    })
    const file = prepared.request.files[0]
    const cacheKey = computeCacheKey(prepared.request, file, compatibility)

    if (current.storage.cacheEnabled) {
      const hit = await this.options.results.get(cacheKey, prepared.request.requiredArtifacts, signal)
      if (hit !== undefined) {
        const job = this.newJob(sessionId, prepared, active, compatibility, cacheKey, { kind: 'cache-hit' }, hit.id, 'completed')
        await this.options.jobs.create(session, job)
        this.diagnostic({
          level: 'info', phase: 'cache-hit', provider: active.provider.id, jobId: job.id,
          bytes: prepared.request.files.reduce((total, source) => total + source.bytes, 0), cacheHit: true,
        })
        return submitView(job)
      }
    }

    let job = this.newJob(sessionId, prepared, active, compatibility, cacheKey, { kind: 'provider' }, undefined, 'queued')
    await this.options.jobs.create(session, job)
    this.diagnostic({
      level: 'info', phase: 'job-created', provider: active.provider.id, jobId: job.id,
      bytes: prepared.request.files.reduce((total, source) => total + source.bytes, 0), cacheHit: false,
    })
    const acquired = this.options.operations.acquire(
      cacheKey, active.config.id, current.polling.operationTimeoutMs,
      operation => this.runOperation(operation, prepared, active, compatibility),
    )
    if (!acquired.created) {
      job = await this.options.jobs.update(session, job.id, record => ({
        ...record,
        resolution: { kind: 'shared-operation', operationId: acquired.operation.id },
      }))
    }
    acquired.operation.attach({ jobId: job.id, session })
    job = await this.replayOperation(session, job.id, acquired.operation)
    this.diagnostic({
      level: 'debug', phase: 'shared-operation', provider: active.provider.id, jobId: job.id,
      operationId: acquired.operation.id, waiterCount: acquired.operation.waiters.size,
    })

    try {
      const submitted = await acquired.operation.waitForSubmission(signal)
      job = await this.syncSubmission(session, job.id, submitted)
    } catch (error) {
      if (signal.aborted) throw error
      job = await this.options.jobs.require(session, job.id)
    }
    return submitView(job)
  }

  private newJob(
    sessionId: SessionId, prepared: PreparedParseRequest, active: ResolvedProvider, compatibility: string,
    cacheKey: CacheKey, resolution: JobResolution, resultId: MinerUResultId | undefined, state: MinerUJobState,
  ): MinerUJobRecord {
    const now = Date.now()
    const file = prepared.request.files[0]
    const fileState = state === 'completed' ? 'completed' : state === 'failed' ? 'failed' : 'queued'
    const fileStatus: MinerUFileStatus = {
      fileId: file.fileId, name: file.name, cacheKey, state: fileState,
      ...(resultId === undefined ? {} : { resultId }),
    }
    return {
      schemaVersion: MINERU_JOB_SCHEMA_VERSION,
      id: createJobId(),
      sessionId,
      providerId: active.provider.id,
      providerConfigId: active.config.id,
      providerCompatibilityKey: compatibility,
      sourceFiles: prepared.request.files.map(source => ({ fileId: source.fileId, name: source.name, bytes: source.bytes, sha256: source.sha256 })),
      request: prepared.request,
      cacheKey,
      state,
      resolution,
      files: [fileStatus],
      ...(resultId === undefined ? {} : { resultId }),
      createdAt: now,
      updatedAt: now,
    }
  }

  private async syncAcceptedRef(
    session: ServiceSession, jobId: MinerUJobId, ref: ProviderJobRef,
  ): Promise<MinerUJobRecord> {
    return this.options.jobs.update(session, jobId, current => {
      if (isTerminalJobState(current.state)) return current
      return {
        ...current,
        state: current.state === 'queued' ? 'uploading' : current.state,
        resolution: withProviderRef(current.resolution, ref),
        files: current.files.map(file => ({
          ...file, state: file.state === 'queued' ? 'uploading' : file.state,
        })),
      }
    })
  }

  private async syncSubmission(session: ServiceSession, jobId: MinerUJobId, submitted: SharedSubmission): Promise<MinerUJobRecord> {
    return this.options.jobs.update(session, jobId, current => {
      if (isTerminalJobState(current.state)) return current
      const resolution = submitted.ref === undefined ? current.resolution : withProviderRef(current.resolution, submitted.ref)
      if (submitted.resultId !== undefined) {
        return {
          ...current, state: 'completed', resolution, resultId: submitted.resultId,
          files: current.files.map(file => ({ ...file, state: 'completed', resultId: submitted.resultId })),
        }
      }
      if (submitted.state === 'failed') {
        const cause = submitted.failure ?? failure('REMOTE_PARSE_FAILED', 'Remote parse failed')
        return {
          ...current, state: 'failed', resolution, failure: cause,
          files: current.files.map(file => ({ ...file, state: 'failed', failure: cause })),
        }
      }
      return {
        ...current,
        state: current.state === 'queued' || current.state === 'uploading' ? 'processing' : current.state,
        resolution,
        files: current.files.map(file => ({
          ...file,
          state: file.state === 'queued' || file.state === 'uploading' ? 'processing' : file.state,
        })),
      }
    })
  }

  private async replayOperation(
    session: ServiceSession, jobId: MinerUJobId, operation: SharedOperation,
  ): Promise<MinerUJobRecord> {
    if (operation.acceptedRef !== undefined) {
      await this.syncAcceptedRef(session, jobId, operation.acceptedRef)
    }
    if (operation.submittedValue !== undefined) {
      await this.syncSubmission(session, jobId, operation.submittedValue)
    }
    const outcome = operation.settledValue
    if (outcome?.resultId !== undefined) {
      await this.syncSubmission(session, jobId, {
        state: outcome.state, resultId: outcome.resultId,
      })
    }
    return this.options.jobs.require(session, jobId)
  }

  private async updateWaiters(
    operation: SharedOperation,
    mutate: (current: MinerUJobRecord) => MinerUJobRecord,
  ): Promise<void> {
    await Promise.all([...operation.waiters.values()].map(async waiter => {
      try { await this.options.jobs.update(waiter.session, waiter.jobId, mutate) } catch (error) {
        const code = error instanceof MinerUError ? error.failure.code : undefined
        if (code !== 'JOB_NOT_FOUND') throw error
      }
    }))
  }

  private snapshotFiles(current: MinerUJobRecord, snapshot: ProviderJobSnapshot): readonly MinerUFileStatus[] {
    const byId = new Map(snapshot.files.map(file => [file.fileId, file]))
    return current.files.map(file => {
      const next = byId.get(file.fileId)
      if (next === undefined) return file
      const { failure: _oldFailure, progress: _oldProgress, ...stable } = file
      return {
        ...stable,
        state: next.state === 'queued' ? 'processing' : next.state,
        ...(next.progress === undefined ? {} : { progress: next.progress }),
        ...(next.failure === undefined ? {} : { failure: next.failure }),
      }
    })
  }

  private async runOperation(
    operation: SharedOperation,
    prepared: PreparedParseRequest,
    resolved: ResolvedProvider,
    compatibility: string,
    recoveryRef?: ProviderJobRef,
  ): Promise<SharedOutcome> {
    let ref = recoveryRef
    let transaction: ResultTransaction | undefined
    const startedAt = Date.now()
    const requestBytes = prepared.request.files.reduce((total, source) => total + source.bytes, 0)
    try {
      const cached = recoveryRef !== undefined || this.config().storage.cacheEnabled
        ? await this.options.results.get(operation.cacheKey, prepared.request.requiredArtifacts, operation.controller.signal)
        : undefined
      if (cached !== undefined) {
        await this.updateWaiters(operation, current => ({
          ...current, state: 'completed',
          resolution: ref === undefined ? { kind: 'cache-hit' } : withProviderRef(current.resolution, ref),
          resultId: cached.id,
          files: current.files.map(file => ({ ...file, state: 'completed', resultId: cached.id })),
        }))
        operation.markSubmitted({ state: 'completed', resultId: cached.id })
        this.diagnostic({
          level: 'info', phase: 'cache-hit', provider: resolved.provider.id, operationId: operation.id,
          durationMs: Date.now() - startedAt, bytes: requestBytes, cacheHit: true, waiterCount: operation.waiters.size,
        })
        return { state: 'completed', resultId: cached.id }
      }

      let snapshot: ProviderJobSnapshot
      if (ref === undefined) {
        await this.updateWaiters(operation, current => isTerminalJobState(current.state) ? current : ({
          ...current, state: 'uploading', files: current.files.map(file => ({ ...file, state: 'uploading' })),
        }))
        await assertSourcesUnchanged(prepared.sources, operation.controller.signal)
        this.diagnostic({
          level: 'info', phase: 'uploading', provider: resolved.provider.id, operationId: operation.id,
          bytes: requestBytes, waiterCount: operation.waiters.size,
        })
        const submission = await resolved.provider.submit(
          prepared.request, prepared.sources,
          await this.callContext(
            resolved.config, operation.controller.signal, operation.id,
            async accepted => {
              ref = accepted
              operation.markAccepted(accepted)
              await this.updateWaiters(operation, current => isTerminalJobState(current.state) ? current : ({
                ...current,
                state: current.state === 'queued' ? 'uploading' : current.state,
                resolution: withProviderRef(current.resolution, accepted),
                files: current.files.map(file => ({
                  ...file, state: file.state === 'queued' ? 'uploading' : file.state,
                })),
              }))
            },
          ),
        )
        ref = submission.ref
        snapshot = { state: submission.state, files: submission.files }
      } else {
        snapshot = await resolved.provider.inspect(ref, await this.callContext(resolved.config, operation.controller.signal, operation.id))
      }

      if (ref === undefined) throw new TypeError('Provider submission did not produce a durable reference')
      const durableRef = ref
      const submissionFailure = snapshot.files.find(file => file.failure)?.failure
        ?? failure('REMOTE_PARSE_FAILED', 'Remote parse failed')
      await this.updateWaiters(operation, current => isTerminalJobState(current.state) ? current : ({
        ...current,
        state: snapshot.state === 'failed' ? 'failed' : current.state === 'collecting' ? 'collecting' : 'processing',
        resolution: withProviderRef(current.resolution, durableRef),
        files: this.snapshotFiles(current, snapshot),
        ...(snapshot.state === 'failed' ? { failure: submissionFailure } : {}),
      }))
      operation.markSubmitted({
        ref: durableRef, state: snapshot.state === 'failed' ? 'failed' : 'processing',
        ...(snapshot.state === 'failed' ? { failure: submissionFailure } : {}),
      })
      this.diagnostic({
        level: snapshot.state === 'failed' ? 'warn' : 'info', phase: 'provider-accepted',
        provider: resolved.provider.id, operationId: operation.id, bytes: requestBytes, waiterCount: operation.waiters.size,
      })
      if (snapshot.state === 'failed') {
        this.diagnostic({
          level: submissionFailure.retryable ? 'warn' : 'error', phase: 'failed', provider: resolved.provider.id,
          operationId: operation.id, durationMs: Date.now() - startedAt, bytes: requestBytes,
          waiterCount: operation.waiters.size, errorCode: submissionFailure.code, retryable: submissionFailure.retryable,
        })
        return { state: 'failed' }
      }
      this.diagnostic({
        level: 'info', phase: 'processing', provider: resolved.provider.id, operationId: operation.id,
        durationMs: Date.now() - startedAt, bytes: requestBytes, waiterCount: operation.waiters.size,
      })

      while (snapshot.state !== 'completed' && snapshot.state !== 'partially-completed') {
        await delay(this.config().polling.pollIntervalMs, operation.controller.signal)
        snapshot = await resolved.provider.inspect(durableRef, await this.callContext(resolved.config, operation.controller.signal, operation.id))
        const pollingFailure = snapshot.files.find(file => file.failure)?.failure
          ?? failure('REMOTE_PARSE_FAILED', 'Remote parse failed')
        await this.updateWaiters(operation, current => isTerminalJobState(current.state) ? current : ({
          ...current,
          state: snapshot.state === 'failed' ? 'failed' : current.state === 'collecting' ? 'collecting' : 'processing',
          resolution: withProviderRef(current.resolution, durableRef),
          files: this.snapshotFiles(current, snapshot),
          ...(snapshot.state === 'failed' ? { failure: pollingFailure } : {}),
        }))
        if (snapshot.state === 'failed') {
          this.diagnostic({
            level: pollingFailure.retryable ? 'warn' : 'error', phase: 'failed', provider: resolved.provider.id,
            operationId: operation.id, durationMs: Date.now() - startedAt, bytes: requestBytes,
            waiterCount: operation.waiters.size, errorCode: pollingFailure.code, retryable: pollingFailure.retryable,
          })
          return { state: 'failed' }
        }
      }

      await this.updateWaiters(operation, current => isTerminalJobState(current.state) ? current : ({ ...current, state: 'collecting' }))
      this.diagnostic({
        level: 'info', phase: 'collecting', provider: resolved.provider.id, operationId: operation.id,
        durationMs: Date.now() - startedAt, bytes: requestBytes, waiterCount: operation.waiters.size,
      })
      transaction = this.options.results.beginTransaction(
        operation.id, prepared.request,
        { providerId: resolved.provider.id, providerConfigId: resolved.config.id, compatibilityKey: compatibility },
        operation.controller.signal,
      )
      const collection = await resolved.provider.collect(
        durableRef, prepared.request, transaction, await this.callContext(resolved.config, operation.controller.signal, operation.id),
      )
      const file = prepared.request.files[0]
      const collected = collection.files.find(candidate => candidate.fileId === file.fileId)
      if (collected === undefined || collected.failure !== undefined) {
        await transaction.abort()
        transaction = undefined
        const cause = collected?.failure ?? failure('REMOTE_PARSE_FAILED', 'Provider did not collect the requested file')
        await this.updateWaiters(operation, current => isTerminalJobState(current.state) ? current : ({
          ...current, state: 'failed', failure: cause,
          files: current.files.map(status => ({ ...status, state: 'failed', failure: cause })),
        }))
        this.diagnostic({
          level: cause.retryable ? 'warn' : 'error', phase: 'failed', provider: resolved.provider.id,
          operationId: operation.id, durationMs: Date.now() - startedAt, bytes: requestBytes,
          waiterCount: operation.waiters.size, errorCode: cause.code, retryable: cause.retryable,
        })
        return { state: 'failed' }
      }
      const manifest = transaction.buildManifest(file, collected.artifacts)
      const published = await this.options.results.commitTransaction(transaction, manifest, operation.controller.signal)
      transaction = undefined
      await this.updateWaiters(operation, current => {
        if (isTerminalJobState(current.state)) return current
        const { failure: _oldFailure, ...stable } = current
        return {
          ...stable, state: 'completed', resultId: published.resultId,
          files: current.files.map(status => {
            const { failure: _fileFailure, progress: _progress, ...file } = status
            return { ...file, state: 'completed', resultId: published.resultId }
          }),
        }
      })
      this.diagnostic({
        level: 'info', phase: 'published', provider: resolved.provider.id, operationId: operation.id,
        durationMs: Date.now() - startedAt, bytes: requestBytes, cacheHit: false, waiterCount: operation.waiters.size,
      })
      return { state: 'completed', resultId: published.resultId }
    } catch (error) {
      await transaction?.abort().catch(() => undefined)
      const normalized = ref === undefined && operation.controller.signal.aborted
        ? failure('INTERRUPTED_UPLOAD', 'Upload was interrupted before a recoverable provider reference was stored', true)
        : toMinerUFailure(error)
      this.diagnostic({
        level: normalized.retryable ? 'warn' : 'error', phase: 'failed', provider: resolved.provider.id,
        operationId: operation.id, durationMs: Date.now() - startedAt, bytes: requestBytes,
        waiterCount: operation.waiters.size, errorCode: normalized.code, retryable: normalized.retryable,
      })
      await this.updateWaiters(operation, current => {
        if (isTerminalJobState(current.state)) return current
        if (ref !== undefined && normalized.retryable) {
          return { ...current, resolution: withProviderRef(current.resolution, ref), failure: normalized }
        }
        return {
          ...current, state: 'failed', failure: normalized,
          files: current.files.map(file => ({ ...file, state: 'failed', failure: normalized })),
        }
      })
      throw error
    }
  }

  async status(session: ServiceSession, jobId: string, signal: AbortSignal): Promise<StatusView> {
    let job = await this.options.jobs.require(session, jobId)
    if (isTerminalJobState(job.state)) return statusView(job)
    const active = this.options.operations.get(job.cacheKey, job.providerConfigId)
    if (active !== undefined) {
      active.attach({ jobId: job.id, session })
      job = await this.replayOperation(session, job.id, active)
      return statusView(job)
    }

    const ref = providerRef(job)
    if (ref === undefined) {
      const interrupted = failure('INTERRUPTED_UPLOAD', 'Job has no recoverable provider reference after process interruption', true)
      job = await this.options.jobs.update(session, job.id, current => ({
        ...current, state: 'failed', failure: interrupted,
        files: current.files.map(file => ({ ...file, state: 'failed', failure: interrupted })),
      }))
      return statusView(job)
    }

    const resolved = await this.options.providers.resolveForJob(job)
    const prepared: PreparedParseRequest = { request: job.request, sources: [] }
    const acquired = this.options.operations.acquire(
      job.cacheKey, job.providerConfigId, this.config().polling.operationTimeoutMs,
      operation => this.runOperation(operation, prepared, resolved, job.providerCompatibilityKey, ref),
    )
    acquired.operation.attach({ jobId: job.id, session })
    job = await this.replayOperation(session, job.id, acquired.operation)
    this.diagnostic({
      level: 'debug', phase: 'shared-operation', provider: resolved.provider.id, jobId: job.id,
      operationId: acquired.operation.id, waiterCount: acquired.operation.waiters.size,
    })
    try { await acquired.operation.waitForSubmission(signal) } catch (error) { if (signal.aborted) throw error }
    job = await this.options.jobs.require(session, job.id)
    return statusView(job)
  }

  private async markdownPreview(path: string, bytes: number, maxChars: number): Promise<{ text: string; truncated: boolean }> {
    const maxBytes = Math.min(bytes, Math.max(1024, maxChars * 4))
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(maxBytes)
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
      const text = new TextDecoder('utf-8').decode(buffer.subarray(0, bytesRead))
      return { text: text.slice(0, maxChars), truncated: bytesRead < bytes || text.length > maxChars }
    } finally {
      await handle.close()
    }
  }

  private fitResult(view: ResultView, limit: number): ResultView {
    type MutableFile = {
      file_id: string
      name: string
      artifacts: ArtifactView[]
      artifacts_truncated?: boolean
    }
    const { markdown_preview: initialPreview, files: _initialFiles, ...base } = view
    let preview = initialPreview
    let outputTrimmed = false
    const files: MutableFile[] = view.files.map(file => ({ ...file, artifacts: [...file.artifacts] }))
    const build = (): ResultView => ({
      ...base,
      preview_truncated: base.preview_truncated || outputTrimmed,
      files,
      ...(preview === undefined ? {} : { markdown_preview: preview }),
    })
    let candidate = build()
    if (JSON.stringify(candidate).length <= limit) return candidate
    if (preview !== undefined) {
      const fullPreview = preview
      let low = 0
      let high = fullPreview.length
      while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        preview = fullPreview.slice(0, middle)
        if (JSON.stringify(build()).length <= limit) low = middle
        else high = middle - 1
      }
      preview = fullPreview.slice(0, low)
      outputTrimmed = low < fullPreview.length
      candidate = build()
    }
    while (JSON.stringify(candidate).length > limit && files.some(file => file.artifacts.length > 0)) {
      const target = files.find(file => file.artifacts.length > 0)
      if (target === undefined) break
      target.artifacts = target.artifacts.slice(0, -1)
      target.artifacts_truncated = true
      candidate = build()
    }
    if (JSON.stringify(candidate).length > limit) {
      throw new MinerUError(failure('RESULT_TOO_LARGE', 'Result metadata exceeds configured model output limit'))
    }
    return candidate
  }

  async result(session: ServiceSession, jobId: string, signal: AbortSignal): Promise<ResultView> {
    const status = await this.status(session, jobId, signal)
    if (status.state !== 'completed' && status.state !== 'partially-completed') {
      throw new MinerUError(failure('RESULT_NOT_READY', `MinerU job ${jobId} is ${status.state}`, true))
    }
    const job = await this.options.jobs.require(session, jobId)
    if (job.resultId === undefined) throw new MinerUError(failure('CACHE_EVICTED', 'Completed job no longer has a result reference'))
    const manifest = await this.options.results.get(job.cacheKey, job.request.requiredArtifacts, signal)
    if (manifest === undefined || manifest.id !== job.resultId) {
      throw new MinerUError(failure('CACHE_EVICTED', 'Published MinerU result is missing or corrupt'))
    }
    return this.projectResult(job, manifest)
  }

  private async projectResult(job: MinerUJobRecord, manifest: MinerUResultManifest): Promise<ResultView> {
    const limit = this.config().output.maxInlineChars
    const document = manifest.files[0]
    const markdown = document.artifacts.find(artifact => artifact.kind === 'markdown')
    const preview = markdown === undefined
      ? undefined
      : await this.markdownPreview(this.options.results.resolveArtifactAbsolutePath(job.cacheKey, markdown.relativePath), markdown.bytes, limit)
    const artifacts = document.artifacts.map((artifact: ArtifactRef): ArtifactView => ({
      kind: artifact.kind,
      path: this.options.results.resolveArtifactAbsolutePath(job.cacheKey, artifact.relativePath),
      bytes: artifact.bytes,
    }))
    const view: ResultView = {
      job_id: job.id,
      state: job.state === 'partially-completed' ? 'partially-completed' : 'completed',
      cache_hit: job.resolution.kind === 'cache-hit',
      result_id: manifest.id,
      files: [{ file_id: document.fileId, name: job.sourceFiles[0]?.name ?? document.name, artifacts }],
      ...(preview === undefined ? {} : { markdown_preview: preview.text }),
      preview_truncated: preview?.truncated ?? false,
      manifest_path: this.options.results.manifestAbsolutePath(job.cacheKey),
      output_limit_chars: limit,
    }
    return this.fitResult(view, limit)
  }

  async parseDocument(
    session: ServiceSession, input: ParseRequestInput, signal: AbortSignal, pollTimeoutMs?: number,
  ): Promise<ParseDocumentView> {
    const submitted = await this.submit(session, input, signal)
    if (submitted.state === 'completed' || submitted.state === 'partially-completed') return this.result(session, submitted.job_id, signal)
    if (submitted.state === 'failed') return this.status(session, submitted.job_id, signal)
    const job = await this.options.jobs.require(session, submitted.job_id)
    let operation = this.options.operations.get(job.cacheKey, job.providerConfigId)
    if (operation === undefined) {
      await this.status(session, job.id, signal)
      operation = this.options.operations.get(job.cacheKey, job.providerConfigId)
    }
    if (operation === undefined) return this.status(session, job.id, signal)

    const timeout = pollTimeoutMs ?? this.config().polling.pollTimeoutMs
    if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > MAX_POLL_TIMEOUT_MS) {
      throw new MinerUError(failure('INVALID_REQUEST', 'poll timeout is outside the supported range'))
    }
    const waitController = new AbortController()
    const onAbort = (): void => waitController.abort(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => waitController.abort(new MinerUError(failure('POLL_TIMEOUT', 'Synchronous MinerU wait timed out', true))), timeout)
    try {
      await operation.waitForOutcome(waitController.signal)
    } catch (error) {
      if (signal.aborted) throw error
      const current = await this.options.jobs.require(session, job.id)
      if (waitController.signal.aborted && !isTerminalJobState(current.state)) {
        return { ...statusView(current), failure: failure('POLL_TIMEOUT', 'Synchronous wait timed out; query this job_id later', true), poll_timed_out: true }
      }
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
    const current = await this.options.jobs.require(session, job.id)
    return current.state === 'completed' || current.state === 'partially-completed'
      ? this.result(session, job.id, signal)
      : statusView(current)
  }
}
