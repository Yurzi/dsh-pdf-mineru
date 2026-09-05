import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import type { MinerUConfig, ProviderConfig } from '../config.js'
import type { MinerUFailure, MinerUProviderId } from '../domain/errors.js'
import { MinerUError, failure, toMinerUFailure } from '../domain/errors.js'
import type { CacheKey, MinerUResultId } from '../domain/ids.js'
import type { FocusKind, PageSelection, ParseRequestInput, PreparedParseRequest } from '../domain/request.js'
import { normalizeFocusSelection, normalizePageSelection } from '../domain/request.js'
import type { ArtifactRef, MinerUResultManifest } from '../domain/result.js'
import type {
  ProviderCallContext,
  ProviderJobSnapshot,
  ProviderRetryEvent,
} from '../providers/provider.js'
import { validateProviderCapabilities } from '../providers/provider.js'
import { ProviderRegistry, type ResolvedProvider } from '../providers/registry.js'
import type { ResultRepository, ResultTransaction } from '../storage/result-repository.js'
import { emitDiagnostic, type MinerUDiagnosticEvent, type MinerUDiagnosticSink } from '../observability.js'
import { computeCacheKey } from './cache-key.js'
import { RequestNormalizer, assertSourcesUnchanged } from './request-normalizer.js'
import { SharedOperationRegistry, type SharedOperation, type SharedOutcome } from './shared-operations.js'
import type {
  ArtifactView,
  ContentListBlock,
  ContentStatus,
  DocumentHeading,
  DocumentSummary,
  FailedParseView,
  ImageCandidateView,
  ParseDocumentView,
  ResultFileView,
  ResultView,
  SubmissionSource,
} from './result-presenter.js'
import {
  computeDocumentSummary,
  extractBlocksMarkdown,
  extractMarkdownHeadings,
  fallbackExtractFromMarkdown,
  formatParseDocumentProse,
  formatParseSummaryProse,
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
  readonly inputPages?: PageSelection
  readonly inputFocus?: FocusKind | readonly FocusKind[]
  source: SubmissionSource
  resultId?: MinerUResultId
  operation?: SharedOperation
  created?: boolean
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
      readonly inputPages?: PageSelection
      readonly inputFocus?: FocusKind | readonly FocusKind[]
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
  ): Promise<{ readonly pending: PendingFileParse; readonly resolved: ResolvedProvider; readonly compatibility: string }> {
    const resolved = this.options.providers.active()
    const current = this.config()
    const normalizer = new RequestNormalizer({
      defaults: current.defaults,
      cwd: session.header.cwd,
      maxFileBytes: Math.min(current.limits.maxFileBytes, resolved.provider.capabilities.maxFileBytes ?? current.limits.maxFileBytes),
    })
    const backendInput: ParseRequestInput = {
      ...input,
      artifacts: input.artifacts,
      pages: undefined,
    }
    const prepared = await normalizer.normalize(backendInput, signal)
    const file = prepared.request.files[0]!
    if (file.bytes > current.limits.maxFileBytes) {
      throw new MinerUError(failure('FILE_TOO_LARGE', `${file.name} exceeds the configured file-size limit`))
    }
    validateProviderCapabilities(prepared.request, resolved.provider.capabilities)
    const compatibility = await resolved.provider.compatibilityKey(prepared.request, {
      configuredVersion: 'configuredVersion' in resolved.config ? resolved.config.configuredVersion : undefined,
    })
    const markdownRequested = input.artifacts === undefined || input.artifacts.includes('markdown')
    const cacheKey = computeCacheKey(prepared.request, file, compatibility)

    const hit = current.storage.cacheEnabled
      ? await this.options.results.get(cacheKey, prepared.request.requiredArtifacts, signal)
      : undefined

    if (hit !== undefined) {
      const pending: PendingFileParse = {
        prepared,
        cacheKey,
        markdownRequested,
        inputPages: input.pages,
        inputFocus: input.focus,
        source: 'cache',
        resultId: hit.id,
      }
      this.diagnostic({
        level: 'info', phase: 'cache-hit', provider: resolved.provider.id,
        bytes: file.bytes, cacheHit: true,
      })
      return { pending, resolved, compatibility }
    }

    const reservation = this.options.operations.reserve(
      cacheKey,
      resolved.config.id,
      current.polling.operationTimeoutMs,
    )
    const pending: PendingFileParse = {
      prepared,
      cacheKey,
      markdownRequested,
      inputPages: input.pages,
      inputFocus: input.focus,
      source: reservation.created ? 'provider' : 'shared-operation',
      operation: reservation.operation,
      created: reservation.created,
    }

    if (reservation.created) {
      try {
        const cached = current.storage.cacheEnabled
          ? await this.options.results.get(cacheKey, prepared.request.requiredArtifacts, signal)
          : undefined
        if (cached !== undefined) {
          pending.source = 'cache'
          pending.resultId = cached.id
          this.options.operations.start(reservation.operation, async () => ({ state: 'completed', resultId: cached.id }))
        } else {
          this.options.operations.start(
            reservation.operation,
            operation => this.runOperation(operation, prepared, resolved, compatibility),
          )
        }
      } catch (error) {
        this.options.operations.release(reservation.operation, error)
        throw error
      }
    }

    return { pending, resolved, compatibility }
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

    const contentListArtifact = data.secondaryArtifacts.find(a => a.kind === 'content-list')
    let contentList: ContentListBlock[] | undefined
    if (contentListArtifact) {
      try {
        const rawJson = await readFile(contentListArtifact.path, 'utf8')
        const parsed = JSON.parse(rawJson)
        if (Array.isArray(parsed)) contentList = parsed
        else if (Array.isArray((parsed as any)?.list)) contentList = (parsed as any).list
        else if (Array.isArray((parsed as any)?.content_list)) contentList = (parsed as any).content_list
      } catch {
        contentList = undefined
      }
    }

    const pagesSet = normalizePageSelection(data.inputPages)
    const focusSet = normalizeFocusSelection(data.inputFocus)
    const imageArtifacts = data.secondaryArtifacts.filter(a => a.kind === 'images')

    let fullSourceText = ''
    let orderedImages: ImageCandidateView[] = []
    let docSummary: DocumentSummary | undefined
    let toc: readonly DocumentHeading[] | undefined

    if (contentList && contentList.length > 0) {
      docSummary = computeDocumentSummary(contentList, raw.text)
      toc = docSummary.toc
      const extracted = extractBlocksMarkdown(contentList, pagesSet, focusSet, imageArtifacts)
      fullSourceText = extracted.text
      orderedImages = extracted.orderedImages
    } else {
      let rawText = raw.text
      if (!raw.isCompleteFile && data.markdownPath) {
        try {
          rawText = await readFile(data.markdownPath, 'utf8')
        } catch {
          // fallback to raw.text
        }
      }
      const fallback = fallbackExtractFromMarkdown(rawText, imageArtifacts)
      fullSourceText = fallback.text
      orderedImages = fallback.orderedImages
      docSummary = fallback.summary
      toc = fallback.summary.toc
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
      ordered_images: orderedImages,
      summary: docSummary,
      toc,
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

    if (fullSourceText.length <= textBudget) {
      contentStatus = 'complete'
      content = fullSourceText
      readOffsetLine = undefined
    } else {
      contentStatus = 'partial'
      const cut = truncateAtCleanBoundary(fullSourceText, textBudget)
      content = cut.text
      readOffsetLine = cut.resumeLine
      if (data.secondaryArtifacts.length > 0) {
        artifactsTruncated = true
      }
      if (!toc || toc.length === 0) {
        toc = extractMarkdownHeadings(fullSourceText)
      }
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
        ordered_images: orderedImages,
        summary: docSummary,
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
      ordered_images: orderedImages,
      summary: docSummary,
      ...(contentStatus === 'partial' || contentStatus === 'complete' ? { toc } : {}),
    }

    while (JSON.stringify(view).length > limit || formatResultProse(view).length > limit) {
      if (view.files[0]?.artifacts.length && view.files[0].artifacts.length > 0) {
        view = {
          ...view,
          files: [{ ...view.files[0]!, artifacts: [], artifacts_truncated: true }],
        }
      } else if (view.summary !== undefined || (view.ordered_images !== undefined && view.ordered_images.length > 0)) {
        view = {
          ...view,
          summary: undefined,
          ordered_images: undefined,
        }
      } else if (view.markdown_content && view.markdown_content.length > 0) {
        const excess = Math.max(JSON.stringify(view).length - limit, formatResultProse(view).length - limit, 10)
        const targetLen = Math.max(0, view.markdown_content.length - excess)
        const cut = truncateAtCleanBoundary(fullSourceText, targetLen)
        const activeToc = view.toc ?? (docSummary?.toc ?? extractMarkdownHeadings(fullSourceText))
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
  ): Promise<ResultView> {
    const { pending } = await this.prepare(session, input, signal)
    const wait = this.createWaitSignal(signal, pollTimeoutMs)
    let outcome: SharedOutcome
    try {
      if (pending.resultId !== undefined) {
        outcome = { state: 'completed', resultId: pending.resultId }
      } else if (pending.operation === undefined) {
        throw new TypeError('Pending parse has no result or shared operation')
      } else {
        outcome = await pending.operation.waitForOutcome(wait.signal)
      }
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

    const manifest = await this.options.results.get(
      pending.cacheKey,
      pending.prepared.request.requiredArtifacts,
      signal,
    )
    if (manifest === undefined || manifest.id !== outcome.resultId) {
      throw new MinerUError(failure('CACHE_EVICTED', 'Published MinerU result is missing or corrupt'))
    }

    const document = manifest.files[0]!
    const markdownRequested = pending.markdownRequested
    const markdownRef = document.artifacts.find(artifact => artifact.kind === 'markdown')
    if (markdownRequested && markdownRef === undefined) {
      throw new MinerUError(failure('REMOTE_PARSE_FAILED', 'Extracted markdown artifact is missing from result'))
    }

    const markdownPath = markdownRef !== undefined
      ? this.options.results.resolveArtifactAbsolutePath(pending.cacheKey, markdownRef.relativePath)
      : undefined
    const manifestPath = this.options.results.manifestAbsolutePath(pending.cacheKey)
    const secondaryArtifacts = document.artifacts
      .filter(a => a.kind !== 'markdown')
      .map((a: ArtifactRef): ArtifactView => ({
        kind: a.kind,
        path: this.options.results.resolveArtifactAbsolutePath(pending.cacheKey, a.relativePath),
        bytes: a.bytes,
      }))

    const rawItem: RawParsedItem = {
      state: 'completed',
      item: pending,
      manifest,
      fileId: document.fileId,
      fileName: pending.prepared.request.files[0]?.name ?? document.name,
      markdownRequested,
      markdownPath,
      markdownBytes: markdownRef?.bytes,
      manifestPath,
      secondaryArtifacts,
      inputPages: pending.inputPages,
      inputFocus: pending.inputFocus,
    }

    const limit = this.config().output.maxInlineChars
    return await this.projectSingle(rawItem, limit)
  }
}
