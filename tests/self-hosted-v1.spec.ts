import { describe, it, expect } from 'vitest'
import type { ServerResponse } from 'node:http'
import { asProviderConfigId, createFileId } from '../src/domain/ids.js'
import { MinerUError } from '../src/domain/errors.js'
import type { CanonicalParseRequest, ParseMethod, PreparedSourceFile } from '../src/domain/request.js'
import type { ProviderJobRef, ProviderSubmittedFile } from '../src/providers/contract.js'
import type { SelfHostedTier, SelfHostedV1Config } from '../src/config/model.js'
import { computeCacheKey } from '../src/domain/cache-key.js'
import { SelfHostedLegacyV2Provider } from '../src/providers/self-hosted-legacy-v2/index.js'
import {
  isSelfHostedV1Health, mapSelfHostedV1FileState, mapSelfHostedV1JobState, SelfHostedV1Provider,
} from '../src/providers/self-hosted-v1/index.js'
import { canonicalizeLayoutDocument, canonicalizeStructuredContent } from '../src/providers/self-hosted-v1/canonical-artifacts.js'
import { isInsecureCrossOriginUpload, isSameOriginUrl, mimeTypeForName } from '../src/providers/self-hosted-v1/upload.js'
import { testPng } from './fixtures/png.js'
import { deferred, fakeUpstream, type Deferred, type FakeUpstream, type RecordedRequest } from './support/http-fake.js'
import {
  RecordingSink, SHA256_A, SHA256_B, callContext, canonicalFile, canonicalRequest, preparedSource, retryLog, zip,
  type CallContextOptions,
} from './support/provider-context.js'

const ALL_ARTIFACTS = ['markdown', 'layout', 'model-output', 'content-list', 'images'] as const
/** Upstream version the mock and fixtures follow. */
const SERVER_VERSION = '4.0.12'
const serverError = { error: { type: 'api_error', code: 'internal_error', message: 'boom', param: null } }

/** A V1 error envelope `{ error: { type, code, message, param } }` with its HTTP status. */
interface ScriptedV1Error { readonly status: number; readonly error: Readonly<Record<string, unknown>> }
const v1Error = (status: number, type: string, code: string, message: string, param: string | null = null): ScriptedV1Error =>
  ({ status, error: { type, code, message, param } })
/** A fatal engine error latches; health and submissions then answer 503 `engine_dead` until restart. */
const ENGINE_DEAD = v1Error(503, 'engine_error', 'engine_dead', 'CUDA error: an illegal memory access was encountered')

/** Scripted MinerU 4.x V1 deployment on top of the loopback fake; tests flip knobs between calls. */
class V1Mock {
  legacyOnly = false
  legacyHealth = false
  v1HealthBody: unknown
  tiersStatus = 200
  uploadCreateFailures = 0
  completeFailures = 0
  parseJobFailures = 0
  uploadDeduplicated = false
  uploadUrlHost: string | undefined
  uploadHeaders: Record<string, string> | undefined
  uploadPutFailures = 0
  uploadPutErrorBody: string | undefined
  /** Hold the byte upload open and resolve this gate once it arrived. */
  uploadPutArrived: Deferred | undefined
  archive: Buffer | undefined
  archiveStatus = 200
  archiveFailures = 0
  /** Send headers and half the archive, then break the connection. */
  archiveBreaks = 0
  /** Send headers and half the archive, keep the body open and resolve this gate. */
  archiveStalled: Deferred | undefined
  completeStatus = 'completed'
  jobStatus = 'queued'
  jobFiles: readonly Record<string, unknown>[] | undefined
  /** Persistent V1 error answers keyed by `METHOD /path`, checked before any other route. */
  errors: Partial<Record<string, ScriptedV1Error>> = {}
  #upstream!: FakeUpstream

  static async start(configure: (mock: V1Mock) => void = () => {}): Promise<V1Mock> {
    const mock = new V1Mock()
    configure(mock)
    mock.#upstream = await fakeUpstream({ '*': (request, res) => mock.#route(request, res) })
    return mock
  }

  get url(): string { return this.#upstream.url }
  get requests(): readonly RecordedRequest[] { return this.#upstream.requests }
  requestsFor(path: string): readonly RecordedRequest[] { return this.#upstream.requestsFor(path) }
  downloads(): readonly RecordedRequest[] { return this.requests.filter(request => request.url.startsWith('/v1/files/')) }
  jobBody(): Record<string, unknown> { return JSON.parse(this.requestsFor('/v1/parse/jobs')[0]!.body.toString('utf8')) as Record<string, unknown> }

  #json(res: ServerResponse, status: number, payload: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload))
  }

  #jobPayload(): Record<string, unknown> {
    const status = this.jobStatus
    return {
      job_id: 'job_1', status, created_at: '2026-10-02T00:00:00Z', tier: 'standard', output_formats: ['zip'],
      progress: { completed: status === 'completed' ? 1 : 0, failed: 0, total: 1 },
      files: this.jobFiles ?? [{
        file_id: 'file_up_1', name: 'doc.pdf', page_range: '', status, error: null,
        output_files: status === 'completed' ? { zip: { file_id: 'file_out_1', bytes: this.archive?.byteLength ?? 0 } } : null,
      }],
    }
  }

  #upload(status: string, file: Record<string, unknown> | null, pending: boolean): Record<string, unknown> {
    const host = this.uploadUrlHost ?? new URL(this.url).host
    return {
      id: 'upload_1', object: 'upload', bytes: 100, filename: 'doc.pdf', purpose: 'parse', mime_type: 'application/pdf', status, file,
      ...(pending ? {
        upload_url: `http://${host}/v1/uploads/upload_1/content`, upload_method: 'PUT',
        upload_headers: this.uploadHeaders ?? { 'Content-Type': 'application/pdf' },
      } : { upload_url: null, upload_method: null, upload_headers: null }),
    }
  }

  #route({ method, url }: RecordedRequest, res: ServerResponse): void {
    const key = `${method} ${url}`
    const scripted = this.errors[key]
    if (scripted !== undefined) return this.#json(res, scripted.status, { error: scripted.error })
    if (key === 'GET /v1/health') {
      if (this.legacyOnly) return this.#json(res, 404, { detail: 'Not Found' })
      return this.#json(res, 200, this.v1HealthBody ?? {
        status: 'ok', version: SERVER_VERSION,
        features: { webhook: false, output_formats: ['markdown', 'middle_json', 'structured_content', 'zip'], sources: ['file_id', 'url', 'inline'] },
      })
    }
    if (key === 'GET /health') {
      if (!this.legacyOnly && !this.legacyHealth) return this.#json(res, 404, { detail: 'Not Found' })
      return this.#json(res, 200, { status: 'healthy', version: '3.4.4', protocol_version: 2 })
    }
    if (key === 'GET /v1/tiers') {
      if (this.tiersStatus !== 200) return this.#json(res, this.tiersStatus, { error: { type: 'authentication_error', code: 'invalid_api_key', message: 'Invalid or missing API key', param: null } })
      // Every tier names the versioned virtual model; quality is selected by tier, not model.
      return this.#json(res, 200, { object: 'list', data: ['flash', 'standard', 'advanced'].map(id => ({ id, description: `${id} parsing`, current_model: `mineru-${SERVER_VERSION}` })) })
    }
    if (key === 'POST /v1/uploads') {
      if (this.uploadCreateFailures > 0 && this.uploadCreateFailures--) return this.#json(res, 500, serverError)
      return this.#json(res, 200, this.uploadDeduplicated
        ? this.#upload('completed', { id: 'file_dedup', object: 'file', bytes: 100, filename: 'doc.pdf', purpose: 'parse' }, false)
        : { ...this.#upload('pending', null, true), sha256sum: SHA256_A })
    }
    if (key === 'PUT /v1/uploads/upload_1/content') {
      if (this.uploadPutFailures > 0 && this.uploadPutFailures--) {
        if (this.uploadPutErrorBody === undefined) return this.#json(res, 500, serverError)
        res.writeHead(500, { 'content-type': 'application/json' })
        return void res.end(this.uploadPutErrorBody)
      }
      if (this.uploadPutArrived !== undefined) return this.uploadPutArrived.resolve()
      res.writeHead(200)
      return void res.end()
    }
    if (key === 'POST /v1/uploads/upload_1/complete') {
      if (this.completeFailures > 0 && this.completeFailures--) return this.#json(res, 500, serverError)
      const done = this.completeStatus === 'completed'
      return this.#json(res, 200, this.#upload(this.completeStatus,
        done ? { id: 'file_up_1', object: 'file', bytes: 100, filename: 'doc.pdf', purpose: 'parse' } : null, false))
    }
    if (key === 'POST /v1/parse/jobs') {
      if (this.parseJobFailures > 0 && this.parseJobFailures--) return this.#json(res, 500, serverError)
      return this.#json(res, 202, this.#jobPayload())
    }
    if (key === 'GET /v1/parse/jobs/job_1') return this.#json(res, 200, this.#jobPayload())
    if (method === 'GET' && url.startsWith('/v1/files/') && url.endsWith('/content')) {
      if (this.archiveFailures > 0 && this.archiveFailures--) return this.#json(res, 500, serverError)
      if (this.archiveStatus !== 200 || this.archive === undefined) {
        return this.#json(res, this.archiveStatus, { error: { type: 'invalid_request_error', code: 'file_not_found', message: 'File file_out_1 not found', param: null } })
      }
      const half = this.archive.subarray(0, Math.max(1, Math.floor(this.archive.byteLength / 2)))
      const partial = (): void => { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(this.archive!.byteLength) }) }
      if (this.archiveBreaks > 0 && this.archiveBreaks--) {
        partial()
        return void res.write(half, () => res.destroy())
      }
      if (this.archiveStalled !== undefined) {
        const stalled = this.archiveStalled
        partial()
        return void res.write(half, () => stalled.resolve())
      }
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      return void res.end(this.archive)
    }
    this.#json(res, 404, { detail: 'Not Found' })
  }
}

/** A MinerU 4.0.12 result archive: Middle JSON 2.0 and structured content with visual-annotation anchors. */
const v1Archive = (): Promise<Buffer> => zip({
  'markdown.md': '<a id="title"></a>\n# Title\n\n![](images/page_0_image_1.png)\n\n<a id="fig-1"></a>\nFigure 1: demo\n',
  'middle_json.json': JSON.stringify({
    schema: 'docvortex.middle', schema_version: '2.0',
    metadata: { file_suffix: 'pdf', producer: { name: 'mineru', version: SERVER_VERSION } },
    extensions: { mineru: { tier: 'standard', parse_mode: 'auto' } },
    pages: [{ page_idx: 0, blocks: [] }, { page_idx: 1, blocks: [] }],
    is_full_document: true,
  }),
  'structured_content.json': JSON.stringify({
    pages: [{
      page_idx: 0,
      blocks: [
        { type: 'doc_title', bbox: [0, 0, 1, 1], level: 1, anchor: 'title', content: 'Title' },
        { type: 'text', bbox: [0, 0, 1, 1], content: 'Body' },
        {
          type: 'image', bbox: [0, 0, 1, 1], content: '',
          captions: [{ bbox: [0, 0, 1, 1], anchor: 'fig-1', content: 'Figure 1: demo' }], footnotes: [],
          image_source: 'images/page_0_image_1.png',
        },
      ],
    }],
    metadata: { file_suffix: 'pdf', producer: { name: 'mineru', version: SERVER_VERSION } },
    is_full_document: true,
  }),
  'model_output.json': JSON.stringify({ pages: [{ page_idx: 0, blocks: [] }] }),
  'images/page_0_image_1.png': testPng(8, 8),
})

function v1(config: Partial<SelfHostedV1Config> & { baseURL: string }): SelfHostedV1Provider {
  return new SelfHostedV1Provider({
    id: asProviderConfigId('mp_self_hosted'), type: 'self-hosted-v1', ocrMode: 'auto', tier: 'standard', allowInsecureHttp: true, ...config,
  })
}

function v1Request(file: PreparedSourceFile, semantics: Partial<CanonicalParseRequest['semantics']> = {}): CanonicalParseRequest {
  return canonicalRequest({
    files: [file], requiredArtifacts: ALL_ARTIFACTS,
    semantics: { model: 'pipeline', ocr: false, parseMethod: 'auto', language: 'auto', formula: false, table: false, ...semantics },
  })
}

/** Starts a V1 mock, a provider for it and a fresh source; submit() runs one full submission. */
async function v1Submission(configure?: (mock: V1Mock) => void, config: Partial<SelfHostedV1Config> = {}) {
  const mock = await V1Mock.start(configure)
  const provider = v1({ baseURL: mock.url, ...config })
  const file = await preparedSource('doc.pdf', '%PDF-1.4 report content')
  const submit = (context: CallContextOptions = {}, semantics: Partial<CanonicalParseRequest['semantics']> = {}) =>
    provider.submit(v1Request(file, semantics), [file], callContext(context))
  return { mock, provider, file, submit }
}

const ONE_FILE: readonly ProviderSubmittedFile[] = [{ dataId: 'd1', fileId: createFileId(SHA256_A), name: 'doc.pdf' }]
const jobRef = (files = ONE_FILE): ProviderJobRef => ({ provider: 'self-hosted-v1', taskId: 'job_1', files })
const fileEntry = (status: string, extra: Record<string, unknown> = {}) =>
  ({ file_id: 'file_up_1', name: 'doc.pdf', page_range: '', status, output_files: null, error: null, ...extra })
const TWO_FILES: readonly ProviderSubmittedFile[] = [...ONE_FILE, { dataId: 'd2', fileId: createFileId(SHA256_B), name: 'doc2.pdf' }]
/** A job failed by a latched engine keeps files completed before the failure. */
const engineDeadFiles = (archiveBytes = 1) => [
  fileEntry('completed', { output_files: { zip: { file_id: 'file_out_1', bytes: archiveBytes } } }),
  fileEntry('failed', { file_id: 'file_up_2', name: 'doc2.pdf', error: { type: 'engine_error', code: 'engine_dead', message: ENGINE_DEAD.error.message } }),
]

describe('SelfHostedV1Provider — MinerU 4.x V1 API', () => {
  describe('compatibility and cache isolation', () => {
    const request = canonicalRequest({ files: [canonicalFile('doc.pdf')] })
    const key = (config: Partial<SelfHostedV1Config>) => v1({ baseURL: 'https://secret-internal-host:8000/api/', tier: undefined, ...config }).compatibilityKey(request)

    it('keys only endpoint, configured version and tier, never secrets', () => {
      const base = key({})
      expect(base).toMatch(/^self-hosted-v1:[a-f0-9]{24}$/)
      expect(base).not.toContain('secret-internal-host')
      expect(key({ baseURL: 'https://secret-internal-host:8000/api', id: asProviderConfigId('mp_other'), apiKeyEnv: 'OTHER_SECRET', configuredVersion: 'v1' })).toBe(base)
      for (const changed of [{ configuredVersion: '4.1' }, { baseURL: 'https://secret-internal-host:8000/other' }, { baseURL: 'https://other-host:8000/api' }]) {
        expect(key(changed)).not.toBe(base)
      }
    })

    it('isolates cached results by explicit tier, including the server default', () => {
      const tiers = [undefined, 'flash', 'basic', 'standard', 'advanced'] as const
      const cacheKeys = tiers.map(tier => computeCacheKey(request, request.files[0]!, key({ tier })))
      expect(new Set(cacheKeys).size).toBe(tiers.length)
    })

    it('never shares cache identity with legacy on the same endpoint and version', () => {
      const baseURL = 'https://mineru.example.com'
      const v1Key = v1({ baseURL, configuredVersion: 'same', tier: undefined }).compatibilityKey(request)
      const legacyKey = new SelfHostedLegacyV2Provider({
        id: asProviderConfigId('mp_legacy'), type: 'self-hosted-legacy-v2', baseURL, configuredVersion: 'same', modelMap: { pipeline: 'pipeline' },
      }).compatibilityKey(request)
      expect(v1Key).not.toBe(legacyKey)
      expect(computeCacheKey(request, request.files[0]!, v1Key)).not.toBe(computeCacheKey(request, request.files[0]!, legacyKey))
    })
  })

  describe('protocol helpers', () => {
    it.each([
      ['doc.pdf', 'application/pdf'], ['SCAN.PNG', 'image/png'],
      ['report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['unknown.bin', 'application/octet-stream'], ['noext', 'application/octet-stream'],
    ])('maps %s to upload MIME type %s', (name, mime) => {
      expect(mimeTypeForName(name)).toBe(mime)
    })

    it.each([['queued', 'queued'], ['running', 'processing'], ['partial', 'partially-completed'], ['canceled', 'failed']])(
      'maps job status %s to %s', (raw, state) => { expect(mapSelfHostedV1JobState(raw)).toBe(state) })

    it('maps file statuses and rejects unknown or missing statuses', () => {
      expect(mapSelfHostedV1FileState('completed')).toBe('completed')
      expect(mapSelfHostedV1FileState('canceled')).toBe('failed')
      expect(() => mapSelfHostedV1JobState('mystery')).toThrow(MinerUError)
      expect(() => mapSelfHostedV1FileState(undefined)).toThrow(MinerUError)
    })

    it.each([
      [{ status: 'ok', version: SERVER_VERSION, features: {} }, true],
      [{ version: SERVER_VERSION }, true],
      [{ status: 'unhealthy', version: SERVER_VERSION }, true],
      [{ status: 'healthy', version: '3.4.4', protocol_version: 2 }, false],
      [{ status: 'ok', version: '3.4.4', queued_tasks: 0 }, false],
      [{ detail: 'Not Found' }, false],
      [{ status: 'ok' }, false],
      [[], false],
      [null, false],
    ])('recognizes V1 health document %j as %s', (body, expected) => {
      expect(isSelfHostedV1Health(body)).toBe(expected)
    })

    it.each([
      ['https://mineru.example.com:8443/v1/uploads/x/content', 'https://mineru.example.com:8443/', true, false],
      ['https://mineru.example.com/v1/uploads/x/content', 'https://mineru.example.com:8443/', false, false],
      ['https://other.example.com/v1/uploads/x/content', 'https://mineru.example.com:8443/', false, false],
      ['http://other.example.com/upload', 'https://mineru.example.com:8443/', false, true],
      // A scheme downgrade is cross-origin too, so the upload is refused instead of sent in cleartext.
      ['http://mineru.example.com:8443/upload', 'https://mineru.example.com:8443/', false, true],
      ['http://other.host:9000/upload', 'http://127.0.0.1:7800', false, false],
      ['http://127.0.0.1:7800/v1/uploads/x/content', 'http://127.0.0.1:7800', true, false],
    ])('classifies upload target %s against %s (same-origin=%s, insecure=%s)', (target, base, sameOrigin, insecure) => {
      expect(isSameOriginUrl(new URL(target), new URL(base))).toBe(sameOrigin)
      expect(isInsecureCrossOriginUpload(new URL(target), new URL(base))).toBe(insecure)
    })

    it('flattens structured content into canonical content-list entries', () => {
      const canonical = canonicalizeStructuredContent({
        pages: [
          { page_idx: 0, blocks: [{ type: 'doc_title', level: 1, anchor: 'title', content: 'Title' }] },
          { page_idx: 1, blocks: [{ type: 'paragraph_title', level: 2, content: 'Section' }, { type: 'text', content: 'Body' }] },
          { page_idx: 2, blocks: [
            // Visual annotations are plain strings or `{ bbox, anchor?, content }` objects.
            { type: 'image', content: 'ocr', image_source: 'images/a.png', captions: ['Figure 1: demo'], footnotes: [{ bbox: [0, 0, 1, 1], content: 'note text' }, { bbox: [0, 0, 1, 1] }] },
            { type: 'table', content: '<table></table>', image_source: 'images/t.png', captions: [{ bbox: [0, 0, 1, 1], anchor: 'tab-1', content: 'Table 1: demo' }], footnotes: [] },
          ] },
        ],
      })
      expect(canonical).toEqual([
        expect.objectContaining({ type: 'title', text_level: 1, content: 'Title', page_idx: 0, anchor: 'title' }),
        expect.objectContaining({ type: 'title', text_level: 2, page_idx: 1 }),
        expect.objectContaining({ type: 'text', content: 'Body', page_idx: 1 }),
        expect.objectContaining({ img_path: 'images/a.png', image_caption: ['Figure 1: demo'], image_footnote: ['note text'], page_idx: 2 }),
        expect.objectContaining({ img_path: 'images/t.png', table_caption: ['Table 1: demo'], page_idx: 2 }),
      ])
      for (const entry of canonical as Record<string, unknown>[]) {
        for (const v1Field of ['level', 'image_source', 'captions', 'footnotes']) expect(entry).not.toHaveProperty(v1Field)
      }
    })

    it('aliases V1 layout pages onto pdf_info and leaves canonical or unrelated documents untouched', () => {
      expect(canonicalizeLayoutDocument({ metadata: {}, pages: [{ page_idx: 0 }, { page_idx: 1 }] })?.pdf_info).toEqual([{ page_idx: 0 }, { page_idx: 1 }])
      expect(canonicalizeLayoutDocument({ pdf_info: [{ page_idx: 0 }] })).toBeUndefined()
      expect(canonicalizeLayoutDocument({ metadata: {} })).toBeUndefined()
      for (const document of [[{ type: 'text', text: 'x' }], { pdf_info: [] }, null]) expect(canonicalizeStructuredContent(document)).toBeUndefined()
    })
  })

  describe('explicit V1 probe without protocol fallback', () => {
    it('probes V1 health then tiers and reports version, credential and deployment capabilities', async () => {
      const mock = await V1Mock.start()
      const result = await v1({ baseURL: mock.url, apiKeyEnv: 'MINERU_API_KEY' }).probe(callContext({ credential: 'sk-secret' }))
      expect(result).toMatchObject({
        available: true, provider: 'self-hosted-v1', authentication: 'valid', protocolVersion: 'v1', serverVersion: SERVER_VERSION,
        availableTiers: ['flash', 'standard', 'advanced'],
        outputFormats: ['markdown', 'middle_json', 'structured_content', 'zip'], sourceTypes: ['file_id', 'url', 'inline'],
      })
      expect(mock.requests.map(request => request.url)).toEqual(['/v1/health', '/v1/tiers'])
      expect(mock.requestsFor('/v1/tiers')[0]?.headers.authorization).toBe('Bearer sk-secret')
    })

    it('reports an invalid credential when the tiers endpoint rejects it', async () => {
      const mock = await V1Mock.start(m => { m.tiersStatus = 401 })
      expect(await v1({ baseURL: mock.url }).probe(callContext({ credential: 'bad-key' }))).toMatchObject({
        available: false, authentication: 'invalid', protocolVersion: 'v1',
        diagnostics: 'Authentication failed (401): invalid_api_key: Invalid or missing API key',
      })
    })

    it.each<[string, ScriptedV1Error]>([
      ['a latched engine failure', ENGINE_DEAD],
      ['a failed model preload', v1Error(503, 'engine_error', 'model_preload_device_unavailable', 'CUDA is not available.')],
      ['a Router without healthy workers', v1Error(503, 'api_error', 'upstream_unavailable', 'No healthy MinerU V1 upstream is available')],
    ])('reports %s with its upstream error code', async (_label, health) => {
      const mock = await V1Mock.start(m => { m.errors['GET /v1/health'] = health })
      expect(await v1({ baseURL: mock.url }).probe(callContext({ credential: 'sk-secret' }))).toMatchObject({
        available: false, provider: 'self-hosted-v1', authentication: 'unknown', protocolVersion: 'v1',
        diagnostics: `MinerU server error (503): ${String(health.error.code)}: ${String(health.error.message)}`,
      })
      expect(mock.requestsFor('/v1/tiers')).toHaveLength(0)
    })

    it.each<[string, (mock: V1Mock) => void]>([
      ['an unhealthy V1 server', m => { m.v1HealthBody = { status: 'unhealthy', version: SERVER_VERSION, features: { output_formats: ['zip'], sources: ['file_id'] } }; m.legacyHealth = true }],
      ['a missing V1 health route', m => { m.legacyOnly = true }],
      ['an invalid V1 health document', m => { m.v1HealthBody = { detail: 'Not Found' }; m.legacyHealth = true }],
    ])('reports %s unavailable without trying the legacy protocol', async (_label, configure) => {
      const mock = await V1Mock.start(configure)
      expect(await v1({ baseURL: mock.url }).probe(callContext({ credential: 'sk-secret' })))
        .toMatchObject({ available: false, provider: 'self-hosted-v1', protocolVersion: 'v1' })
      expect(mock.requestsFor('/health')).toHaveLength(0)
    })
  })

  describe('submit', () => {
    it('declares only the V1 option surface', () => {
      expect(v1({ baseURL: 'https://mineru.example.com' }).capabilities).toMatchObject({
        models: ['pipeline'], parseMethods: ['auto', 'txt', 'ocr'], supportsOcr: true,
        supportsLanguage: false, supportsFormula: false, supportsTable: false,
      })
    })

    it('discovers, uploads bytes, completes the upload and submits one parse job', async () => {
      const { mock, file, submit } = await v1Submission()
      const submission = await submit({ credential: 'sk-secret' })

      expect(submission).toMatchObject({ ref: { provider: 'self-hosted-v1', taskId: 'job_1' }, state: 'queued', files: [{ state: 'queued' }] })
      expect(mock.requests.map(request => `${request.method} ${request.url}`)).toEqual([
        'GET /v1/health', 'GET /v1/tiers', 'POST /v1/uploads', 'PUT /v1/uploads/upload_1/content', 'POST /v1/uploads/upload_1/complete', 'POST /v1/parse/jobs',
      ])
      expect(mock.requests.every(request => request.headers.authorization === 'Bearer sk-secret')).toBe(true)
      expect(JSON.parse(mock.requestsFor('/v1/uploads')[0]!.body.toString('utf8'))).toEqual({
        filename: 'doc.pdf', bytes: file.bytes, mime_type: 'application/pdf', purpose: 'parse', sha256sum: file.sha256,
      })
      const upload = mock.requestsFor('/v1/uploads/upload_1/content')[0]!
      expect(upload.headers['content-type']).toBe('application/pdf')
      // A Blob body carries Content-Length, which presigned and size-checking targets require.
      expect(Number(upload.headers['content-length'])).toBe(file.bytes)
      expect(upload.headers['transfer-encoding']).toBeUndefined()
      expect(upload.body.toString('utf8')).toBe('%PDF-1.4 report content')
      expect(mock.jobBody()).toEqual({ files: [{ source: { type: 'file_id', file_id: 'file_up_1' } }], tier: 'standard', ocr_mode: 'auto', output_formats: ['zip'] })
    })

    it.each<[ParseMethod, ParseMethod]>([['auto', 'ocr'], ['txt', 'ocr'], ['ocr', 'txt']])(
      'sends the canonical %s OCR mode (profile default %s) without legacy fields or fallback', async (parseMethod, profileMode) => {
        const { mock, submit } = await v1Submission(undefined, { ocrMode: profileMode, tier: undefined })
        await submit({}, { parseMethod, ocr: parseMethod === 'ocr' })
        expect(mock.jobBody()).toEqual({ files: [{ source: { type: 'file_id', file_id: 'file_up_1' } }], ocr_mode: parseMethod, output_formats: ['zip'] })
        expect(mock.requestsFor('/health')).toHaveLength(0)
        expect(mock.requestsFor('/tasks')).toHaveLength(0)
      })

    it.each<[SelfHostedTier | undefined, string | undefined, Record<string, unknown>]>([
      ['advanced', undefined, { tier: 'advanced' }],
      [undefined, '2-4,7', { files: [{ source: { type: 'file_id', file_id: 'file_up_1' }, page_range: '2-4,7' }] }],
    ])('submits the configured tier %s and page range %s', async (tier, pages, expected) => {
      const { mock, provider, file, submit } = await v1Submission(undefined, { tier })
      await submit({}, pages === undefined ? {} : { pages })
      expect(mock.jobBody()).toMatchObject(expected)
      if (tier === undefined) expect(mock.jobBody()).not.toHaveProperty('tier')
      // The tier sent upstream is the one the compatibility key records.
      expect(provider.compatibilityKey(v1Request(file))).toBe(v1({ baseURL: mock.url, tier }).compatibilityKey(v1Request(file)))
    })

    it.each([
      ['ZIP output', { output_formats: ['markdown'], sources: ['file_id'] }],
      ['file_id sources', { output_formats: ['zip'], sources: ['url', 'inline'] }],
    ])('rejects a deployment without %s before uploading', async (_label, features) => {
      const { mock, submit } = await v1Submission(m => { m.v1HealthBody = { status: 'ok', version: SERVER_VERSION, features } })
      await expect(submit()).rejects.toMatchObject({ failure: { code: 'UNSUPPORTED_OPTION' } })
      expect(mock.requests.every(request => request.method === 'GET')).toBe(true)
    })

    it('rejects an unavailable tier and reports the deployment list without uploading', async () => {
      const { mock, provider, submit } = await v1Submission(undefined, { tier: 'basic' })
      expect(await provider.probe(callContext())).toMatchObject({ available: false, availableTiers: ['flash', 'standard', 'advanced'] })
      await expect(submit()).rejects.toMatchObject({ failure: { code: 'UNSUPPORTED_OPTION' } })
      expect(mock.requestsFor('/v1/uploads')).toHaveLength(0)
    })

    it('stops before uploading when the engine has died', async () => {
      const { mock, submit } = await v1Submission(m => { m.errors['GET /v1/health'] = ENGINE_DEAD })
      await expect(submit({ credential: 'sk-secret' })).rejects.toMatchObject({
        failure: { code: 'PROVIDER_UNAVAILABLE', provider: 'self-hosted-v1', providerCode: 'engine_dead', message: expect.stringContaining('engine_dead: CUDA error') },
      })
      expect(mock.requests.every(request => request.url === '/v1/health')).toBe(true)
    })

    it('fails closed when V1 discovery is unavailable instead of falling back', async () => {
      const { mock, submit } = await v1Submission(m => { m.legacyOnly = true })
      await expect(submit()).rejects.toBeInstanceOf(MinerUError)
      expect(mock.requests.map(request => request.url)).toEqual(['/v1/health'])
    })

    it('skips the byte transfer for a deduplicated upload', async () => {
      const { mock, submit } = await v1Submission(m => { m.uploadDeduplicated = true })
      await submit()
      expect(mock.requestsFor('/v1/uploads/upload_1/content')).toHaveLength(0)
      expect(mock.requestsFor('/v1/uploads/upload_1/complete')).toHaveLength(0)
      expect(mock.jobBody().files).toEqual([{ source: { type: 'file_id', file_id: 'file_dedup' } }])
    })

    it('never forwards the API key to a cross-origin upload URL', async () => {
      const { mock, submit } = await v1Submission()
      mock.uploadUrlHost = `localhost:${new URL(mock.url).port}`
      await submit({ credential: 'sk-secret' })
      const upload = mock.requestsFor('/v1/uploads/upload_1/content')[0]!
      expect(upload.headers.authorization).toBeUndefined()
      expect(upload.headers['content-type']).toBe('application/pdf')
    })

    it('lets a service-provided Authorization header win over the API key', async () => {
      const { mock, submit } = await v1Submission(m => { m.uploadHeaders = { Authorization: 'Bearer SERVICE-TOKEN', 'Content-Type': 'application/pdf' } })
      await submit({ credential: 'sk-secret' })
      expect(mock.requestsFor('/v1/uploads/upload_1/content')[0]?.headers.authorization).toBe('Bearer SERVICE-TOKEN')
    })

    it('rejects upload headers that would inject a header line', async () => {
      const { mock, submit } = await v1Submission(m => { m.uploadHeaders = { 'Content-Type': 'application/pdf\r\nX-Injected: 1' } })
      await expect(submit()).rejects.toMatchObject({ failure: { code: 'UPLOAD_FAILED' } })
      expect(mock.requestsFor('/v1/uploads/upload_1/content')).toHaveLength(0)
    })

    it('keeps an unrecognized upload error body as bounded raw text', async () => {
      const { submit } = await v1Submission(m => { m.uploadPutFailures = 5; m.uploadPutErrorBody = '{"Code":"SignatureDoesNotMatch"}' })
      await expect(submit({ retry: { maxRetries: 0 } })).rejects.toMatchObject({
        failure: { code: 'UPLOAD_FAILED', message: 'Upload failed with HTTP status 500: {"Code":"SignatureDoesNotMatch"}' },
      })
    })

    it('redacts the credential from an upload error body', async () => {
      const { submit } = await v1Submission(m => { m.uploadPutFailures = 5; m.uploadPutErrorBody = JSON.stringify({ error: 'invalid key sk-secret' }) })
      const error = await submit({ credential: 'sk-secret' }).then(() => undefined, (reason: unknown) => reason)
      expect(error).toBeInstanceOf(MinerUError)
      expect((error as MinerUError).failure.message).toContain('[REDACTED]')
      expect(JSON.stringify(error)).not.toContain('sk-secret')
    })

    it.each<[string, (mock: V1Mock) => void, string]>([
      ['upload-session', m => { m.uploadCreateFailures = 1 }, 'POST /v1/uploads'],
      ['upload-complete', m => { m.completeFailures = 1 }, 'POST /v1/uploads/upload_1/complete'],
      ['parse-job', m => { m.parseJobFailures = 1 }, 'POST /v1/parse/jobs'],
    ])('never replays the %s POST after a server error', async (_label, configure, post) => {
      const { mock, submit } = await v1Submission(configure)
      const log = retryLog({ maxRetries: 3 })
      await expect(submit({ retry: log.retry })).rejects.toMatchObject({
        failure: { code: 'PROVIDER_UNAVAILABLE', providerCode: 'internal_error', message: 'MinerU server error (500): internal_error: boom' },
      })
      expect(mock.requestsFor(post)).toHaveLength(1)
      expect(mock.requests.at(-1)?.url).toBe(post.slice(post.indexOf(' ') + 1))
      expect(log.events).toEqual([])
    })

    it.each<[string, string, ScriptedV1Error, string, string]>([
      ['an engine that died after discovery', 'POST /v1/parse/jobs', ENGINE_DEAD, 'PROVIDER_UNAVAILABLE',
        'MinerU server error (503): engine_dead: CUDA error: an illegal memory access was encountered'],
      ['a Router without a worker for the tier and formats', 'POST /v1/parse/jobs',
        v1Error(503, 'api_error', 'quality_tier_unavailable', "No healthy upstream supports tier 'standard' and requested formats"), 'PROVIDER_UNAVAILABLE',
        "MinerU server error (503): quality_tier_unavailable: No healthy upstream supports tier 'standard' and requested formats"],
      ['a cached blob of a different size', 'POST /v1/uploads',
        v1Error(400, 'invalid_request_error', 'upload_size_mismatch', 'Declared size does not match the cached file', 'bytes'), 'REMOTE_PARSE_FAILED',
        'MinerU returned unexpected status 400: upload_size_mismatch: Declared size does not match the cached file (param: bytes)'],
      ['an expired upload session', 'POST /v1/uploads/upload_1/complete',
        v1Error(404, 'invalid_request_error', 'upload_not_found', 'Upload upload_1 expired'), 'JOB_NOT_FOUND',
        'Resource not found (404): upload_not_found: Upload upload_1 expired'],
    ])('reports %s from %s with its upstream code and no replay', async (_label, post, answer, code, message) => {
      const { mock, submit } = await v1Submission(m => { m.errors[post] = answer })
      const log = retryLog({ maxRetries: 3 })
      await expect(submit({ retry: log.retry })).rejects.toMatchObject({
        failure: { code, provider: 'self-hosted-v1', providerCode: answer.error.code, message },
      })
      expect(mock.requestsFor(post.slice(post.indexOf(' ') + 1))).toHaveLength(1)
      expect(log.events).toEqual([])
    })

    it('does not retry the byte upload into an expired session', async () => {
      const { mock, submit } = await v1Submission(m => {
        m.errors['PUT /v1/uploads/upload_1/content'] = v1Error(404, 'invalid_request_error', 'upload_not_found', 'Upload upload_1 expired')
      })
      const log = retryLog()
      await expect(submit({ retry: log.retry })).rejects.toMatchObject({
        failure: { code: 'UPLOAD_FAILED', retryable: false, providerCode: 'upload_not_found', message: 'Upload failed with HTTP status 404: upload_not_found: Upload upload_1 expired' },
      })
      expect(mock.requestsFor('/v1/uploads/upload_1/content')).toHaveLength(1)
      expect(mock.requestsFor('/v1/uploads/upload_1/complete')).toHaveLength(0)
      expect(log.events).toEqual([])
    })

    it('retries the idempotent byte upload with a fresh stream', async () => {
      const { mock, submit } = await v1Submission(m => { m.uploadPutFailures = 1 })
      const log = retryLog()
      expect((await submit({ retry: log.retry })).state).toBe('queued')
      expect(mock.requestsFor('/v1/uploads/upload_1/content').map(request => request.body.toString('utf8')))
        .toEqual(['%PDF-1.4 report content', '%PDF-1.4 report content'])
      expect(log.events).toEqual([expect.objectContaining({ provider: 'self-hosted-v1', operation: 'upload-put', status: 500 })])
    })

    it('exhausts the upload retry budget without replaying the session POST', async () => {
      const { mock, submit } = await v1Submission(m => { m.uploadPutFailures = 10 })
      await expect(submit({ retry: { maxRetries: 2 } })).rejects.toMatchObject({ failure: { code: 'UPLOAD_FAILED' } })
      expect(mock.requestsFor('/v1/uploads')).toHaveLength(1)
      expect(mock.requestsFor('/v1/uploads/upload_1/content')).toHaveLength(3)
    })

    it('aborts an in-flight byte upload as CANCELLED', async () => {
      const arrived = deferred()
      const { mock, submit } = await v1Submission(m => { m.uploadPutArrived = arrived })
      const controller = new AbortController()
      const pending = submit({ signal: controller.signal })
      await arrived.promise
      controller.abort(new DOMException('Caller stopped', 'AbortError'))
      await expect(pending).rejects.toMatchObject({ failure: { code: 'CANCELLED' } })
      expect(mock.requestsFor('/v1/parse/jobs')).toHaveLength(0)
    })

    it('surfaces an incomplete upload session instead of submitting a job', async () => {
      const { mock, submit } = await v1Submission(m => { m.completeStatus = 'pending' })
      await expect(submit()).rejects.toMatchObject({ failure: { code: 'UPLOAD_FAILED' } })
      expect(mock.requestsFor('/v1/parse/jobs')).toHaveLength(0)
    })
  })

  describe('inspect', () => {
    async function inspect(jobStatus: string, jobFiles: readonly Record<string, unknown>[]) {
      const mock = await V1Mock.start(m => { m.jobStatus = jobStatus; m.jobFiles = jobFiles })
      return await v1({ baseURL: mock.url }).inspect(jobRef(), callContext())
    }

    it.each<[string, readonly Record<string, unknown>[], string, string]>([
      ['running', [fileEntry('running')], 'processing', 'processing'],
      ['completed', [fileEntry('completed', { output_files: { zip: { file_id: 'file_out_1', bytes: 1 } } })], 'completed', 'completed'],
      ['canceled', [], 'failed', 'failed'],
      // A terminal job that never lists the submitted file has no result for it.
      ['partial', [{ ...fileEntry('completed'), file_id: 'file_x', name: 'other.pdf' }], 'failed', 'failed'],
    ])('maps a %s job to %s (file %s)', async (jobStatus, files, state, fileState) => {
      const snapshot = await inspect(jobStatus, files)
      expect([snapshot.state, snapshot.files[0]?.state]).toEqual([state, fileState])
    })

    it('reports per-file upstream failures with their diagnostic', async () => {
      const snapshot = await inspect('partial', [fileEntry('failed', { error: { type: 'engine_error', code: 'parse_failed', message: 'password protected' } })])
      expect(snapshot.state).toBe('failed')
      expect(snapshot.files[0]?.failure).toMatchObject({
        code: 'REMOTE_PARSE_FAILED', retryable: false, providerCode: 'parse_failed', message: 'parse_failed: password protected',
      })
    })

    it('derives a partial result from file states when a latched engine fails the job', async () => {
      const mock = await V1Mock.start(m => { m.jobStatus = 'failed'; m.jobFiles = engineDeadFiles() })
      const snapshot = await v1({ baseURL: mock.url }).inspect(jobRef(TWO_FILES), callContext())
      expect(snapshot.state).toBe('partially-completed')
      expect(snapshot.files.map(file => file.state)).toEqual(['completed', 'failed'])
      expect(snapshot.files[1]?.failure).toMatchObject({
        code: 'REMOTE_PARSE_FAILED', providerCode: 'engine_dead', message: `engine_dead: ${String(ENGINE_DEAD.error.message)}`,
      })
    })

    it.each<[string, Record<string, unknown> | null, string, string | undefined]>([
      ['a Router job whose worker was lost', { type: 'engine_error', code: 'upstream_job_lost', message: 'Upstream task no longer exists' },
        'upstream_job_lost: Upstream task no longer exists', 'upstream_job_lost'],
      ['an error code without a message', { type: 'engine_error', code: 'engine_dead' }, 'engine_dead: Remote document extraction failed', 'engine_dead'],
      ['a failure without an error object', null, 'Remote document extraction failed', undefined],
    ])('reports %s', async (_label, error, message, providerCode) => {
      const snapshot = await inspect('failed', [fileEntry('failed', { error })])
      expect(snapshot.state).toBe('failed')
      expect(snapshot.files[0]?.failure).toMatchObject({ code: 'REMOTE_PARSE_FAILED', message })
      expect(snapshot.files[0]?.failure?.providerCode).toBe(providerCode)
    })
  })

  describe('collect', () => {
    async function collectFrom(configure: (mock: V1Mock) => void, context: CallContextOptions = {}, sink = new RecordingSink()) {
      const archive = await v1Archive()
      const mock = await V1Mock.start(m => { m.jobStatus = 'completed'; m.archive = archive; configure(m) })
      const file = await preparedSource('doc.pdf')
      const result = v1({ baseURL: mock.url }).collect(jobRef(), v1Request(file), sink, callContext(context))
      return { mock, sink, result }
    }

    it('downloads the result archive and writes canonical artifacts', async () => {
      const { mock, sink, result } = await collectFrom(() => {}, { credential: 'sk-secret' })
      expect((await result).files.map(file => file.failure)).toEqual([undefined])
      expect(mock.requestsFor('/v1/files/file_out_1/content')[0]?.headers.authorization).toBe('Bearer sk-secret')
      expect(sink.artifact('markdown')?.toString('utf8')).toContain('# Title')
      expect(JSON.parse(sink.artifact('layout')!.toString('utf8')).pdf_info).toEqual([{ page_idx: 0, blocks: [] }, { page_idx: 1, blocks: [] }])
      expect(JSON.parse(sink.artifact('model-output')!.toString('utf8')).pages).toHaveLength(1)
      const contentList = JSON.parse(sink.artifact('content-list')!.toString('utf8')) as Record<string, unknown>[]
      expect(contentList[0]).toMatchObject({ type: 'title', page_idx: 0, text_level: 1, anchor: 'title' })
      expect(contentList[2]).toMatchObject({ type: 'image', page_idx: 0, img_path: 'images/page_0_image_1.png', image_caption: ['Figure 1: demo'] })
      const images = sink.written.filter(entry => entry.kind === 'images')
      expect(images.map(entry => entry.options.relativeName)).toEqual(['images/page_0_image_1.png'])
      expect(images[0]?.content.equals(testPng(8, 8))).toBe(true)
    })

    it('returns a per-file failure instead of downloading failed results', async () => {
      const { mock, result } = await collectFrom(m => {
        m.jobStatus = 'partial'
        m.jobFiles = [fileEntry('failed', { error: { type: 'engine_error', code: 'parse_failed', message: 'unsupported document' } })]
      })
      expect((await result).files[0]?.failure).toMatchObject({ providerCode: 'parse_failed', message: 'parse_failed: unsupported document' })
      expect(mock.downloads()).toHaveLength(0)
    })

    it('collects the files completed before a latched engine failed the job', async () => {
      const archive = await v1Archive()
      const mock = await V1Mock.start(m => { m.jobStatus = 'failed'; m.archive = archive; m.jobFiles = engineDeadFiles(archive.byteLength) })
      const sink = new RecordingSink()
      const collected = await v1({ baseURL: mock.url }).collect(jobRef(TWO_FILES), v1Request(await preparedSource('doc.pdf')), sink, callContext())
      expect(collected.files[0]).toMatchObject({ fileId: TWO_FILES[0]!.fileId })
      expect(collected.files[0]?.failure).toBeUndefined()
      expect(collected.files[1]).toMatchObject({ fileId: TWO_FILES[1]!.fileId, artifacts: [], failure: { providerCode: 'engine_dead' } })
      expect(mock.downloads().map(request => request.url)).toEqual(['/v1/files/file_out_1/content'])
      expect(sink.artifact('markdown')?.toString('utf8')).toContain('# Title')
    })

    it('reports an output already collected by server retention with its upstream code', async () => {
      const { mock, result } = await collectFrom(m => { m.archive = undefined; m.archiveStatus = 404 }, { retry: { maxRetries: 2 } })
      await expect(result).rejects.toMatchObject({
        failure: {
          code: 'RESULT_DOWNLOAD_FAILED', retryable: false, providerCode: 'file_not_found',
          message: 'Failed to download result archive, HTTP status 404: file_not_found: File file_out_1 not found',
        },
      })
      expect(mock.downloads()).toHaveLength(1)
    })

    it('keeps the upstream code of a retried archive download failure', async () => {
      const { mock, result } = await collectFrom(m => { m.archiveFailures = 10 }, { retry: { maxRetries: 1 } })
      await expect(result).rejects.toMatchObject({
        failure: { code: 'RESULT_DOWNLOAD_FAILED', retryable: true, providerCode: 'internal_error', message: 'Failed to download result archive, HTTP status 500: internal_error: boom' },
      })
      expect(mock.downloads()).toHaveLength(2)
    })

    it.each<[string, (mock: V1Mock) => void]>([
      ['an HTTP 500', m => { m.archiveFailures = 1 }],
      ['a body that breaks after HTTP 200', m => { m.archiveBreaks = 1 }],
    ])('retries the archive download after %s', async (_label, configure) => {
      const log = retryLog()
      const { mock, sink, result } = await collectFrom(configure, { retry: log.retry })
      expect((await result).files[0]?.failure).toBeUndefined()
      expect(sink.artifact('markdown')?.toString('utf8')).toContain('# Title')
      expect(mock.downloads()).toHaveLength(2)
      expect(log.events).toEqual([expect.objectContaining({ operation: 'result-download', attempt: 1 })])
    })

    it('reports a persistently broken body as bounded RESULT_DOWNLOAD_FAILED', async () => {
      const { mock, result } = await collectFrom(m => { m.archiveBreaks = 10 }, { retry: { maxRetries: 2 } })
      await expect(result).rejects.toMatchObject({ failure: { code: 'RESULT_DOWNLOAD_FAILED', retryable: true } })
      expect(mock.downloads()).toHaveLength(3)
    })

    it('does not retry a download that fails while staging locally', async () => {
      const sink = new RecordingSink()
      sink.writeTemporary = async () => { throw new Error('EACCES: permission denied, open staging file') }
      const { mock, result } = await collectFrom(() => {}, {}, sink)
      await expect(result).rejects.toMatchObject({ failure: { code: 'RESULT_DOWNLOAD_FAILED', retryable: false } })
      expect(mock.downloads()).toHaveLength(1)
    })

    it('does not retry a download cancelled while its body is streaming', async () => {
      const stalled = deferred()
      const controller = new AbortController()
      const { mock, result } = await collectFrom(m => { m.archiveStalled = stalled }, { signal: controller.signal })
      await stalled.promise
      controller.abort(new DOMException('Caller stopped', 'AbortError'))
      await expect(result).rejects.toMatchObject({ failure: { code: 'CANCELLED' } })
      expect(mock.downloads()).toHaveLength(1)
    })

    it('refuses to collect while the job is still running', async () => {
      const { result } = await collectFrom(m => { m.jobStatus = 'running'; m.jobFiles = [fileEntry('running')] })
      await expect(result).rejects.toMatchObject({ failure: { code: 'RESULT_NOT_READY' } })
    })

    it('rejects an archive larger than the configured download limit', async () => {
      const { result } = await collectFrom(() => {}, { limits: { maxZipDownloadBytes: 64 } })
      await expect(result).rejects.toMatchObject({ failure: { code: 'RESULT_TOO_LARGE' } })
    })

    it('stages one archive copy per file when two files share an archive file id', async () => {
      const archive = await v1Archive()
      const output = { zip: { file_id: 'file_out_1', bytes: archive.byteLength } }
      const mock = await V1Mock.start(m => {
        m.jobStatus = 'completed'
        m.archive = archive
        m.jobFiles = [fileEntry('completed', { output_files: output }), fileEntry('completed', { file_id: 'file_up_2', name: 'doc2.pdf', output_files: output })]
      })
      const files: readonly ProviderSubmittedFile[] = [...ONE_FILE, { dataId: 'd2', fileId: createFileId(SHA256_B), name: 'doc2.pdf' }]
      const sink = new RecordingSink()
      const collected = await v1({ baseURL: mock.url }).collect(jobRef(files), v1Request(await preparedSource('doc.pdf')), sink, callContext())
      expect(collected.files.map(entry => [entry.fileId, entry.failure])).toEqual(files.map(file => [file.fileId, undefined]))
      expect(sink.temporaries.map(entry => entry.name)).toEqual(['mineru_v1_0_file_out_1.zip', 'mineru_v1_1_file_out_1.zip'])
    })

    it.each<ProviderJobRef>([
      { provider: 'official-v4', batchId: 'batch_1', files: [] },
      { provider: 'self-hosted-legacy-v2', taskId: 'legacy_1', files: [] },
    ])('rejects a foreign $provider reference for inspect and collect', async ref => {
      const provider = v1({ baseURL: 'http://127.0.0.1:1' })
      await expect(provider.inspect(ref, callContext())).rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
      await expect(provider.collect(ref, canonicalRequest(), new RecordingSink(), callContext())).rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
    })
  })
})
