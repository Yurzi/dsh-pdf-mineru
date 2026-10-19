import { setTimeout as delay } from 'node:timers/promises'
import type { ProbeView } from '../contracts/probe.js'
import { PROVIDER_TRAITS, effectiveParseDefaults, providerById, type MinerUConfig, type ProviderConfig } from '../config/model.js'
import { computeCacheKey } from '../domain/cache-key.js'
import { MinerUError, failure, toMinerUFailure } from '../domain/errors.js'
import type { CacheKey } from '../domain/ids.js'
import type { CanonicalSourceFile, PreparedParseRequest } from '../domain/request.js'
import type { MinerUResultManifest } from '../domain/result.js'
import { emitDiagnostic, type MinerUDiagnosticEvent, type MinerUDiagnosticSink } from '../observability.js'
import { validateProviderCapabilities, type MinerUProvider, type ProviderCallContext, type ProviderJobSnapshot } from '../providers/contract.js'
import type { ProviderRetryEvent } from '../providers/http/retry.js'
import type { ProviderFactory } from '../providers/registry.js'
import { assertSourcesUnchanged, canonicalParseRequest, prepareSource } from '../source/prepared-source.js'
import type { StorageAccessGate } from '../storage/access-gate.js'
import type { ResultRepository, ResultTransaction } from '../storage/result-repository.js'
import type { SharedOperation, SharedOperationRegistry, SharedOutcome } from './shared-operations.js'

/** Invocation-local progress only; never carries provider refs, paths or credentials. */
export type ParseProgress = 'preparing' | 'waiting-for-parse' | 'reading-result' | 'summarizing'
export type ParseProgressListener = (phase: ParseProgress) => void

export function reportProgress(listener: ParseProgressListener | undefined, phase: ParseProgress): void {
  try { listener?.(phase) } catch { /* Observation must not change parse or cancellation outcomes. */ }
}

export type CredentialResolver = (reference: string, signal: AbortSignal) => Promise<string | undefined>

export interface ParseServiceOptions {
  readonly createProvider: ProviderFactory
  readonly results: ResultRepository
  readonly operations: SharedOperationRegistry
  readonly accessGate: Pick<StorageAccessGate, 'runShared'>
  readonly resolveCredential: CredentialResolver
  readonly diagnostics?: MinerUDiagnosticSink
}

/** A verified published result; reading it never needs the Provider again. */
export interface PublishedResult {
  readonly cacheKey: CacheKey
  readonly manifest: MinerUResultManifest
  readonly source: 'cache' | 'shared-operation' | 'provider'
  /** The current local source; its name may differ from the file that first produced the result. */
  readonly sourceFile: CanonicalSourceFile
}

export interface EnsurePublishedOptions {
  /** Continuations read the cache only and never start a Provider. */
  readonly cacheOnly?: boolean
  /** Synchronous wait bound: omitted uses polling.pollTimeoutMs, null waits for the shared outcome. */
  readonly waitTimeoutMs?: number | null
  readonly onProgress?: ParseProgressListener
}

interface ActiveProvider {
  readonly config: ProviderConfig
  readonly provider: MinerUProvider
}

type Pending =
  | { readonly kind: 'published'; readonly result: PublishedResult }
  | { readonly kind: 'operation'; readonly source: 'provider' | 'shared-operation'; readonly operation: SharedOperation; readonly prepared: PreparedParseRequest; readonly cacheKey: CacheKey }

/** Parse orchestration: one cache key per source, same-process coalescing, and verified publication. */
export class ParseService {
  constructor(private readonly options: ParseServiceOptions) {}

  private diagnostic(event: MinerUDiagnosticEvent): void {
    emitDiagnostic(this.options.diagnostics, event)
  }

  private active(config: MinerUConfig): ActiveProvider {
    const provider = providerById(config, config.activeProvider)!
    return { config: provider, provider: this.options.createProvider(provider) }
  }

  private async callContext(
    provider: ProviderConfig,
    config: MinerUConfig,
    signal: AbortSignal,
    operationId?: string,
    allowMissingCredential = false,
  ): Promise<ProviderCallContext> {
    signal.throwIfAborted()
    const reference = provider.apiKeyEnv
    const credential = reference === undefined ? undefined : await this.options.resolveCredential(reference, signal)
    signal.throwIfAborted()
    if (PROVIDER_TRAITS[provider.type].requiresCredential && credential === undefined && !allowMissingCredential) {
      throw new MinerUError(failure('CREDENTIAL_MISSING', `Credential ${provider.apiKeyEnv} is not configured`))
    }
    return {
      signal,
      ...(credential === undefined ? {} : { credential }),
      timeoutMs: config.polling.requestTimeoutMs,
      retry: {
        maxRetries: config.retry.maxAttempts - 1,
        initialDelayMs: config.retry.baseDelayMs,
        maxDelayMs: config.retry.maxDelayMs,
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
        maxApiResponseBytes: config.limits.maxApiResponseBytes,
        maxZipDownloadBytes: config.limits.maxZipDownloadBytes,
        maxZipEntries: config.limits.maxZipEntries,
        maxZipEntryBytes: config.limits.maxZipEntryBytes,
        maxZipTotalBytes: config.limits.maxZipTotalBytes,
        maxZipCompressionRatio: config.limits.maxZipCompressionRatio,
      },
    }
  }

  /** Discover the active (or an unsaved draft) provider without creating parse state. */
  async probe(config: MinerUConfig, signal: AbortSignal, draft?: ProviderConfig): Promise<ProbeView> {
    const resolved = draft === undefined ? this.active(config) : { config: draft, provider: this.options.createProvider(draft) }
    const result = await resolved.provider.probe(await this.callContext(resolved.config, config, signal, undefined, true))
    return {
      available: result.available,
      provider: result.provider,
      authentication: result.authentication,
      protocol_version: result.protocolVersion,
      ...(result.serverVersion === undefined ? {} : { server_version: result.serverVersion }),
      ...(result.availableTiers === undefined ? {} : { available_tiers: result.availableTiers }),
      ...(result.outputFormats === undefined ? {} : { output_formats: result.outputFormats }),
      ...(result.sourceTypes === undefined ? {} : { source_types: result.sourceTypes }),
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

  /**
   * Return the verified published result for one absolute source path, joining or
   * starting the shared producer. A timed-out wait leaves the producer running.
   */
  async ensurePublished(sourcePath: string, config: MinerUConfig, signal: AbortSignal, options: EnsurePublishedOptions = {}): Promise<PublishedResult> {
    signal.throwIfAborted()
    reportProgress(options.onProgress, 'preparing')
    const pending = await this.prepare(sourcePath, config, signal, options.cacheOnly === true)
    if (pending.kind === 'published') {
      reportProgress(options.onProgress, 'reading-result')
      return pending.result
    }
    const wait = waitSignal(signal, options.waitTimeoutMs === null ? undefined : options.waitTimeoutMs ?? config.polling.pollTimeoutMs)
    let outcome: SharedOutcome
    try {
      reportProgress(options.onProgress, 'waiting-for-parse')
      outcome = await pending.operation.waitForOutcome(wait.signal)
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error
      if (wait.timedOut()) {
        throw new MinerUError(failure('POLL_TIMEOUT', 'Synchronous MinerU wait timed out; retry the same request to rejoin the shared operation', true))
      }
      throw error
    } finally {
      wait.dispose()
    }
    if (outcome.state === 'failed' || outcome.resultId === undefined) {
      throw new MinerUError(outcome.failure ?? failure('REMOTE_PARSE_FAILED', 'Remote parse failed'))
    }
    reportProgress(options.onProgress, 'reading-result')
    const manifest = await this.options.results.get(pending.cacheKey, pending.prepared.request.requiredArtifacts, signal)
    if (manifest === undefined || manifest.id !== outcome.resultId) {
      throw new MinerUError(failure('CACHE_EVICTED', 'Published MinerU result is missing or corrupt'))
    }
    return { cacheKey: pending.cacheKey, manifest, source: pending.source, sourceFile: pending.prepared.request.files[0]! }
  }

  private async prepare(sourcePath: string, config: MinerUConfig, signal: AbortSignal, cacheOnly: boolean): Promise<Pending> {
    const resolved = this.active(config)
    const source = await prepareSource(sourcePath, Math.min(config.limits.maxFileBytes, resolved.provider.capabilities.maxFileBytes ?? config.limits.maxFileBytes), signal)
    const prepared: PreparedParseRequest = { request: canonicalParseRequest(effectiveParseDefaults(config.defaults, resolved.config), source), sources: [source] }
    const file = prepared.request.files[0]!
    validateProviderCapabilities(prepared.request, resolved.provider.capabilities)
    const compatibility = resolved.provider.compatibilityKey(prepared.request)
    const cacheKey = computeCacheKey(prepared.request, file, compatibility)
    const published = (manifest: MinerUResultManifest): Pending => ({ kind: 'published', result: { cacheKey, manifest, source: 'cache', sourceFile: file } })

    const hit = config.storage.cacheEnabled || cacheOnly
      ? await this.options.results.get(cacheKey, prepared.request.requiredArtifacts, signal)
      : undefined
    if (hit !== undefined) {
      this.diagnostic({ level: 'info', phase: 'cache-hit', provider: resolved.provider.id, bytes: file.bytes, cacheHit: true })
      return published(hit)
    }
    if (cacheOnly) throw new MinerUError(failure('CACHE_EVICTED', 'Cursor result is missing or corrupt; restart without a cursor. Continuation never starts a new Provider parse.'))

    const reservation = this.options.operations.reserve(cacheKey, resolved.config.id, config.polling.operationTimeoutMs)
    if (!reservation.created) return { kind: 'operation', source: 'shared-operation', operation: reservation.operation, prepared, cacheKey }
    try {
      const cached = config.storage.cacheEnabled
        ? await this.options.results.get(cacheKey, prepared.request.requiredArtifacts, signal)
        : undefined
      if (cached !== undefined) {
        this.options.operations.start(reservation.operation, async () => ({ state: 'completed', resultId: cached.id }))
        return published(cached)
      }
      this.options.operations.start(reservation.operation, operation => this.options.accessGate.runShared(
        () => this.produce(operation, prepared, resolved, compatibility, config), operation.controller.signal,
      ))
    } catch (error) {
      this.options.operations.release(reservation.operation, error)
      throw error
    }
    return { kind: 'operation', source: 'provider', operation: reservation.operation, prepared, cacheKey }
  }

  private async produce(
    operation: SharedOperation,
    prepared: PreparedParseRequest,
    resolved: ActiveProvider,
    compatibility: string,
    config: MinerUConfig,
  ): Promise<SharedOutcome> {
    let transaction: ResultTransaction | undefined
    const startedAt = Date.now()
    const signal = operation.controller.signal
    const requestBytes = prepared.request.files.reduce((total, source) => total + source.bytes, 0)
    const providerId = resolved.provider.id
    try {
      // A concurrent process may have published while this one waited for the producer lease.
      const cached = config.storage.cacheEnabled
        ? await this.options.results.get(operation.cacheKey, prepared.request.requiredArtifacts, signal)
        : undefined
      if (cached !== undefined) {
        this.diagnostic({
          level: 'info', phase: 'cache-hit', provider: providerId, operationId: operation.id,
          durationMs: Date.now() - startedAt, bytes: requestBytes, cacheHit: true, waiterCount: operation.waiterCount,
        })
        return { state: 'completed', resultId: cached.id }
      }

      await assertSourcesUnchanged(prepared.sources, signal)
      this.diagnostic({
        level: 'info', phase: 'uploading', provider: providerId, operationId: operation.id,
        bytes: requestBytes, waiterCount: operation.waiterCount,
      })
      const call = () => this.callContext(resolved.config, config, signal, operation.id)
      const submission = await resolved.provider.submit(prepared.request, prepared.sources, await call())
      let snapshot: ProviderJobSnapshot = submission
      this.diagnostic({
        level: snapshot.state === 'failed' ? 'warn' : 'info', phase: 'provider-accepted',
        provider: providerId, operationId: operation.id, bytes: requestBytes,
        waiterCount: operation.waiterCount,
      })
      while (snapshot.state !== 'completed' && snapshot.state !== 'partially-completed') {
        if (snapshot.state === 'failed') {
          return { state: 'failed', failure: snapshot.files.find(file => file.failure)?.failure ?? failure('REMOTE_PARSE_FAILED', 'Remote parse failed') }
        }
        await delay(config.polling.pollIntervalMs, undefined, { signal })
        snapshot = await resolved.provider.inspect(submission.ref, await call())
      }

      this.diagnostic({
        level: 'info', phase: 'collecting', provider: providerId, operationId: operation.id,
        durationMs: Date.now() - startedAt, bytes: requestBytes, waiterCount: operation.waiterCount,
      })
      transaction = this.options.results.beginTransaction(
        operation.id,
        prepared.request,
        { providerId, providerConfigId: resolved.config.id, compatibilityKey: compatibility },
        signal,
      )
      const collection = await resolved.provider.collect(submission.ref, prepared.request, transaction, await call())
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
      const published = await this.options.results.commitTransaction(transaction, manifest, signal)
      transaction = undefined
      this.diagnostic({
        level: 'info', phase: 'published', provider: providerId, operationId: operation.id,
        durationMs: Date.now() - startedAt, bytes: requestBytes, cacheHit: false, waiterCount: operation.waiterCount,
      })
      return { state: 'completed', resultId: published.resultId }
    } catch (error) {
      await transaction?.abort().catch(() => undefined)
      const normalized = toMinerUFailure(error)
      this.diagnostic({
        level: normalized.retryable ? 'warn' : 'error', phase: 'failed', provider: providerId,
        operationId: operation.id, durationMs: Date.now() - startedAt, bytes: requestBytes,
        waiterCount: operation.waiterCount, errorCode: normalized.code, retryable: normalized.retryable,
      })
      return { state: 'failed', failure: normalized }
    }
  }
}

function waitSignal(signal: AbortSignal, timeoutMs: number | undefined): {
  readonly signal: AbortSignal
  readonly timedOut: () => boolean
  dispose(): void
} {
  const controller = new AbortController()
  let didTimeOut = false
  const onAbort = (): void => controller.abort(signal.reason)
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) controller.abort(signal.reason)
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
    didTimeOut = true
    controller.abort(new MinerUError(failure('POLL_TIMEOUT', 'Synchronous MinerU wait timed out', true)))
  }, timeoutMs)
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
