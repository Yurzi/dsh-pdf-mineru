import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { ZipFile } from 'yazl'
import { createHash } from 'node:crypto'
import { asProviderConfigId, createFileId, type MinerUFileId } from '../src/domain/ids.js'
import { MinerUError, failure } from '../src/domain/errors.js'
import type { ArtifactKind, CanonicalParseRequest, PreparedSourceFile } from '../src/domain/request.js'
import type { ArtifactRef } from '../src/domain/result.js'
import type {
  ArtifactInput,
  ArtifactSink,
  ArtifactWriteOptions,
  ProviderCallContext,
  TemporaryArtifact,
} from '../src/providers/provider.js'
import type { SelfHostedV1Config } from '../src/config/pure.js'
import { computeCacheKey } from '../src/domain/cache-key.js'
import { SelfHostedLegacyV2Provider } from '../src/providers/self-hosted-legacy-v2.js'
import {
  canonicalizeLayoutDocument,
  canonicalizeStructuredContent,
  isInsecureCrossOriginUpload,
  isSameOriginUrl,
  isSelfHostedV1Health,
  mapSelfHostedV1FileState,
  mapSelfHostedV1JobState,
  mimeTypeForName,
  SelfHostedV1Provider,
} from '../src/providers/self-hosted-v1.js'
import { testPng } from './fixtures/png.js'

const SHA256_A = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const SHA256_B = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'

interface RecordedRequest {
  readonly method: string
  readonly url: string
  readonly headers: IncomingHttpHeaders
  readonly body: Buffer
}

const sinkTempDirs: string[] = []

class RecordingSink implements ArtifactSink {
  readonly written: Array<{
    readonly fileId: string
    readonly kind: string
    readonly content: Buffer
    readonly options: ArtifactWriteOptions
  }> = []
  readonly temporaryNames: string[] = []

  async writeArtifact(
    fileId: MinerUFileId,
    kind: ArtifactKind,
    input: ArtifactInput,
    options: ArtifactWriteOptions,
  ): Promise<ArtifactRef> {
    const content = await inputBuffer(input)
    this.written.push({ fileId: String(fileId), kind: String(kind), content, options })
    return {
      kind,
      relativePath: `files/${String(fileId)}/${options.relativeName ?? 'artifact.bin'}`,
      mediaType: options.mediaType,
      bytes: content.byteLength,
      sha256: SHA256_A,
    }
  }

  async writeTemporary(name: string, input: ArtifactInput, maxBytes: number): Promise<TemporaryArtifact> {
    const dir = await mkdtemp(join(tmpdir(), 'mineru-v1-temp-'))
    sinkTempDirs.push(dir)
    const path = join(dir, name)
    const content = await inputBuffer(input)
    if (content.byteLength > maxBytes) {
      // Mirrors StagingArtifactSink.writeTemporary, which reports an exceeded limit as RESULT_TOO_LARGE.
      throw new MinerUError(failure('RESULT_TOO_LARGE', `Artifact output exceeded byte limit of ${String(maxBytes)} bytes`))
    }
    await writeFile(path, content)
    this.temporaryNames.push(name)
    return { path, bytes: content.byteLength, sha256: SHA256_A }
  }

  artifact(kind: string): Buffer | undefined {
    return this.written.find(entry => entry.kind === kind)?.content
  }
}

async function inputBuffer(input: ArtifactInput): Promise<Buffer> {
  if (typeof input === 'string') return Buffer.from(input, 'utf8')
  if (input instanceof Uint8Array) return Buffer.from(input)
  const stream = input instanceof Readable
    ? input
    : Readable.fromWeb(input as import('node:stream/web').ReadableStream<Uint8Array>)
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array))
  return Buffer.concat(chunks)
}

class V1Mock {
  readonly requests: RecordedRequest[] = []
  server: Server | undefined
  url = ''
  legacyOnly = false
  legacyHealth = false
  v1HealthBody: unknown
  tiersStatus = 200
  uploadCreateStatus = 200
  uploadCreateFailures = 0
  completeFailures = 0
  parseJobFailures = 0
  uploadDeduplicated = false
  uploadUrlHost: string | undefined
  uploadHeaders: Record<string, string> | undefined
  uploadPutFailures = 0
  uploadPutErrorBody: string | undefined
  uploadPutDelayMs = 0
  archiveFailures = 0
  archiveStallAttempts = 0
  archiveStallDelayMs = 120
  archiveStallMs = 0
  completeStatus = 'completed'
  jobStatus = 'queued'
  jobFiles: readonly Record<string, unknown>[] | undefined
  archive: Buffer | undefined
  archiveStatus = 200
  onJobGet: ((count: number) => void) | undefined
  #jobGets = 0

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk as Buffer))
      req.on('end', () => {
        const body = Buffer.concat(chunks)
        this.requests.push({
          method: req.method ?? 'GET',
          url: req.url ?? '/',
          headers: req.headers,
          body,
        })
        void this.#route(req.method ?? 'GET', req.url ?? '/', req.headers, res).catch(() => {
          res.writeHead(500)
          res.end()
        })
      })
    })
    await new Promise<void>(resolve => this.server!.listen(0, '127.0.0.1', () => resolve()))
    const port = (this.server.address() as AddressInfo).port
    this.url = `http://127.0.0.1:${String(port)}`
  }

  async stop(): Promise<void> {
    if (this.server !== undefined) {
      await new Promise<void>(resolve => this.server!.close(() => resolve()))
      this.server = undefined
    }
  }

  requestsFor(url: string): readonly RecordedRequest[] {
    return this.requests.filter(request => request.url === url)
  }

  #json(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload))
  }

  #jobPayload(): Record<string, unknown> {
    const status = this.jobStatus
    return {
      job_id: 'job_1',
      status,
      created_at: '2026-10-02T00:00:00Z',
      tier: 'standard',
      output_formats: ['zip'],
      access_level: 'registered',
      progress: { completed: status === 'completed' ? 1 : 0, failed: 0, total: 1 },
      links: { self: '/v1/parse/jobs/job_1', cancel: '/v1/parse/jobs/job_1' },
      files: this.jobFiles ?? [{
        file_id: 'file_up_1',
        name: 'doc.pdf',
        page_range: '',
        status,
        output_files: status === 'completed' ? { zip: { file_id: 'file_out_1', bytes: this.archive?.byteLength ?? 0 } } : null,
        error: null,
      }],
    }
  }

  async #route(
    method: string,
    url: string,
    headers: IncomingHttpHeaders,
    res: import('node:http').ServerResponse,
  ): Promise<void> {
    if (url === '/v1/health' && method === 'GET') {
      if (this.legacyOnly) {
        res.writeHead(404)
        res.end()
        return
      }
      if (this.v1HealthBody !== undefined) {
        this.#json(res, 200, this.v1HealthBody)
        return
      }
      this.#json(res, 200, {
        status: 'ok',
        version: '4.0.9',
        features: { webhook: false, output_formats: ['markdown', 'middle_json', 'structured_content', 'zip'], sources: ['file_id', 'url', 'inline'] },
      })
      return
    }
    if (url === '/health' && method === 'GET') {
      if (!this.legacyOnly && !this.legacyHealth) {
        res.writeHead(404)
        res.end()
        return
      }
      this.#json(res, 200, { status: 'healthy', version: '3.4.4', protocol_version: 2, queued_tasks: 0, processing_tasks: 0, completed_tasks: 0, failed_tasks: 0, max_concurrent_requests: 2 })
      return
    }
    if (url === '/v1/tiers' && method === 'GET') {
      if (this.tiersStatus !== 200) {
        this.#json(res, this.tiersStatus, { error: { type: 'authentication_error', code: 'invalid_api_key', message: 'Invalid or missing API key', param: null } })
        return
      }
      this.#json(res, 200, { object: 'list', data: [{ id: 'flash' }, { id: 'standard' }, { id: 'advanced' }] })
      return
    }
    if (url === '/v1/uploads' && method === 'POST') {
      if (this.uploadCreateFailures > 0) {
        this.uploadCreateFailures--
        this.#json(res, 500, { error: { type: 'server_error', code: 'internal', message: 'boom', param: null } })
        return
      }
      if (this.uploadCreateStatus !== 200) {
        this.#json(res, this.uploadCreateStatus, { error: { type: 'invalid_request_error', code: 'invalid_request', message: 'Upload rejected', param: null } })
        return
      }
      const host = this.uploadUrlHost ?? `127.0.0.1:${String((this.server!.address() as AddressInfo).port)}`
      this.#json(res, 200, {
        id: 'upload_1',
        object: 'upload',
        bytes: 100,
        created_at: 1,
        expires_at: 2,
        filename: 'doc.pdf',
        purpose: 'parse',
        mime_type: 'application/pdf',
        sha256sum: SHA256_A,
        status: this.uploadDeduplicated ? 'completed' : 'pending',
        upload_url: this.uploadDeduplicated ? null : `http://${host}/v1/uploads/upload_1/content`,
        upload_method: this.uploadDeduplicated ? null : 'PUT',
        upload_headers: this.uploadDeduplicated ? null : (this.uploadHeaders ?? { 'Content-Type': 'application/pdf' }),
        file: this.uploadDeduplicated ? { id: 'file_dedup', object: 'file', bytes: 100, created_at: 1, filename: 'doc.pdf', purpose: 'parse' } : null,
      })
      return
    }
    if (url === '/v1/uploads/upload_1/content' && method === 'PUT') {
      if (this.uploadPutFailures > 0) {
        this.uploadPutFailures--
        if (this.uploadPutErrorBody !== undefined) {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(this.uploadPutErrorBody)
          return
        }
        this.#json(res, 500, { error: { type: 'server_error', code: 'internal', message: 'boom', param: null } })
        return
      }
      const finish = (): void => {
        res.writeHead(200)
        res.end()
      }
      if (this.uploadPutDelayMs > 0) setTimeout(finish, this.uploadPutDelayMs)
      else finish()
      return
    }
    if (url === '/v1/uploads/upload_1/complete' && method === 'POST') {
      if (this.completeFailures > 0) {
        this.completeFailures--
        this.#json(res, 500, { error: { type: 'server_error', code: 'internal', message: 'boom', param: null } })
        return
      }
      this.#json(res, 200, {
        id: 'upload_1',
        object: 'upload',
        bytes: 100,
        created_at: 1,
        expires_at: 2,
        filename: 'doc.pdf',
        purpose: 'parse',
        mime_type: 'application/pdf',
        status: this.completeStatus,
        file: this.completeStatus === 'completed'
          ? { id: 'file_up_1', object: 'file', bytes: 100, created_at: 1, filename: 'doc.pdf', purpose: 'parse' }
          : null,
      })
      return
    }
    if (url === '/v1/parse/jobs' && method === 'POST') {
      if (this.parseJobFailures > 0) {
        this.parseJobFailures--
        this.#json(res, 500, { error: { type: 'server_error', code: 'internal', message: 'boom', param: null } })
        return
      }
      this.#json(res, 202, this.#jobPayload())
      return
    }
    if (url === '/v1/parse/jobs/job_1' && method === 'GET') {
      this.#jobGets++
      this.onJobGet?.(this.#jobGets)
      this.#json(res, 200, this.#jobPayload())
      return
    }
    if (url.startsWith('/v1/files/') && url.endsWith('/content') && method === 'GET') {
      if (this.archiveFailures > 0) {
        this.archiveFailures--
        this.#json(res, 500, { error: { type: 'server_error', code: 'internal', message: 'boom', param: null } })
        return
      }
      if (this.archiveStatus !== 200 || this.archive === undefined) {
        this.#json(res, this.archiveStatus, { error: { type: 'not_found_error', code: 'not_found', message: 'missing', param: null } })
        return
      }
      if (this.archiveStallAttempts > 0) {
        // Deliver headers plus half the body, then break the connection while the caller is
        // still consuming the body (a mid-transfer failure, not a request failure).
        this.archiveStallAttempts--
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(this.archive.byteLength) })
        res.write(this.archive.subarray(0, Math.max(1, Math.floor(this.archive.byteLength / 2))))
        setTimeout(() => { if (!res.writableEnded) res.destroy() }, this.archiveStallDelayMs)
        return
      }
      if (this.archiveStallMs > 0) {
        // Keep the partial body open until the caller gives up (cancellation coverage).
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(this.archive.byteLength) })
        res.write(this.archive.subarray(0, Math.max(1, Math.floor(this.archive.byteLength / 2))))
        setTimeout(() => { if (!res.writableEnded) res.destroy() }, this.archiveStallMs)
        return
      }
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.end(this.archive)
      return
    }
    res.writeHead(404)
    res.end()
  }
}

async function v1Archive(): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const zip = new ZipFile()
    const chunks: Buffer[] = []
    zip.outputStream.on('data', chunk => chunks.push(chunk as Buffer))
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
    zip.outputStream.on('error', reject)

    zip.addBuffer(Buffer.from('# Title\n\n![](images/page_0_image_1.png)\n', 'utf8'), 'markdown.md')
    zip.addBuffer(Buffer.from(JSON.stringify({
      metadata: { producer: { name: 'mineru', version: '4.0.9' } },
      pages: [{ page_idx: 0, blocks: [] }, { page_idx: 1, blocks: [] }],
    }), 'utf8'), 'middle_json.json')
    zip.addBuffer(Buffer.from(JSON.stringify({
      pages: [{
        page_idx: 0,
        blocks: [
          { type: 'doc_title', bbox: [0, 0, 1, 1], level: 1, content: 'Title' },
          { type: 'text', bbox: [0, 0, 1, 1], content: 'Body' },
          { type: 'image', bbox: [0, 0, 1, 1], content: '', captions: ['Figure 1: demo'], footnotes: [], image_source: 'images/page_0_image_1.png' },
        ],
      }],
      is_full_document: true,
    }), 'utf8'), 'structured_content.json')
    zip.addBuffer(Buffer.from(JSON.stringify({ pages: [{ page_idx: 0, blocks: [] }] }), 'utf8'), 'model_output.json')
    zip.addBuffer(testPng(8, 8), 'images/page_0_image_1.png')
    zip.end()
  })
}

describe('SelfHostedV1Provider — MinerU 4.x V1 API', () => {
  let mock: V1Mock | undefined
  const tempDirs: string[] = []

  function makeContext(overrides: Partial<ProviderCallContext> = {}): ProviderCallContext {
    return {
      signal: new AbortController().signal,
      timeoutMs: 5000,
      limits: {
        maxApiResponseBytes: 1024 * 1024,
        maxZipDownloadBytes: 10 * 1024 * 1024,
        maxZipEntries: 100,
        maxZipEntryBytes: 5 * 1024 * 1024,
        maxZipTotalBytes: 20 * 1024 * 1024,
        maxZipCompressionRatio: 10,
      },
      retry: { initialDelayMs: 1, maxDelayMs: 5, jitter: false, sleep: async () => {} },
      ...overrides,
    }
  }

  function makeProvider(config: Partial<SelfHostedV1Config> & { baseURL: string }): SelfHostedV1Provider {
    return new SelfHostedV1Provider({
      id: asProviderConfigId('mp_self_hosted'),
      type: 'self-hosted-v1',
      ocrMode: 'auto',
      tier: 'standard',
      allowInsecureHttp: true,
      ...config,
    })
  }

  async function createTestFile(name: string, content = '%PDF-1.4 report content'): Promise<PreparedSourceFile> {
    const dir = await mkdtemp(join(tmpdir(), 'mineru-v1-source-'))
    tempDirs.push(dir)
    const path = join(dir, name)
    await writeFile(path, content, 'utf8')
    const info = await stat(path)
    return {
      fileId: createFileId(SHA256_A),
      name,
      bytes: info.size,
      sha256: SHA256_A,
      path,
      fingerprint: { size: info.size, mtimeMs: info.mtimeMs, device: info.dev, inode: info.ino },
    }
  }

  function makeRequest(file: PreparedSourceFile, overrides: Partial<CanonicalParseRequest['semantics']> = {}): CanonicalParseRequest {
    return {
      schemaVersion: 1,
      files: [{ fileId: file.fileId, name: file.name, bytes: file.bytes, sha256: file.sha256 }],
      semantics: { model: 'pipeline', ocr: false, parseMethod: 'auto', language: 'auto', formula: false, table: false, ...overrides },
      requiredArtifacts: ['markdown', 'layout', 'model-output', 'content-list', 'images'],
    }
  }

  afterEach(async () => {
    await mock?.stop()
    mock = undefined
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
    await Promise.all(sinkTempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  describe('V1 constructor URL safety', () => {
    it.each([
      'https://user:pass@example.com', 'ftp://example.com', 'not-a-url',
      'https://example.com/v1?token=secret', 'https://example.com/v1#fragment',
    ])('rejects unsafe base URL %s', baseURL => {
      expect(() => makeProvider({ baseURL })).toThrow(MinerUError)
    })

    it('requires explicit insecure HTTP permission', () => {
      expect(() => makeProvider({ baseURL: 'http://127.0.0.1:8000', allowInsecureHttp: false })).toThrow(MinerUError)
      expect(makeProvider({ baseURL: 'https://mineru.example.com', allowInsecureHttp: false }).id).toBe('self-hosted-v1')
    })
  })

  describe('V1 compatibility and cache isolation', () => {
    it('hashes only endpoint, configured version, and explicit tier without exposing secrets', async () => {
      const request = makeRequest(await createTestFile('doc.pdf'))
      const provider = makeProvider({ baseURL: 'https://secret-internal-host:8000/api/', tier: undefined })
      const key = await provider.compatibilityKey(request, {})
      const expectedHash = createHash('sha256').update(JSON.stringify({
        originAndPath: 'https://secret-internal-host:8000/api', configuredVersion: 'v1', tier: null,
      }), 'utf8').digest('hex').slice(0, 24)
      expect(key).toBe('self-hosted-v1:' + expectedHash)
      expect(key).not.toContain('secret-internal-host')
      expect(await makeProvider({ baseURL: 'https://secret-internal-host:8000/api', tier: undefined,
        id: asProviderConfigId('mp_other'), apiKeyEnv: 'OTHER_SECRET', configuredVersion: 'v1',
      }).compatibilityKey(request, {})).toBe(key)
      expect(await provider.compatibilityKey(request, { configuredVersion: '4.1' })).not.toBe(key)
      expect(await makeProvider({ baseURL: provider.config.baseURL, tier: undefined, configuredVersion: '4.1' })
        .compatibilityKey(request, {})).toBe(await provider.compatibilityKey(request, { configuredVersion: '4.1' }))
      expect(await makeProvider({ baseURL: 'https://secret-internal-host:8000/other', tier: undefined })
        .compatibilityKey(request, {})).not.toBe(key)
      expect(await makeProvider({ baseURL: 'https://other-host:8000/api', tier: undefined })
        .compatibilityKey(request, {})).not.toBe(key)
    })

    it('isolates P1 cached results by explicit tier including the server default', async () => {
      const request = makeRequest(await createTestFile('doc.pdf'))
      const keys = await Promise.all(([undefined, 'flash', 'basic', 'standard', 'advanced'] as const).map(async tier => {
        const provider = makeProvider({ baseURL: 'https://mineru.example.com', tier })
        return await provider.compatibilityKey(request, {})
      }))
      expect(new Set(keys).size).toBe(5)
      const cacheKeys = keys.map(key => computeCacheKey(request, request.files[0]!, key))
      expect(new Set(cacheKeys).size).toBe(5)
    })

    it('isolates auto, txt, and ocr in canonical cache semantics, not provider compatibility', async () => {
      const file = await createTestFile('doc.pdf')
      const keys: string[] = []
      const cacheKeys: string[] = []
      for (const parseMethod of ['auto', 'txt', 'ocr'] as const) {
        const provider = makeProvider({ baseURL: 'https://mineru.example.com', ocrMode: parseMethod })
        const request = makeRequest(file, { parseMethod, ocr: parseMethod === 'ocr' })
        const key = await provider.compatibilityKey(request, {})
        keys.push(key)
        cacheKeys.push(computeCacheKey(request, request.files[0]!, key))
      }
      expect(new Set(keys).size).toBe(1)
      expect(new Set(cacheKeys).size).toBe(3)
    })

    it('never shares cache identity with legacy on the same endpoint and version', async () => {
      const request = makeRequest(await createTestFile('doc.pdf'))
      const baseURL = 'https://mineru.example.com'
      const v1 = makeProvider({ baseURL, configuredVersion: 'same', tier: undefined })
      const legacy = new SelfHostedLegacyV2Provider({
        id: asProviderConfigId('mp_legacy'), type: 'self-hosted-legacy-v2', baseURL,
        configuredVersion: 'same', modelMap: { pipeline: 'pipeline' },
      })
      const v1Key = await v1.compatibilityKey(request, {})
      const legacyKey = await legacy.compatibilityKey(request, {})
      expect(v1Key).toMatch(/^self-hosted-v1:[a-f0-9]{24}$/)
      expect(legacyKey).toMatch(/^self-hosted-legacy-v2:[a-f0-9]{24}$/)
      expect(v1Key).not.toBe(legacyKey)
      expect(computeCacheKey(request, request.files[0]!, v1Key))
        .not.toBe(computeCacheKey(request, request.files[0]!, legacyKey))
    })
  })

  describe('MinerU 4.x V1 API helpers', () => {
    it('maps file extensions onto upload MIME types', () => {
      expect(mimeTypeForName('doc.pdf')).toBe('application/pdf')
      expect(mimeTypeForName('SCAN.PNG')).toBe('image/png')
      expect(mimeTypeForName('report.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      expect(mimeTypeForName('unknown.bin')).toBe('application/octet-stream')
      expect(mimeTypeForName('noext')).toBe('application/octet-stream')
    })

    it('maps V1 job and file statuses and rejects unknown ones', () => {
      expect(mapSelfHostedV1JobState('queued')).toBe('queued')
      expect(mapSelfHostedV1JobState('running')).toBe('processing')
      expect(mapSelfHostedV1JobState('partial')).toBe('partially-completed')
      expect(mapSelfHostedV1JobState('canceled')).toBe('failed')
      expect(() => mapSelfHostedV1JobState('mystery')).toThrow(/Unknown remote job status/)
      expect(mapSelfHostedV1FileState('completed')).toBe('completed')
      expect(mapSelfHostedV1FileState('canceled')).toBe('failed')
      expect(() => mapSelfHostedV1FileState(undefined)).toThrow(/Missing file status/)
    })

    it('flattens structured content into the canonical content-list array', () => {
      const canonical = canonicalizeStructuredContent({
        pages: [
          { page_idx: 0, blocks: [{ type: 'doc_title', level: 1, content: 'Title' }] },
          { page_idx: 1, blocks: [{ type: 'paragraph_title', level: 2, content: 'Section' }, { type: 'text', content: 'Body' }] },
        ],
      }) as Array<Record<string, unknown>>
      expect(canonical).toHaveLength(3)
      expect(canonical[0]).toMatchObject({ type: 'title', text_level: 1, content: 'Title', page_idx: 0 })
      expect(canonical[1]).toMatchObject({ type: 'title', text_level: 2, page_idx: 1 })
      expect(canonical[2]).toMatchObject({ type: 'text', content: 'Body', page_idx: 1 })
      expect(canonical[0]).not.toHaveProperty('level')
    })

    it('maps image and table references onto canonical caption fields', () => {
      const canonical = canonicalizeStructuredContent({
        pages: [{
          page_idx: 0,
          blocks: [
            {
              type: 'image',
              content: 'ocr',
              image_source: 'images/a.png',
              captions: ['Figure 1: demo'],
              footnotes: [{ bbox: [0, 0, 1, 1], content: 'note text' }, { bbox: [0, 0, 1, 1] }],
            },
            { type: 'table', content: '<table></table>', image_source: 'images/t.png', captions: [{ content: 'Table 1: demo' }], footnotes: [] },
          ],
        }],
      }) as Array<Record<string, unknown>>
      expect(canonical[0]).toMatchObject({ img_path: 'images/a.png', image_caption: ['Figure 1: demo'], image_footnote: ['note text'] })
      expect(canonical[1]).toMatchObject({ img_path: 'images/t.png', table_caption: ['Table 1: demo'] })
      expect(canonical[0]).not.toHaveProperty('image_source')
      expect(canonical[1]).not.toHaveProperty('captions')
    })

    it('leaves canonical content lists and unrelated documents untouched', () => {
      expect(canonicalizeStructuredContent([{ type: 'text', text: 'x' }])).toBeUndefined()
      expect(canonicalizeStructuredContent({ pdf_info: [] })).toBeUndefined()
      expect(canonicalizeStructuredContent(null)).toBeUndefined()
    })

    it('aliases the V1 layout page list onto the canonical pdf_info shape', () => {
      const layout = canonicalizeLayoutDocument({ metadata: {}, pages: [{ page_idx: 0 }, { page_idx: 1 }] })
      expect(layout?.pdf_info).toEqual([{ page_idx: 0 }, { page_idx: 1 }])
      expect(canonicalizeLayoutDocument({ pdf_info: [{ page_idx: 0 }] })).toBeUndefined()
      expect(canonicalizeLayoutDocument({ metadata: {} })).toBeUndefined()
    })

    it('submits the tier that the compatibility key records', async () => {
      mock = new V1Mock()
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url, tier: 'standard' })
      const file = await createTestFile('doc.pdf')
      const request = makeRequest(file)

      const key = await provider.compatibilityKey(request, {})
      await provider.submit(request, [file], makeContext())

      const job = mock.requestsFor('/v1/parse/jobs')[0]!
      expect(JSON.parse(job.body.toString('utf8')).tier).toBe('standard')

      // The same request without an effective tier is a different cache identity.
      const untiered = makeProvider({ baseURL: mock.url, tier: undefined })
      expect(await untiered.compatibilityKey(request, {})).not.toBe(key)
    })

    it('accepts only a positive V1 health shape', () => {
      expect(isSelfHostedV1Health({ status: 'ok', version: '4.0.9', features: {} })).toBe(true)
      expect(isSelfHostedV1Health({ version: '4.0.9' })).toBe(true)
      expect(isSelfHostedV1Health({ status: 'unhealthy', version: '4.0.9' })).toBe(true)
      // Legacy health documents, generic gateway bodies, and non-objects are not V1.
      expect(isSelfHostedV1Health({ status: 'healthy', version: '3.4.4', protocol_version: 2 })).toBe(false)
      expect(isSelfHostedV1Health({ status: 'ok', version: '3.4.4', queued_tasks: 0 })).toBe(false)
      expect(isSelfHostedV1Health({ detail: 'Not Found' })).toBe(false)
      expect(isSelfHostedV1Health({ status: 'ok' })).toBe(false)
      expect(isSelfHostedV1Health([])).toBe(false)
      expect(isSelfHostedV1Health(null)).toBe(false)
    })

    it('separates same-origin targets from insecure cross-origin upload targets', () => {
      const httpsBase = new URL('https://mineru.example.com:8443/')
      expect(isSameOriginUrl(new URL('https://mineru.example.com:8443/v1/uploads/x/content'), httpsBase)).toBe(true)
      expect(isSameOriginUrl(new URL('https://mineru.example.com/v1/uploads/x/content'), httpsBase)).toBe(false)
      expect(isSameOriginUrl(new URL('https://other.example.com/v1/uploads/x/content'), httpsBase)).toBe(false)
      expect(isInsecureCrossOriginUpload(new URL('http://other.example.com/upload'), httpsBase)).toBe(true)
      // A scheme downgrade is cross-origin too, so the upload is refused instead of sent in cleartext.
      expect(isInsecureCrossOriginUpload(new URL('http://mineru.example.com:8443/upload'), httpsBase)).toBe(true)
      const httpBase = new URL('http://127.0.0.1:7800')
      expect(isInsecureCrossOriginUpload(new URL('http://other.host:9000/upload'), httpBase)).toBe(false)
      expect(isInsecureCrossOriginUpload(new URL('http://127.0.0.1:7800/v1/uploads/x/content'), httpBase)).toBe(false)
    })
  })

  describe('explicit V1 probe without protocol fallback', () => {
    it('probes V1 health then tiers and reports version, credentials, and deployment capabilities', async () => {
      mock = new V1Mock()
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url, apiKeyEnv: 'MINERU_API_KEY' })

      const result = await provider.probe(makeContext({ credential: 'sk-secret' }))
      expect(result).toMatchObject({
        available: true,
        provider: 'self-hosted-v1',
        authentication: 'valid',
        protocolVersion: 'v1',
        serverVersion: '4.0.9',
        availableTiers: ['flash', 'standard', 'advanced'],
        outputFormats: ['markdown', 'middle_json', 'structured_content', 'zip'],
        sourceTypes: ['file_id', 'url', 'inline'],
      })
      expect(mock.requestsFor('/v1/tiers')[0]?.headers.authorization).toBe('Bearer sk-secret')
      expect(mock.requests.map(request => request.url)).toEqual(['/v1/health', '/v1/tiers'])
    })

    it('reports an invalid credential when the authenticated tiers endpoint rejects it', async () => {
      mock = new V1Mock()
      mock.tiersStatus = 401
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })

      const result = await provider.probe(makeContext({ credential: 'bad-key' }))
      expect(result.available).toBe(false)
      expect(result.authentication).toBe('invalid')
      expect(result.protocolVersion).toBe('v1')
    })

    it('reports unhealthy V1 unavailable without attempting legacy health', async () => {
      mock = new V1Mock()
      mock.v1HealthBody = { status: 'unhealthy', version: '4.0.9', features: { output_formats: ['zip'], sources: ['file_id'] } }
      mock.legacyHealth = true
      await mock.start()
      const result = await makeProvider({ baseURL: mock.url }).probe(makeContext())
      expect(result).toMatchObject({ available: false, provider: 'self-hosted-v1', protocolVersion: 'v1' })
      expect(mock.requestsFor('/health')).toHaveLength(0)
    })

    it('does not downgrade to legacy when the V1 health route is absent', async () => {
      mock = new V1Mock()
      mock.legacyOnly = true
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })

      const result = await provider.probe(makeContext({ credential: 'sk-secret' }))
      expect(result.available).toBe(false)
      expect(result.protocolVersion).toBe('v1')
      expect(mock.requestsFor('/health')).toHaveLength(0)
      expect(mock.requestsFor('/v1/tiers')).toHaveLength(0)
      expect(mock.requestsFor('/v1/health')).toHaveLength(1)
    })

    it('does not downgrade to healthy legacy after an invalid V1 health document', async () => {
      mock = new V1Mock()
      mock.v1HealthBody = { detail: 'Not Found' }
      mock.legacyHealth = true
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })

      const result = await provider.probe(makeContext({ credential: 'sk-secret' }))
      expect(result.available).toBe(false)
      expect(result.protocolVersion).toBe('v1')
      expect(mock.requestsFor('/health')).toHaveLength(0)
      expect(mock.requestsFor('/v1/tiers')).toHaveLength(0)
    })
  })

  describe('submit over the V1 API', () => {
    it('exposes only internal compatibility sentinels for unsupported V1 options', () => {
      expect(makeProvider({ baseURL: 'https://mineru.example.com' }).capabilities).toMatchObject({
        models: ['pipeline'], parseMethods: ['auto', 'txt', 'ocr'], supportsOcr: true,
        supportsLanguage: false, supportsFormula: false, supportsTable: false,
      })
    })

    it.each([
      { model: 'vlm' as const }, { language: 'en' }, { formula: true }, { table: true },
    ])('rejects explicit unsupported option %j before any upload', async overrides => {
      mock = new V1Mock()
      await mock.start()
      const file = await createTestFile('doc.pdf')
      await expect(makeProvider({ baseURL: mock.url }).submit(makeRequest(file, overrides), [file], makeContext()))
        .rejects.toMatchObject({ failure: { code: 'UNSUPPORTED_OPTION' } })
      expect(mock.requests).toHaveLength(0)
    })

    it.each(['auto', 'txt', 'ocr'] as const)('sends canonical %s OCR mode without legacy sentinel fields', async parseMethod => {
      mock = new V1Mock()
      // Discover deployment capabilities before uploads; never attempt legacy fallback.
      await mock.start()
      const file = await createTestFile('doc.pdf')
      const provider = makeProvider({ baseURL: mock.url, ocrMode: parseMethod === 'ocr' ? 'txt' : 'ocr', tier: undefined })
      await provider.submit(makeRequest(file, { parseMethod, ocr: parseMethod === 'ocr' }), [file], makeContext())
      expect(JSON.parse(mock.requestsFor('/v1/parse/jobs')[0]!.body.toString('utf8'))).toEqual({
        files: [{ source: { type: 'file_id', file_id: 'file_up_1' } }], ocr_mode: parseMethod, output_formats: ['zip'],
      })
      expect(mock.requestsFor('/v1/health')).toHaveLength(1)
      expect(mock.requestsFor('/v1/tiers')).toHaveLength(1)
      expect(mock.requestsFor('/health')).toHaveLength(0)
      expect(mock.requestsFor('/tasks')).toHaveLength(0)
    })

    it.each([
      { label: 'ZIP', features: { output_formats: ['markdown'], sources: ['file_id'] } },
      { label: 'file_id', features: { output_formats: ['zip'], sources: ['url', 'inline'] } },
    ])('rejects a deployment missing $label before uploading', async ({features}) => {
      mock = new V1Mock()
      mock.v1HealthBody = { status: 'ok', version: '4.0.10', features }
      await mock.start()
      const file = await createTestFile('doc.pdf')
      await expect(makeProvider({baseURL:mock.url}).submit(makeRequest(file), [file], makeContext()))
        .rejects.toMatchObject({failure:{code:'UNSUPPORTED_OPTION'}})
      expect(mock.requests.every(request => request.method === 'GET')).toBe(true)
      expect(mock.requestsFor('/tasks')).toHaveLength(0)
    })

    it('rejects an unavailable tier and reports the deployment list without uploading', async () => {
      mock = new V1Mock(); await mock.start()
      const file = await createTestFile('doc.pdf')
      const provider = makeProvider({baseURL:mock.url, tier:'basic'})
      const probe = await provider.probe(makeContext())
      expect(probe.available).toBe(false)
      expect(probe.availableTiers).toEqual(['flash','standard','advanced'])
      await expect(provider.submit(makeRequest(file), [file], makeContext())).rejects.toMatchObject({failure:{code:'UNSUPPORTED_OPTION'}})
      expect(mock.requestsFor('/v1/uploads')).toHaveLength(0)
    })

    it('fails closed when V1 discovery is unavailable instead of falling back', async () => {
      mock = new V1Mock(); mock.legacyOnly = true; await mock.start()
      const file = await createTestFile('doc.pdf')
      await expect(makeProvider({baseURL:mock.url}).submit(makeRequest(file), [file], makeContext())).rejects.toBeInstanceOf(MinerUError)
      expect(mock.requestsFor('/health')).toHaveLength(0)
      expect(mock.requestsFor('/tasks')).toHaveLength(0)
      expect(mock.requestsFor('/v1/uploads')).toHaveLength(0)
    })

    it('uploads bytes, completes the upload, and submits one parse job', async () => {
      mock = new V1Mock()
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })
      const file = await createTestFile('doc.pdf')

      const submission = await provider.submit(makeRequest(file), [file], makeContext({ credential: 'sk-secret' }))

      expect(submission.ref.provider).toBe('self-hosted-v1')
      if (submission.ref.provider !== 'self-hosted-v1') throw new Error('unreachable')
      expect(submission.ref.protocol).toBe('v1')
      expect(submission.ref.taskId).toBe('job_1')
      expect(submission.state).toBe('queued')
      expect(submission.files[0]?.state).toBe('queued')
      expect(mock.requests.map(request => request.url)).toEqual([
        '/v1/health', '/v1/tiers', '/v1/uploads', '/v1/uploads/upload_1/content', '/v1/uploads/upload_1/complete', '/v1/parse/jobs',
      ])

      const create = mock.requestsFor('/v1/uploads')[0]!
      expect(JSON.parse(create.body.toString('utf8'))).toEqual({
        filename: 'doc.pdf',
        bytes: file.bytes,
        mime_type: 'application/pdf',
        purpose: 'parse',
        sha256sum: SHA256_A,
      })
      expect(create.headers.authorization).toBe('Bearer sk-secret')

      const upload = mock.requestsFor('/v1/uploads/upload_1/content')[0]!
      expect(upload.method).toBe('PUT')
      expect(upload.headers.authorization).toBe('Bearer sk-secret')
      expect(upload.headers['content-type']).toBe('application/pdf')
      // A Blob body carries Content-Length, which presigned and size-checking targets require.
      expect(Number(upload.headers['content-length'])).toBe(file.bytes)
      expect(upload.headers['transfer-encoding']).toBeUndefined()
      expect(upload.body.toString('utf8')).toBe('%PDF-1.4 report content')

      const complete = mock.requestsFor('/v1/uploads/upload_1/complete')[0]!
      expect(complete.method).toBe('POST')
      expect(complete.headers.authorization).toBe('Bearer sk-secret')

      const job = mock.requestsFor('/v1/parse/jobs')[0]!
      expect(JSON.parse(job.body.toString('utf8'))).toEqual({
        files: [{ source: { type: 'file_id', file_id: 'file_up_1' } }],
        tier: 'standard',
        ocr_mode: 'auto',
        output_formats: ['zip'],
      })
    })

    it('forwards parse method and page range and omits an unconfigured tier', async () => {
      mock = new V1Mock()
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url, tier: undefined })
      const file = await createTestFile('doc.pdf')

      await provider.submit(
        makeRequest(file, { parseMethod: 'ocr', ocr: true, pages: '2-4,7' }),
        [file],
        makeContext(),
      )

      const job = mock.requestsFor('/v1/parse/jobs')[0]!
      expect(JSON.parse(job.body.toString('utf8'))).toEqual({
        files: [{ source: { type: 'file_id', file_id: 'file_up_1' }, page_range: '2-4,7' }],
        ocr_mode: 'ocr',
        output_formats: ['zip'],
      })
    })

    it('submits the explicitly configured parse tier', async () => {
      mock = new V1Mock()
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url, tier: 'advanced' })
      const file = await createTestFile('doc.pdf')

      await provider.submit(makeRequest(file), [file], makeContext())

      const job = mock.requestsFor('/v1/parse/jobs')[0]!
      expect(JSON.parse(job.body.toString('utf8')).tier).toBe('advanced')
    })

    it('skips the byte transfer for a deduplicated upload', async () => {
      mock = new V1Mock()
      mock.uploadDeduplicated = true
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })
      const file = await createTestFile('doc.pdf')

      await provider.submit(makeRequest(file), [file], makeContext())

      expect(mock.requestsFor('/v1/uploads/upload_1/content')).toHaveLength(0)
      expect(mock.requestsFor('/v1/uploads/upload_1/complete')).toHaveLength(0)
      const job = mock.requestsFor('/v1/parse/jobs')[0]!
      expect(JSON.parse(job.body.toString('utf8')).files).toEqual([{ source: { type: 'file_id', file_id: 'file_dedup' } }])
    })

    it('never forwards the API key to a cross-origin upload URL', async () => {
      mock = new V1Mock()
      await mock.start()
      mock.uploadUrlHost = `localhost:${String((mock.server!.address() as AddressInfo).port)}`
      const provider = makeProvider({ baseURL: mock.url })
      const file = await createTestFile('doc.pdf')

      await provider.submit(makeRequest(file), [file], makeContext({ credential: 'sk-secret' }))

      const upload = mock.requestsFor('/v1/uploads/upload_1/content')[0]!
      expect(upload.headers.authorization).toBeUndefined()
      expect(upload.headers['content-type']).toBe('application/pdf')
    })

    it('lets a service-provided Authorization header win over the API key', async () => {
      mock = new V1Mock()
      mock.uploadHeaders = { Authorization: 'Bearer SERVICE-TOKEN', 'Content-Type': 'application/pdf' }
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })
      const file = await createTestFile('doc.pdf')

      await provider.submit(makeRequest(file), [file], makeContext({ credential: 'sk-secret' }))

      const upload = mock.requestsFor('/v1/uploads/upload_1/content')[0]!
      expect(upload.headers.authorization).toBe('Bearer SERVICE-TOKEN')
    })

    it('redacts the credential from an upload error body', async () => {
      mock = new V1Mock()
      mock.uploadPutFailures = 5
      mock.uploadPutErrorBody = JSON.stringify({ error: 'invalid key sk-secret' })
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })
      const file = await createTestFile('doc.pdf')

      const error = await provider.submit(makeRequest(file), [file], makeContext({ credential: 'sk-secret' }))
        .then(() => undefined, (reason: unknown) => reason as { failure: { message: string } })
      expect(error?.failure.message).toContain('[REDACTED]')
      expect(error?.failure.message).not.toContain('sk-secret')
    })

    it('does not replay the complete or parse-job POST after a server error', async () => {
      mock = new V1Mock()
      mock.completeFailures = 1
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })
      const file = await createTestFile('doc.pdf')

      await expect(provider.submit(makeRequest(file), [file], makeContext())).rejects.toMatchObject({
        failure: expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
      })
      expect(mock.requestsFor('/v1/uploads/upload_1/complete')).toHaveLength(1)
      expect(mock.requestsFor('/v1/parse/jobs')).toHaveLength(0)

      mock.completeFailures = 0
      mock.parseJobFailures = 1
      await expect(provider.submit(makeRequest(file), [file], makeContext())).rejects.toMatchObject({
        failure: expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
      })
      expect(mock.requestsFor('/v1/parse/jobs')).toHaveLength(1)
    })

    it('exhausts the upload retry budget without replaying the session POST', async () => {
      mock = new V1Mock()
      mock.uploadPutFailures = 10
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })
      const file = await createTestFile('doc.pdf')

      await expect(provider.submit(makeRequest(file), [file], makeContext({
        retry: { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 2, jitter: false, sleep: async () => {} },
      }))).rejects.toMatchObject({
        failure: expect.objectContaining({ code: 'UPLOAD_FAILED' }),
      })
      expect(mock.requestsFor('/v1/uploads')).toHaveLength(1)
      expect(mock.requestsFor('/v1/uploads/upload_1/content')).toHaveLength(3)
    })

    it('does not retry the upload-session POST after a server error', async () => {
      mock = new V1Mock()
      mock.uploadCreateFailures = 1
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })
      const file = await createTestFile('doc.pdf')

      await expect(provider.submit(makeRequest(file), [file], makeContext())).rejects.toMatchObject({
        failure: expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
      })
      expect(mock.requestsFor('/v1/uploads')).toHaveLength(1)
    })

    it('retries the idempotent byte upload with a fresh stream', async () => {
      mock = new V1Mock()
      mock.uploadPutFailures = 1
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })
      const file = await createTestFile('doc.pdf')

      const submission = await provider.submit(makeRequest(file), [file], makeContext({
        retry: { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 2, jitter: false, sleep: async () => {} },
      }))

      const uploads = mock.requestsFor('/v1/uploads/upload_1/content')
      expect(uploads).toHaveLength(2)
      expect(uploads[1]?.body.toString('utf8')).toBe('%PDF-1.4 report content')
      expect(submission.state).toBe('queued')
    })

    it('rejects upload headers that would inject a new header line', async () => {
      mock = new V1Mock()
      mock.uploadHeaders = { 'Content-Type': 'application/pdf\r\nX-Injected: 1' }
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })
      const file = await createTestFile('doc.pdf')

      await expect(provider.submit(makeRequest(file), [file], makeContext())).rejects.toMatchObject({
        failure: expect.objectContaining({ code: 'UPLOAD_FAILED' }),
      })
      expect(mock.requestsFor('/v1/uploads/upload_1/content')).toHaveLength(0)
    })

    it('aborts an in-flight byte upload as CANCELLED', async () => {
      mock = new V1Mock()
      mock.uploadPutDelayMs = 3000
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })
      const file = await createTestFile('doc.pdf')
      const controller = new AbortController()

      const pending = provider.submit(makeRequest(file), [file], makeContext({ signal: controller.signal }))
      setTimeout(() => controller.abort(new DOMException('Caller stopped', 'AbortError')), 50)

      await expect(pending).rejects.toMatchObject({
        failure: expect.objectContaining({ code: 'CANCELLED' }),
      })
      expect(mock.requestsFor('/v1/parse/jobs')).toHaveLength(0)
    })

    it('surfaces an incomplete upload session instead of submitting a job', async () => {
      mock = new V1Mock()
      mock.completeStatus = 'pending'
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })
      const file = await createTestFile('doc.pdf')

      await expect(provider.submit(makeRequest(file), [file], makeContext())).rejects.toMatchObject({
        failure: expect.objectContaining({ code: 'UPLOAD_FAILED' }),
      })
      expect(mock.requestsFor('/v1/parse/jobs')).toHaveLength(0)
    })
  })

  describe('inspect over the V1 API', () => {
    function v1Ref(): Parameters<SelfHostedV1Provider['inspect']>[0] {
      return {
        provider: 'self-hosted-v1',
        protocol: 'v1',
        taskId: 'job_1',
        files: [{ dataId: 'd1', fileId: createFileId(SHA256_A), name: 'doc.pdf' }],
      }
    }

    it('maps per-file progress and completion', async () => {
      mock = new V1Mock()
      mock.jobStatus = 'running'
      mock.jobFiles = [{ file_id: 'file_up_1', name: 'doc.pdf', page_range: '', status: 'running', output_files: null, error: null }]
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })

      const running = await provider.inspect(v1Ref(), makeContext())
      expect(running.state).toBe('processing')
      expect(running.files[0]?.state).toBe('processing')

      mock.jobStatus = 'completed'
      mock.jobFiles = [{ file_id: 'file_up_1', name: 'doc.pdf', page_range: '', status: 'completed', output_files: { zip: { file_id: 'file_out_1', bytes: 1 } }, error: null }]
      const completed = await provider.inspect(v1Ref(), makeContext())
      expect(completed.state).toBe('completed')
      expect(completed.files[0]?.state).toBe('completed')
    })

    it('reports a canceled job without a per-file list as failed', async () => {
      mock = new V1Mock()
      mock.jobStatus = 'canceled'
      mock.jobFiles = []
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })

      const snapshot = await provider.inspect(v1Ref(), makeContext())
      expect(snapshot.state).toBe('failed')
      expect(snapshot.files[0]?.state).toBe('failed')
      expect(snapshot.files[0]?.failure?.message).toContain('did not complete')
    })

    it('reports a terminal job that never lists a submitted file as failed', async () => {
      mock = new V1Mock()
      mock.jobStatus = 'partial'
      mock.jobFiles = [{ file_id: 'file_x', name: 'other.pdf', page_range: '', status: 'completed', output_files: { zip: { file_id: 'file_out_9', bytes: 1 } }, error: null }]
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })

      const snapshot = await provider.inspect(v1Ref(), makeContext())
      expect(snapshot.state).toBe('failed')
      expect(snapshot.files[0]?.state).toBe('failed')
      expect(snapshot.files[0]?.failure?.message).toContain('finished without a result')
    })

    it('reports partial jobs and per-file failures', async () => {
      mock = new V1Mock()
      mock.jobStatus = 'partial'
      mock.jobFiles = [{
        file_id: 'file_up_1',
        name: 'doc.pdf',
        page_range: '',
        status: 'failed',
        output_files: null,
        error: { code: 'parse_failed', message: 'password protected' },
      }]
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })

      const snapshot = await provider.inspect(v1Ref(), makeContext())
      expect(snapshot.state).toBe('failed')
      expect(snapshot.files[0]?.failure?.code).toBe('REMOTE_PARSE_FAILED')
      expect(snapshot.files[0]?.failure?.message).toContain('password protected')
    })
  })

  describe('collect over the V1 API', () => {
    function v1Ref(): Parameters<SelfHostedV1Provider['collect']>[0] {
      return {
        provider: 'self-hosted-v1',
        protocol: 'v1',
        taskId: 'job_1',
        files: [{ dataId: 'd1', fileId: createFileId(SHA256_A), name: 'doc.pdf' }],
      }
    }

    it('downloads the result archive and writes canonical artifacts', async () => {
      mock = new V1Mock()
      mock.jobStatus = 'completed'
      mock.archive = await v1Archive()
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })
      const sink = new RecordingSink()
      const file = await createTestFile('doc.pdf')

      const collection = await provider.collect(v1Ref(), makeRequest(file), sink, makeContext({ credential: 'sk-secret' }))

      expect(collection.files).toHaveLength(1)
      expect(collection.files[0]?.failure).toBeUndefined()
      expect(mock.requestsFor('/v1/files/file_out_1/content')[0]?.headers.authorization).toBe('Bearer sk-secret')

      expect(sink.artifact('markdown')?.toString('utf8')).toContain('# Title')
      expect(JSON.parse(sink.artifact('layout')!.toString('utf8')).pdf_info).toEqual([{ page_idx: 0, blocks: [] }, { page_idx: 1, blocks: [] }])
      expect(JSON.parse(sink.artifact('model-output')!.toString('utf8')).pages).toHaveLength(1)

      const contentList = JSON.parse(sink.artifact('content-list')!.toString('utf8')) as Array<Record<string, unknown>>
      expect(contentList[0]).toMatchObject({ type: 'title', page_idx: 0, text_level: 1 })
      expect(contentList[2]).toMatchObject({ type: 'image', page_idx: 0, img_path: 'images/page_0_image_1.png' })

      const images = sink.written.filter(entry => entry.kind === 'images')
      expect(images).toHaveLength(1)
      expect(images[0]?.options.relativeName).toBe('images/page_0_image_1.png')
      expect(images[0]?.content.equals(testPng(8, 8))).toBe(true)
    })

    it('returns a per-file failure instead of downloading failed file results', async () => {
      mock = new V1Mock()
      mock.jobStatus = 'partial'
      mock.jobFiles = [{
        file_id: 'file_up_1',
        name: 'doc.pdf',
        page_range: '',
        status: 'failed',
        output_files: null,
        error: { code: 'parse_failed', message: 'unsupported document' },
      }]
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })
      const sink = new RecordingSink()
      const file = await createTestFile('doc.pdf')

      const collection = await provider.collect(v1Ref(), makeRequest(file), sink, makeContext())
      expect(collection.files[0]?.failure?.message).toContain('unsupported document')
      expect(mock.requests.filter(request => request.url.startsWith('/v1/files/'))).toHaveLength(0)
    })

    it('retries the result-archive download and reports a bounded failure', async () => {
      mock = new V1Mock()
      mock.jobStatus = 'completed'
      mock.archive = await v1Archive()
      mock.archiveFailures = 1
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })
      const sink = new RecordingSink()
      const file = await createTestFile('doc.pdf')
      const retry = { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 2, jitter: false, sleep: async () => {} }

      const collected = await provider.collect(v1Ref(), makeRequest(file), sink, makeContext({ retry }))
      expect(collected.files[0]?.failure).toBeUndefined()
      expect(mock.requests.filter(request => request.url.startsWith('/v1/files/'))).toHaveLength(2)

      mock.archive = undefined
      mock.archiveStatus = 404
      const failingSink = new RecordingSink()
      await expect(provider.collect(v1Ref(), makeRequest(file), failingSink, makeContext({ retry }))).rejects.toMatchObject({
        failure: expect.objectContaining({ code: 'RESULT_DOWNLOAD_FAILED' }),
      })
    })

    it('retries when the archive body breaks after an accepted HTTP 200', async () => {
      mock = new V1Mock()
      mock.jobStatus = 'completed'
      mock.archive = await v1Archive()
      mock.archiveStallAttempts = 1
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })
      const sink = new RecordingSink()
      const file = await createTestFile('doc.pdf')
      const retry = { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 2, jitter: false, sleep: async () => {} }

      const collected = await provider.collect(v1Ref(), makeRequest(file), sink, makeContext({ retry }))

      expect(collected.files[0]?.failure).toBeUndefined()
      expect(sink.artifact('markdown')?.toString('utf8')).toContain('# Title')
      expect(mock.requests.filter(request => request.url.startsWith('/v1/files/'))).toHaveLength(2)
    })

    it('exhausts the download retry budget on a persistently broken body', async () => {
      mock = new V1Mock()
      mock.jobStatus = 'completed'
      mock.archive = await v1Archive()
      mock.archiveStallAttempts = 10
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })
      const sink = new RecordingSink()
      const file = await createTestFile('doc.pdf')
      const retry = { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 2, jitter: false, sleep: async () => {} }

      await expect(provider.collect(v1Ref(), makeRequest(file), sink, makeContext({ retry }))).rejects.toMatchObject({
        failure: expect.objectContaining({ code: 'RESULT_DOWNLOAD_FAILED', retryable: true }),
      })
      expect(mock.requests.filter(request => request.url.startsWith('/v1/files/'))).toHaveLength(3)
    })

    it('does not retry a download that fails while staging locally', async () => {
      mock = new V1Mock()
      mock.jobStatus = 'completed'
      mock.archive = await v1Archive()
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })
      const sink = new RecordingSink()
      sink.writeTemporary = async () => { throw new Error('EACCES: permission denied, open staging file') }
      const file = await createTestFile('doc.pdf')
      const retry = { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 2, jitter: false, sleep: async () => {} }

      const error = await provider.collect(v1Ref(), makeRequest(file), sink, makeContext({ retry }))
        .then(() => undefined, (reason: unknown) => reason as { failure: { code: string; retryable: boolean; message: string } })

      expect(error?.failure.code).toBe('RESULT_DOWNLOAD_FAILED')
      expect(error?.failure.retryable).toBe(false)
      expect(error?.failure.message).toContain('Failed to stage the downloaded result archive')
      expect(error?.failure.message).toContain('EACCES')
      expect(mock.requests.filter(request => request.url.startsWith('/v1/files/'))).toHaveLength(1)
    })

    it('does not retry a download cancelled while its body is still streaming', async () => {
      mock = new V1Mock()
      mock.jobStatus = 'completed'
      mock.archive = await v1Archive()
      mock.archiveStallMs = 3000
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })
      const sink = new RecordingSink()
      const file = await createTestFile('doc.pdf')
      const controller = new AbortController()
      const retry = { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 2, jitter: false, sleep: async () => {} }

      const pending = provider.collect(v1Ref(), makeRequest(file), sink, makeContext({ signal: controller.signal, retry }))
      setTimeout(() => controller.abort(new DOMException('Caller stopped', 'AbortError')), 50)

      await expect(pending).rejects.toMatchObject({
        failure: expect.objectContaining({ code: 'CANCELLED' }),
      })
      expect(mock.requests.filter(request => request.url.startsWith('/v1/files/'))).toHaveLength(1)
    })

    it('refuses to collect while the job is still running', async () => {
      mock = new V1Mock()
      mock.jobStatus = 'running'
      mock.jobFiles = [{ file_id: 'file_up_1', name: 'doc.pdf', page_range: '', status: 'running', output_files: null, error: null }]
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })
      const sink = new RecordingSink()
      const file = await createTestFile('doc.pdf')

      await expect(provider.collect(v1Ref(), makeRequest(file), sink, makeContext())).rejects.toMatchObject({
        failure: expect.objectContaining({ code: 'RESULT_NOT_READY' }),
      })
    })

    it('rejects an archive larger than the configured download limit', async () => {
      mock = new V1Mock()
      mock.jobStatus = 'completed'
      mock.archive = await v1Archive()
      await mock.start()
      const provider = makeProvider({ baseURL: mock.url })
      const sink = new RecordingSink()
      const file = await createTestFile('doc.pdf')

      const context = makeContext()
      await expect(provider.collect(v1Ref(), makeRequest(file), sink, {
        ...context,
        limits: { ...context.limits, maxZipDownloadBytes: 64 },
      })).rejects.toMatchObject({
        failure: expect.objectContaining({ code: 'RESULT_TOO_LARGE' }),
      })
    })

    it('collects two files that resolve to the same archive file id', async () => {
      mock = new V1Mock()
      mock.jobStatus = 'completed'
      mock.archive = await v1Archive()
      await mock.start()
      mock.jobFiles = [
        { file_id: 'file_up_1', name: 'doc.pdf', page_range: '', status: 'completed', output_files: { zip: { file_id: 'file_out_1', bytes: mock.archive.byteLength } }, error: null },
        { file_id: 'file_up_2', name: 'doc2.pdf', page_range: '', status: 'completed', output_files: { zip: { file_id: 'file_out_1', bytes: mock.archive.byteLength } }, error: null },
      ]
      const provider = makeProvider({ baseURL: mock.url })
      const sink = new RecordingSink()
      const file = await createTestFile('doc.pdf')
      const ref = {
        provider: 'self-hosted-v1' as const,
        protocol: 'v1' as const,
        taskId: 'job_1',
        files: [
          { dataId: 'd1', fileId: createFileId(SHA256_A), name: 'doc.pdf' },
          { dataId: 'd2', fileId: createFileId(SHA256_B), name: 'doc2.pdf' },
        ],
      }

      const collected = await provider.collect(ref, makeRequest(file), sink, makeContext())
      expect(collected.files).toHaveLength(2)
      expect(collected.files.map(entry => entry.failure)).toEqual([undefined, undefined])
      expect(collected.files.map(entry => String(entry.fileId))).toEqual([
        String(createFileId(SHA256_A)),
        String(createFileId(SHA256_B)),
      ])
      expect(sink.temporaryNames).toEqual(['mineru_v1_0_file_out_1.zip', 'mineru_v1_1_file_out_1.zip'])
    })

    it.each([
      { provider: 'official-v4' as const, batchId: 'batch_1', files: [] },
      { provider: 'self-hosted-legacy-v2' as const, protocol: 'legacy' as const, taskId: 'legacy_1', files: [] },
    ])('rejects a foreign provider reference %j for inspect and collect', async ref => {
      const provider = makeProvider({ baseURL: 'http://127.0.0.1:1' })
      const sink = new RecordingSink()
      const file = await createTestFile('doc.pdf')
      await expect(provider.inspect(ref, makeContext())).rejects.toMatchObject({
        failure: expect.objectContaining({ code: 'INVALID_REQUEST' }),
      })
      await expect(provider.collect(ref, makeRequest(file), sink, makeContext())).rejects.toMatchObject({
        failure: expect.objectContaining({ code: 'INVALID_REQUEST' }),
      })
    })
  })
})
