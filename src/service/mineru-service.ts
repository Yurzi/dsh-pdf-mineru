import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import type { MinerUConfig, ProviderConfig } from '../config.js'
import type { MinerUFailure, MinerUProviderId } from '../domain/errors.js'
import { MinerUError, failure, toMinerUFailure } from '../domain/errors.js'
import type { CacheKey, MinerUResultId } from '../domain/ids.js'
import type { ArtifactKind, FocusKind, PageSelection, ParseRequestInput, PreparedParseRequest } from '../domain/request.js'
import { narrowPageSelection, normalizeFocusSelection, normalizePageSelection } from '../domain/request.js'
import type { ArtifactRef, MinerUResultManifest } from '../domain/result.js'
import type {
  ProviderCallContext,
  ProviderJobSnapshot,
  ProviderRetryEvent,
} from '../providers/provider.js'
import { validateProviderCapabilities } from '../providers/provider.js'
import { ProviderRegistry, type ResolvedProvider } from '../providers/registry.js'
import type { ResultRepository, ResultTransaction } from '../storage/result-repository.js'
import type { StorageAccessGate } from '../storage/access-gate.js'
import { emitDiagnostic, type MinerUDiagnosticEvent, type MinerUDiagnosticSink } from '../observability.js'
import { computeCacheKey } from '../domain/cache-key.js'
import { RequestNormalizer, assertSourcesUnchanged } from './request-normalizer.js'
import { SharedOperationRegistry, type SharedOperation, type SharedOutcome } from './shared-operations.js'
import type {
  ArtifactView,
  ContentListBlock,
  DocumentHeading,
  DocumentSummary,
  FailedParseView,
  ImageCandidateView,
  ParseDocumentView,
  ProjectedBlockRange,
  ParseSummaryView,
  ResultFileView,
  ResultView,
  SubmissionSource,
} from './result-presenter.js'
import {
  computeDocumentSummary,
  getBlockCategory,
  extractBlocksMarkdown,
  extractMarkdownHeadings,
  fallbackExtractFromMarkdown,
  formatPageOutOfRangeMessage,
  formatResultProse,
  formatTocMarkdown,
  readMarkdownFile,
  safeStringSlice,
} from './result-presenter.js'
import { decodeReadCursor, type ReadCursorPayload } from './read-cursor.js'
import { normalizeDocumentBlocks } from './document-index.js'
import { boundedWarnings, deliverReadChunk, fitsReadBudget } from './read-delivery.js'
import { renderPdfPage } from './page-renderer.js'
import { asResultId, createFileId } from '../domain/ids.js'

export * from './result-presenter.js'

export interface ServiceSession {
  readonly header: { readonly id: string; readonly cwd?: string }
}

const MAX_POLL_TIMEOUT_MS = 24 * 60 * 60 * 1000
const MAX_CONTENT_LIST_BYTES = 64 * 1024 * 1024
const MAX_SYNOPSIS_CONTENT_LIST_BYTES = 2 * 1024 * 1024
const MAX_SYNOPSIS_HEADINGS = 20
const MAX_SYNOPSIS_TITLE_CHARS = 160

/** Read only a manifest-declared index, with actual file size and short-read checks. */
async function readJsonArtifact(artifact: ArtifactView, maxBytes: number, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted()
  if (artifact.bytes > maxBytes) throw new MinerUError(failure('RESULT_TOO_LARGE', 'content-list artifact exceeds the bounded reader limit'))
  const handle = await open(artifact.path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.size !== artifact.bytes) throw new Error('content-list artifact changed before reading')
    if (before.size > maxBytes) throw new MinerUError(failure('RESULT_TOO_LARGE', 'content-list artifact exceeds the bounded reader limit'))
    const buffer = Buffer.alloc(before.size)
    let offset = 0
    while (offset < buffer.length) {
      signal?.throwIfAborted()
      const result = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (result.bytesRead === 0) throw new Error('content-list artifact changed during reading')
      offset += result.bytesRead
    }
    signal?.throwIfAborted()
    const after = await handle.stat()
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('content-list artifact changed during reading')
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer))
  } finally {
    await handle.close()
  }
}

async function readContentList(artifact: ArtifactView, maxBytes: number, signal?: AbortSignal): Promise<ContentListBlock[]> {
  const parsed = await readJsonArtifact(artifact, maxBytes, signal)
  const container = typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  const candidate = Array.isArray(parsed) ? parsed : container?.list ?? container?.content_list
  if (!Array.isArray(candidate)) throw new TypeError('content-list must be an array or contain list/content_list')
  for (const block of candidate) {
    if (typeof block !== 'object' || block === null || Array.isArray(block)) throw new TypeError('content-list contains a malformed block')
    if (block.page_idx !== undefined && (!Number.isSafeInteger(block.page_idx) || block.page_idx < 0)) throw new TypeError('content-list contains an invalid page_idx')
    if (block.type !== undefined && typeof block.type !== 'string') throw new TypeError('content-list contains an invalid type')
  }
  return candidate as ContentListBlock[]
}

/** A complete contiguous MinerU pdf_info page list is stronger than the last text block's index. */
async function readLayoutPageCount(artifact: ArtifactView | undefined, signal?: AbortSignal): Promise<number | undefined> {
  if (!artifact || artifact.bytes > MAX_CONTENT_LIST_BYTES) return undefined
  const parsed = await readJsonArtifact(artifact, MAX_CONTENT_LIST_BYTES, signal)
  const pages = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>).pdf_info : undefined
  if (!Array.isArray(pages) || pages.length === 0 || pages.length > 99999) return undefined
  if (!pages.every((page, index) => typeof page === 'object' && page !== null && !Array.isArray(page) && page.page_idx === index)) return undefined
  return pages.length
}

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
  readonly accessGate?: StorageAccessGate
}

interface PendingFileParse {
  readonly prepared: PreparedParseRequest
  readonly cacheKey: CacheKey
  readonly markdownRequested: boolean
  readonly inputPages?: PageSelection
  readonly inputFocus?: FocusKind | readonly FocusKind[]
  readonly inputArtifacts?: readonly ArtifactKind[]
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
      readonly inputArtifacts?: readonly ArtifactKind[]
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
    cacheOnly = false,
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

    const hit = current.storage.cacheEnabled || cacheOnly
      ? await this.options.results.get(cacheKey, prepared.request.requiredArtifacts, signal)
      : undefined

    if (hit !== undefined) {
      const pending: PendingFileParse = {
        prepared,
        cacheKey,
        markdownRequested,
        inputPages: input.pages,
        inputFocus: input.focus,
        inputArtifacts: input.artifacts,
        source: 'cache',
        resultId: hit.id,
      }
      this.diagnostic({
        level: 'info', phase: 'cache-hit', provider: resolved.provider.id,
        bytes: file.bytes, cacheHit: true,
      })
      return { pending, resolved, compatibility }
    }

    if (cacheOnly) throw new MinerUError(failure('CACHE_EVICTED', 'Cursor result is missing or corrupt; restart without a cursor. Continuation never starts a new Provider parse.'))
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
      inputArtifacts: input.artifacts,
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
    const work = () => this.runOperationCore(operation, prepared, resolved, compatibility)
    return this.options.accessGate === undefined
      ? await work()
      : await this.options.accessGate.runProducer(work, operation.controller.signal)
  }

  private async runOperationCore(
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
    if (fitsReadBudget(view)) return view

    const strippedFiles: ResultFileView[] = view.files.map(f => ({
      ...f,
      artifacts: [],
      ...(f.artifacts.length > 0 ? { artifacts_truncated: true } : {}),
    }))
    view = { ...view, files: strippedFiles }
    if (!fitsReadBudget(view)) {
      throw new MinerUError(failure('RESULT_TOO_LARGE', 'Result metadata exceeds configured model output limit'))
    }
    return view
  }

  private async projectSingle(
    data: Extract<RawParsedItem, { state: 'completed' }>,
    limit: number,
    cursorPayload?: ReadCursorPayload,
    input: ParseRequestInput = {},
    signal?: AbortSignal,
  ): Promise<ResultView> {
    signal?.throwIfAborted()
    const blockId = cursorPayload?.block ?? input.block_id
    const query = cursorPayload?.query ?? input.query
    const focusSet = normalizeFocusSelection(data.inputFocus)
    const rawPagesSet = normalizePageSelection(data.inputPages)
    const artifactsRequested = focusSet.has('artifacts')
    const markdownArtifact: ArtifactView | undefined = data.markdownPath === undefined ? undefined : { kind: 'markdown', path: data.markdownPath, bytes: data.markdownBytes ?? 0 }
    const artifact = data.secondaryArtifacts.find(a => a.kind === 'content-list')
    let rawBlocks: ContentListBlock[] = []
    if (artifact) {
      try { rawBlocks = await readContentList(artifact, MAX_CONTENT_LIST_BYTES, signal) }
      catch (error) {
        signal?.throwIfAborted()
        if (error instanceof MinerUError) throw error
        throw new MinerUError(failure('INVALID_REQUEST', 'Malformed content-list artifact; cannot provide a reliable selection'), { cause: error })
      }
    }
    const warningOrders = rawPagesSet === undefined && blockId === undefined ? undefined : new Set(rawBlocks.flatMap((block, index) =>
      (rawPagesSet === undefined || typeof block.page_idx === 'number' && rawPagesSet.has(block.page_idx + 1)) && (blockId === undefined || blockId === data.manifest.id + ':b' + (index + 1)) ? [index + 1] : []))
    const normalized = normalizeDocumentBlocks(rawBlocks, data.manifest.id, warningOrders)
    const blocks = normalized.blocks
    const summary = blocks.length ? computeDocumentSummary(blocks) : undefined
    const { toc: outline, ...counts } = summary ?? {}
    const warnings = [...normalized.warnings]
    let physicalPageCount: number | undefined
    try { physicalPageCount = await readLayoutPageCount(data.secondaryArtifacts.find(artifact => artifact.kind === 'layout'), signal) }
    catch { signal?.throwIfAborted(); warnings.push('[PAGE_COUNT_UNAVAILABLE] Layout page metadata could not be read reliably; use original page view to verify physical bounds.') }
    if (physicalPageCount !== undefined && (summary?.page_count ?? 0) > physicalPageCount) {
      warnings.push('[PAGE_MAPPING_CONFLICT] Content blocks exceed layout page metadata; physical bounds are not reliable.')
      physicalPageCount = undefined
    }
    if (physicalPageCount !== undefined) counts.page_count = physicalPageCount
    if (counts.page_count !== undefined) counts.page_count_source = physicalPageCount === undefined ? 'content-list-lower-bound' : 'layout'
    if (rawPagesSet !== undefined && blocks.some(block => block.page_idx === undefined && (focusSet.has('all') || focusSet.has(getBlockCategory(block.type)) || focusSet.has('toc') && block.text_level !== undefined))) throw new MinerUError(failure('INVALID_REQUEST', '[SELECTION_UNAVAILABLE] Some selected content has no page coordinates; read without pages or use block_id/original page view'))
    if (rawPagesSet !== undefined && summary?.page_count === undefined) throw new MinerUError(failure('INVALID_REQUEST', '[SELECTION_UNAVAILABLE] No reliable physical page coordinates are available'))
    const narrowed = narrowPageSelection(rawPagesSet, physicalPageCount)
    if (narrowed.fullyOutOfRange) throw new MinerUError(failure('INVALID_REQUEST', formatPageOutOfRangeMessage(physicalPageCount)))
    if (narrowed.outOfRange.length) warnings.push('Some requested pages are outside the document range: ' + narrowed.outOfRange.slice(0, 20).join(', '))
    const pagesLabel = rawPagesSet === undefined ? undefined : narrowed.pagesLabel
    const pagesSet = narrowed.pagesSet
    if (rawPagesSet !== undefined && physicalPageCount === undefined) warnings.push('[PAGE_COUNT_LOWER_BOUND] Physical page count is unknown; parsed page_count is a lower bound. An empty selection is not proof that the requested page is blank or absent.')
    const artifactList = artifactsRequested ? [...(markdownArtifact ? [markdownArtifact] : []), ...data.secondaryArtifacts] : []
    const base: ResultView = {
      state: 'completed', source: data.item.source, cache_hit: data.item.source === 'cache', result_id: data.manifest.id,
      files: [{ file_id: data.fileId, name: data.fileName, artifacts: artifactList.slice(0, 20), ...(artifactList.length > 20 ? { artifacts_truncated: true } : {}) }],
      content_status: 'not_requested', cursor: null, output_limit_chars: limit,
      source_sha256: data.item.prepared.request.files[0]!.sha256,
      ...(artifactsRequested ? { manifest_path: data.manifestPath, ...(data.markdownPath ? { markdown_path: data.markdownPath } : {}) } : {}),
      ...(summary ? { summary: counts } : {}),
      ...(pagesLabel ? { pages: pagesLabel } : {}),
      ...(warnings.length ? { warnings: boundedWarnings(warnings) } : {}),
    }
    if (focusSet.size === 1 && artifactsRequested || !data.markdownRequested) return this.fitSingleCandidate(base, data.secondaryArtifacts, limit)
    let fullText = ''
    let images: readonly ImageCandidateView[] = []
    let ranges: readonly ProjectedBlockRange[] = []
    if (blocks.length) {
      const selected = blocks.filter(block => {
        const page = typeof block.page_idx === 'number' ? block.page_idx + 1 : undefined
        return (pagesSet === undefined || page !== undefined && pagesSet.has(page)) && (focusSet.has('all') || focusSet.has(getBlockCategory(block.type)))
      })
      if (blockId !== undefined && !blocks.some(block => block.block_id === blockId)) throw new MinerUError(failure('INVALID_REQUEST', '[BLOCK_NOT_FOUND] This block does not belong to the current parsed result; search again'))
      const matching = blockId === undefined ? selected : selected.filter(block => block.block_id === blockId)
      if (blockId !== undefined && matching.length === 0) throw new MinerUError(failure('INVALID_REQUEST', '[BLOCK_NOT_FOUND] Block is outside the requested pages/focus'))
      const imageArtifacts = data.secondaryArtifacts.filter(a => a.kind === 'images')
      if (query !== undefined) {
        const escaped = [...query].map(character => '\\.^$*+?()[]{}|'.includes(character) ? '\\' + character : character).join('')
        const literal = new RegExp(escaped, 'iu')
        const matches: string[] = []
        const matchRanges: ProjectedBlockRange[] = []
        let matchLength = 0
        for (const block of matching) {
          signal?.throwIfAborted()
          const projected = extractBlocksMarkdown([block], undefined, new Set(['all']), imageArtifacts).text
          const locationEnd = projected.indexOf(']') + 1
          const body = projected.slice(locationEnd).trim()
          const at = literal.exec(body)?.index
          if (at === undefined) continue
          let snippetStart = Math.max(0, at - 80)
          if (snippetStart > 0 && /[\uDC00-\uDFFF]/.test(body[snippetStart]!)) snippetStart--
          const snippet = safeStringSlice(body.slice(snippetStart), 360).replace(/\s+/g, ' ')
          const match = projected.slice(0, locationEnd) + '\n' + snippet
          const start = matchLength + (matches.length ? 2 : 0)
          matchLength = start + match.length
          matches.push(match)
          matchRanges.push({ block_id: block.block_id, start, locator_end: start + locationEnd, end: matchLength, ...(typeof block.page_idx === 'number' ? { page: block.page_idx + 1 } : {}) })
        }
        fullText = matches.length ? matches.join('\n\n') : 'No literal matches in the selected parsed blocks.'
        ranges = matchRanges
      } else {
        const projected = extractBlocksMarkdown(matching, undefined, new Set(['all']), imageArtifacts)
        fullText = projected.text
        images = projected.orderedImages
        ranges = projected.ranges
      }
      if (focusSet.has('toc')) {
        const headings = (outline ?? []).filter(heading => pagesSet === undefined || heading.page !== undefined && pagesSet.has(heading.page))
        const tocRanges: ProjectedBlockRange[] = []
        const tocText = formatTocMarkdown(headings, { pageRange: pagesLabel }, tocRanges)
        if (fullText) ranges = ranges.map(range => ({ ...range, start: range.start + tocText.length + 2, locator_end: range.locator_end + tocText.length + 2, end: range.end + tocText.length + 2 }))
        ranges = [...tocRanges, ...ranges]
        fullText = fullText ? tocText + '\n\n' + fullText : tocText
      }
    } else {
      if (blockId !== undefined || query !== undefined || rawPagesSet !== undefined || !focusSet.has('all') && !focusSet.has('toc')) throw new MinerUError(failure('INVALID_REQUEST', '[SELECTION_UNAVAILABLE] No content-list mapping; use unfiltered reading or original page view'))
      const raw = await readMarkdownFile(data.markdownPath!, data.markdownBytes ?? 0, signal)
      const fallback = fallbackExtractFromMarkdown(raw.text, data.secondaryArtifacts.filter(a => a.kind === 'images'))
      fullText = focusSet.has('toc') && !focusSet.has('all') ? formatTocMarkdown(extractMarkdownHeadings(raw.text)) : fallback.text
      images = focusSet.has('toc') && !focusSet.has('all') ? [] : fallback.orderedImages
      warnings.push('[LOCATION_UNAVAILABLE] Reading Markdown fallback; page/block coordinates are unavailable.')
    }
    return deliverReadChunk({ base: { ...base, ...(warnings.length ? { warnings: boundedWarnings(warnings) } : {}) }, text: fullText, focus: focusSet, images, ranges, cursor: cursorPayload, signal, identity: JSON.stringify(data.manifest.files),
      selection: { ...(blockId ? { block: blockId } : {}), ...(query ? { query } : {}) },
    })
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

  /** Ensure publication and return a bounded synopsis, never a body projection. */
  async ensureParsed(session: ServiceSession, input: ParseRequestInput, signal: AbortSignal): Promise<ParseSummaryView> {
    if (input.cursor !== undefined) throw new MinerUError(failure('INVALID_REQUEST', 'A parse summary cannot resume a read cursor; use read_pdf'))
    const { data } = await this.resolveParsedResult(session, input, signal, null)
    return this.projectSummary(data, signal)
  }

  /** Local original-page verification; never invokes a Provider or persists a source. */
  async previewPage(session: ServiceSession, input: { file_path: string; page: number; expectedSha256?: string }, signal: AbortSignal) {
    const page = await renderPdfPage({ ...input, cwd: session.header.cwd, maxFileBytes: this.config().limits.maxFileBytes, signal })
    return { ...page, result_id: asResultId('mr_page_' + page.sha256.slice(0, 32) + '_' + page.page), file_id: createFileId(page.sha256), output_limit_chars: this.config().output.maxInlineChars }
  }

  /** Read selected content from a published result. */
  async parseDocument(session: ServiceSession, input: ParseRequestInput, signal: AbortSignal, pollTimeoutMs?: number | null): Promise<ResultView> {
    const { data, cursor, limit } = await this.resolveParsedResult(session, input, signal, pollTimeoutMs)
    return this.projectSingle(data, limit, cursor, input, signal)
  }

  private async projectSummary(data: Extract<RawParsedItem, { state: 'completed' }>, signal: AbortSignal): Promise<ParseSummaryView> {
    signal.throwIfAborted()
    const artifact = data.secondaryArtifacts.find(item => item.kind === 'content-list')
    let summary: DocumentSummary | undefined
    const warnings: string[] = []
    if (artifact !== undefined) {
      try {
        const blocks = await readContentList(artifact, MAX_SYNOPSIS_CONTENT_LIST_BYTES, signal)
        if (blocks.length > 0) {
          const full = computeDocumentSummary(blocks)
          const headings = full.toc ?? []
          const toc = headings.slice(0, MAX_SYNOPSIS_HEADINGS).map(heading => ({
            ...heading, title: safeStringSlice(heading.title, MAX_SYNOPSIS_TITLE_CHARS),
          }))
          summary = { ...full, toc }
          if (headings.length > toc.length || headings.some(heading => heading.title.length > MAX_SYNOPSIS_TITLE_CHARS)) {
            warnings.push('Outline shortened for the parse summary; use read_pdf to inspect the complete outline.')
          }
        }
      } catch {
        signal.throwIfAborted()
        warnings.push('Optional summary metadata is unavailable or exceeds the synopsis budget; the parsed result remains cached. Use read_pdf to inspect it.')
      }
    }
    signal.throwIfAborted()
    return {
      state: 'completed', source: data.item.source, cache_hit: data.item.source === 'cache', result_id: data.manifest.id,
      files: [{ file_id: data.fileId, name: data.fileName, artifacts: [] }], content_status: 'not_requested',
      manifest_path: data.manifestPath,
      ...(summary !== undefined ? { summary } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    }
  }

  /** Shared parse/publication path. Repository integrity checks remain mandatory. */
  private async resolveParsedResult(
    session: ServiceSession,
    input: ParseRequestInput,
    signal: AbortSignal,
    pollTimeoutMs?: number | null,
  ): Promise<{ data: Extract<RawParsedItem, { state: 'completed' }>; cursor?: ReadCursorPayload; limit: number }> {
    if (input.query !== undefined && (typeof input.query !== 'string' || input.query.trim() === '' || input.query.length > 256)) throw new MinerUError(failure('INVALID_REQUEST', 'query must contain 1–256 characters'))
    if (input.block_id !== undefined && (typeof input.block_id !== 'string' || input.block_id.length > 160 || !/^mr_[a-zA-Z0-9_-]+:b[1-9][0-9]*$/.test(input.block_id))) throw new MinerUError(failure('INVALID_REQUEST', 'block_id must be an exact ID returned by read_pdf'))
    if (input.query !== undefined && input.block_id !== undefined) throw new MinerUError(failure('INVALID_REQUEST', 'query and block_id cannot be combined'))
    if (input.query !== undefined || input.block_id !== undefined) {
      let focus: ReadonlySet<FocusKind>
      try { focus = normalizeFocusSelection(input.focus) } catch (error) { throw new MinerUError(failure('INVALID_REQUEST', 'Invalid focus'), { cause: error }) }
      if (focus.has('toc') || focus.has('artifacts')) throw new MinerUError(failure('INVALID_REQUEST', 'query/block_id cannot use toc or artifacts focus'))
    }
    let cursorPayload: ReadCursorPayload | undefined
    if (input.cursor !== undefined) {
      try {
        cursorPayload = decodeReadCursor(input.cursor)
      } catch (error) {
        throw new MinerUError(failure('INVALID_REQUEST', error instanceof Error ? error.message : 'Cursor is malformed; start over without a cursor'), { cause: error })
      }
      if (input.pages !== undefined || input.focus !== undefined || input.block_id !== undefined || input.query !== undefined) {
        throw new MinerUError(failure('INVALID_REQUEST', 'pages and focus must be omitted when cursor is provided, as must block_id and query'))
      }
    }
    const effectiveInput: ParseRequestInput = cursorPayload === undefined
      ? input
      : { ...input, pages: cursorPayload.pages === '' ? undefined : cursorPayload.pages, focus: cursorPayload.focus }
    const { pending } = await this.prepare(session, effectiveInput, signal, cursorPayload !== undefined)
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

    if (cursorPayload !== undefined && cursorPayload.rid !== String(manifest.id)) {
      throw new MinerUError(failure('INVALID_REQUEST', 'Cursor result identity does not match the published result; start over without a cursor'))
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
      inputArtifacts: pending.inputArtifacts,
    }

    const limit = this.config().output.maxInlineChars
    return { data: rawItem, cursor: cursorPayload, limit }
  }
}
