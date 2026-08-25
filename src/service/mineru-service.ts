import { open } from 'node:fs/promises'
import { TextDecoder } from 'node:util'
import type { MinerUConfig, ProviderConfig } from '../config.js'
import type { MinerUFailure, MinerUProviderId } from '../domain/errors.js'
import { MinerUError, failure, toMinerUFailure } from '../domain/errors.js'
import type { CacheKey, MinerUResultId } from '../domain/ids.js'
import type { ParseRequestInput, PreparedParseRequest } from '../domain/request.js'
import type { ArtifactRef, MinerUResultManifest } from '../domain/result.js'
import type {
  ProviderCallContext,
  ProviderJobSnapshot,
  ProviderRetryEvent,
} from '../providers/provider.js'
import { validateProviderCapabilities } from '../providers/provider.js'
import { ProviderRegistry, type ResolvedProvider } from '../providers/registry.js'
import { BatchArtifactRouter } from '../storage/batch-artifact-router.js'
import type { ResultRepository, ResultTransaction } from '../storage/result-repository.js'
import { emitDiagnostic, type MinerUDiagnosticEvent, type MinerUDiagnosticSink } from '../observability.js'
import { BatchCoordinator, type BatchParticipant } from './batch-coordinator.js'
import { computeCacheKey } from './cache-key.js'
import { RequestNormalizer, assertSourcesUnchanged } from './request-normalizer.js'
import { SharedOperationRegistry, type SharedOperation, type SharedOutcome } from './shared-operations.js'

export interface ServiceSession {
  readonly header: { readonly id: string; readonly cwd?: string }
}

const MAX_POLL_TIMEOUT_MS = 24 * 60 * 60 * 1000

export type CredentialResolver = (reference: string, signal: AbortSignal) => Promise<string | undefined>
export type SubmissionSource = 'cache' | 'shared-operation' | 'provider'

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
  readonly state: 'completed'
  readonly source: SubmissionSource
  readonly cache_hit: boolean
  readonly result_id: string
  readonly files: readonly ResultFileView[]
  readonly markdown_preview?: string
  readonly preview_truncated: boolean
  readonly manifest_path: string
  readonly output_limit_chars: number
}

export interface FailedParseView {
  readonly state: 'failed'
  readonly source: SubmissionSource
  readonly file_id: string
  readonly name: string
  readonly failure: MinerUFailure
}

export interface BatchParseDocumentView {
  readonly kind: 'batch'
  readonly state: 'completed' | 'partially-completed' | 'failed'
  readonly results: readonly (ResultView | FailedParseView)[]
}

export type ParseDocumentView = ResultView | BatchParseDocumentView

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

export interface MinerUServiceOptions {
  readonly getConfig: () => MinerUConfig
  readonly providers: ProviderRegistry
  readonly results: ResultRepository
  readonly operations: SharedOperationRegistry
  readonly resolveCredential: CredentialResolver
  readonly diagnostics?: MinerUDiagnosticSink
}

interface PendingFileParse {
  readonly prepared: PreparedParseRequest
  readonly cacheKey: CacheKey
  source: SubmissionSource
  resultId?: MinerUResultId
  operation?: SharedOperation
  created?: boolean
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
    timer.unref?.()
  })
}

function singlePreparedRequest(prepared: PreparedParseRequest, index: number): PreparedParseRequest {
  const file = prepared.request.files[index]
  const source = prepared.sources[index]
  if (file === undefined || source === undefined) throw new TypeError('Prepared request source mapping is incomplete')
  return {
    request: { ...prepared.request, files: [file] },
    sources: [source],
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
    const result = await resolved.provider.probe(await this.callContext(resolved.config, signal, undefined, true))
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

  private async prepare(
    session: ServiceSession,
    input: ParseRequestInput,
    signal: AbortSignal,
  ): Promise<{ readonly pending: readonly PendingFileParse[]; readonly resolved: ResolvedProvider; readonly compatibility: string }> {
    const resolved = this.options.providers.active()
    const current = this.config()
    const normalizer = new RequestNormalizer({
      defaults: current.defaults,
      cwd: session.header.cwd,
      maxFiles: Math.min(current.limits.maxFilesPerRequest, resolved.provider.capabilities.maxFilesPerSubmission),
      maxFileBytes: Math.min(current.limits.maxFileBytes, resolved.provider.capabilities.maxFileBytes ?? current.limits.maxFileBytes),
    })
    const prepared = await normalizer.normalize(input, signal)
    const maxTotalRequestBytes = current.limits.maxFileBytes * current.limits.maxFilesPerRequest
    const totalRequestBytes = prepared.request.files.reduce((total, file) => total + file.bytes, 0)
    if (!Number.isSafeInteger(maxTotalRequestBytes) || totalRequestBytes > maxTotalRequestBytes) {
      throw new MinerUError(failure('FILE_TOO_LARGE', 'Combined request files exceed the derived total byte limit'))
    }
    validateProviderCapabilities(prepared.request, resolved.provider.capabilities)
    const compatibility = await resolved.provider.compatibilityKey(prepared.request, {
      configuredVersion: 'configuredVersion' in resolved.config ? resolved.config.configuredVersion : undefined,
    })
    const pending: PendingFileParse[] = []

    try {
      for (let index = 0; index < prepared.request.files.length; index++) {
        const one = singlePreparedRequest(prepared, index)
        const file = one.request.files[0]!
        const cacheKey = computeCacheKey(one.request, file, compatibility)
        const hit = current.storage.cacheEnabled
          ? await this.options.results.get(cacheKey, one.request.requiredArtifacts, signal)
          : undefined
        if (hit !== undefined) {
          pending.push({ prepared: one, cacheKey, source: 'cache', resultId: hit.id })
          this.diagnostic({
            level: 'info', phase: 'cache-hit', provider: resolved.provider.id,
            bytes: file.bytes, cacheHit: true,
          })
          continue
        }
        const reservation = this.options.operations.reserve(
          cacheKey,
          resolved.config.id,
          current.polling.operationTimeoutMs,
        )
        pending.push({
          prepared: one,
          cacheKey,
          source: reservation.created ? 'provider' : 'shared-operation',
          operation: reservation.operation,
          created: reservation.created,
        })
      }
    } catch (error) {
      for (const item of pending) {
        if (item.created === true && item.operation !== undefined) this.options.operations.release(item.operation, error)
      }
      throw error
    }

    const created = pending.filter(item => item.created === true)
    try {
      const producers: PendingFileParse[] = []
      for (const item of created) {
        const cached = current.storage.cacheEnabled
          ? await this.options.results.get(item.cacheKey, item.prepared.request.requiredArtifacts, signal)
          : undefined
        if (cached === undefined) {
          producers.push(item)
          continue
        }
        item.source = 'cache'
        item.resultId = cached.id
        this.options.operations.start(item.operation!, async () => ({ state: 'completed', resultId: cached.id }))
      }
      if (producers.length === 1) {
        const item = producers[0]!
        this.options.operations.start(
          item.operation!,
          operation => this.runOperation(operation, item.prepared, resolved, compatibility),
        )
      } else if (producers.length > 1) {
        this.startBatch(producers, resolved, compatibility, current)
      }
    } catch (error) {
      for (const item of created) {
        if (item.operation !== undefined) this.options.operations.release(item.operation, error)
      }
      throw error
    }

    return { pending, resolved, compatibility }
  }

  private startBatch(
    items: readonly PendingFileParse[],
    resolved: ResolvedProvider,
    compatibility: string,
    current: MinerUConfig,
  ): void {
    const transactions = new Map<string, ResultTransaction>()
    for (const item of items) {
      const operation = item.operation!
      const fileId = item.prepared.request.files[0]!.fileId
      transactions.set(fileId, this.options.results.beginTransaction(
        operation.id,
        item.prepared.request,
        { providerId: resolved.provider.id, providerConfigId: resolved.config.id, compatibilityKey: compatibility },
      ))
    }
    const router = new BatchArtifactRouter(items.map(item => ({
      fileId: item.prepared.request.files[0]!.fileId,
      transaction: transactions.get(item.prepared.request.files[0]!.fileId)!,
    })))
    let unregister = (): void => undefined
    const coordinator = new BatchCoordinator({
      participants: items.map(item => {
        const operation = item.operation!
        const file = item.prepared.request.files[0]!
        const transaction = transactions.get(file.fileId)!
        const fail = async (error: unknown): Promise<SharedOutcome> => {
          await transaction.abort().catch(() => undefined)
          return { state: 'failed', failure: toMinerUFailure(error) }
        }
        return {
          request: item.prepared.request,
          source: item.prepared.sources[0]!,
          operation,
          collected: async collected => {
            if (collected.failure !== undefined) return fail(new MinerUError(collected.failure))
            const manifest = transaction.buildManifest(file, collected.artifacts)
            const published = await this.options.results.commitTransaction(
              transaction,
              manifest,
              coordinator.controller.signal,
            )
            return { state: 'completed', resultId: published.resultId }
          },
          failed: fail,
        } satisfies BatchParticipant
      }),
      resolved,
      sink: router,
      pollIntervalMs: current.polling.pollIntervalMs,
      timeoutMs: current.polling.operationTimeoutMs,
      createContext: signal => this.callContext(resolved.config, signal, items[0]!.operation!.id),
      unregister: () => unregister(),
    })
    unregister = this.options.operations.registerCoordinator(() => coordinator.abort(
      new MinerUError(failure('CANCELLED', 'MinerU plugin disposed', true)),
    ))
    for (const item of items) {
      const operation = item.operation!
      this.options.operations.start(operation, async () => {
        await coordinator.run().catch(() => undefined)
        const settled = operation.settledValue
        if (settled === undefined) throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'Batch participant did not settle'))
        return settled
      })
    }
  }

  private async runOperation(
    operation: SharedOperation,
    prepared: PreparedParseRequest,
    resolved: ResolvedProvider,
    compatibility: string,
  ): Promise<SharedOutcome> {
    let transaction: ResultTransaction | undefined
    const startedAt = Date.now()
    const requestBytes = prepared.request.files.reduce((total, source) => total + source.bytes, 0)
    try {
      const cached = this.config().storage.cacheEnabled
        ? await this.options.results.get(operation.cacheKey, prepared.request.requiredArtifacts, operation.controller.signal)
        : undefined
      if (cached !== undefined) {
        this.diagnostic({
          level: 'info', phase: 'cache-hit', provider: resolved.provider.id, operationId: operation.id,
          durationMs: Date.now() - startedAt, bytes: requestBytes, cacheHit: true, waiterCount: operation.waiterCount,
        })
        return { state: 'completed', resultId: cached.id }
      }

      await assertSourcesUnchanged(prepared.sources, operation.controller.signal)
      this.diagnostic({
        level: 'info', phase: 'uploading', provider: resolved.provider.id, operationId: operation.id,
        bytes: requestBytes, waiterCount: operation.waiterCount,
      })
      const submission = await resolved.provider.submit(
        prepared.request,
        prepared.sources,
        await this.callContext(resolved.config, operation.controller.signal, operation.id),
      )
      let snapshot: ProviderJobSnapshot = submission
      const submissionFailure = snapshot.files.find(file => file.failure)?.failure
        ?? failure('REMOTE_PARSE_FAILED', 'Remote parse failed')
      this.diagnostic({
        level: snapshot.state === 'failed' ? 'warn' : 'info', phase: 'provider-accepted',
        provider: resolved.provider.id, operationId: operation.id, bytes: requestBytes,
        waiterCount: operation.waiterCount,
      })
      if (snapshot.state === 'failed') return { state: 'failed', failure: submissionFailure }

      while (snapshot.state !== 'completed' && snapshot.state !== 'partially-completed') {
        await delay(this.config().polling.pollIntervalMs, operation.controller.signal)
        snapshot = await resolved.provider.inspect(
          submission.ref,
          await this.callContext(resolved.config, operation.controller.signal, operation.id),
        )
        if (snapshot.state === 'failed') {
          return {
            state: 'failed',
            failure: snapshot.files.find(file => file.failure)?.failure
              ?? failure('REMOTE_PARSE_FAILED', 'Remote parse failed'),
          }
        }
      }

      this.diagnostic({
        level: 'info', phase: 'collecting', provider: resolved.provider.id, operationId: operation.id,
        durationMs: Date.now() - startedAt, bytes: requestBytes, waiterCount: operation.waiterCount,
      })
      transaction = this.options.results.beginTransaction(
        operation.id,
        prepared.request,
        { providerId: resolved.provider.id, providerConfigId: resolved.config.id, compatibilityKey: compatibility },
        operation.controller.signal,
      )
      const collection = await resolved.provider.collect(
        submission.ref,
        prepared.request,
        transaction,
        await this.callContext(resolved.config, operation.controller.signal, operation.id),
      )
      const file = prepared.request.files[0]!
      const collected = collection.files.find(candidate => candidate.fileId === file.fileId)
      if (collected === undefined || collected.failure !== undefined) {
        await transaction.abort()
        transaction = undefined
        return {
          state: 'failed',
          failure: collected?.failure ?? failure('REMOTE_PARSE_FAILED', 'Provider did not collect the requested file'),
        }
      }
      const manifest = transaction.buildManifest(file, collected.artifacts)
      const published = await this.options.results.commitTransaction(transaction, manifest, operation.controller.signal)
      transaction = undefined
      this.diagnostic({
        level: 'info', phase: 'published', provider: resolved.provider.id, operationId: operation.id,
        durationMs: Date.now() - startedAt, bytes: requestBytes, cacheHit: false, waiterCount: operation.waiterCount,
      })
      return { state: 'completed', resultId: published.resultId }
    } catch (error) {
      await transaction?.abort().catch(() => undefined)
      const normalized = toMinerUFailure(error)
      this.diagnostic({
        level: normalized.retryable ? 'warn' : 'error', phase: 'failed', provider: resolved.provider.id,
        operationId: operation.id, durationMs: Date.now() - startedAt, bytes: requestBytes,
        waiterCount: operation.waiterCount, errorCode: normalized.code, retryable: normalized.retryable,
      })
      return { state: 'failed', failure: normalized }
    }
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
    type MutableFile = Omit<ResultFileView, 'artifacts' | 'artifacts_truncated'> & {
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

  private async projectResult(item: PendingFileParse, manifest: MinerUResultManifest): Promise<ResultView> {
    const limit = this.config().output.maxInlineChars
    const document = manifest.files[0]!
    const markdown = document.artifacts.find(artifact => artifact.kind === 'markdown')
    const preview = markdown === undefined
      ? undefined
      : await this.markdownPreview(
        this.options.results.resolveArtifactAbsolutePath(item.cacheKey, markdown.relativePath),
        markdown.bytes,
        limit,
      )
    const artifacts = document.artifacts.map((artifact: ArtifactRef): ArtifactView => ({
      kind: artifact.kind,
      path: this.options.results.resolveArtifactAbsolutePath(item.cacheKey, artifact.relativePath),
      bytes: artifact.bytes,
    }))
    return this.fitResult({
      state: 'completed',
      source: item.source,
      cache_hit: item.source === 'cache',
      result_id: manifest.id,
      files: [{ file_id: document.fileId, name: item.prepared.request.files[0]?.name ?? document.name, artifacts }],
      ...(preview === undefined ? {} : { markdown_preview: preview.text }),
      preview_truncated: preview?.truncated ?? false,
      manifest_path: this.options.results.manifestAbsolutePath(item.cacheKey),
      output_limit_chars: limit,
    }, limit)
  }

  private createWaitSignal(signal: AbortSignal, pollTimeoutMs: number | null | undefined): {
    readonly signal: AbortSignal
    readonly timedOut: () => boolean
    dispose(): void
  } {
    const timeout = pollTimeoutMs === null ? undefined : pollTimeoutMs ?? this.config().polling.pollTimeoutMs
    if (timeout !== undefined && (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > MAX_POLL_TIMEOUT_MS)) {
      throw new MinerUError(failure('INVALID_REQUEST', 'poll timeout is outside the supported range'))
    }
    const controller = new AbortController()
    let didTimeOut = false
    const onAbort = (): void => controller.abort(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) controller.abort(signal.reason)
    const timer = timeout === undefined ? undefined : setTimeout(() => {
      didTimeOut = true
      controller.abort(new MinerUError(failure('POLL_TIMEOUT', 'Synchronous MinerU wait timed out', true)))
    }, timeout)
    timer?.unref?.()
    return {
      signal: controller.signal,
      timedOut: () => didTimeOut,
      dispose: () => {
        if (timer !== undefined) clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
      },
    }
  }

  /** Parse directly to immutable results. No plugin Job is created for this call. */
  async parseDocument(
    session: ServiceSession,
    input: ParseRequestInput,
    signal: AbortSignal,
    pollTimeoutMs?: number | null,
  ): Promise<ParseDocumentView> {
    const { pending } = await this.prepare(session, input, signal)
    const wait = this.createWaitSignal(signal, pollTimeoutMs)
    let outcomes: SharedOutcome[]
    try {
      outcomes = await Promise.all(pending.map(async item => {
        if (item.resultId !== undefined) return { state: 'completed', resultId: item.resultId } as const
        if (item.operation === undefined) throw new TypeError('Pending parse has no result or shared operation')
        return await item.operation.waitForOutcome(wait.signal)
      }))
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error
      if (wait.timedOut()) {
        throw new MinerUError(failure('POLL_TIMEOUT', 'Synchronous MinerU wait timed out; retry the same request to rejoin the shared operation', true))
      }
      throw error
    } finally {
      wait.dispose()
    }

    const views = await Promise.all(outcomes.map(async (outcome, index): Promise<ResultView | FailedParseView> => {
      const item = pending[index]!
      const file = item.prepared.request.files[0]!
      if (outcome.state === 'failed' || outcome.resultId === undefined) {
        return {
          state: 'failed',
          source: item.source,
          file_id: file.fileId,
          name: file.name,
          failure: outcome.failure ?? failure('REMOTE_PARSE_FAILED', 'Remote parse failed'),
        }
      }
      const manifest = await this.options.results.get(
        item.cacheKey,
        item.prepared.request.requiredArtifacts,
        signal,
      )
      if (manifest === undefined || manifest.id !== outcome.resultId) {
        return {
          state: 'failed',
          source: item.source,
          file_id: file.fileId,
          name: file.name,
          failure: failure('CACHE_EVICTED', 'Published MinerU result is missing or corrupt'),
        }
      }
      return await this.projectResult(item, manifest)
    }))

    if (views.length === 1) {
      const view = views[0]!
      if (view.state === 'failed') throw new MinerUError(view.failure)
      return view
    }
    const completed = views.filter(view => view.state === 'completed').length
    return {
      kind: 'batch',
      state: completed === views.length ? 'completed' : completed === 0 ? 'failed' : 'partially-completed',
      results: views,
    }
  }
}
