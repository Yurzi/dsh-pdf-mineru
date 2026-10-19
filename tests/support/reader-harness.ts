import { chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { onTestFinished } from 'vitest'
import { providerById, type MinerUConfig, type OutputConfig, type PollingConfig, type ProviderConfig } from '../../src/config/model.js'
import { defaultMinerUConfig } from '../../src/config/parse.js'
import { failure } from '../../src/domain/errors.js'
import type { CacheKey, MinerUResultId } from '../../src/domain/ids.js'
import type { ArtifactKind, CanonicalParseRequest, PreparedSourceFile } from '../../src/domain/request.js'
import type { ArtifactRef } from '../../src/domain/result.js'
import type { ContentQuery, FocusKind } from '../../src/domain/selection.js'
import type { MinerUDiagnosticEvent } from '../../src/observability.js'
import type {
  MinerUProvider, ProviderCallContext, ProviderCapabilities, ProviderCollection, ProviderFileSnapshot,
  ProviderJobRef, ProviderJobSnapshot, ProviderProbeResult, ProviderSubmission,
} from '../../src/providers/contract.js'
import type { ProviderRetryOptions } from '../../src/providers/http/retry.js'
import { createProvider } from '../../src/providers/registry.js'
import { ReaderService } from '../../src/reader/reader-service.js'
import type { ContentListBlock, ParseSummaryView, ResultView } from '../../src/reader/views.js'
import type { ImageSink, SavedImage } from '../../src/reader/visuals.js'
import { ParseService, type ParseProgressListener } from '../../src/service/parse-service.js'
import { SharedOperationRegistry, type SharedOperation } from '../../src/service/shared-operations.js'
import { StorageAccessGate } from '../../src/storage/access-gate.js'
import type { ArtifactSink } from '../../src/storage/artifact-port.js'
import { StoragePaths } from '../../src/storage/paths.js'
import { ProcessLock } from '../../src/storage/process-lock.js'
import { ResultRepository } from '../../src/storage/result-repository.js'
import { parseReadArguments } from '../../src/tools/read-pdf.js'
import { testPng } from '../fixtures/png.js'

export const PNG_1X1: Buffer = testPng(1, 1)

/** One extra artifact the fake Provider stages for every collected file. */
export interface FakeArtifact {
  readonly kind: ArtifactKind
  readonly content: string | Uint8Array
  readonly mediaType?: string
  readonly relativeName?: string
}

export interface FakeImage {
  readonly relativeName: string
  readonly data?: Uint8Array
  readonly mediaType?: string
}

/** A held submission: entered resolves once submit() runs; release() lets it continue. */
export interface SubmitGate {
  readonly entered: Promise<void>
  release(): void
}

function abortable(promise: Promise<void>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

const DEFAULT_ARTIFACTS: Readonly<Record<ArtifactKind, { readonly content: string | Uint8Array; readonly mediaType: string }>> = {
  markdown: { content: '', mediaType: 'text/markdown' },
  layout: { content: '{"pdf_info":[]}', mediaType: 'application/json' },
  'model-output': { content: '{}', mediaType: 'application/json' },
  'content-list': { content: '[]', mediaType: 'application/json' },
  images: { content: PNG_1X1, mediaType: 'image/png' },
}

/**
 * A scripted Provider implementing the real MinerUProvider contract. Identity, capabilities and the
 * cache compatibility key come from the real Provider built for the profile, so published results
 * are cache hits for the production plugin configured with the same profile.
 */
export class FakeProvider implements MinerUProvider {
  readonly id: MinerUProvider['id']
  readonly capabilities: ProviderCapabilities
  private readonly real: MinerUProvider

  markdown = '# parsed\n'
  omitMarkdown = false
  /** Blocks (or raw JSON text) for the content-list artifact; undefined stages an empty list. */
  contentList: readonly ContentListBlock[] | string | undefined
  images: FakeImage[] = []
  extras: FakeArtifact[] = []
  readonly failedNames = new Set<string>()
  /** Whether inspect() reports completion; completeAfterInspect flips it after N inspections. */
  complete = true
  completeAfterInspect: number | undefined

  submitCount = 0
  inspectCount = 0
  collectCount = 0
  retry: ProviderRetryOptions | undefined
  private gate: Promise<void> = Promise.resolve()
  private onSubmit: (() => void) | undefined

  constructor(profile: ProviderConfig) {
    this.real = createProvider(profile)
    this.id = this.real.id
    this.capabilities = this.real.capabilities
  }

  /** Hold later submissions until release(); the producer stays in flight meanwhile. */
  holdSubmit(): SubmitGate {
    let release!: () => void
    this.gate = new Promise(resolve => { release = resolve })
    const entered = new Promise<void>(resolve => { this.onSubmit = resolve })
    return { entered, release }
  }

  probe(_context: ProviderCallContext): Promise<ProviderProbeResult> {
    return Promise.resolve({ available: true, provider: this.id, authentication: 'not-configured', protocolVersion: 'fake' })
  }

  compatibilityKey(request: CanonicalParseRequest): string {
    return this.real.compatibilityKey(request)
  }

  async submit(request: CanonicalParseRequest, _sources: readonly PreparedSourceFile[], context: ProviderCallContext): Promise<ProviderSubmission> {
    this.submitCount++
    this.retry = context.retry
    this.onSubmit?.()
    await abortable(this.gate, context.signal)
    const files = request.files.map(file => ({ dataId: 'data_' + file.fileId, fileId: file.fileId, name: file.name }))
    const ref: ProviderJobRef = this.id === 'official-v4'
      ? { provider: 'official-v4', batchId: 'fake-batch-' + String(this.submitCount), files }
      : { provider: this.id, taskId: 'fake-task-' + String(this.submitCount), files }
    return { ref, state: 'processing', files: files.map(file => ({ fileId: file.fileId, state: 'processing' })) }
  }

  inspect(ref: ProviderJobRef, _context: ProviderCallContext): Promise<ProviderJobSnapshot> {
    this.inspectCount++
    if (this.completeAfterInspect !== undefined && this.inspectCount >= this.completeAfterInspect) this.complete = true
    const files: ProviderFileSnapshot[] = ref.files.map(file => this.failedNames.has(file.name)
      ? { fileId: file.fileId, state: 'failed', failure: this.failure(file.name) }
      : { fileId: file.fileId, state: this.complete ? 'completed' : 'processing' })
    const state = files.every(file => file.state === 'completed') ? 'completed'
      : files.every(file => file.state === 'failed') ? 'failed'
        : files.every(file => file.state !== 'processing') ? 'partially-completed' : 'processing'
    return Promise.resolve({ state, files })
  }

  async collect(ref: ProviderJobRef, request: CanonicalParseRequest, sink: ArtifactSink, _context: ProviderCallContext): Promise<ProviderCollection> {
    this.collectCount++
    const files: ProviderCollection['files'][number][] = []
    for (const file of ref.files) {
      if (this.failedNames.has(file.name)) {
        files.push({ fileId: file.fileId, name: file.name, artifacts: [], failure: this.failure(file.name) })
        continue
      }
      const artifacts: ArtifactRef[] = []
      const write = async (kind: ArtifactKind, content: string | Uint8Array, mediaType: string, relativeName?: string): Promise<void> => {
        artifacts.push(await sink.writeArtifact(file.fileId, kind, content, { mediaType, ...(relativeName === undefined ? {} : { relativeName }) }))
      }
      if (!this.omitMarkdown) await write('markdown', this.markdown, 'text/markdown')
      if (this.contentList !== undefined) {
        await write('content-list', typeof this.contentList === 'string' ? this.contentList : JSON.stringify(this.contentList), 'application/json')
      }
      for (const image of this.images) await write('images', image.data ?? PNG_1X1, image.mediaType ?? 'image/png', image.relativeName)
      for (const extra of this.extras) await write(extra.kind, extra.content, extra.mediaType ?? DEFAULT_ARTIFACTS[extra.kind].mediaType, extra.relativeName)
      for (const kind of request.requiredArtifacts) {
        if (kind === 'markdown' || artifacts.some(artifact => artifact.kind === kind)) continue
        await write(kind, DEFAULT_ARTIFACTS[kind].content, DEFAULT_ARTIFACTS[kind].mediaType)
      }
      files.push({ fileId: file.fileId, name: file.name, artifacts })
    }
    return { files }
  }

  private failure(name: string) {
    return failure('REMOTE_PARSE_FAILED', 'Fake parse failed for ' + name, false, { provider: this.id })
  }
}

/** A registry that records each created producer so tests can await waiter counts instead of sleeping. */
export class RecordingOperations extends SharedOperationRegistry {
  readonly reserved: SharedOperation[] = []

  override reserve(...args: Parameters<SharedOperationRegistry['reserve']>): ReturnType<SharedOperationRegistry['reserve']> {
    const reservation = super.reserve(...args)
    if (reservation.created) this.reserved.push(reservation.operation)
    return reservation
  }
}

/** Tool-shaped read selectors; parsed by the real read_pdf argument parser. */
export interface ReadArgs {
  readonly pages?: string | number
  readonly focus?: FocusKind | readonly FocusKind[]
  readonly cursor?: string | null
  readonly block_id?: string
  readonly query?: string
  readonly inline_images?: boolean
  readonly poll_timeout_ms?: number
}

/** The ContentQuery read_pdf builds for these arguments (selector validation stays in parseReadArguments). */
export function contentQuery(args: ReadArgs = {}): ContentQuery {
  const { query } = parseReadArguments({ file_path: 'fixture.pdf', ...args })
  if (query.kind === 'page') throw new TypeError('contentQuery builds content reads only')
  return query
}

export interface ConfigOverrides {
  readonly output?: Partial<OutputConfig>
  readonly polling?: Partial<PollingConfig>
  readonly cacheEnabled?: boolean
}

/** Configuration over one storage root with fast polling; other sections come from base. */
export function testConfig(storageRoot: string, overrides: ConfigOverrides = {}, base: MinerUConfig = defaultMinerUConfig()): MinerUConfig {
  return {
    ...base,
    storage: { ...base.storage, storageRoot, ...(overrides.cacheEnabled === undefined ? {} : { cacheEnabled: overrides.cacheEnabled }) },
    polling: { ...base.polling, pollIntervalMs: 1, pollTimeoutMs: 5000, operationTimeoutMs: 10_000, ...overrides.polling },
    output: { ...base.output, ...overrides.output },
  }
}

function activeProfile(config: MinerUConfig): ProviderConfig {
  const profile = providerById(config, config.activeProvider)
  if (profile === undefined) throw new TypeError('activeProvider does not identify a configured provider')
  return profile
}

/** Records every image the reader attaches. */
export function recordingImageSink(): { readonly sink: ImageSink; readonly saved: SavedImage[] } {
  const saved: SavedImage[] = []
  const sink: ImageSink = async image => {
    const ref: SavedImage = { attachmentId: 'sha256:' + String(saved.length).padStart(64, '0'), mediaType: image.mediaType, bytes: image.data.byteLength, name: image.name }
    saved.push(ref)
    return ref
  }
  return { sink, saved }
}

async function makeWritable(path: string): Promise<void> {
  await chmod(path, 0o755).catch(() => undefined)
  let entries
  try { entries = await readdir(path, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) await makeWritable(child)
    else await chmod(child, 0o644).catch(() => undefined)
  }
}

function storageGraph(config: MinerUConfig) {
  const paths = new StoragePaths(config.storage.storageRoot)
  const lock = new ProcessLock(paths)
  const accessGate = new StorageAccessGate({ paths, lock })
  const results = new ResultRepository(paths, { maxArtifactBytes: config.limits.maxZipEntryBytes }, lock)
  return { accessGate, results }
}

export interface ReadOptions {
  readonly images?: ImageSink
  readonly signal?: AbortSignal
  /** Absolute source path; defaults to the harness input.pdf. */
  readonly file?: string
}

/**
 * The production ParseService + ReaderService graph over a FakeProvider and a temporary storage root.
 * Create it inside a test; producer shutdown and temp removal run when the test finishes.
 */
export async function readerHarness(overrides: ConfigOverrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'mineru-reader-'))
  const file = join(root, 'input.pdf')
  await writeFile(file, '%PDF-1.4 reader fixture\n%EOF')
  const initial = testConfig(join(root, 'store'), overrides)
  const { accessGate, results } = storageGraph(initial)
  const operations = new RecordingOperations()
  const provider = new FakeProvider(activeProfile(initial))
  const diagnostics: MinerUDiagnosticEvent[] = []
  const parser = new ParseService({
    createProvider: () => provider, results, operations, accessGate,
    diagnostics: event => { diagnostics.push(event) },
    resolveCredential: async () => undefined,
  })
  const reader = new ReaderService({ parser, results, accessGate })
  onTestFinished(async () => {
    await operations.shutdown()
    await makeWritable(root)
    await rm(root, { recursive: true, force: true })
  })
  const harness = {
    root, file, provider, results, operations, accessGate, diagnostics, parser, reader,
    /** Configuration snapshot passed to every call; configure() replaces it between reads. */
    config: initial,
    configure(next: ConfigOverrides): void {
      harness.config = testConfig(initial.storage.storageRoot, {
        output: { ...harness.config.output, ...next.output },
        polling: { ...harness.config.polling, ...next.polling },
        cacheEnabled: next.cacheEnabled ?? harness.config.storage.cacheEnabled,
      })
    },
    /** Write another source document under the harness root and return its absolute path. */
    async addSource(name: string, body = '%PDF-1.4 ' + name): Promise<string> {
      const path = join(root, name)
      await writeFile(path, body)
      return path
    },
    read: (args: ReadArgs = {}, options: ReadOptions = {}): Promise<ResultView> =>
      reader.readContent(options.file ?? file, contentQuery(args), harness.config, options.images, options.signal ?? new AbortController().signal),
    summarize: (options: { readonly file?: string; readonly signal?: AbortSignal; readonly onProgress?: ParseProgressListener } = {}): Promise<ParseSummaryView> =>
      reader.summarize(options.file ?? file, harness.config, options.signal ?? new AbortController().signal, options.onProgress),
  }
  return harness
}

export type ReaderHarness = Awaited<ReturnType<typeof readerHarness>>

export interface PublishFixtureOptions {
  /** Absolute path of an existing source document (supported extension, e.g. .pdf). */
  readonly sourcePath: string
  /** The configuration the production plugin will run with; its active profile determines the cache key. */
  readonly config: MinerUConfig
  /** Storage root to publish into; defaults to config.storage.storageRoot. */
  readonly storageRoot?: string
  readonly markdown?: string
  readonly contentList?: readonly ContentListBlock[] | string
  readonly images?: readonly FakeImage[]
  readonly extras?: readonly FakeArtifact[]
}

export interface PublishedFixture {
  readonly resultId: MinerUResultId
  readonly cacheKey: CacheKey
  readonly manifestPath: string
  readonly sourceSha256: string
}

/**
 * Publish one fixture result through the real ParseService/ResultRepository so that a production
 * plugin configured with config (and the same storage root) serves it as a cache hit without a
 * Provider. Resolves after publication; leaves no live operations or locks behind.
 */
export async function publishFixtureResult(options: PublishFixtureOptions): Promise<PublishedFixture> {
  if (!isAbsolute(options.sourcePath)) throw new TypeError('sourcePath must be absolute')
  const storageRoot = options.storageRoot ?? options.config.storage.storageRoot
  const config = testConfig(storageRoot, { cacheEnabled: true }, options.config)
  const { accessGate, results } = storageGraph(config)
  const operations = new SharedOperationRegistry()
  const provider = new FakeProvider(activeProfile(config))
  if (options.markdown !== undefined) provider.markdown = options.markdown
  provider.contentList = options.contentList
  provider.images = [...options.images ?? []]
  provider.extras = [...options.extras ?? []]
  const parser = new ParseService({
    createProvider: () => provider, results, operations, accessGate,
    // Credential-requiring profiles need a value for the call context; it never reaches storage.
    resolveCredential: async () => 'fixture-credential',
  })
  try {
    const published = await parser.ensurePublished(options.sourcePath, config, new AbortController().signal, { waitTimeoutMs: null })
    return {
      resultId: published.manifest.id,
      cacheKey: published.cacheKey,
      manifestPath: results.manifestAbsolutePath(published.cacheKey),
      sourceSha256: published.sourceFile.sha256,
    }
  } finally {
    await operations.shutdown()
  }
}
