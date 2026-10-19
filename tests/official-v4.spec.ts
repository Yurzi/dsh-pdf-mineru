import { describe, it, expect, vi } from 'vitest'
import { Readable } from 'node:stream'
import { asFileId, asProviderConfigId } from '../src/domain/ids.js'
import type { MinerUErrorCode } from '../src/domain/errors.js'
import type { ProviderCallContext, ProviderJobRef, ProviderSubmittedFile } from '../src/providers/contract.js'
import { OfficialV4Provider } from '../src/providers/official-v4/index.js'
import { bodyText, json, seq, stubFetch, text, type CannedReply, type FetchRoute } from './support/http-fake.js'
import {
  RecordingSink, SHA256_B, callContext, canonicalFile, canonicalRequest, preparedSource, retryLog, zip, type CallContextOptions,
} from './support/provider-context.js'

const API = 'https://mineru.net/api/v4'
const TOKEN = 'test-official-token-xyz'
const SUBMIT = `POST ${API}/file-urls/batch`
const PUT_URL = 'https://oss.example.com/upload?signature=xyz'
const CDN_URL = 'https://cdn.example.com/result.zip'
const status = (batchId: string): string => `GET ${API}/extract-results/batch/${batchId}`
const ok = (data: unknown, extra: Record<string, unknown> = {}): CannedReply => json(200, { code: 0, msg: 'ok', ...extra, data })
const submitted = (fileUrls: readonly string[] = [PUT_URL]): CannedReply => ok({ batch_id: 'batch_1', file_urls: fileUrls }, { trace_id: 'trace_submit' })
const resultZip = zip({ 'full.md': '# Full Parsed Markdown', 'layout.json': '{"layout":"ok"}' })
const zipReply = async (): Promise<CannedReply> => ({ status: 200, headers: { 'content-type': 'application/zip' }, body: await resultZip })

const FILE_1 = asFileId('mf_0123456789abcdef0123456789_0')
const FILE_2 = asFileId('mf_fedcba9876543210fedcba9876_1')
const ONE_FILE: readonly ProviderSubmittedFile[] = [{ fileId: FILE_1, dataId: 'data_1', name: 'doc1.pdf' }]
const batchRef = (batchId: string, files = ONE_FILE): ProviderJobRef => ({ provider: 'official-v4', batchId, files })
const done = (dataId = 'data_1', zipUrl = CDN_URL) => ({ data_id: dataId, file_name: 'doc1.pdf', state: 'done', full_zip_url: zipUrl })

const provider = (): OfficialV4Provider => new OfficialV4Provider({
  id: asProviderConfigId('mp_official_v4'), type: 'official-v4', baseURL: API,
  apiKeyEnv: 'MINERU_API_KEY', models: ['pipeline', 'vlm'], configuredVersion: 'v4',
})
const context = (options: CallContextOptions = {}): ProviderCallContext => callContext({ credential: TOKEN, ...options })

async function submitSource(name = 'sample.pdf', body = '%PDF-1.4 sample') {
  const source = await preparedSource(name, body)
  return { source, request: canonicalRequest({ files: [source] }) }
}

describe('OfficialV4Provider', () => {
  it('derives an opaque compatibility key without the endpoint or token', () => {
    const key = new OfficialV4Provider({
      id: asProviderConfigId('mp_official_v4'), type: 'official-v4', baseURL: 'https://secret-cluster.mineru.net/api/v4/',
      apiKeyEnv: 'MINERU_API_KEY', models: ['vlm'], configuredVersion: 'v4',
    }).compatibilityKey(canonicalRequest({ files: [canonicalFile('doc.pdf')], semantics: { model: 'vlm' } }))
    expect(key).toMatch(/^official-v4:[a-f0-9]{24}$/)
    expect(key).not.toContain('secret-cluster')
  })

  describe('probe', () => {
    it('reports not-configured without any request when the credential is empty', async () => {
      const fetches = stubFetch({})
      expect(await provider().probe(context({ credential: '' }))).toMatchObject({
        available: false, authentication: 'not-configured', provider: 'official-v4', protocolVersion: 'v4',
      })
      expect(fetches.calls).toHaveLength(0)
    })

    it.each<[string, CannedReply, { available: boolean; authentication: string }]>([
      ['a successful query', ok({ batch_id: '__dsh_probe__' }), { available: true, authentication: 'valid' }],
      ['the documented missing-batch sentinel', json(404, { code: 'BATCH_NOT_FOUND', msg: 'Probe batch does not exist' }), { available: true, authentication: 'valid' }],
      ['missing-task sentinel -500', json(200, { code: -500, msg: 'task not found or expire' }), { available: true, authentication: 'valid' }],
      ['missing-task sentinel -60012', json(200, { code: -60012, msg: 'task not found or expire' }), { available: true, authentication: 'valid' }],
      ['code -500 with an unrelated message', json(200, { code: -500, msg: 'Internal service error' }), { available: false, authentication: 'unknown' }],
      ['code -60012 with an unrelated message', json(200, { code: -60012, msg: 'Internal service error' }), { available: false, authentication: 'unknown' }],
      ['a generic proxy 400', json(400, { msg: 'Bad request' }), { available: false, authentication: 'unknown' }],
      ['business auth code A0202', json(200, { code: 'A0202', msg: 'Token invalid or expired' }), { available: false, authentication: 'invalid' }],
      ['business auth code A0211', json(200, { code: 'A0211', msg: 'Token invalid or expired' }), { available: false, authentication: 'invalid' }],
      ['business auth code 401', json(200, { code: '401', msg: 'Token invalid or expired' }), { available: false, authentication: 'invalid' }],
      ['HTTP 401', json(401, { code: 401, msg: 'Invalid token' }), { available: false, authentication: 'invalid' }],
    ])('classifies %s', async (_label, reply, expected) => {
      const fetches = stubFetch({ [status('__dsh_probe__')]: reply })
      expect(await provider().probe(context())).toMatchObject({ provider: 'official-v4', protocolVersion: 'v4', ...expected })
      expect(fetches.calls).toHaveLength(1)
      expect(fetches.calls[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`)
      expect(fetches.calls[0]?.init.redirect).toBe('error')
    })
  })

  describe('submit (authenticated batch POST + bare presigned PUT)', () => {
    it('allocates the batch with Bearer JSON and uploads with an explicitly empty headers object', async () => {
      const source = await preparedSource('sample.pdf', '%PDF-1.4 test binary data')
      const request = canonicalRequest({ files: [source], semantics: { model: 'vlm', ocr: true, pages: '1-5' } })
      let uploaded: string | undefined
      const fetches = stubFetch({
        [SUBMIT]: submitted(),
        // The source stream is closed once fetch settles, so the body is read while the PUT is in flight.
        [`PUT ${PUT_URL}`]: async call => { uploaded = await bodyText(call.init.body); return text(200) },
      })
      const submission = await provider().submit(request, [source], context())

      const [post, put] = fetches.calls
      expect(post).toMatchObject({ method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' } })
      expect(post?.init.redirect).toBe('error')
      expect(JSON.parse(String(post?.init.body))).toEqual({
        model_version: 'vlm',
        files: [{
          name: 'sample.pdf', data_id: `data_${String(source.fileId)}`, is_ocr: true,
          enable_formula: true, enable_table: true, language: 'ch', page_ranges: '1-5',
        }],
      })
      expect(put?.url).toBe(PUT_URL)
      expect(put?.init.headers).toEqual({})
      expect(put?.init).toMatchObject({ method: 'PUT', redirect: 'error', duplex: 'half' })
      expect(uploaded).toBe('%PDF-1.4 test binary data')
      expect(fetches.calls).toHaveLength(2)
      // The transient ref holds only batch and file mappings — no upload or result URLs.
      expect(submission.ref).toEqual({
        provider: 'official-v4', batchId: 'batch_1',
        files: [{ dataId: `data_${String(source.fileId)}`, fileId: source.fileId, name: 'sample.pdf' }],
      })
      expect(submission.state).toBe('processing')
    })

    it.each<[string | number, MinerUErrorCode]>([
      [4001, 'REMOTE_PARSE_FAILED'],
      ['A0202', 'AUTHENTICATION_FAILED'],
      ['A0211', 'AUTHENTICATION_FAILED'],
      [-60018, 'PROVIDER_QUOTA_EXHAUSTED'],
      [-60005, 'FILE_TOO_LARGE'],
    ])('maps business code %s to %s and keeps provider code and trace id', async (code, expected) => {
      const { source, request } = await submitSource()
      const fetches = stubFetch({ [SUBMIT]: json(200, { code, msg: 'official business failure', trace_id: 'trace-business' }) })
      await expect(provider().submit(request, [source], context())).rejects.toMatchObject({
        failure: { code: expected, providerCode: String(code), traceId: 'trace-business' },
      })
      expect(fetches.calls).toHaveLength(1)
    })

    it.each([
      ['plain HTTP', 'http://oss.example.com/upload'],
      ['embedded credentials', 'https://user:pass@oss.example.com/upload'],
      ['an invalid URL', 'not a url'],
    ])('refuses a presigned upload URL with %s before uploading', async (_label, uploadUrl) => {
      const { source, request } = await submitSource()
      const fetches = stubFetch({ [SUBMIT]: submitted([uploadUrl]) })
      await expect(provider().submit(request, [source], context())).rejects.toMatchObject({ failure: { code: 'REMOTE_PARSE_FAILED' } })
      expect(fetches.calls.map(call => call.method)).toEqual(['POST'])
    })

    it('reports a rejected storage upload as non-retryable UPLOAD_FAILED', async () => {
      const { source, request } = await submitSource()
      const fetches = stubFetch({ [SUBMIT]: submitted(), [`PUT ${PUT_URL}`]: text(403, 'SignatureDoesNotMatch') })
      await expect(provider().submit(request, [source], context())).rejects.toMatchObject({ failure: { code: 'UPLOAD_FAILED', retryable: false } })
      expect(fetches.callsTo(PUT_URL)).toHaveLength(1)
    })
  })

  describe('inspect (GET extract-results)', () => {
    const twoFiles: readonly ProviderSubmittedFile[] = [
      { fileId: FILE_1, dataId: 'data_1', name: 'file1.pdf' },
      { fileId: FILE_2, dataId: 'data_2', name: 'file2.pdf' },
    ]
    const item = (dataId: string, state: string, extra: Record<string, unknown> = {}) => ({ data_id: dataId, file_name: 'x.pdf', state, ...extra })

    it.each([
      ['processing', [item('data_1', 'running'), item('data_2', 'waiting-file')], ['processing', 'queued']],
      ['partially-completed', [item('data_1', 'done'), item('data_2', 'failed')], ['completed', 'failed']],
      ['completed', [item('data_1', 'done'), item('data_2', 'done')], ['completed', 'completed']],
      ['failed', [item('data_1', 'failed'), item('data_2', 'failed')], ['failed', 'failed']],
    ])('aggregates the batch as %s', async (batchState, results, fileStates) => {
      stubFetch({ [status('b')]: ok({ batch_id: 'b', extract_result: results }) })
      const snapshot = await provider().inspect(batchRef('b', twoFiles), context())
      expect(snapshot.state).toBe(batchState)
      expect(snapshot.files.map(file => file.state)).toEqual(fileStates)
    })

    it('maps page progress and redacted per-file failures with the trace id', async () => {
      stubFetch({
        [status('b')]: ok({ batch_id: 'b', extract_result: [
          item('data_1', 'running', { extract_progress: { extracted_pages: 3, total_pages: 10 } }),
          item('data_2', 'failed', { err_msg: `Encrypted document (${TOKEN})` }),
        ] }, { trace_id: 'tr_status' }),
      })
      const snapshot = await provider().inspect(batchRef('b', twoFiles), context())
      expect(snapshot.files[0]?.progress).toEqual({ completed: 3, total: 10 })
      expect(snapshot.files[1]?.failure).toMatchObject({ code: 'REMOTE_PARSE_FAILED', traceId: 'tr_status', fileId: FILE_2 })
      expect(snapshot.files[1]?.failure?.message).not.toContain(TOKEN)
    })

    it('maps reordered, renamed results strictly by data_id', async () => {
      const sameName: readonly ProviderSubmittedFile[] = [
        { fileId: FILE_1, dataId: 'data_first', name: 'duplicate.pdf' },
        { fileId: FILE_2, dataId: 'data_second', name: 'duplicate.pdf' },
      ]
      stubFetch({
        [status('b')]: ok({ batch_id: 'b', extract_result: [
          { data_id: 'data_second', file_name: 'duplicate.pdf', state: 'failed', err_msg: 'second failed' },
          { data_id: 'data_first', file_name: 'normalized_other_name.pdf', state: 'done' },
        ] }),
      })
      const snapshot = await provider().inspect(batchRef('b', sameName), context())
      expect(snapshot.files.map(file => [file.fileId, file.state])).toEqual([[FILE_1, 'completed'], [FILE_2, 'failed']])
    })

    it.each([
      ['duplicate', [item('data_1', 'done'), item('data_1', 'done')]],
      ['unknown', [item('unexpected', 'done')]],
      ['missing', [{ file_name: 'doc.pdf', state: 'done' }]],
    ])('rejects %s data_id values', async (_label, results) => {
      stubFetch({ [status('b')]: ok({ batch_id: 'b', extract_result: results }) })
      await expect(provider().inspect(batchRef('b'), context())).rejects.toMatchObject({ failure: { code: 'REMOTE_PARSE_FAILED' } })
    })
  })

  describe('collect (unauthenticated CDN ZIP + safe extraction)', () => {
    it('downloads a shared ZIP once without Authorization and fans out per file', async () => {
      const files: readonly ProviderSubmittedFile[] = [
        { fileId: FILE_1, dataId: 'data_1', name: 'doc1.pdf' },
        { fileId: FILE_2, dataId: 'data_2', name: 'doc2.pdf' },
      ]
      const fetches = stubFetch({
        [status('b')]: ok({ batch_id: 'b', extract_result: [done('data_1'), done('data_2')] }),
        [`GET ${CDN_URL}`]: await zipReply(),
      })
      const request = canonicalRequest({
        files: [canonicalFile('doc1.pdf'), canonicalFile('doc2.pdf', SHA256_B, 1)], requiredArtifacts: ['markdown', 'layout'],
      })
      const collection = await provider().collect(batchRef('b', files), request, new RecordingSink(), context())

      const cdn = fetches.callsTo(CDN_URL)
      expect(cdn).toHaveLength(1)
      expect(cdn[0]?.init.headers).toEqual({})
      expect(cdn[0]?.init.redirect).toBe('error')
      expect(collection.files.map(file => [file.fileId, file.failure])).toEqual([[FILE_1, undefined], [FILE_2, undefined]])
    })

    it('refuses to collect a file that is still running', async () => {
      stubFetch({ [status('b')]: ok({ batch_id: 'b', extract_result: [{ data_id: 'data_1', file_name: 'doc1.pdf', state: 'running' }] }) })
      await expect(provider().collect(batchRef('b'), canonicalRequest(), new RecordingSink(), context()))
        .rejects.toMatchObject({ failure: { code: 'RESULT_NOT_READY' } })
    })

    it('refuses a non-HTTPS result URL without downloading it', async () => {
      const fetches = stubFetch({ [status('b')]: ok({ batch_id: 'b', extract_result: [done('data_1', 'http://cdn.example.com/result.zip')] }) })
      await expect(provider().collect(batchRef('b'), canonicalRequest(), new RecordingSink(), context()))
        .rejects.toMatchObject({ failure: { code: 'REMOTE_PARSE_FAILED' } })
      expect(fetches.calls).toHaveLength(1)
    })
  })

  describe('retry policy', () => {
    const recovered = ok({ batch_id: 'b', extract_result: [done()] })

    it.each<[string, string, string, CannedReply, Record<string, unknown>]>([
      ['inspect after HTTP 502', 'inspect', status('b'), json(502, { msg: 'Server maintenance' }), { status: 502 }],
      ['inspect after HTTP 429 with Retry-After', 'inspect', status('b'), json(429, { msg: 'Rate limited' }, { 'retry-after': '2' }), { status: 429, retryAfterMs: 2000, delayMs: 2000 }],
      ['inspect after business code 429', 'inspect', status('b'), json(200, { code: 429, msg: 'Business rate limit' }, { 'retry-after': '3' }), { status: 429, retryAfterMs: 3000, delayMs: 3000 }],
      ['collect after business code 429', 'collect', status('b'), json(200, { code: 429, msg: 'Business rate limit' }, { 'retry-after': '1' }), { status: 429, retryAfterMs: 1000 }],
      ['probe after business code 429', 'probe', status('__dsh_probe__'), json(200, { code: 429, msg: 'Rate limited' }, { 'retry-after': '2' }), { status: 429, delayMs: 2000 }],
    ])('retries %s', async (_label, operation, route, first, event) => {
      const fetches = stubFetch({ [route]: seq(first, recovered), [`GET ${CDN_URL}`]: await zipReply() })
      const log = retryLog({ maxDelayMs: 10_000 })
      const ctx = context({ retry: log.retry })
      const p = provider()
      if (operation === 'probe') expect(await p.probe(ctx)).toMatchObject({ available: true, authentication: 'valid' })
      else if (operation === 'inspect') expect((await p.inspect(batchRef('b'), ctx)).state).toBe('completed')
      else expect((await p.collect(batchRef('b'), canonicalRequest(), new RecordingSink(), ctx)).files[0]?.failure).toBeUndefined()
      expect(fetches.callsTo(route.slice(4))).toHaveLength(2)
      expect(fetches.callsTo(CDN_URL)).toHaveLength(operation === 'collect' ? 1 : 0)
      expect(log.events).toEqual([expect.objectContaining({ provider: 'official-v4', operation, attempt: 1, reason: 'http-status', ...event })])
    })

    it.each<[string, Readonly<Record<string, FetchRoute>>, (p: OfficialV4Provider, ctx: ProviderCallContext) => Promise<unknown>, Record<string, unknown>, string]>([
      ['the batch-allocation POST after HTTP 500', { [SUBMIT]: json(500, { msg: 'timeout during batch registration' }) },
        async (p, ctx) => { const { source, request } = await submitSource(); return await p.submit(request, [source], ctx) },
        { code: 'PROVIDER_UNAVAILABLE', retryable: true }, SUBMIT],
      ['the batch-allocation POST after business code 429', { [SUBMIT]: json(200, { code: 429, msg: 'Business rate limit' }, { 'retry-after': '5' }) },
        async (p, ctx) => { const { source, request } = await submitSource(); return await p.submit(request, [source], ctx) },
        { code: 'PROVIDER_RATE_LIMITED', retryable: true }, SUBMIT],
      ['an inspect business auth failure', { [status('b')]: json(200, { code: 'A0202', msg: 'Token expired' }) },
        async (p, ctx) => await p.inspect(batchRef('b'), ctx),
        { code: 'AUTHENTICATION_FAILED', retryable: false }, status('b')],
      ['a CDN 404', { [status('b')]: recovered, [`GET ${CDN_URL}`]: text(404, 'Not found') },
        async (p, ctx) => await p.collect(batchRef('b'), canonicalRequest(), new RecordingSink(), ctx),
        { code: 'RESULT_DOWNLOAD_FAILED', retryable: false }, `GET ${CDN_URL}`],
    ])('never retries %s', async (_label, routes, invoke, failure, counted) => {
      const fetches = stubFetch(routes)
      const log = retryLog({ maxRetries: 3 })
      await expect(invoke(provider(), context({ retry: log.retry }))).rejects.toMatchObject({ failure })
      expect(fetches.callsTo(counted)).toHaveLength(1)
      expect(log.events).toEqual([])
    })

    it('retries the presigned PUT with a fresh source stream and still no headers', async () => {
      const body = '%PDF-1.4 binary content for fresh stream verification'
      const { source, request } = await submitSource('upload.pdf', body)
      const received: string[] = []
      const fetches = stubFetch({
        [SUBMIT]: submitted(),
        [`PUT ${PUT_URL}`]: async call => {
          received.push(await bodyText(call.init.body))
          return received.length === 1 ? text(503, 'OSS internal error') : text(200)
        },
      })
      const log = retryLog({ maxRetries: 3 })
      const submission = await provider().submit(request, [source], context({ retry: log.retry }))
      expect(submission.state).toBe('processing')
      expect(fetches.callsTo(SUBMIT)).toHaveLength(1)
      expect(received).toEqual([body, body])
      expect(fetches.callsTo(PUT_URL).map(call => call.init.headers)).toEqual([{}, {}])
      expect(log.events).toEqual([expect.objectContaining({ operation: 'presigned-put', attempt: 1, status: 503 })])
    })

    it('closes the active PUT stream and does not retry when the caller aborts', async () => {
      const { source, request } = await submitSource('abort.pdf', '%PDF-1.4 ' + 'x'.repeat(2 * 1024 * 1024))
      const controller = new AbortController()
      let bodyClosed = false
      const fetches = stubFetch({
        [SUBMIT]: submitted(),
        [`PUT ${PUT_URL}`]: async call => {
          const reader = (call.init.body as ReadableStream<Uint8Array>).getReader()
          expect((await reader.read()).done).toBe(false)
          controller.abort(new DOMException('Caller stopped upload', 'AbortError'))
          await reader.read().catch(() => { bodyClosed = true })
          throw new DOMException('Caller stopped upload', 'AbortError')
        },
      })
      const log = retryLog({ maxRetries: 3 })
      await expect(provider().submit(request, [source], context({ signal: controller.signal, retry: log.retry })))
        .rejects.toMatchObject({ failure: { code: 'CANCELLED' } })
      expect(fetches.callsTo(PUT_URL)).toHaveLength(1)
      expect(bodyClosed).toBe(true)
      expect(log.events).toEqual([])
    })

    it('retries an unauthenticated CDN download after a transient 503', async () => {
      const fetches = stubFetch({
        [status('b')]: ok({ batch_id: 'b', extract_result: [done()] }),
        [`GET ${CDN_URL}`]: seq(text(503, 'CDN glitch', { 'retry-after': '1' }), await zipReply()),
      })
      const log = retryLog()
      const collection = await provider().collect(batchRef('b'), canonicalRequest(), new RecordingSink(), context({ retry: log.retry }))
      expect(collection.files[0]?.artifacts).toHaveLength(1)
      expect(fetches.callsTo(CDN_URL).map(call => call.headers.authorization)).toEqual([undefined, undefined])
      expect(log.events).toEqual([expect.objectContaining({ operation: 'cdn-download', status: 503, retryAfterMs: 1000 })])
    })

    it('cancels the CDN body and does not retry when collection is aborted while staging', async () => {
      const controller = new AbortController()
      let bodyCancelled = false
      const fetches = stubFetch({
        [status('b')]: ok({ batch_id: 'b', extract_result: [done()] }),
        [`GET ${CDN_URL}`]: () => new Response(new ReadableStream<Uint8Array>({
          start(stream) { stream.enqueue(new Uint8Array([1, 2, 3])) },
          cancel() { bodyCancelled = true },
        })),
      })
      const sink = new RecordingSink()
      let staged: unknown
      sink.writeTemporary = async (_name, input) => {
        staged = input
        controller.abort(new DOMException('Caller stopped download', 'AbortError'))
        throw new DOMException('Caller stopped download', 'AbortError')
      }
      const log = retryLog({ maxRetries: 3 })
      await expect(provider().collect(batchRef('b'), canonicalRequest(), sink, context({ signal: controller.signal, retry: log.retry })))
        .rejects.toMatchObject({ failure: { code: 'CANCELLED' } })
      expect(staged).toBeInstanceOf(Readable)
      await vi.waitFor(() => expect(bodyCancelled).toBe(true))
      expect((staged as Readable).destroyed).toBe(true)
      expect(fetches.callsTo(CDN_URL)).toHaveLength(1)
      expect(log.events).toEqual([])
    })

    it('emits retry diagnostics without credentials, URLs, bodies or source paths', async () => {
      stubFetch({
        [status('b')]: seq(
          json(500, { msg: 'Error with token Bearer secret-token-12345 and url https://api.example.com/secret?token=abc' }),
          ok({ batch_id: 'b', extract_result: [done()] }),
        ),
      })
      const log = retryLog()
      await provider().inspect(batchRef('b'), context({ credential: 'super-secret-api-token', retry: log.retry }))
      expect(log.events).toEqual([{
        provider: 'official-v4', operation: 'inspect', attempt: 1, maxRetries: 2, delayMs: 1, reason: 'http-status', status: 500,
      }])
      const serialized = JSON.stringify(log.events)
      for (const secret of ['secret-token-12345', 'super-secret-api-token', 'token=abc', 'api.example.com', 'mineru.net']) {
        expect(serialized).not.toContain(secret)
      }
    })
  })
})
