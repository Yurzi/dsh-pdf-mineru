import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ZipFile } from 'yazl'
import { asFileId, asProviderConfigId, createFileId, type MinerUFileId } from '../src/domain/ids.js'
import { MinerUError } from '../src/domain/errors.js'
import type { ArtifactKind, CanonicalParseRequest, PreparedSourceFile } from '../src/domain/request.js'
import type { ArtifactRef } from '../src/domain/result.js'
import type {
  ArtifactInput,
  ArtifactSink,
  ArtifactWriteOptions,
  ProviderCallContext,
  ProviderJobRef,
  TemporaryArtifact,
} from '../src/providers/provider.js'
import { OfficialV4Provider } from '../src/providers/official-v4.js'
import type { OfficialV4Config } from '../src/config.js'

const SHA256_A = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const SHA256_B = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'

class MockArtifactSink implements ArtifactSink {
  readonly written: Array<{
    fileId: MinerUFileId
    kind: ArtifactKind
    input: ArtifactInput
    options: ArtifactWriteOptions
  }> = []

  readonly temporaries: Array<{
    name: string
    input: ArtifactInput
    maxBytes: number
    path: string
  }> = []

  async writeArtifact(
    fileId: MinerUFileId,
    kind: ArtifactKind,
    input: ArtifactInput,
    options: ArtifactWriteOptions,
  ): Promise<ArtifactRef> {
    this.written.push({ fileId, kind, input, options })
    const bytes = typeof input === 'string'
      ? Buffer.byteLength(input)
      : input instanceof Uint8Array
        ? input.byteLength
        : Buffer.isBuffer(input)
          ? input.length
          : 100

    return {
      kind,
      relativePath: `files/${String(fileId)}/${options.relativeName ?? 'artifact.bin'}`,
      mediaType: options.mediaType,
      bytes,
      sha256: SHA256_A,
    }
  }

  async writeTemporary(name: string, input: ArtifactInput, maxBytes: number): Promise<TemporaryArtifact> {
    const dir = await mkdtemp(join(tmpdir(), 'mineru-temp-sink-'))
    const filePath = join(dir, name)

    if (typeof input === 'string') {
      await writeFile(filePath, input, 'utf8')
    } else if (input instanceof Uint8Array || Buffer.isBuffer(input)) {
      await writeFile(filePath, input)
    } else if (input instanceof Readable) {
      const out = createWriteStream(filePath)
      await pipeline(input, out)
    } else if (input !== null && typeof input === 'object' && 'getReader' in input) {
      const nodeStream = Readable.fromWeb(input as import('node:stream/web').ReadableStream<Uint8Array>)
      const out = createWriteStream(filePath)
      await pipeline(nodeStream, out)
    }

    this.temporaries.push({ name, input, maxBytes, path: filePath })
    return {
      path: filePath,
      bytes: 100,
      sha256: SHA256_A,
    }
  }
}

describe('OfficialV4Provider', () => {
  const tempDirs: string[] = []
  const originalFetch = globalThis.fetch

  function makeContext(overrides: Partial<ProviderCallContext> = {}): ProviderCallContext {
    return {
      signal: new AbortController().signal,
      credential: 'test-official-token-xyz',
      timeoutMs: 5000,
      limits: {
        maxApiResponseBytes: 1024 * 1024,
        maxZipDownloadBytes: 50 * 1024 * 1024,
        maxZipEntries: 100,
        maxZipEntryBytes: 10 * 1024 * 1024,
        maxZipTotalBytes: 50 * 1024 * 1024,
        maxZipCompressionRatio: 50,
      },
      ...overrides,
    }
  }

  function makeConfig(overrides: Partial<OfficialV4Config> = {}): OfficialV4Config {
    return {
      id: asProviderConfigId('mp_official_v4'),
      type: 'official-v4',
      baseURL: 'https://mineru.net/api/v4',
      apiKeyEnv: 'MINERU_API_KEY',
      models: ['pipeline', 'vlm'],
      configuredVersion: 'v4',
      ...overrides,
    }
  }

  async function createTestFile(name: string, content = '%PDF-1.4 sample'): Promise<PreparedSourceFile> {
    const dir = await mkdtemp(join(tmpdir(), 'mineru-test-file-'))
    tempDirs.push(dir)
    const filePath = join(dir, name)
    await writeFile(filePath, content, 'utf8')
    const st = await stat(filePath)
    const fileId = createFileId(SHA256_A)
    return {
      fileId,
      name,
      bytes: st.size,
      sha256: SHA256_A,
      path: filePath,
      fingerprint: {
        size: st.size,
        mtimeMs: st.mtimeMs,
        device: st.dev,
        inode: st.ino,
      },
    }
  }

  async function createValidResultZipBuffer(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const zip = new ZipFile()
      const chunks: Buffer[] = []
      zip.outputStream.on('data', chunk => chunks.push(chunk))
      zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
      zip.outputStream.on('error', reject)

      zip.addBuffer(Buffer.from('# Full Parsed Markdown', 'utf8'), 'full.md')
      zip.addBuffer(Buffer.from(JSON.stringify({ layout: 'ok' }), 'utf8'), 'layout.json')
      zip.end()
    })
  }

  afterEach(async () => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
    await Promise.all(tempDirs.splice(0).map(d => rm(d, { recursive: true, force: true })))
  })

  describe('Constructor & URL Validation', () => {
    it('accepts valid HTTPS baseURL', () => {
      const provider = new OfficialV4Provider(makeConfig())
      expect(provider.id).toBe('official-v4')
      expect(provider.capabilities.models).toEqual(['pipeline', 'vlm'])
      expect(provider.capabilities.maxFilesPerSubmission).toBe(200)
    })

    it('rejects HTTP baseURL (must use HTTPS)', () => {
      expect(() => new OfficialV4Provider(makeConfig({ baseURL: 'http://mineru.net/api/v4' }))).toThrow(MinerUError)
      expect(() => new OfficialV4Provider(makeConfig({ baseURL: 'http://mineru.net/api/v4' }))).toThrow(/HTTPS/)
    })

    it('rejects baseURL with embedded credentials, query params, or fragments', () => {
      expect(() => new OfficialV4Provider(makeConfig({ baseURL: 'https://user:pass@mineru.net/api/v4' }))).toThrow(/embedded credentials/)
      expect(() => new OfficialV4Provider(makeConfig({ baseURL: 'https://mineru.net/api/v4?token=secret' }))).toThrow(/query parameters/)
      expect(() => new OfficialV4Provider(makeConfig({ baseURL: 'https://mineru.net/api/v4#frag' }))).toThrow(/query parameters or fragments/)
    })

    it('rejects empty or invalid baseURL string', () => {
      expect(() => new OfficialV4Provider(makeConfig({ baseURL: '' }))).toThrow(MinerUError)
      expect(() => new OfficialV4Provider(makeConfig({ baseURL: 'not-a-url' }))).toThrow(MinerUError)
    })
  })

  describe('compatibilityKey', () => {
    it('generates deterministic key without plaintext URL or secret token', async () => {
      const provider = new OfficialV4Provider(makeConfig({
        baseURL: 'https://secret-cluster.mineru.net/api/v4/',
      }))

      const request: CanonicalParseRequest = {
        schemaVersion: 1,
        files: [{ fileId: createFileId(SHA256_A), name: 'doc.pdf', bytes: 100, sha256: SHA256_A }],
        semantics: { model: 'vlm', ocr: true, parseMethod: 'ocr', language: 'ch', formula: true, table: true },
        requiredArtifacts: ['markdown'],
      }

      const key = await provider.compatibilityKey(request, {})
      expect(key).toMatch(/^official-v4:[a-f0-9]{16}:v4:vlm$/)
      expect(key).not.toContain('secret-cluster')
      expect(key).not.toContain('https://')
    })
  })

  describe('probe', () => {
    it('returns not-configured when credential is empty', async () => {
      const provider = new OfficialV4Provider(makeConfig())
      const result = await provider.probe(makeContext({ credential: '' }))

      expect(result.available).toBe(false)
      expect(result.authentication).toBe('not-configured')
      expect(result.provider).toBe('official-v4')
      expect(result.protocolVersion).toBe('v4')
      expect(result.queue).toBeUndefined()
    })

    it('returns available: true and authentication: valid on successful probe query', async () => {
      const fetchMock = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        expect(url).toBe('https://mineru.net/api/v4/extract-results/batch/__dsh_probe__')
        expect(init.method).toBe('GET')
        expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer test-official-token-xyz')
        expect(init.redirect).toBe('error')
        return new Response(JSON.stringify({ code: 0, msg: 'ok', data: { batch_id: '__dsh_probe__' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      })
      globalThis.fetch = fetchMock

      const provider = new OfficialV4Provider(makeConfig())
      const result = await provider.probe(makeContext())

      expect(result.available).toBe(true)
      expect(result.authentication).toBe('valid')
      expect(result.provider).toBe('official-v4')
      expect(result.protocolVersion).toBe('v4')
      expect(result.queue).toBeUndefined()
    })

    it.each(['A0202', 'A0211', '401'])('returns invalid for HTTP 200 auth business code %s', async code => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code, msg: 'Token invalid or expired' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
      const result = await new OfficialV4Provider(makeConfig()).probe(makeContext())
      expect(result.available).toBe(false)
      expect(result.authentication).toBe('invalid')
      expect(result.diagnostics).toContain('Token invalid')
    })

    it('returns authentication: invalid on 401 response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 401, msg: 'Invalid token' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }))

      const provider = new OfficialV4Provider(makeConfig())
      const result = await provider.probe(makeContext())

      expect(result.available).toBe(false)
      expect(result.authentication).toBe('invalid')
      expect(result.diagnostics).toContain('Invalid token')
    })
  })

  describe('submit (POST /file-urls/batch + Bare PUT)', () => {
    it('executes POST with Bearer JSON and follows up with strictly bare PUT', async () => {
      const source = await createTestFile('sample.pdf', '%PDF-1.4 test binary data')
      const request: CanonicalParseRequest = {
        schemaVersion: 1,
        files: [source],
        semantics: {
          model: 'vlm',
          ocr: true,
          parseMethod: 'auto',
          language: 'ch',
          formula: true,
          table: true,
          pages: '1-5',
        },
        requiredArtifacts: ['markdown', 'layout'],
      }

      let postCalled = false
      let putCalled = false

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        if (url === 'https://mineru.net/api/v4/file-urls/batch') {
          postCalled = true
          expect(init.method).toBe('POST')
          const headers = init.headers as Record<string, string>
          expect(headers['authorization']).toBe('Bearer test-official-token-xyz')
          expect(headers['content-type']).toBe('application/json')
          expect(init.redirect).toBe('error')

          const body = JSON.parse(init.body as string)
          expect(body.model_version).toBe('vlm')
          expect(body.files).toHaveLength(1)
          expect(body.files[0].name).toBe('sample.pdf')
          expect(body.files[0].data_id).toBe(`data_${String(source.fileId)}`)
          expect(body.files[0].is_ocr).toBe(true)
          expect(body.files[0].enable_formula).toBe(true)
          expect(body.files[0].enable_table).toBe(true)
          expect(body.files[0].language).toBe('ch')
          expect(body.files[0].page_ranges).toBe('1-5')

          return new Response(JSON.stringify({
            code: 0,
            msg: 'ok',
            trace_id: 'trace_submit_1',
            data: {
              batch_id: 'batch_uuid_123',
              file_urls: ['https://oss.example.com/upload-presigned-url-1'],
            },
          }), { status: 200, headers: { 'content-type': 'application/json' } })
        }

        if (url === 'https://oss.example.com/upload-presigned-url-1') {
          putCalled = true
          expect(init.method).toBe('PUT')
          expect(init.redirect).toBe('error')
          expect((init as RequestInit & { duplex?: string }).duplex).toBe('half')
          const headers = init.headers as Record<string, string>
          // Assert that Authorization and Content-Type are strictly ABSENT on bare PUT
          expect(headers['authorization']).toBeUndefined()
          expect(headers['Authorization']).toBeUndefined()
          expect(headers['content-type']).toBeUndefined()
          expect(headers['Content-Type']).toBeUndefined()
          expect(Object.keys(headers)).toHaveLength(0)

          return new Response(null, { status: 200 })
        }

        throw new Error(`Unexpected fetch to ${url}`)
      })

      const provider = new OfficialV4Provider(makeConfig())
      const submission = await provider.submit(request, [source], makeContext())

      expect(postCalled).toBe(true)
      expect(putCalled).toBe(true)
      expect(submission.ref.provider).toBe('official-v4')
      if (submission.ref.provider !== 'official-v4') throw new Error('unexpected provider ref')
      expect(submission.ref.batchId).toBe('batch_uuid_123')
      expect(submission.ref.files).toHaveLength(1)
      expect(submission.ref.files[0]?.dataId).toBe(`data_${String(source.fileId)}`)
      expect(submission.state).toBe('processing')
    })

    it('rejects if API returns HTTP 200 with code != 0 and preserves providerCode and traceId', async () => {
      const source = await createTestFile('sample.pdf')
      const request: CanonicalParseRequest = {
        schemaVersion: 1,
        files: [source],
        semantics: { model: 'vlm', ocr: false, parseMethod: 'auto', language: 'ch', formula: true, table: true },
        requiredArtifacts: ['markdown'],
      }

      globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        code: 4001,
        msg: 'User quota exceeded',
        trace_id: 'trace_err_quota_999',
      }), { status: 200, headers: { 'content-type': 'application/json' } }))

      const provider = new OfficialV4Provider(makeConfig())

      try {
        await provider.submit(request, [source], makeContext())
        expect.unreachable('Should have thrown MinerUError')
      } catch (err) {
        expect(err).toBeInstanceOf(MinerUError)
        const failure = (err as MinerUError).failure
        expect(failure.code).toBe('REMOTE_PARSE_FAILED')
        expect(failure.message).toContain('quota exceeded')
        expect(failure.providerCode).toBe('4001')
        expect(failure.traceId).toBe('trace_err_quota_999')
      }
    })

    it.each([
      ['A0202', 'AUTHENTICATION_FAILED'],
      ['A0211', 'AUTHENTICATION_FAILED'],
      [-60018, 'PROVIDER_QUOTA_EXHAUSTED'],
      [-60005, 'FILE_TOO_LARGE'],
    ] as const)('maps official business code %s to %s', async (providerCode, expectedCode) => {
      const source = await createTestFile('business-code.pdf')
      const request: CanonicalParseRequest = {
        schemaVersion: 1,
        files: [source],
        semantics: { model: 'vlm', ocr: false, parseMethod: 'auto', language: 'ch', formula: true, table: true },
        requiredArtifacts: ['markdown'],
      }
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        code: providerCode, msg: 'official business failure', trace_id: 'trace-business',
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      await expect(new OfficialV4Provider(makeConfig()).submit(request, [source], makeContext()))
        .rejects.toMatchObject({ failure: { code: expectedCode, providerCode: String(providerCode), traceId: 'trace-business' } })
    })

    it('rejects legacy txt parse method instead of silently treating it as auto', async () => {
      const source = await createTestFile('txt.pdf')
      const request: CanonicalParseRequest = {
        schemaVersion: 1, files: [source],
        semantics: { model: 'pipeline', ocr: false, parseMethod: 'txt', language: 'ch', formula: true, table: true },
        requiredArtifacts: ['markdown'],
      }
      await expect(new OfficialV4Provider(makeConfig()).submit(request, [source], makeContext()))
        .rejects.toMatchObject({ failure: { code: 'UNSUPPORTED_OPTION' } })
    })

    it('rejects if PUT upload fails with non-200/204 status', async () => {
      const source = await createTestFile('sample.pdf')
      const request: CanonicalParseRequest = {
        schemaVersion: 1,
        files: [source],
        semantics: { model: 'vlm', ocr: false, parseMethod: 'auto', language: 'ch', formula: true, table: true },
        requiredArtifacts: ['markdown'],
      }

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/file-urls/batch')) {
          return new Response(JSON.stringify({
            code: 0,
            msg: 'ok',
            data: { batch_id: 'b1', file_urls: ['https://oss.example.com/put'] },
          }), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        return new Response('403 SignatureDoesNotMatch', { status: 403 })
      })

      const provider = new OfficialV4Provider(makeConfig())
      await expect(provider.submit(request, [source], makeContext())).rejects.toThrowError(/Storage upload failed/i)
    })
  })

  describe('inspect (GET /extract-results/batch/{batchId})', () => {
    it('accurately maps all official file states and aggregates batch state', async () => {
      const fileId1 = asFileId('mf_0123456789abcdef0123456789_0')
      const fileId2 = asFileId('mf_fedcba9876543210fedcba9876_1')

      const ref: ProviderJobRef = {
        provider: 'official-v4',
        batchId: 'batch_status_test',
        files: [
          { fileId: fileId1, dataId: 'data_1', name: 'file1.pdf' },
          { fileId: fileId2, dataId: 'data_2', name: 'file2.pdf' },
        ],
      }

      // Test State 1: running with progress
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        code: 0,
        msg: 'ok',
        trace_id: 'tr_status_1',
        data: {
          batch_id: 'batch_status_test',
          extract_result: [
            { data_id: 'data_1', file_name: 'file1.pdf', state: 'running', extract_progress: { extracted_pages: 3, total_pages: 10 } },
            { data_id: 'data_2', file_name: 'file2.pdf', state: 'waiting-file' },
          ],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))

      const provider = new OfficialV4Provider(makeConfig())
      const snapshot1 = await provider.inspect(ref, makeContext())

      expect(snapshot1.state).toBe('processing')
      expect(snapshot1.files[0]?.state).toBe('processing')
      expect(snapshot1.files[0]?.progress).toEqual({ completed: 3, total: 10 })
      expect(snapshot1.files[1]?.state).toBe('queued')

      // Test State 2: Partial success (file 1 done, file 2 failed)
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        code: 0,
        msg: 'ok',
        trace_id: 'tr_status_2',
        data: {
          batch_id: 'batch_status_test',
          extract_result: [
            { data_id: 'data_1', file_name: 'file1.pdf', state: 'done', full_zip_url: 'https://cdn.example.com/1.zip' },
            { data_id: 'data_2', file_name: 'file2.pdf', state: 'failed', err_msg: 'Encrypted document' },
          ],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))

      const snapshot2 = await provider.inspect(ref, makeContext())
      expect(snapshot2.state).toBe('partially-completed')
      expect(snapshot2.files[0]?.state).toBe('completed')
      expect(snapshot2.files[1]?.state).toBe('failed')
      expect(snapshot2.files[1]?.failure?.message).toContain('Encrypted document')
      expect(snapshot2.files[1]?.failure?.traceId).toBe('tr_status_2')

      // Test State 3: All done -> completed
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        code: 0,
        msg: 'ok',
        data: {
          batch_id: 'batch_status_test',
          extract_result: [
            { data_id: 'data_1', file_name: 'file1.pdf', state: 'done', full_zip_url: 'https://cdn.example.com/1.zip' },
            { data_id: 'data_2', file_name: 'file2.pdf', state: 'done', full_zip_url: 'https://cdn.example.com/2.zip' },
          ],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))

      const snapshot3 = await provider.inspect(ref, makeContext())
      expect(snapshot3.state).toBe('completed')

      // Test State 4: All failed -> failed
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        code: 0,
        msg: 'ok',
        data: {
          batch_id: 'batch_status_test',
          extract_result: [
            { data_id: 'data_1', file_name: 'file1.pdf', state: 'failed', err_msg: 'Corrupt' },
            { data_id: 'data_2', file_name: 'file2.pdf', state: 'failed', err_msg: 'Corrupt' },
          ],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))

      const snapshot4 = await provider.inspect(ref, makeContext())
      expect(snapshot4.state).toBe('failed')
    })

    it('matches results strictly by data_id and ignores file_name differences', async () => {
      const fileId = asFileId('mf_0123456789abcdef0123456789_0')
      const ref: ProviderJobRef = {
        provider: 'official-v4',
        batchId: 'batch_data_id_test',
        files: [{ fileId, dataId: 'unique_data_id_abc', name: 'original_input.pdf' }],
      }

      globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        code: 0,
        msg: 'ok',
        data: {
          batch_id: 'batch_data_id_test',
          extract_result: [
            // Server returned normalized / altered file_name, but matching data_id
            { data_id: 'unique_data_id_abc', file_name: 'normalized_diff_name.pdf', state: 'done', full_zip_url: 'https://cdn.example.com/z.zip' },
          ],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))

      const provider = new OfficialV4Provider(makeConfig())
      const snapshot = await provider.inspect(ref, makeContext())

      expect(snapshot.state).toBe('completed')
      expect(snapshot.files[0]?.state).toBe('completed')
      expect(snapshot.files[0]?.fileId).toBe(fileId)
    })
  })

  describe('collect (Download ZIP + Safe Extraction)', () => {
    it('downloads ZIP without Authorization header and de-duplicates identical ZIP URLs', async () => {
      const fileId1 = asFileId('mf_0123456789abcdef0123456789_0')
      const fileId2 = asFileId('mf_fedcba9876543210fedcba9876_1')

      const ref: ProviderJobRef = {
        provider: 'official-v4',
        batchId: 'batch_collect_test',
        files: [
          { fileId: fileId1, dataId: 'data_1', name: 'doc1.pdf' },
          { fileId: fileId2, dataId: 'data_2', name: 'doc2.pdf' },
        ],
      }

      const request: CanonicalParseRequest = {
        schemaVersion: 1,
        files: [
          { fileId: fileId1, name: 'doc1.pdf', bytes: 100, sha256: SHA256_A },
          { fileId: fileId2, name: 'doc2.pdf', bytes: 100, sha256: SHA256_B },
        ],
        semantics: { model: 'vlm', ocr: false, parseMethod: 'auto', language: 'ch', formula: true, table: true },
        requiredArtifacts: ['markdown', 'layout'],
      }

      const zipBuf = await createValidResultZipBuffer()
      let cdnDownloadCount = 0

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        if (url.includes('/extract-results/batch/')) {
          return new Response(JSON.stringify({
            code: 0,
            msg: 'ok',
            data: {
              batch_id: 'batch_collect_test',
              extract_result: [
                // Both files share the same full_zip_url
                { data_id: 'data_1', file_name: 'doc1.pdf', state: 'done', full_zip_url: 'https://cdn-mineru.example.com/shared_result.zip' },
                { data_id: 'data_2', file_name: 'doc2.pdf', state: 'done', full_zip_url: 'https://cdn-mineru.example.com/shared_result.zip' },
              ],
            },
          }), { status: 200, headers: { 'content-type': 'application/json' } })
        }

        if (url === 'https://cdn-mineru.example.com/shared_result.zip') {
          cdnDownloadCount++
          expect(init.method).toBe('GET')
          const headers = init.headers as Record<string, string>
          // Assert Authorization header is NOT sent to CDN
          expect(headers['authorization']).toBeUndefined()
          expect(headers['Authorization']).toBeUndefined()
          expect(init.redirect).toBe('error')
          const body = zipBuf.buffer.slice(zipBuf.byteOffset, zipBuf.byteOffset + zipBuf.byteLength) as ArrayBuffer
          return new Response(body, { status: 200, headers: { 'content-type': 'application/zip' } })
        }

        throw new Error(`Unexpected fetch: ${url}`)
      })

      const sink = new MockArtifactSink()
      const provider = new OfficialV4Provider(makeConfig())
      const collection = await provider.collect(ref, request, sink, makeContext())

      // CDN download was executed only ONCE for the shared ZIP URL
      expect(cdnDownloadCount).toBe(1)
      expect(collection.files).toHaveLength(2)
      expect(collection.files[0]?.fileId).toBe(fileId1)
      expect(collection.files[0]?.failure).toBeUndefined()
      expect(collection.files[1]?.fileId).toBe(fileId2)
      expect(collection.files[1]?.failure).toBeUndefined()
    })

    it('throws RESULT_NOT_READY if task is not in done/failed state', async () => {
      const fileId = asFileId('mf_0123456789abcdef0123456789_0')
      const ref: ProviderJobRef = {
        provider: 'official-v4',
        batchId: 'batch_not_ready',
        files: [{ fileId, dataId: 'data_1', name: 'doc1.pdf' }],
      }

      const request: CanonicalParseRequest = {
        schemaVersion: 1,
        files: [{ fileId, name: 'doc1.pdf', bytes: 100, sha256: SHA256_A }],
        semantics: { model: 'vlm', ocr: false, parseMethod: 'auto', language: 'ch', formula: true, table: true },
        requiredArtifacts: ['markdown'],
      }

      globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        code: 0,
        msg: 'ok',
        data: {
          batch_id: 'batch_not_ready',
          extract_result: [{ data_id: 'data_1', file_name: 'doc1.pdf', state: 'running' }],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))

      const sink = new MockArtifactSink()
      const provider = new OfficialV4Provider(makeConfig())

      await expect(provider.collect(ref, request, sink, makeContext())).rejects.toThrowError(/not ready/i)
    })
  })
})
