import { chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultMinerUConfig, type MinerUConfig, type ProviderConfig } from '../src/config.js'
import { asCacheKey, asProviderConfigId, asSessionId, type SessionId } from '../src/domain/ids.js'
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
import { MinerUService, type ServiceSession } from '../src/service/mineru-service.js'
import { SharedOperationRegistry } from '../src/service/shared-operations.js'
import { JobRepository } from '../src/storage/job-repository.js'
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
    maxFilesPerSubmission: 1,
    maxFileBytes: 200 * 1024 * 1024,
  }
  submitCount = 0
  inspectCount = 0
  collectCount = 0
  complete = false
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
    const ref: ProviderJobRef = {
      provider: this.id,
      taskId: 'upstream-task-1',
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
    const files = ref.files.map(file => ({ fileId: file.fileId, state: this.complete ? 'completed' as const : 'processing' as const }))
    return Promise.resolve({ state: this.complete ? 'completed' : 'processing', files })
  }

  async collect(
    ref: ProviderJobRef, _request: CanonicalParseRequest, sink: ArtifactSink, _context: ProviderCallContext,
  ): Promise<ProviderCollection> {
    this.collectCount++
    const files = []
    for (const file of ref.files) {
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
  readonly provider: MockProvider
  readonly config: MinerUConfig
  readonly jobs: JobRepository
  readonly results: ResultRepository
  readonly operations: SharedOperationRegistry
  readonly diagnostics: MinerUDiagnosticEvent[]
  readonly service: MinerUService
}

const harnesses: Harness[] = []

function session(id: string): ServiceSession {
  return { header: { id: asSessionId(id) } }
}

async function harness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'mineru-service-'))
  const file = join(root, 'input.pdf')
  await writeFile(file, '%PDF-1.4 service fixture')
  const base = defaultMinerUConfig()
  const config: MinerUConfig = {
    ...base,
    storage: { ...base.storage, storageRoot: join(root, 'store') },
    polling: { ...base.polling, pollIntervalMs: 2, pollTimeoutMs: 100, operationTimeoutMs: 5000 },
    output: { maxInlineChars: 2048 },
  }
  const paths = new StoragePaths(config.storage.storageRoot)
  const jobs = new JobRepository(paths)
  const results = new ResultRepository(paths, { maxArtifactBytes: config.limits.maxZipEntryBytes })
  const operations = new SharedOperationRegistry()
  const provider = new MockProvider()
  const providers = new MockProviderRegistry(() => config, provider)
  const diagnostics: MinerUDiagnosticEvent[] = []
  const service = new MinerUService({
    getConfig: () => config, providers, jobs, results, operations, diagnostics: event => diagnostics.push(event),
    resolveCredential: () => Promise.resolve(undefined),
  })
  const result = { root, file, provider, config, jobs, results, operations, diagnostics, service }
  harnesses.push(result)
  return result
}

async function waitCompleted(service: MinerUService, owner: ServiceSession, jobId: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const status = await service.status(owner, jobId, new AbortController().signal)
    if (status.state === 'completed') return
    if (status.state === 'failed') throw new Error(`job failed: ${status.failure?.message ?? 'unknown'}`)
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  throw new Error('job did not complete')
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
  for (const item of completed) item.operations.dispose()
  await new Promise(resolve => setTimeout(resolve, 5))
  await Promise.all(completed.map(async item => {
    await makeWritable(item.root)
    await rm(item.root, { recursive: true, force: true })
  }))
})

describe('MinerUService cache, sessions, concurrency, and recovery', () => {
  it('publishes once, then returns a cache hit without calling the provider', async () => {
    const h = await harness()
    const owner = session('session-cache')
    h.provider.complete = true
    const first = await h.service.parseDocument(owner, { file_paths: [h.file] }, new AbortController().signal, 1000)
    expect(first.state).toBe('completed')
    expect(h.provider.submitCount).toBe(1)

    const second = await h.service.submit(owner, { file_paths: [h.file] }, new AbortController().signal)
    expect(second.source).toBe('cache')
    expect(second.state).toBe('completed')
    expect(h.provider.submitCount).toBe(1)
    expect(second.job_id).not.toBe(first.job_id)
    expect(h.provider.retryOptions).toMatchObject({ maxRetries: 2, initialDelayMs: 500, maxDelayMs: 10000 })
    h.provider.retryOptions?.onRetry?.({
      provider: 'self-hosted-v2', operation: 'inspect', attempt: 1, maxRetries: 2,
      delayMs: 500, reason: 'transport',
    })
    expect(h.diagnostics.some(event => event.phase === 'provider-retry'
      && event.providerOperation === 'inspect' && event.maxAttempts === 3)).toBe(true)
    const published = h.diagnostics.find(event => event.phase === 'published')
    expect(published).toMatchObject({ provider: 'self-hosted-v2', cacheHit: false, waiterCount: 1 })
    expect(published?.bytes).toBeGreaterThan(0)
    expect(published?.durationMs).toBeGreaterThanOrEqual(0)
    expect(h.diagnostics.some(event => event.phase === 'cache-hit' && event.jobId === second.job_id)).toBe(true)
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
    registry.dispose()
  })

  it('coalesces concurrent sessions to one upstream submit but creates independent jobs', async () => {
    const h = await harness()
    let release!: () => void
    h.provider.submitGate = new Promise(resolve => { release = resolve })
    const one = h.service.submit(session('session-one'), { file_paths: [h.file] }, new AbortController().signal)
    const two = h.service.submit(session('session-two'), { file_paths: [h.file] }, new AbortController().signal)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(h.provider.submitCount).toBe(1)
    const [persistedOne, persistedTwo] = await Promise.all([
      h.jobs.list(session('session-one')), h.jobs.list(session('session-two')),
    ])
    expect(persistedOne[0]?.resolution).toMatchObject({ ref: { provider: 'self-hosted-v2', taskId: 'upstream-task-1' } })
    expect(persistedTwo[0]?.resolution).toMatchObject({ ref: { provider: 'self-hosted-v2', taskId: 'upstream-task-1' } })
    release()
    const [first, second] = await Promise.all([one, two])
    expect(first.job_id).not.toBe(second.job_id)
    expect(new Set([first.source, second.source])).toEqual(new Set(['provider', 'shared-operation']))
    expect(h.provider.submitCount).toBe(1)
    expect(h.diagnostics.some(event => event.phase === 'shared-operation' && event.waiterCount === 2)).toBe(true)
    h.provider.complete = true
    await Promise.all([
      waitCompleted(h.service, session('session-one'), first.job_id),
      waitCompleted(h.service, session('session-two'), second.job_id),
    ])
  })

  it('does not cancel the shared producer when one waiter aborts', async () => {
    const h = await harness()
    let release!: () => void
    h.provider.submitGate = new Promise(resolve => { release = resolve })
    const firstOwner = session('session-keep')
    const cancelledOwner = session('session-cancelled')
    const first = h.service.submit(firstOwner, { file_paths: [h.file] }, new AbortController().signal)
    const controller = new AbortController()
    const cancelled = h.service.submit(cancelledOwner, { file_paths: [h.file] }, controller.signal)
    await new Promise(resolve => setTimeout(resolve, 10))
    controller.abort()
    await expect(cancelled).rejects.toBeDefined()
    release()
    const kept = await first
    h.provider.complete = true
    await waitCompleted(h.service, firstOwner, kept.job_id)
    const cancelledJobs = await h.jobs.list(cancelledOwner)
    expect(cancelledJobs).toHaveLength(1)
    await waitCompleted(h.service, cancelledOwner, cancelledJobs[0]!.id)
    expect(h.provider.submitCount).toBe(1)
  })

  it('prevents session B from reading session A job', async () => {
    const h = await harness()
    const a = session('session-a')
    h.provider.complete = true
    const submitted = await h.service.submit(a, { file_paths: [h.file] }, new AbortController().signal)
    await expect(h.service.status(session('session-b'), submitted.job_id, new AbortController().signal))
      .rejects.toMatchObject({ failure: { code: 'JOB_NOT_FOUND' } })
  })

  it('recovers a persisted remote ref after restart without the source path', async () => {
    const h = await harness()
    const owner = session('session-restart')
    const submitted = await h.service.submit(owner, { file_paths: [h.file] }, new AbortController().signal)
    expect(submitted.state).toBe('processing')
    h.operations.dispose()
    await new Promise(resolve => setTimeout(resolve, 10))
    await rm(h.file)

    const operations = new SharedOperationRegistry()
    const providers = new MockProviderRegistry(() => h.config, h.provider)
    const restarted = new MinerUService({
      getConfig: () => h.config, providers, jobs: h.jobs, results: h.results, operations,
      resolveCredential: () => Promise.resolve(undefined),
    })
    h.provider.complete = true
    await waitCompleted(restarted, owner, submitted.job_id)
    expect(h.provider.submitCount).toBe(1)
    expect(h.provider.inspectCount).toBeGreaterThan(0)
    expect((await restarted.result(owner, submitted.job_id, new AbortController().signal)).state).toBe('completed')
    operations.dispose()
  })

  it('attaches every historical session job to one active restart recovery', async () => {
    const h = await harness()
    const ownerA = session('session-recovery-a')
    const ownerB = session('session-recovery-b')
    const [jobA, jobB] = await Promise.all([
      h.service.submit(ownerA, { file_paths: [h.file] }, new AbortController().signal),
      h.service.submit(ownerB, { file_paths: [h.file] }, new AbortController().signal),
    ])
    expect(h.provider.submitCount).toBe(1)
    h.operations.dispose()
    await new Promise(resolve => setTimeout(resolve, 10))

    const operations = new SharedOperationRegistry()
    const restarted = new MinerUService({
      getConfig: () => h.config,
      providers: new MockProviderRegistry(() => h.config, h.provider),
      jobs: h.jobs, results: h.results, operations,
      resolveCredential: () => Promise.resolve(undefined),
    })
    h.provider.complete = false
    expect((await restarted.status(ownerA, jobA.job_id, new AbortController().signal)).state).toBe('processing')
    expect((await restarted.status(ownerB, jobB.job_id, new AbortController().signal)).state).toBe('processing')
    h.provider.complete = true
    await Promise.all([
      waitCompleted(restarted, ownerA, jobA.job_id),
      waitCompleted(restarted, ownerB, jobB.job_id),
    ])
    expect((await restarted.result(ownerB, jobB.job_id, new AbortController().signal)).state).toBe('completed')
    operations.dispose()
  })

  it('keeps a job queryable after synchronous parse timeout', async () => {
    const h = await harness()
    const owner = session('session-timeout')
    const timedOut = await h.service.parseDocument(owner, { file_paths: [h.file] }, new AbortController().signal, 10)
    expect('poll_timed_out' in timedOut && timedOut.poll_timed_out).toBe(true)
    expect(timedOut.state).toBe('processing')
    h.provider.complete = true
    await waitCompleted(h.service, owner, timedOut.job_id)
    expect((await h.service.result(owner, timedOut.job_id, new AbortController().signal)).state).toBe('completed')
  })

  it('bounds canonical result JSON and rendered preview metadata together', async () => {
    const h = await harness()
    h.provider.markdown = 'x'.repeat(20000)
    h.provider.complete = true
    const owner = session('session-limit')
    const parsed = await h.service.parseDocument(owner, { file_paths: [h.file] }, new AbortController().signal, 1000)
    expect(parsed.state).toBe('completed')
    expect(JSON.stringify(parsed).length).toBeLessThanOrEqual(h.config.output.maxInlineChars)
    expect('preview_truncated' in parsed && parsed.preview_truncated).toBe(true)
  })
})
