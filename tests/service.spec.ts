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
} from '../src/service/mineru-service.js'
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
      const markdown = await sink.writeArtifact(file.fileId, 'markdown', this.markdown, { mediaType: 'text/markdown' })
      files.push({ fileId: file.fileId, name: file.name, artifacts: [markdown] })
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
    expect(parsed.preview_truncated).toBe(true)
    expect('job_id' in parsed).toBe(false)
  })
})
