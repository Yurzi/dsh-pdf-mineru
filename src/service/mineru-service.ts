import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
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
import type {
  ArtifactView,
  BatchParseDocumentView,
  ContentStatus,
  DocumentHeading,
  FailedParseView,
  ParseDocumentView,
  ResultFileView,
  ResultView,
  SubmissionSource,
} from './result-presenter.js'
import {
  allocateReclaimedShares,
  extractMarkdownHeadings,
  formatParseDocumentProse,
  formatResultProse,
  readMarkdownFile,
  truncateAtCleanBoundary,
} from './result-presenter.js'

export * from './result-presenter.js'

export interface ServiceSession {
  readonly header: { readonly id: string; readonly cwd?: string }
}

const MAX_POLL_TIMEOUT_MS = 24 * 60 * 60 * 1000

export type CredentialResolver = (reference: string, signal: AbortSignal) => Promise<string | undefined>

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
  readonly markdownRequested: boolean
  source: SubmissionSource
  resultId?: MinerUResultId
  operation?: SharedOperation
  created?: boolean
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


type RawParsedItem =
  | { readonly state: 'failed'; readonly failureView: FailedParseView }
  | {
      readonly state: 'completed'
      readonly item: PendingFileParse
      readonly manifest: MinerUResultManifest
      readonly fileId: string
      readonly fileName: string
      readonly markdownRequested: boolean
      readonly markdownPath?: string
      readonly markdownBytes?: number
      readonly manifestPath: string
      readonly secondaryArtifacts: readonly ArtifactView[]
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
    const markdownRequested = input.artifacts === undefined || input.artifacts.includes('markdown')

    try {
      for (let index = 0; index < prepared.request.files.length; index++) {
        const one = singlePreparedRequest(prepared, index)
        const file = one.request.files[0]!
        const cacheKey = computeCacheKey(one.request, file, compatibility)
        const hit = current.storage.cacheEnabled
          ? await this.options.results.get(cacheKey, one.request.requiredArtifacts, signal)
          : undefined
        if (hit !== undefined) {
          pending.push({ prepared: one, cacheKey, markdownRequested, source: 'cache', resultId: hit.id })
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
          markdownRequested,
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
        await delay(this.config().polling.pollIntervalMs, undefined, { signal: operation.controller.signal })
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

  private fitSingleCandidate(
    candidate: ResultView,
    secondaryArtifacts: readonly ArtifactView[],
    limit: number,
  ): ResultView {
    let view = candidate
    let overhead = Math.max(JSON.stringify(view).length, formatResultProse(view).length)
    if (overhead <= limit) return view

    const strippedFiles: ResultFileView[] = view.files.map(f => ({
      ...f,
      artifacts: [],
      ...(secondaryArtifacts.length > 0 ? { artifacts_truncated: true } : {}),
    }))
    view = { ...view, files: strippedFiles }
    overhead = Math.max(JSON.stringify(view).length, formatResultProse(view).length)
    if (overhead > limit) {
      throw new MinerUError(failure('RESULT_TOO_LARGE', 'Result metadata exceeds configured model output limit'))
    }
    return view
  }

  private async projectSingle(
    data: Extract<RawParsedItem, { state: 'completed' }>,
    limit: number,
  ): Promise<ResultView> {
    if (!data.markdownRequested) {
      const baseFiles: ResultFileView[] = [{
        file_id: data.fileId,
        name: data.fileName,
        artifacts: [...data.secondaryArtifacts],
      }]
      const candidate: ResultView = {
        state: 'completed',
        source: data.item.source,
        cache_hit: data.item.source === 'cache',
        result_id: data.manifest.id,
        files: baseFiles,
        content_status: 'not_requested',
        manifest_path: data.manifestPath,
        output_limit_chars: limit,
      }
      return this.fitSingleCandidate(candidate, data.secondaryArtifacts, limit)
    }

    const raw = await readMarkdownFile(data.markdownPath!, data.markdownBytes ?? 0, limit)
    const markdownArtifact: ArtifactView = {
      kind: 'markdown',
      path: data.markdownPath!,
      bytes: data.markdownBytes ?? 0,
    }

    const skeleton: ResultView = {
      state: 'completed',
      source: data.item.source,
      cache_hit: data.item.source === 'cache',
      result_id: data.manifest.id,
      files: [{
        file_id: data.fileId,
        name: data.fileName,
        artifacts: [markdownArtifact],
        markdown_path: data.markdownPath,
      }],
      content_status: 'complete',
      markdown_path: data.markdownPath,
      manifest_path: data.manifestPath,
      output_limit_chars: limit,
      markdown_content: '',
    }

    let overhead = Math.max(JSON.stringify(skeleton).length, formatResultProse(skeleton).length)
    let baseArtifacts: ArtifactView[] = [markdownArtifact]
    let baseArtifactsTruncated = false

    if (overhead > limit) {
      const strippedSkeleton: ResultView = {
        ...skeleton,
        files: [{ file_id: data.fileId, name: data.fileName, artifacts: [], artifacts_truncated: true, markdown_path: data.markdownPath }],
      }
      overhead = Math.max(JSON.stringify(strippedSkeleton).length, formatResultProse(strippedSkeleton).length)
      if (overhead > limit) {
        throw new MinerUError(failure('RESULT_TOO_LARGE', 'Result metadata exceeds configured model output limit'))
      }
      baseArtifacts = []
      baseArtifactsTruncated = true
    }

    const avail = Math.max(0, limit - overhead)
    const textBudget = Math.floor(avail / 1.05)

    let contentStatus: ContentStatus
    let content: string
    let readOffsetLine: number | undefined
    let artifactsTruncated = baseArtifactsTruncated
    let fullText = raw.text
    let toc: DocumentHeading[] | undefined

    if (raw.text.length <= textBudget && raw.isCompleteFile) {
      contentStatus = 'complete'
      content = raw.text
      readOffsetLine = undefined
    } else {
      contentStatus = 'partial'
      const cut = truncateAtCleanBoundary(raw.text, textBudget)
      content = cut.text
      readOffsetLine = cut.resumeLine
      if (data.secondaryArtifacts.length > 0) {
        artifactsTruncated = true
      }
      if (!raw.isCompleteFile && data.markdownPath) {
        try {
          fullText = await readFile(data.markdownPath, 'utf8')
        } catch {
          // fallback to raw.text
        }
      }
      toc = extractMarkdownHeadings(fullText)
    }

    let finalArtifacts: ArtifactView[] = baseArtifacts
    if (contentStatus === 'complete' && !baseArtifactsTruncated && data.secondaryArtifacts.length > 0) {
      const withSecondary = [markdownArtifact, ...data.secondaryArtifacts]
      const testView: ResultView = {
        state: 'completed',
        source: data.item.source,
        cache_hit: data.item.source === 'cache',
        result_id: data.manifest.id,
        files: [{ file_id: data.fileId, name: data.fileName, artifacts: withSecondary, markdown_path: data.markdownPath }],
        content_status: contentStatus,
        markdown_path: data.markdownPath,
        manifest_path: data.manifestPath,
        output_limit_chars: limit,
        markdown_content: content,
      }
      if (JSON.stringify(testView).length <= limit && formatResultProse(testView).length <= limit) {
        finalArtifacts = withSecondary
      } else {
        artifactsTruncated = true
      }
    }

    let view: ResultView = {
      state: 'completed',
      source: data.item.source,
      cache_hit: data.item.source === 'cache',
      result_id: data.manifest.id,
      files: [{
        file_id: data.fileId,
        name: data.fileName,
        artifacts: finalArtifacts,
        ...(artifactsTruncated ? { artifacts_truncated: true } : {}),
        markdown_path: data.markdownPath,
      }],
      content_status: contentStatus,
      markdown_path: data.markdownPath,
      ...(readOffsetLine !== undefined ? { read_offset_line: readOffsetLine } : {}),
      manifest_path: data.manifestPath,
      output_limit_chars: limit,
      markdown_content: content,
      ...(contentStatus === 'partial' ? { toc } : {}),
    }

    while (JSON.stringify(view).length > limit || formatResultProse(view).length > limit) {
      if (view.files[0]?.artifacts.length && view.files[0].artifacts.length > 0) {
        view = {
          ...view,
          files: [{ ...view.files[0]!, artifacts: [], artifacts_truncated: true }],
        }
      } else if (view.markdown_content && view.markdown_content.length > 0) {
        const excess = Math.max(JSON.stringify(view).length - limit, formatResultProse(view).length - limit, 10)
        const targetLen = Math.max(0, view.markdown_content.length - excess)
        const cut = truncateAtCleanBoundary(raw.text, targetLen)
        const activeToc = view.toc ?? extractMarkdownHeadings(fullText)
        view = {
          ...view,
          content_status: 'partial',
          markdown_content: cut.text,
          read_offset_line: cut.resumeLine,
          toc: activeToc,
        }
      } else if (view.toc && view.toc.length > 0) {
        const nextToc = view.toc.slice(0, Math.max(0, Math.floor(view.toc.length / 2)))
        view = {
          ...view,
          ...(nextToc.length > 0 ? { toc: nextToc } : { toc: undefined }),
        }
      } else {
        throw new MinerUError(failure('RESULT_TOO_LARGE', 'Result metadata exceeds configured model output limit'))
      }
    }

    return view
  }

  private async projectBatch(
    rawItems: readonly RawParsedItem[],
    limit: number,
  ): Promise<BatchParseDocumentView> {
    const completedItems = rawItems.filter((i): i is Extract<RawParsedItem, { state: 'completed' }> => i.state === 'completed')

    const fileTexts = new Map<string, { text: string; isCompleteFile: boolean }>()
    const fullTexts = new Map<string, string>()
    for (const item of completedItems) {
      if (item.markdownRequested && item.markdownPath) {
        const raw = await readMarkdownFile(item.markdownPath, item.markdownBytes ?? 0, limit)
        fileTexts.set(item.fileId, raw)
      }
    }

    const skeletonResults: Array<ResultView | FailedParseView> = rawItems.map(item => {
      if (item.state === 'failed') return item.failureView
      const markdownArtifact: ArtifactView | undefined = item.markdownPath ? {
        kind: 'markdown',
        path: item.markdownPath,
        bytes: item.markdownBytes ?? 0,
      } : undefined
      return {
        state: 'completed',
        source: item.item.source,
        cache_hit: item.item.source === 'cache',
        result_id: item.manifest.id,
        files: [{
          file_id: item.fileId,
          name: item.fileName,
          artifacts: markdownArtifact ? [markdownArtifact] : [],
          markdown_path: item.markdownPath,
        }],
        content_status: item.markdownRequested ? 'complete' : 'not_requested',
        markdown_path: item.markdownPath,
        manifest_path: item.manifestPath,
        output_limit_chars: limit,
        ...(item.markdownRequested ? { markdown_content: '' } : {}),
      }
    })

    const completedCount = completedItems.length
    const batchState: BatchParseDocumentView['state'] =
      completedCount === rawItems.length ? 'completed' : completedCount === 0 ? 'failed' : 'partially-completed'

    let batchSkeleton: BatchParseDocumentView = {
      kind: 'batch',
      state: batchState,
      output_limit_chars: limit,
      content_status: 'complete',
      results: skeletonResults,
    }

    let overhead = Math.max(JSON.stringify(batchSkeleton).length, formatParseDocumentProse(batchSkeleton).length)
    let baseArtifactsStripped = false
    if (overhead > limit) {
      const strippedResults = skeletonResults.map(r => {
        if (r.state === 'failed') return r
        return {
          ...r,
          files: r.files.map(f => ({ ...f, artifacts: [], artifacts_truncated: true })),
        }
      })
      batchSkeleton = { ...batchSkeleton, results: strippedResults }
      overhead = Math.max(JSON.stringify(batchSkeleton).length, formatParseDocumentProse(batchSkeleton).length)
      if (overhead > limit) {
        throw new MinerUError(failure('RESULT_TOO_LARGE', 'Result metadata exceeds configured model output limit'))
      }
      baseArtifactsStripped = true
    }

    const avail = Math.max(0, limit - overhead)
    const totalTextBudget = Math.floor(avail / 1.05)

    const mdItems = completedItems.filter(i => i.markdownRequested)
    const lengths = mdItems.map(i => fileTexts.get(i.fileId)?.text.length ?? 0)
    const shares = allocateReclaimedShares(lengths, totalTextBudget)

    const finalResults: Array<ResultView | FailedParseView> = await Promise.all(rawItems.map(async item => {
      if (item.state === 'failed') return item.failureView
      if (!item.markdownRequested) {
        return {
          state: 'completed',
          source: item.item.source,
          cache_hit: item.item.source === 'cache',
          result_id: item.manifest.id,
          files: [{
            file_id: item.fileId,
            name: item.fileName,
            artifacts: baseArtifactsStripped ? [] : [...item.secondaryArtifacts],
            ...(baseArtifactsStripped && item.secondaryArtifacts.length > 0 ? { artifacts_truncated: true } : {}),
            markdown_path: undefined,
          }],
          content_status: 'not_requested',
          manifest_path: item.manifestPath,
          output_limit_chars: limit,
        }
      }

      const mdIndex = mdItems.indexOf(item)
      const share = shares[mdIndex] ?? 0
      const raw = fileTexts.get(item.fileId) ?? { text: '', isCompleteFile: true }
      const markdownArtifact: ArtifactView = {
        kind: 'markdown',
        path: item.markdownPath!,
        bytes: item.markdownBytes ?? 0,
      }

      let contentStatus: ContentStatus
      let content: string
      let readOffsetLine: number | undefined
      let artifactsTruncated = baseArtifactsStripped
      let toc: DocumentHeading[] | undefined

      if (raw.text.length <= share && raw.isCompleteFile) {
        contentStatus = 'complete'
        content = raw.text
        readOffsetLine = undefined
        fullTexts.set(item.fileId, raw.text)
      } else {
        contentStatus = 'partial'
        const cut = truncateAtCleanBoundary(raw.text, share)
        content = cut.text
        readOffsetLine = cut.resumeLine
        if (item.secondaryArtifacts.length > 0 || baseArtifactsStripped) {
          artifactsTruncated = true
        }
        let full = raw.text
        if (!raw.isCompleteFile && item.markdownPath) {
          try {
            full = await readFile(item.markdownPath, 'utf8')
          } catch {
            // fallback
          }
        }
        fullTexts.set(item.fileId, full)
        toc = extractMarkdownHeadings(full)
      }

      const fileArtifacts = baseArtifactsStripped ? [] : [markdownArtifact]

      return {
        state: 'completed',
        source: item.item.source,
        cache_hit: item.item.source === 'cache',
        result_id: item.manifest.id,
        files: [{
          file_id: item.fileId,
          name: item.fileName,
          artifacts: fileArtifacts,
          ...(artifactsTruncated ? { artifacts_truncated: true } : {}),
          markdown_path: item.markdownPath,
        }],
        content_status: contentStatus,
        markdown_path: item.markdownPath,
        ...(readOffsetLine !== undefined ? { read_offset_line: readOffsetLine } : {}),
        manifest_path: item.manifestPath,
        output_limit_chars: limit,
        markdown_content: content,
        ...(contentStatus === 'partial' ? { toc } : {}),
      }
    }))

    let batchContentStatus: ContentStatus
    const completedResults = finalResults.filter((r): r is ResultView => r.state === 'completed')
    if (completedResults.length === 0 || completedResults.every(r => r.content_status === 'not_requested')) {
      batchContentStatus = 'not_requested'
    } else if (completedResults.some(r => r.content_status === 'partial')) {
      batchContentStatus = 'partial'
    } else {
      batchContentStatus = 'complete'
    }

    let batchView: BatchParseDocumentView = {
      kind: 'batch',
      state: batchState,
      output_limit_chars: limit,
      content_status: batchContentStatus,
      results: finalResults,
    }

    while (JSON.stringify(batchView).length > limit || formatParseDocumentProse(batchView).length > limit) {
      // Prioritize text: strip artifacts from completed results FIRST before cutting text
      let strippedAnyArtifacts = false
      const strippedResults = batchView.results.map(r => {
        if (r.state === 'completed' && r.files.some(f => f.artifacts.length > 0)) {
          strippedAnyArtifacts = true
          return {
            ...r,
            files: r.files.map(f => ({ ...f, artifacts: [], artifacts_truncated: true })),
          }
        }
        return r
      })
      if (strippedAnyArtifacts) {
        batchView = { ...batchView, results: strippedResults }
        continue
      }

      const candidates = batchView.results
        .filter((r): r is ResultView => r.state === 'completed' && Boolean(r.markdown_content && r.markdown_content.length > 0))
      if (candidates.length > 0) {
        candidates.sort((a, b) => (b.markdown_content?.length ?? 0) - (a.markdown_content?.length ?? 0))
        const target = candidates[0]!
        const excess = Math.max(JSON.stringify(batchView).length - limit, formatParseDocumentProse(batchView).length - limit, 10)
        const targetLen = Math.max(0, (target.markdown_content?.length ?? 0) - excess)
        const raw = fileTexts.get(target.files[0]?.file_id ?? '')?.text ?? target.markdown_content!
        const cut = truncateAtCleanBoundary(raw, targetLen)
        const fileId = target.files[0]?.file_id ?? ''
        const full = fullTexts.get(fileId) ?? raw
        const activeToc = target.toc ?? extractMarkdownHeadings(full)
        const updatedTarget: ResultView = {
          ...target,
          content_status: 'partial',
          markdown_content: cut.text,
          read_offset_line: cut.resumeLine,
          toc: activeToc,
        }
        batchView = {
          ...batchView,
          content_status: 'partial',
          results: batchView.results.map(r => r === target ? updatedTarget : r),
        }
      } else {
        const tocCandidates = batchView.results
          .filter((r): r is ResultView => r.state === 'completed' && Boolean(r.toc && r.toc.length > 0))
        if (tocCandidates.length > 0) {
          const target = tocCandidates[0]!
          const nextToc = target.toc!.slice(0, Math.max(0, Math.floor(target.toc!.length / 2)))
          const updatedTarget: ResultView = {
            ...target,
            ...(nextToc.length > 0 ? { toc: nextToc } : { toc: undefined }),
          }
          batchView = {
            ...batchView,
            results: batchView.results.map(r => r === target ? updatedTarget : r),
          }
        } else {
          throw new MinerUError(failure('RESULT_TOO_LARGE', 'Result metadata exceeds configured model output limit'))
        }
      }
    }

    return batchView
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

    const rawItems: RawParsedItem[] = []

    for (let index = 0; index < outcomes.length; index++) {
      const outcome = outcomes[index]!
      const item = pending[index]!
      const file = item.prepared.request.files[0]!
      if (outcome.state === 'failed' || outcome.resultId === undefined) {
        rawItems.push({
          state: 'failed',
          failureView: {
            state: 'failed',
            source: item.source,
            file_id: file.fileId,
            name: file.name,
            failure: outcome.failure ?? failure('REMOTE_PARSE_FAILED', 'Remote parse failed'),
          },
        })
        continue
      }
      const manifest = await this.options.results.get(
        item.cacheKey,
        item.prepared.request.requiredArtifacts,
        signal,
      )
      if (manifest === undefined || manifest.id !== outcome.resultId) {
        rawItems.push({
          state: 'failed',
          failureView: {
            state: 'failed',
            source: item.source,
            file_id: file.fileId,
            name: file.name,
            failure: failure('CACHE_EVICTED', 'Published MinerU result is missing or corrupt'),
          },
        })
        continue
      }
      const document = manifest.files[0]!
      const markdownRequested = item.markdownRequested
      const markdownRef = document.artifacts.find(artifact => artifact.kind === 'markdown')
      if (markdownRequested && markdownRef === undefined) {
        rawItems.push({
          state: 'failed',
          failureView: {
            state: 'failed',
            source: item.source,
            file_id: document.fileId,
            name: item.prepared.request.files[0]?.name ?? document.name,
            failure: failure('REMOTE_PARSE_FAILED', 'Extracted markdown artifact is missing from result'),
          },
        })
        continue
      }

      const markdownPath = markdownRef !== undefined
        ? this.options.results.resolveArtifactAbsolutePath(item.cacheKey, markdownRef.relativePath)
        : undefined
      const manifestPath = this.options.results.manifestAbsolutePath(item.cacheKey)
      const secondaryArtifacts = document.artifacts
        .filter(a => a.kind !== 'markdown')
        .map((a: ArtifactRef): ArtifactView => ({
          kind: a.kind,
          path: this.options.results.resolveArtifactAbsolutePath(item.cacheKey, a.relativePath),
          bytes: a.bytes,
        }))

      rawItems.push({
        state: 'completed',
        item,
        manifest,
        fileId: document.fileId,
        fileName: item.prepared.request.files[0]?.name ?? document.name,
        markdownRequested,
        markdownPath,
        markdownBytes: markdownRef?.bytes,
        manifestPath,
        secondaryArtifacts,
      })
    }

    const limit = this.config().output.maxInlineChars
    if (rawItems.length === 1) {
      const first = rawItems[0]!
      if (first.state === 'failed') throw new MinerUError(first.failureView.failure)
      return await this.projectSingle(first, limit)
    }

    return await this.projectBatch(rawItems, limit)
  }
}
