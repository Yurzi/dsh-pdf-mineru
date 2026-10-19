import { describe, it, expect } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { createFileId, asProviderConfigId } from '../src/domain/ids.js'
import type { ProviderJobRef, ProviderSubmittedFile } from '../src/providers/contract.js'
import type { ProviderRetryOptions as Retry } from '../src/providers/http/retry.js'
import { SelfHostedLegacyV2Provider, type SelfHostedLegacyV2ProviderConfig } from '../src/providers/self-hosted-legacy-v2/index.js'
import { deferred, fakeUpstream, json, seq, text, type ServerRoute } from './support/http-fake.js'
import {
  RecordingSink, SHA256_A, SHA256_B, callContext, canonicalFile, canonicalRequest, preparedSource, retryLog,
} from './support/provider-context.js'

function legacy(baseURL: string, overrides: Partial<SelfHostedLegacyV2ProviderConfig> = {}): SelfHostedLegacyV2Provider {
  return new SelfHostedLegacyV2Provider({
    id: asProviderConfigId('mp_local'), type: 'self-hosted-legacy-v2', baseURL,
    modelMap: { pipeline: 'pipeline', vlm: 'vlm-engine' }, allowInsecureHttp: true, ...overrides,
  })
}

async function legacyUpstream(routes: Readonly<Record<string, ServerRoute>>) {
  const upstream = await fakeUpstream(routes)
  return { upstream, provider: legacy(upstream.url) }
}

function taskRef(taskId: string, files: readonly ProviderSubmittedFile[] = [{ dataId: 'd1', fileId: createFileId(SHA256_A), name: 'doc.pdf' }]): ProviderJobRef {
  return { provider: 'self-hosted-legacy-v2', taskId, files }
}

/** Text fields of a multipart/form-data body, keyed by field name. */
function multipartFields(body: Buffer): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const match of body.toString('utf8').matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)\r\n/g)) fields[match[1]!] = match[2]!
  return fields
}

const HEALTHY = {
  status: 'healthy', version: '3.4.4', protocol_version: 2,
  queued_tasks: 2, processing_tasks: 1, completed_tasks: 50, failed_tasks: 0, max_concurrent_requests: 4,
}

describe('SelfHostedLegacyV2Provider', () => {
  it('derives an opaque compatibility key that tracks the mapped backend', () => {
    const request = canonicalRequest({ files: [canonicalFile('doc.pdf')], semantics: { model: 'vlm' } })
    const provider = legacy('https://secret-internal-host:8000/v2/', { configuredVersion: 'v3.4.4' })
    const key = provider.compatibilityKey(request)
    expect(key).toMatch(/^self-hosted-legacy-v2:[a-f0-9]{24}$/)
    expect(key).not.toContain('secret-internal-host')
    expect(legacy('https://secret-internal-host:8000/v2/', { configuredVersion: 'v3.4.4', modelMap: { vlm: 'another-vlm' } })
      .compatibilityKey(request)).not.toBe(key)
  })

  describe('probe (GET /health)', () => {
    it('reports health, version and queue stats using only the legacy route', async () => {
      const { upstream, provider } = await legacyUpstream({ 'GET /health': json(200, HEALTHY) })
      const result = await provider.probe(callContext({ credential: 'my-secret-token' }))
      expect(result).toMatchObject({
        available: true, provider: 'self-hosted-legacy-v2', authentication: 'valid', protocolVersion: 'v2', serverVersion: '3.4.4',
        queue: { queued: 2, processing: 1, completed: 50, failed: 0, maxConcurrent: 4 },
      })
      expect(upstream.requests.map(request => request.url)).toEqual(['/health'])
      expect(upstream.requests[0]?.headers.authorization).toBe('Bearer my-secret-token')
    })

    it('reports an unhealthy server without a credential as unavailable and not configured', async () => {
      const { upstream, provider } = await legacyUpstream({ 'GET /health': json(200, { status: 'unhealthy', version: '3.4.4' }) })
      const result = await provider.probe(callContext())
      expect(result).toMatchObject({ available: false, authentication: 'not-configured' })
      expect(upstream.requests[0]?.headers.authorization).toBeUndefined()
    })

    it.each<[string, ServerRoute, string]>([
      ['a rejected credential', json(401, { detail: 'Invalid token' }), 'invalid'],
      ['a redirect (never followed)', text(302, '', { location: '/elsewhere' }), 'unknown'],
    ])('reports %s as unavailable after one request', async (_label, route, authentication) => {
      const { upstream, provider } = await legacyUpstream({ 'GET /health': route })
      const result = await provider.probe(callContext({ credential: 'token', retry: { maxRetries: 0 } }))
      expect(result).toMatchObject({ available: false, authentication })
      expect(upstream.requests).toHaveLength(1)
    })

    it('reports a refused connection as unavailable', async () => {
      const upstream = await fakeUpstream({})
      await upstream.close()
      const result = await legacy(upstream.url).probe(callContext({ retry: { maxRetries: 0 } }))
      expect(result.available).toBe(false)
    })

    it('rethrows CANCELLED for an aborted probe', async () => {
      const controller = new AbortController()
      controller.abort()
      await expect(legacy('https://example.com').probe(callContext({ signal: controller.signal })))
        .rejects.toMatchObject({ failure: { code: 'CANCELLED' } })
    })
  })

  describe('submit (POST /tasks multipart)', () => {
    it.each([
      ['1-5', '0', '4'],
      ['3', '2', '2'],
    ])('streams one multipart request with mapped fields (pages %s)', async (pages, start, end) => {
      const { upstream, provider } = await legacyUpstream({
        'POST /tasks': json(202, { task_id: 'task_abc_123', status: 'pending', status_url: 'http://127.0.0.1/tasks/task_abc_123' }),
      })
      const file = await preparedSource('report.pdf', '%PDF-1.4 report content')
      const request = canonicalRequest({
        files: [file], semantics: { pages }, requiredArtifacts: ['markdown', 'layout', 'content-list', 'images'],
      })
      const submission = await provider.submit(request, [file], callContext({ credential: 'secret-key' }))

      expect(upstream.requests.map(request => request.url)).toEqual(['/tasks'])
      const post = upstream.requests[0]!
      expect(post.headers.authorization).toBe('Bearer secret-key')
      expect(post.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
      expect(multipartFields(post.body)).toEqual({
        backend: 'pipeline', parse_method: 'auto', lang_list: 'ch', formula_enable: 'true', table_enable: 'true',
        start_page_id: start, end_page_id: end,
        return_md: 'true', return_middle_json: 'true', return_model_output: 'false', return_content_list: 'true', return_images: 'true',
      })
      expect(post.body.toString('utf8')).toContain('%PDF-1.4 report content')
      // The transient job ref carries only task and file mappings, never upstream URLs.
      expect(submission.ref).toEqual({
        provider: 'self-hosted-legacy-v2', taskId: 'task_abc_123',
        files: [{ dataId: `data_${file.fileId}`, fileId: file.fileId, name: 'report.pdf' }],
      })
      expect(submission.state).toBe('queued')
      expect(submission.files).toMatchObject([{ fileId: file.fileId, state: 'queued' }])
    })

    it('rejects multi-interval page ranges before contacting the server', async () => {
      const { upstream, provider } = await legacyUpstream({})
      const file = await preparedSource('test.pdf')
      await expect(provider.submit(canonicalRequest({ files: [file], semantics: { pages: '1-3,5-7' } }), [file], callContext()))
        .rejects.toMatchObject({ failure: { code: 'UNSUPPORTED_OPTION' } })
      expect(upstream.requests).toHaveLength(0)
    })

    it('re-stats the source and refuses to upload a modified file', async () => {
      const { upstream, provider } = await legacyUpstream({})
      const file = await preparedSource('test.pdf', 'original content')
      await writeFile(file.path, 'tampered much longer content')
      await expect(provider.submit(canonicalRequest({ files: [file] }), [file], callContext()))
        .rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
      expect(upstream.requests).toHaveLength(0)
    })

    it('never retries the multipart POST', async () => {
      const { upstream, provider } = await legacyUpstream({ 'POST /tasks': json(500, { detail: 'Submission queue overloaded' }) })
      const file = await preparedSource('test.pdf')
      const log = retryLog({ maxRetries: 3 })
      await expect(provider.submit(canonicalRequest({ files: [file] }), [file], callContext({ retry: log.retry })))
        .rejects.toMatchObject({ failure: { code: 'PROVIDER_UNAVAILABLE', retryable: true } })
      expect(upstream.requestsFor('POST /tasks')).toHaveLength(1)
      expect(log.events).toEqual([])
    })

    it('enforces maxApiResponseBytes on the submit response', async () => {
      const { provider } = await legacyUpstream({ 'POST /tasks': json(200, { task_id: 'task_huge', status: 'pending', extra: 'x'.repeat(10_000) }) })
      const file = await preparedSource('test.pdf')
      await expect(provider.submit(canonicalRequest({ files: [file] }), [file], callContext({ limits: { maxApiResponseBytes: 100 } })))
        .rejects.toMatchObject({ failure: { code: 'RESULT_TOO_LARGE' } })
    })
  })

  describe('inspect (GET /tasks/{id})', () => {
    it('rejects V1 references instead of dispatching that protocol', async () => {
      const provider = legacy('http://127.0.0.1:1')
      const ref: ProviderJobRef = { provider: 'self-hosted-v1', taskId: 'v1_job', files: [] }
      await expect(provider.inspect(ref, callContext())).rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
      await expect(provider.collect(ref, canonicalRequest(), new RecordingSink(), callContext()))
        .rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
    })

    it('maps task statuses onto job and file states', async () => {
      const { provider } = await legacyUpstream({
        'GET /tasks/task_123': seq(json(200, { task_id: 'task_123', status: 'processing' }), json(200, { task_id: 'task_123', status: 'completed' })),
      })
      const processing = await provider.inspect(taskRef('task_123'), callContext())
      expect([processing.state, processing.files[0]?.state]).toEqual(['processing', 'processing'])
      const completed = await provider.inspect(taskRef('task_123'), callContext())
      expect([completed.state, completed.files[0]?.state]).toEqual(['completed', 'completed'])
    })

    it.each<[string, ServerRoute, string]>([
      ['a missing task (not retried)', json(404, { detail: 'Task not found' }), 'JOB_NOT_FOUND'],
      ['an unknown status', json(200, { task_id: 'task_123', status: 'weird_unknown_state' }), 'REMOTE_PARSE_FAILED'],
    ])('fails %s', async (_label, route, code) => {
      const { upstream, provider } = await legacyUpstream({ 'GET /tasks/task_123': route })
      await expect(provider.inspect(taskRef('task_123'), callContext())).rejects.toMatchObject({ failure: { code } })
      expect(upstream.requests).toHaveLength(1)
    })

    it('reports CANCELLED when the caller aborts an in-flight request', async () => {
      const arrived = deferred()
      const { provider } = await legacyUpstream({ 'GET /tasks/task_1': () => { arrived.resolve() } })
      const controller = new AbortController()
      const pending = provider.inspect(taskRef('task_1'), callContext({ signal: controller.signal }))
      await arrived.promise
      controller.abort()
      await expect(pending).rejects.toMatchObject({ failure: { code: 'CANCELLED' } })
    })

    it('redacts credentials, bearer tokens and URL secrets from server diagnostics', async () => {
      const { provider } = await legacyUpstream({
        'GET /tasks/task_err': json(500, {
          detail: 'Invalid key plain-secret-credential; Bearer secret-token-xyz at https://api.upstream.com/path?token=supersecret&key=123#frag',
        }),
      })
      const error = await provider.inspect(taskRef('task_err'), callContext({ credential: 'plain-secret-credential', retry: { maxRetries: 0 } }))
        .then(() => undefined, (reason: unknown) => reason)
      expect(error).toMatchObject({ failure: { code: 'PROVIDER_UNAVAILABLE' } })
      const message = JSON.stringify(error)
      expect(message).toContain('Bearer [REDACTED]')
      for (const secret of ['secret-token-xyz', 'plain-secret-credential', 'supersecret']) expect(message).not.toContain(secret)
    })
  })

  describe('collect (GET /tasks/{id}/result)', () => {
    it('writes every requested artifact and sanitizes base64 image names', async () => {
      const png = `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`
      const { provider } = await legacyUpstream({
        'GET /tasks/task_123/result': json(200, {
          backend: 'pipeline', version: '3.4.4',
          results: {
            document: {
              md_content: '# Extracted Title', middle_json: { blocks: [] }, model_output: 'raw model output',
              content_list: [{ type: 'text', content: 'Extracted Title' }],
              images: { 'figure_1.png': png, '../traversal.png': png },
            },
          },
        }),
      })
      const file = canonicalFile('document.pdf')
      const sink = new RecordingSink()
      const collection = await provider.collect(
        taskRef('task_123', [{ dataId: 'd1', fileId: file.fileId, name: file.name }]),
        canonicalRequest({ files: [file], requiredArtifacts: ['markdown', 'layout', 'model-output', 'content-list', 'images'] }),
        sink, callContext(),
      )
      expect(collection.files).toHaveLength(1)
      expect(collection.files[0]).toMatchObject({ fileId: file.fileId })
      expect(collection.files[0]?.failure).toBeUndefined()
      expect(new Set(sink.written.map(entry => entry.kind))).toEqual(new Set(['markdown', 'layout', 'model-output', 'content-list', 'images']))
      expect(sink.written.filter(entry => entry.kind === 'images').map(entry => entry.options.relativeName))
        .toEqual(['images/figure_1.png', 'images/traversal.png', 'images/index.json'])
      expect(sink.artifact('markdown')?.toString()).toBe('# Extracted Title')
    })

    it('returns a terminal per-file failure when a required artifact is missing', async () => {
      const { provider } = await legacyUpstream({ 'GET /tasks/partial/result': json(200, { results: { document: { md_content: '# only markdown' } } }) })
      const collection = await provider.collect(taskRef('partial'), canonicalRequest({ requiredArtifacts: ['markdown', 'layout'] }), new RecordingSink(), callContext())
      expect(collection.files[0]?.failure).toMatchObject({ code: 'REMOTE_PARSE_FAILED', retryable: false })
    })

    it('matches multi-file results by name or unique stem and refuses ambiguous stems', async () => {
      const { provider } = await legacyUpstream({
        'GET /tasks/multi/result': json(200, { results: { 'file_a.pdf': { md_content: '# A' }, file_b: { md_content: '# B' }, doc: { md_content: '# ?' } } }),
      })
      const files: ProviderSubmittedFile[] = [
        { dataId: 'd1', fileId: createFileId(SHA256_A, 0), name: 'file_a.pdf' },
        { dataId: 'd2', fileId: createFileId(SHA256_B, 1), name: 'file_b.pdf' },
        { dataId: 'd3', fileId: createFileId(SHA256_A, 2), name: 'doc.pdf' },
        { dataId: 'd4', fileId: createFileId(SHA256_B, 3), name: 'doc.docx' },
      ]
      const sink = new RecordingSink()
      const collection = await provider.collect(taskRef('multi', files), canonicalRequest(), sink, callContext())
      expect(collection.files.map(file => file.failure?.code)).toEqual([undefined, undefined, 'REMOTE_PARSE_FAILED', 'REMOTE_PARSE_FAILED'])
      expect(sink.written.map(entry => entry.content.toString())).toEqual(['# A', '# B'])
    })
  })

  describe('retry policy', () => {
    it.each([
      ['probe', 'GET /health', (p: SelfHostedLegacyV2Provider, retry: Retry) => p.probe(callContext({ retry })), json(200, HEALTHY)],
      ['inspect', 'GET /tasks/t1', (p: SelfHostedLegacyV2Provider, retry: Retry) => p.inspect(taskRef('t1'), callContext({ retry })), json(200, { task_id: 't1', status: 'completed' })],
      ['collect', 'GET /tasks/t1/result', (p: SelfHostedLegacyV2Provider, retry: Retry) => p.collect(taskRef('t1'), canonicalRequest(), new RecordingSink(), callContext({ retry })), json(200, { results: { 'doc.pdf': { md_content: '# ok' } } })],
    ] as const)('retries the idempotent %s GET after a transient 503', async (operation, route, call, success) => {
      const { upstream, provider } = await legacyUpstream({ [route]: seq(json(503, { detail: 'Service busy' }), success) })
      const log = retryLog()
      await call(provider, log.retry)
      expect(upstream.requests).toHaveLength(2)
      expect(log.events).toEqual([expect.objectContaining({ provider: 'self-hosted-legacy-v2', operation, attempt: 1, status: 503, reason: 'http-status' })])
    })

    it('waits for the Retry-After header of a 429', async () => {
      const { provider } = await legacyUpstream({
        'GET /tasks/t429': seq(json(429, { detail: 'Rate limit exceeded' }, { 'retry-after': '2' }), json(200, { task_id: 't429', status: 'processing' })),
      })
      const log = retryLog({ maxDelayMs: 10_000 })
      expect((await provider.inspect(taskRef('t429'), callContext({ retry: log.retry }))).state).toBe('processing')
      expect(log.events).toEqual([expect.objectContaining({ operation: 'inspect', status: 429, retryAfterMs: 2000, delayMs: 2000 })])
    })
  })
})
