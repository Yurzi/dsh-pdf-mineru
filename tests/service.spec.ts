import { chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultMinerUConfig, type MinerUConfig, type ProviderConfig } from '../src/config.js'
import { failure } from '../src/domain/errors.js'
import { asCacheKey, asProviderConfigId } from '../src/domain/ids.js'
import type { CanonicalParseRequest, PreparedSourceFile } from '../src/domain/request.js'
import type {
  ArtifactSink,
  MinerUProvider,
  ProviderCallContext,
  ProviderCapabilities,
  ProviderCollection,
  ProviderCompatibilityContext,
  ProviderJobRef,
  ProviderJobSnapshot,
  ProviderProbeResult,
  ProviderRetryOptions,
  ProviderSubmission,
} from '../src/providers/provider.js'
import { ProviderRegistry } from '../src/providers/registry.js'
import {
  MinerUService,
  type BatchParseDocumentView,
  type ParseDocumentView,
  type ResultView,
  type ServiceSession,
  truncateAtCleanBoundary,
  safeStringSlice,
  allocateReclaimedShares,
  extractMarkdownHeadings,
  type DocumentHeading,
} from '../src/service/mineru-service.js'
import { renderResult, renderParseDocument } from '../src/tools.js'
import { SharedOperationRegistry } from '../src/service/shared-operations.js'
import { ResultRepository } from '../src/storage/result-repository.js'
import { StoragePaths } from '../src/storage/paths.js'
import type { MinerUDiagnosticEvent } from '../src/observability.js'

function waitSignal(promise: Promise<void>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  throw new Error(message)
}

class MockProvider implements MinerUProvider {
  readonly id = 'self-hosted-v2' as const
  readonly capabilities: ProviderCapabilities = {
    models: ['pipeline', 'vlm'],
    parseMethods: ['auto', 'txt', 'ocr'],
    supportsOcr: true,
    supportsLanguage: true,
    supportsFormula: true,
    supportsTable: true,
    supportsPageRanges: true,
    supportedArtifacts: ['markdown', 'layout', 'model-output', 'content-list', 'images'],
    maxFilesPerSubmission: 10,
    maxFileBytes: 200 * 1024 * 1024,
  }
  submitCount = 0
  inspectCount = 0
  collectCount = 0
  complete = false
  completeAfterInspect: number | undefined
  readonly failedNames = new Set<string>()
  readonly submittedRequests: CanonicalParseRequest[] = []
  markdown = '# parsed\n'
  readonly markdownByFileName = new Map<string, string>()
  readonly extraArtifactsByFileName = new Map<string, Array<{ kind: 'layout' | 'images' | 'model-output' | 'content-list'; content: string }>>()
  omitMarkdown = false
  submitGate: Promise<void> = Promise.resolve()
  retryOptions?: ProviderRetryOptions

  probe(_context: ProviderCallContext): Promise<ProviderProbeResult> {
    return Promise.resolve({ available: true, provider: this.id, authentication: 'not-configured', protocolVersion: 'v2' })
  }

  compatibilityKey(_request: CanonicalParseRequest, _context: ProviderCompatibilityContext): Promise<string> {
    return Promise.resolve('self-hosted-v2:test:v1:pipeline')
  }

  async submit(
    request: CanonicalParseRequest, _sources: readonly PreparedSourceFile[], context: ProviderCallContext,
  ): Promise<ProviderSubmission> {
    this.submitCount++
    this.retryOptions = context.retry
    this.submittedRequests.push(request)
    const ref: ProviderJobRef = {
      provider: this.id,
      taskId: `upstream-task-${String(this.submitCount)}`,
      files: request.files.map(file => ({ dataId: `data_${file.fileId}`, fileId: file.fileId, name: file.name })),
    }
    await context.onAccepted?.(ref)
    await waitSignal(this.submitGate, context.signal)
    return {
      ref,
      state: 'processing',
      files: request.files.map(file => ({ fileId: file.fileId, state: 'processing' })),
    }
  }

  inspect(ref: ProviderJobRef, _context: ProviderCallContext): Promise<ProviderJobSnapshot> {
    this.inspectCount++
    if (this.completeAfterInspect !== undefined && this.inspectCount >= this.completeAfterInspect) this.complete = true
    const files = ref.files.map(file => {
      if (this.failedNames.has(file.name)) {
        return {
          fileId: file.fileId,
          state: 'failed' as const,
          failure: failure('REMOTE_PARSE_FAILED', `Mock parse failed for ${file.name}`, false, { provider: this.id, fileId: file.fileId }),
        }
      }
      return { fileId: file.fileId, state: this.complete ? 'completed' as const : 'processing' as const }
    })
    const state = files.every(file => file.state === 'completed')
      ? 'completed'
      : files.every(file => file.state === 'failed')
        ? 'failed'
        : files.every(file => file.state === 'completed' || file.state === 'failed')
          ? 'partially-completed'
          : 'processing'
    return Promise.resolve({ state, files })
  }

  async collect(
    ref: ProviderJobRef, _request: CanonicalParseRequest, sink: ArtifactSink, _context: ProviderCallContext,
  ): Promise<ProviderCollection> {
    this.collectCount++
    const files: Array<ProviderCollection['files'][number]> = []
    for (const file of ref.files) {
      if (this.failedNames.has(file.name)) {
        files.push({
          fileId: file.fileId,
          name: file.name,
          artifacts: [],
          failure: failure('REMOTE_PARSE_FAILED', `Mock parse failed for ${file.name}`, false, { provider: this.id, fileId: file.fileId }),
        })
        continue
      }
      const artifacts: any[] = []
      if (!this.omitMarkdown) {
        const mdText = this.markdownByFileName.get(file.name) ?? this.markdown
        const markdown = await sink.writeArtifact(file.fileId, 'markdown', mdText, { mediaType: 'text/markdown' })
        artifacts.push(markdown)
      }
      const extras = this.extraArtifactsByFileName.get(file.name)
      if (extras) {
        for (const extra of extras) {
          const art = await sink.writeArtifact(file.fileId, extra.kind, extra.content, { mediaType: 'application/json' })
          artifacts.push(art)
        }
      }
      files.push({ fileId: file.fileId, name: file.name, artifacts })
    }
    return { files }
  }
}

class MockProviderRegistry extends ProviderRegistry {
  constructor(getConfig: () => MinerUConfig, private readonly mock: MockProvider) { super(getConfig) }
  override create(_config: ProviderConfig): MinerUProvider { return this.mock }
}

interface Harness {
  readonly root: string
  readonly file: string
  readonly fileTwo: string
  readonly fileThree: string
  readonly provider: MockProvider
  readonly config: MinerUConfig
  readonly results: ResultRepository
  readonly operations: SharedOperationRegistry
  readonly diagnostics: MinerUDiagnosticEvent[]
  readonly service: MinerUService
}

const harnesses: Harness[] = []

function session(id: string): ServiceSession {
  return { header: { id } }
}

function asResult(value: ParseDocumentView): ResultView {
  if ('kind' in value) throw new TypeError('Expected a single result view')
  return value
}

function asBatch(value: ParseDocumentView): BatchParseDocumentView {
  if (!('kind' in value)) throw new TypeError('Expected a batch result view')
  return value
}

async function harness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'mineru-service-'))
  const file = join(root, 'input.pdf')
  const fileTwo = join(root, 'input-two.pdf')
  const fileThree = join(root, 'input-three.pdf')
  await Promise.all([
    writeFile(file, '%PDF-1.4 service fixture'),
    writeFile(fileTwo, '%PDF-1.4 service fixture two'),
    writeFile(fileThree, '%PDF-1.4 service fixture three'),
  ])
  const base = defaultMinerUConfig()
  const config: MinerUConfig = {
    ...base,
    storage: { ...base.storage, storageRoot: join(root, 'store') },
    polling: { ...base.polling, pollIntervalMs: 2, pollTimeoutMs: 100, operationTimeoutMs: 5000 },
    output: { maxInlineChars: 2048 },
    limits: { ...base.limits, maxFilesPerRequest: 10 },
  }
  const paths = new StoragePaths(config.storage.storageRoot)
  const results = new ResultRepository(paths, { maxArtifactBytes: config.limits.maxZipEntryBytes })
  const operations = new SharedOperationRegistry()
  const provider = new MockProvider()
  const providers = new MockProviderRegistry(() => config, provider)
  const diagnostics: MinerUDiagnosticEvent[] = []
  const service = new MinerUService({
    getConfig: () => config,
    providers,
    results,
    operations,
    diagnostics: event => diagnostics.push(event),
    resolveCredential: () => Promise.resolve(undefined),
  })
  const result = { root, file, fileTwo, fileThree, provider, config, results, operations, diagnostics, service }
  harnesses.push(result)
  return result
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

afterEach(async () => {
  const completed = harnesses.splice(0)
  await Promise.all(completed.map(async item => {
    await item.operations.shutdown()
    await makeWritable(item.root)
    await rm(item.root, { recursive: true, force: true })
  }))
})

describe('MinerUService direct parsing', () => {
  it('maps a provider probe without creating parse state', async () => {
    const h = await harness()

    await expect(h.service.probe(new AbortController().signal)).resolves.toEqual({
      available: true,
      provider: 'self-hosted-v2',
      authentication: 'not-configured',
      protocol_version: 'v2',
    })
  })

  it('publishes once, then returns a cache result without another provider call or job id', async () => {
    const h = await harness()
    h.provider.complete = true

    const first = asResult(await h.service.parseDocument(
      session('session-cache'), { file_paths: [h.file] }, new AbortController().signal, null,
    ))
    expect(first).toMatchObject({ state: 'completed', source: 'provider', cache_hit: false })
    expect('job_id' in first).toBe(false)
    expect(h.provider.submitCount).toBe(1)

    const second = asResult(await h.service.parseDocument(
      session('session-cache'), { file_paths: [h.file] }, new AbortController().signal, null,
    ))
    expect(second).toMatchObject({
      state: 'completed',
      source: 'cache',
      cache_hit: true,
      result_id: first.result_id,
    })
    expect('job_id' in second).toBe(false)
    expect(h.provider.submitCount).toBe(1)
    expect(h.provider.retryOptions).toMatchObject({ maxRetries: 2, initialDelayMs: 500, maxDelayMs: 10000 })

    h.provider.retryOptions?.onRetry?.({
      provider: 'self-hosted-v2', operation: 'inspect', attempt: 1, maxRetries: 2,
      delayMs: 500, reason: 'transport',
    })
    expect(h.diagnostics.some(event => event.phase === 'provider-retry'
      && event.providerOperation === 'inspect' && event.maxAttempts === 3)).toBe(true)
    expect(h.diagnostics.some(event => event.phase === 'cache-hit' && event.jobId === undefined)).toBe(true)
    expect(JSON.stringify(h.diagnostics)).not.toContain(h.file)
    expect(JSON.stringify(h.diagnostics)).not.toContain(h.root)
  })

  it('does not coalesce live operations across provider credential authorities', async () => {
    const registry = new SharedOperationRegistry()
    const cacheKey = asCacheKey('a'.repeat(64))
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const runner = async () => { await gate; return { state: 'failed' as const } }
    const first = registry.acquire(cacheKey, asProviderConfigId('mp_account_a'), 5000, runner)
    const second = registry.acquire(cacheKey, asProviderConfigId('mp_account_b'), 5000, runner)
    const duplicate = registry.acquire(cacheKey, asProviderConfigId('mp_account_a'), 5000, runner)

    expect(first.created).toBe(true)
    expect(second.created).toBe(true)
    expect(duplicate.created).toBe(false)
    expect(duplicate.operation).toBe(first.operation)
    expect(second.operation).not.toBe(first.operation)

    release()
    await Promise.all([
      first.operation.waitForOutcome(new AbortController().signal),
      second.operation.waitForOutcome(new AbortController().signal),
    ])
    await registry.shutdown()
  })

  it('releases an unstarted reservation so the same key can be retried', async () => {
    const registry = new SharedOperationRegistry()
    const cacheKey = asCacheKey('b'.repeat(64))
    const authority = asProviderConfigId('mp_release_test')
    const first = registry.reserve(cacheKey, authority, 5000)
    const waiting = first.operation.waitForOutcome(new AbortController().signal)

    expect(registry.release(first.operation, new Error('setup failed'))).toBe(true)
    await expect(waiting).rejects.toThrow('setup failed')
    expect(registry.activeOperationCount()).toBe(0)
    expect(registry.reserve(cacheKey, authority, 5000).created).toBe(true)
    await registry.shutdown()
  })

  it('cleans a created reservation when the second cache check fails', async () => {
    const h = await harness()
    const original = h.results.get.bind(h.results)
    let reads = 0
    const get = vi.spyOn(h.results, 'get').mockImplementation(async (cacheKey, artifacts, signal) => {
      reads++
      if (reads === 2) throw new Error('second cache read failed')
      return await original(cacheKey, artifacts, signal)
    })

    try {
      await expect(h.service.parseDocument(
        session('session-reserve-failure'), { file_paths: [h.file] }, new AbortController().signal, null,
      )).rejects.toThrow('second cache read failed')
      expect(h.operations.activeOperationCount()).toBe(0)
    } finally {
      get.mockRestore()
    }

    h.provider.complete = true
    const retried = asResult(await h.service.parseDocument(
      session('session-reserve-retry'), { file_paths: [h.file] }, new AbortController().signal, null,
    ))
    expect(retried.state).toBe('completed')
    expect(h.provider.submitCount).toBe(1)
  })

  it('releases earlier reservations when a later initial cache read fails', async () => {
    const h = await harness()
    const original = h.results.get.bind(h.results)
    let reads = 0
    const get = vi.spyOn(h.results, 'get').mockImplementation(async (cacheKey, artifacts, signal) => {
      reads++
      if (reads === 2) throw new Error('later initial cache read failed')
      return await original(cacheKey, artifacts, signal)
    })

    await expect(h.service.parseDocument(
      session('session-initial-failure'),
      { file_paths: [h.file, h.fileTwo] },
      new AbortController().signal,
      null,
    )).rejects.toThrow('later initial cache read failed')
    expect(h.operations.activeOperationCount()).toBe(0)
    get.mockRestore()

    h.provider.complete = true
    await expect(h.service.parseDocument(
      session('session-initial-retry'), { file_paths: [h.file] }, new AbortController().signal, null,
    )).resolves.toMatchObject({ state: 'completed' })
  })

  it('coalesces concurrent parses to one upstream producer', async () => {
    const h = await harness()
    let release!: () => void
    h.provider.submitGate = new Promise(resolve => { release = resolve })

    const firstPromise = h.service.parseDocument(
      session('session-one'), { file_paths: [h.file] }, new AbortController().signal, null,
    )
    await waitFor(() => h.provider.submitCount === 1, 'first producer did not start')
    const secondPromise = h.service.parseDocument(
      session('session-two'), { file_paths: [h.file] }, new AbortController().signal, null,
    )
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(h.provider.submitCount).toBe(1)

    h.provider.complete = true
    release()
    const [first, second] = [
      asResult(await firstPromise),
      asResult(await secondPromise),
    ]
    expect(new Set([first.source, second.source])).toEqual(new Set(['provider', 'shared-operation']))
    expect(h.provider.submitCount).toBe(1)
    expect('job_id' in first).toBe(false)
    expect('job_id' in second).toBe(false)
  })

  it('does not cancel a shared producer when one direct caller aborts', async () => {
    const h = await harness()
    let release!: () => void
    h.provider.submitGate = new Promise(resolve => { release = resolve })

    const kept = h.service.parseDocument(
      session('session-keep'), { file_paths: [h.file] }, new AbortController().signal, null,
    )
    await waitFor(() => h.provider.submitCount === 1, 'shared producer did not start')
    const controller = new AbortController()
    const cancelled = h.service.parseDocument(
      session('session-cancelled'), { file_paths: [h.file] }, controller.signal, null,
    )
    await new Promise(resolve => setTimeout(resolve, 5))
    controller.abort(new DOMException('Caller stopped waiting', 'AbortError'))

    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    h.provider.complete = true
    release()
    expect(asResult(await kept).state).toBe('completed')
    expect(h.provider.submitCount).toBe(1)
  })

  it('throws POLL_TIMEOUT and lets a later direct call rejoin the producer', async () => {
    const h = await harness()
    let release!: () => void
    h.provider.submitGate = new Promise(resolve => { release = resolve })

    await expect(h.service.parseDocument(
      session('session-timeout'), { file_paths: [h.file] }, new AbortController().signal, 10,
    )).rejects.toMatchObject({ failure: { code: 'POLL_TIMEOUT' } })
    expect(h.provider.submitCount).toBe(1)

    const rejoined = h.service.parseDocument(
      session('session-rejoin'), { file_paths: [h.file] }, new AbortController().signal, null,
    )
    await new Promise(resolve => setTimeout(resolve, 5))
    h.provider.complete = true
    release()

    expect(asResult(await rejoined)).toMatchObject({ state: 'completed', source: 'shared-operation' })
    expect(h.provider.submitCount).toBe(1)
  })

  it('returns a batch of independent direct results for cache misses', async () => {
    const h = await harness()
    h.provider.completeAfterInspect = 1

    const parsed = asBatch(await h.service.parseDocument(
      session('session-batch-misses'), { file_paths: [h.file, h.fileTwo] }, new AbortController().signal, null,
    ))
    expect(parsed).toMatchObject({ kind: 'batch', state: 'completed' })
    expect(parsed.results).toHaveLength(2)
    expect(parsed.results.every(result => result.state === 'completed')).toBe(true)
    expect(h.provider.submitCount).toBe(1)
    expect(h.provider.submittedRequests[0]?.files.map(file => file.name)).toEqual(['input.pdf', 'input-two.pdf'])
    expect(h.provider.inspectCount).toBe(1)
    expect(h.provider.collectCount).toBe(1)
    expect('job_id' in parsed).toBe(false)
    for (const result of parsed.results) {
      expect('job_id' in result).toBe(false)
      if (result.state === 'completed') {
        expect(result.files).toHaveLength(1)
        expect(result.manifest_path).toEqual(expect.any(String))
      }
    }
  })

  it('does not upload cached sources when another batch source misses', async () => {
    const h = await harness()
    h.provider.complete = true
    await h.service.parseDocument(
      session('session-mixed-cache'), { file_paths: [h.file] }, new AbortController().signal, null,
    )
    const submissionsBefore = h.provider.submitCount

    const parsed = asBatch(await h.service.parseDocument(
      session('session-mixed-cache'), { file_paths: [h.file, h.fileTwo] }, new AbortController().signal, null,
    ))
    expect(h.provider.submitCount).toBe(submissionsBefore + 1)
    expect(h.provider.submittedRequests.at(-1)?.files.map(file => file.name)).toEqual(['input-two.pdf'])
    const cached = parsed.results.find(result => result.state === 'completed' && result.files[0]?.name === 'input.pdf')
    const uploaded = parsed.results.find(result => result.state === 'completed' && result.files[0]?.name === 'input-two.pdf')
    expect(cached).toMatchObject({ state: 'completed', source: 'cache', cache_hit: true })
    expect(uploaded).toMatchObject({ state: 'completed', source: 'provider', cache_hit: false })
  })

  it('keeps batch partial successes and failures isolated per source', async () => {
    const h = await harness()
    h.provider.complete = true
    h.provider.failedNames.add('input-two.pdf')

    const parsed = asBatch(await h.service.parseDocument(
      session('session-batch-partial'), { file_paths: [h.file, h.fileTwo] }, new AbortController().signal, null,
    ))
    expect(parsed).toMatchObject({ kind: 'batch', state: 'partially-completed' })
    const success = parsed.results.find(result => result.state === 'completed' && result.files[0]?.name === 'input.pdf')
    const failed = parsed.results.find(result => result.state === 'failed' && result.name === 'input-two.pdf')
    expect(success).toMatchObject({ state: 'completed', result_id: expect.any(String), manifest_path: expect.any(String) })
    expect(failed).toMatchObject({ state: 'failed', failure: { code: 'REMOTE_PARSE_FAILED' } })
    expect(h.provider.collectCount).toBe(1)
    expect('job_id' in parsed).toBe(false)
  })

  it('bounds canonical result JSON and preview metadata together', async () => {
    const h = await harness()
    h.provider.markdown = 'x'.repeat(20000)
    h.provider.complete = true

    const parsed = asResult(await h.service.parseDocument(
      session('session-limit'), { file_paths: [h.file] }, new AbortController().signal, null,
    ))
    expect(parsed.state).toBe('completed')
    expect(JSON.stringify(parsed).length).toBeLessThanOrEqual(h.config.output.maxInlineChars)
    expect(parsed.content_status).toBe('partial')
    expect(parsed.markdown_content).toBeDefined()
    expect('job_id' in parsed).toBe(false)
  })

  it('populates markdown_content and content_status correctly on complete document', async () => {
    const h = await harness()
    h.provider.markdown = '# Complete Document Content\nFull text delivered.'
    h.provider.complete = true

    const parsed = asResult(await h.service.parseDocument(
      session('session-direct-content'), { file_paths: [h.file] }, new AbortController().signal, null,
    ))
    expect(parsed.state).toBe('completed')
    expect(parsed.content_status).toBe('complete')
    expect(parsed.markdown_content).toBe('# Complete Document Content\nFull text delivered.')
    expect(parsed.read_offset_line).toBeUndefined()
    expect('job_id' in parsed).toBe(false)
  })

  it('handles valid empty markdown file with complete status', async () => {
    const h = await harness()
    h.provider.markdown = ''
    h.provider.complete = true

    const parsed = asResult(await h.service.parseDocument(
      session('session-empty-md'), { file_paths: [h.file] }, new AbortController().signal, null,
    ))
    expect(parsed.state).toBe('completed')
    expect(parsed.content_status).toBe('complete')
    expect(parsed.markdown_content).toBe('')
    expect(parsed.read_offset_line).toBeUndefined()
  })

  it('handles request without markdown artifact and marks not_requested without claiming complete text', async () => {
    const h = await harness()
    h.provider.complete = true
    h.provider.extraArtifactsByFileName.set('input.pdf', [{ kind: 'layout', content: '{"pages":[]}' }])

    const parsed = asResult(await h.service.parseDocument(
      session('session-no-md'),
      { file_paths: [h.file], artifacts: ['layout'] },
      new AbortController().signal,
      null,
    ))
    expect(parsed.state).toBe('completed')
    expect(parsed.content_status).toBe('not_requested')
    expect(parsed.markdown_content).toBeUndefined()
    expect(parsed.read_offset_line).toBeUndefined()
    const rendered = renderResult(parsed)[0]?.text ?? ''
    expect(rendered).not.toContain('Status: Content complete')
    expect(rendered).not.toContain('delivered above')
    expect(rendered).toContain('Status: Markdown content was not requested')
  })

  it('fails if markdown was requested but provider did not produce it', async () => {
    const h = await harness()
    h.provider.complete = true
    h.provider.omitMarkdown = true
    h.provider.extraArtifactsByFileName.set('input.pdf', [{ kind: 'layout', content: '{"pages":[]}' }])

    await expect(h.service.parseDocument(
      session('session-missing-md'),
      { file_paths: [h.file], artifacts: ['markdown'] },
      new AbortController().signal,
      null,
    )).rejects.toMatchObject({ failure: { code: 'PROVIDER_UNAVAILABLE' } })
  })

  it('truncates text cleanly at paragraph and newline boundaries without splitting surrogate pairs', () => {
    const text = 'First line\nSecond line\nThird line'
    const cut = truncateAtCleanBoundary(text, 22)
    expect(cut.truncated).toBe(true)
    expect(cut.text).toBe('First line\n')
    expect(cut.resumeLine).toBe(2)

    const paraText = 'Paragraph 1\n\nParagraph 2\n\nParagraph 3'
    const paraCut = truncateAtCleanBoundary(paraText, 16)
    expect(paraCut.truncated).toBe(true)
    expect(paraCut.text).toBe('Paragraph 1\n\n')
    expect(paraCut.resumeLine).toBe(3)

    const lineCut = truncateAtCleanBoundary(paraText, 25)
    expect(lineCut.truncated).toBe(true)
    expect(lineCut.text).toBe('Paragraph 1\n\nParagraph 2\n')
    expect(lineCut.resumeLine).toBe(4)

    const chText = '第一段中文\n第二段中文内容更长一些\n第三段'
    const chCut = truncateAtCleanBoundary(chText, 16)
    expect(chCut.truncated).toBe(true)
    expect(chCut.text).toBe('第一段中文\n')
    expect(chCut.resumeLine).toBe(2)

    const emojiText = 'A🚀B\nC🌟D'
    const brokenSlice = emojiText.slice(0, 2)
    expect(brokenSlice.length).toBe(2)
    const safeSlice = safeStringSlice(emojiText, 2)
    expect(safeSlice).toBe('A')
  })

  it('allocates reclaimed fair shares correctly', () => {
    const shares1 = allocateReclaimedShares([100, 5000], 1000)
    expect(shares1).toEqual([100, 900])

    const shares2 = allocateReclaimedShares([50, 150, 2000, 3000], 800)
    expect(shares2).toEqual([50, 150, 300, 300])

    const shares3 = allocateReclaimedShares([100, 200, 300], 1000)
    expect(shares3).toEqual([100, 200, 300])
  })

  describe('extractMarkdownHeadings', () => {
    it('returns empty array for empty string or text without headings', () => {
      expect(extractMarkdownHeadings('')).toEqual([])
      expect(extractMarkdownHeadings('Just plain text\nAnother line\nNo hashes here')).toEqual([])
    })

    it('extracts levels 1 through 6 with 1-based line numbers and trimmed titles', () => {
      const text = [
        '# Main Title',
        'Intro text',
        '## Section 1 ',
        'Paragraph',
        '### Subsection 1.1',
        '#### Heading 4',
        '##### Heading 5',
        '###### Heading 6',
      ].join('\n')

      const headings = extractMarkdownHeadings(text)
      expect(headings).toEqual([
        { level: 1, title: 'Main Title', line: 1 },
        { level: 2, title: 'Section 1', line: 3 },
        { level: 3, title: 'Subsection 1.1', line: 5 },
        { level: 4, title: 'Heading 4', line: 6 },
        { level: 5, title: 'Heading 5', line: 7 },
        { level: 6, title: 'Heading 6', line: 8 },
      ])
    })

    it('ignores invalid heading syntax and handles CRLF line endings', () => {
      const text = [
        '####### Seven Hashes (not a heading)',
        '#NoSpaceAfterHash',
        '### \t Tab after hash',
        '###    ',
        '# Valid Heading\r\n## Second Heading\r\n',
      ].join('\r\n')

      const headings = extractMarkdownHeadings(text)
      expect(headings).toEqual([
        { level: 3, title: 'Tab after hash', line: 3 },
        { level: 1, title: 'Valid Heading', line: 5 },
        { level: 2, title: 'Second Heading', line: 6 },
      ])
    })

    it('retains all headings when count <= 25', () => {
      const lines: string[] = []
      for (let i = 1; i <= 25; i++) {
        lines.push(`## Section ${i}`)
      }
      const headings = extractMarkdownHeadings(lines.join('\n'))
      expect(headings).toHaveLength(25)
      expect(headings[0]).toEqual({ level: 2, title: 'Section 1', line: 1 })
      expect(headings[24]).toEqual({ level: 2, title: 'Section 25', line: 25 })
    })

    it('filters to high-level headings (levels 1-3, max 20) when headings > 25', () => {
      const lines: string[] = []
      // 10 H1, 10 H2, 10 H4 -> total 30
      for (let i = 1; i <= 10; i++) lines.push(`# Title ${i}`)
      for (let i = 1; i <= 10; i++) lines.push(`## Subtitle ${i}`)
      for (let i = 1; i <= 10; i++) lines.push(`#### LowLevel ${i}`)

      const headings = extractMarkdownHeadings(lines.join('\n'))
      expect(headings).toHaveLength(20)
      expect(headings.every(h => h.level <= 3)).toBe(true)
      expect(headings[0]!.title).toBe('Title 1')
      expect(headings[19]!.title).toBe('Subtitle 10')
    })

    it('caps high-level headings to max 20 when there are > 20 high-level headings', () => {
      const lines: string[] = []
      // 30 H1 headings
      for (let i = 1; i <= 30; i++) lines.push(`# Title ${i}`)

      const headings = extractMarkdownHeadings(lines.join('\n'))
      expect(headings).toHaveLength(20)
      expect(headings[0]!.title).toBe('Title 1')
      expect(headings[19]!.title).toBe('Title 20')
    })

    it('falls back to first 20 headings when all > 25 headings are low-level', () => {
      const lines: string[] = []
      // 30 H4 headings
      for (let i = 1; i <= 30; i++) lines.push(`#### LowLevel ${i}`)

      const headings = extractMarkdownHeadings(lines.join('\n'))
      expect(headings).toHaveLength(20)
      expect(headings[0]!.title).toBe('LowLevel 1')
      expect(headings[19]!.title).toBe('LowLevel 20')
    })
  })

  it('applies fair share reclamation in multi-file batch so short file is complete and long file gets remainder', async () => {
    const h = await harness()
    h.provider.complete = true
    const shortText = '# Short Document\nThis is a short paragraph.\n'
    const longText = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}: ${'Lorem ipsum '.repeat(5)}`).join('\n')
    h.provider.markdownByFileName.set('input.pdf', shortText)
    h.provider.markdownByFileName.set('input-two.pdf', longText)

    const parsed = asBatch(await h.service.parseDocument(
      session('session-reclaim-batch'),
      { file_paths: [h.file, h.fileTwo] },
      new AbortController().signal,
      null,
    ))

    expect(parsed.kind).toBe('batch')
    expect(parsed.state).toBe('completed')
    expect(parsed.content_status).toBe('partial')
    expect(parsed.results).toHaveLength(2)

    const shortRes = parsed.results.find(r => r.state === 'completed' && r.files[0]?.name === 'input.pdf') as ResultView
    const longRes = parsed.results.find(r => r.state === 'completed' && r.files[0]?.name === 'input-two.pdf') as ResultView

    expect(shortRes.content_status).toBe('complete')
    expect(shortRes.markdown_content).toBe(shortText)

    expect(longRes.content_status).toBe('partial')
    expect(longRes.read_offset_line).toBeGreaterThan(1)
    expect(longRes.markdown_path).toBeDefined()

    expect(JSON.stringify(parsed).length).toBeLessThanOrEqual(h.config.output.maxInlineChars)
    const rendered = renderParseDocument(parsed)
    expect(rendered[0]?.text.length).toBeLessThanOrEqual(h.config.output.maxInlineChars)
    expect(rendered[0]?.text).toContain('input.pdf')
    expect(rendered[0]?.text).toContain('input-two.pdf')
    expect(rendered[0]?.text).toContain('Status: Content complete. Full document markdown delivered above.')
    expect(rendered[0]?.text).toContain('Status: Content partial (truncated to output limit)')
  })

  it('preserves failure info and visible text when batch has mixed success and failure under tight budget', async () => {
    const h = await harness()
    h.provider.complete = true
    h.provider.failedNames.add('input-two.pdf')
    h.provider.markdownByFileName.set('input.pdf', '# Succeeded\n' + 'Content line.\n'.repeat(20))

    const parsed = asBatch(await h.service.parseDocument(
      session('session-mixed-fail'),
      { file_paths: [h.file, h.fileTwo] },
      new AbortController().signal,
      null,
    ))

    expect(parsed.kind).toBe('batch')
    expect(parsed.state).toBe('partially-completed')
    expect(parsed.results).toHaveLength(2)

    const failed = parsed.results.find(r => r.state === 'failed')!
    expect(failed.name).toBe('input-two.pdf')
    expect(failed.failure.code).toBe('REMOTE_PARSE_FAILED')

    const success = parsed.results.find(r => r.state === 'completed' && r.files[0]?.name === 'input.pdf') as ResultView
    expect(success.files[0]?.name).toBe('input.pdf')
    expect(success.markdown_content).toBeDefined()

    const rendered = renderParseDocument(parsed)
    const text = rendered[0]?.text ?? ''
    expect(text).toContain('input-two.pdf')
    expect(text).toContain('REMOTE_PARSE_FAILED')
    expect(text).toContain('input.pdf')
    expect(text.length).toBeLessThanOrEqual(h.config.output.maxInlineChars)
  })

  it('prioritizes text over secondary artifacts when budget is tight', async () => {
    const h = await harness()
    h.provider.complete = true
    h.provider.extraArtifactsByFileName.set('input.pdf', [
      { kind: 'layout', content: JSON.stringify({ data: 'x'.repeat(1000) }) },
      { kind: 'images', content: JSON.stringify({ data: 'y'.repeat(1000) }) },
    ])
    h.provider.markdown = '# Essential Text\n' + 'Important content.\n'.repeat(50)

    const parsed = asResult(await h.service.parseDocument(
      session('session-priority'),
      { file_paths: [h.file] },
      new AbortController().signal,
      null,
    ))

    expect(parsed.state).toBe('completed')
    expect(parsed.markdown_content).toBeDefined()
    expect(parsed.markdown_content).toContain('Essential Text')
    expect(parsed.files[0]?.artifacts_truncated).toBe(true)
    expect(JSON.stringify(parsed).length).toBeLessThanOrEqual(h.config.output.maxInlineChars)
  })

  it('throws RESULT_TOO_LARGE when metadata alone exceeds the configured limit', async () => {
    const h = await harness()
    h.provider.complete = true
    const tinyConfig: MinerUConfig = {
      ...h.config,
      output: { maxInlineChars: 50 },
    }
    const tinyService = new MinerUService({
      getConfig: () => tinyConfig,
      providers: new MockProviderRegistry(() => tinyConfig, h.provider),
      results: h.results,
      operations: h.operations,
      resolveCredential: () => Promise.resolve(undefined),
    })

    await expect(tinyService.parseDocument(
      session('session-tiny-limit'),
      { file_paths: [h.file] },
      new AbortController().signal,
      null,
    )).rejects.toMatchObject({ failure: { code: 'RESULT_TOO_LARGE' } })
  })

  it('verifies end-to-end service projection to render output consistency without silent slice', async () => {
    const h = await harness()
    h.provider.complete = true
    h.provider.markdown = '# Full Story\n' + 'Paragraph here.\n'.repeat(150)

    const parsed = asResult(await h.service.parseDocument(
      session('session-consistency'),
      { file_paths: [h.file] },
      new AbortController().signal,
      null,
    ))

    const rendered = renderResult(parsed)
    const text = rendered[0]?.text ?? ''
    expect(text.length).toBeLessThanOrEqual(h.config.output.maxInlineChars)
    expect(text).not.toContain('[Output truncated to limit]')
    expect(text).toContain('Full markdown artifact at:')
    expect(text).toContain('Manifest:')
    expect(text).toContain('resume line: offset=')
    expect(parsed.content_status).toBe('partial')
  })

  it('computes and populates toc on partial content when document has headings', async () => {
    const h = await harness()
    h.provider.complete = true
    const mdWithHeadings = [
      '# Document Title',
      'Introduction paragraph.',
      '## Chapter 1: Foundations',
      'Paragraph 1. '.repeat(100),
      '## Chapter 2: Methods',
      'Paragraph 2. '.repeat(100),
      '### Section 2.1: Details',
      'Paragraph 3. '.repeat(100),
    ].join('\n')
    h.provider.markdown = mdWithHeadings

    const parsed = asResult(await h.service.parseDocument(
      session('session-toc-partial'),
      { file_paths: [h.file] },
      new AbortController().signal,
      null,
    ))

    expect(parsed.state).toBe('completed')
    expect(parsed.content_status).toBe('partial')
    expect(parsed.toc).toBeDefined()
    expect(parsed.toc!.length).toBeGreaterThanOrEqual(4)
    expect(parsed.toc![0]).toEqual({ level: 1, title: 'Document Title', line: 1 })
    expect(parsed.toc![1]).toEqual({ level: 2, title: 'Chapter 1: Foundations', line: 3 })
    expect(parsed.toc![2]).toEqual({ level: 2, title: 'Chapter 2: Methods', line: 5 })
    expect(parsed.toc![3]).toEqual({ level: 3, title: 'Section 2.1: Details', line: 7 })

    const rendered = renderResult(parsed)
    const text = rendered[0]?.text ?? ''
    expect(text).toContain('Document Outline:')
    expect(text).toContain('- Document Title (line 1)')
    expect(text).toContain('  - Chapter 1: Foundations (line 3)')
    expect(text).toContain('  - Chapter 2: Methods (line 5)')
    expect(text).toContain('    - Section 2.1: Details (line 7)')
    expect(text).toContain('Note: To read specific sections, call read_pdf with pages="X-Y" or use the read tool starting from the given line offset.')
  })
})
