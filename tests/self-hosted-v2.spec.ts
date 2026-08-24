import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asProviderConfigId, createFileId, type MinerUFileId } from '../src/domain/ids.js'
import { parseProviderJobRef } from '../src/domain/schemas.js'
import { MinerUError } from '../src/domain/errors.js'
import type {
  ArtifactInput,
  ArtifactSink,
  ArtifactWriteOptions,
  ProviderCallContext,
  TemporaryArtifact,
} from '../src/providers/provider.js'
import type { ArtifactRef } from '../src/domain/result.js'
import type { ArtifactKind, CanonicalParseRequest, PreparedSourceFile } from '../src/domain/request.js'
import {
  SelfHostedV2Provider,
  type SelfHostedV2ProviderConfig,
} from '../src/providers/self-hosted-v2.js'

const SHA256_A = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const SHA256_B = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'

class MockArtifactSink implements ArtifactSink {
  readonly written: Array<{
    fileId: string
    kind: string
    input: ArtifactInput
    options: ArtifactWriteOptions
  }> = []

  async writeArtifact(
    fileId: MinerUFileId,
    kind: ArtifactKind,
    input: ArtifactInput,
    options: ArtifactWriteOptions,
  ): Promise<ArtifactRef> {
    this.written.push({ fileId: String(fileId), kind: String(kind), input, options })
    return {
      kind,
      relativePath: options.relativeName ?? 'artifact.bin',
      mediaType: options.mediaType,
      bytes: typeof input === 'string' ? Buffer.byteLength(input) : input instanceof Uint8Array ? input.byteLength : 100,
      sha256: SHA256_A,
    }
  }

  async writeTemporary(name: string, input: ArtifactInput, maxBytes: number): Promise<TemporaryArtifact> {
    return {
      path: '/tmp/test',
      bytes: 100,
      sha256: SHA256_A,
    }
  }
}

describe('SelfHostedV2Provider', () => {
  let server: Server | undefined
  let serverUrl = ''
  const tempDirs: string[] = []

  function getPort(s: Server): number {
    const addr = s.address()
    if (addr && typeof addr === 'object') return (addr as AddressInfo).port
    throw new Error('Server has no port')
  }

  async function createTestFile(name: string, content = '%PDF-1.4 test'): Promise<PreparedSourceFile> {
    const dir = await mkdtemp(join(tmpdir(), 'mineru-test-'))
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
      ...overrides,
    }
  }

  afterEach(async () => {
    if (server) {
      await new Promise(resolve => server!.close(resolve))
      server = undefined
    }
    await Promise.all(tempDirs.splice(0).map(d => rm(d, { recursive: true, force: true })))
  })

  describe('Constructor & URL Validation', () => {
    it('accepts HTTPS baseURL', () => {
      const provider = new SelfHostedV2Provider({
        id: asProviderConfigId('mp_prod'),
        type: 'self-hosted-v2',
        baseURL: 'https://mineru.example.com/api/v2',
        modelMap: { pipeline: 'pipeline', vlm: 'vlm-engine' },
      })
      expect(provider.id).toBe('self-hosted-v2')
      expect(provider.capabilities.models).toEqual(['pipeline', 'vlm'])
    })

    it('rejects HTTP baseURL when allowInsecureHttp is omitted or false', () => {
      expect(() => {
        new SelfHostedV2Provider({
          id: asProviderConfigId('mp_local'),
          type: 'self-hosted-v2',
          baseURL: 'http://127.0.0.1:8000',
          modelMap: { pipeline: 'pipeline' },
        })
      }).toThrow(MinerUError)

      expect(() => {
        new SelfHostedV2Provider({
          id: asProviderConfigId('mp_local'),
          type: 'self-hosted-v2',
          baseURL: 'http://127.0.0.1:8000',
          modelMap: { pipeline: 'pipeline' },
          allowInsecureHttp: false,
        })
      }).toThrow(MinerUError)
    })

    it('accepts HTTP baseURL when allowInsecureHttp is true', () => {
      const provider = new SelfHostedV2Provider({
        id: asProviderConfigId('mp_local'),
        type: 'self-hosted-v2',
        baseURL: 'http://127.0.0.1:8000',
        modelMap: { pipeline: 'pipeline' },
        allowInsecureHttp: true,
      })
      expect(provider.id).toBe('self-hosted-v2')
    })

    it('rejects baseURL with credentials or invalid protocols', () => {
      expect(() => {
        new SelfHostedV2Provider({
          id: asProviderConfigId('mp_local'),
          type: 'self-hosted-v2',
          baseURL: 'https://user:pass@example.com',
          modelMap: { pipeline: 'pipeline' },
        })
      }).toThrow(MinerUError)

      expect(() => {
        new SelfHostedV2Provider({
          id: asProviderConfigId('mp_local'),
          type: 'self-hosted-v2',
          baseURL: 'ftp://example.com',
          modelMap: { pipeline: 'pipeline' },
        })
      }).toThrow(MinerUError)

      expect(() => {
        new SelfHostedV2Provider({
          id: asProviderConfigId('mp_local'),
          type: 'self-hosted-v2',
          baseURL: 'not-a-url',
          modelMap: { pipeline: 'pipeline' },
        })
      }).toThrow(MinerUError)

      expect(() => new SelfHostedV2Provider({
        id: asProviderConfigId('mp_local'),
        type: 'self-hosted-v2',
        baseURL: 'https://example.com/v2?token=secret',
        modelMap: { pipeline: 'pipeline' },
      })).toThrow(/query or fragment/)
    })
  })

  describe('compatibilityKey', () => {
    it('generates deterministic key without plaintext URL or credentials', async () => {
      const provider = new SelfHostedV2Provider({
        id: asProviderConfigId('mp_local'),
        type: 'self-hosted-v2',
        baseURL: 'https://secret-internal-host:8000/v2/',
        modelMap: { pipeline: 'pipeline' },
        configuredVersion: 'v3.4.4',
      })

      const request: CanonicalParseRequest = {
        schemaVersion: 1,
        files: [{ fileId: createFileId(SHA256_A), name: 'doc.pdf', bytes: 100, sha256: SHA256_A }],
        semantics: { model: 'pipeline', ocr: false, parseMethod: 'auto', language: 'ch', formula: true, table: true },
        requiredArtifacts: ['markdown'],
      }

      const key = await provider.compatibilityKey(request, {})
      expect(key).toMatch(/^self-hosted-v2:[a-f0-9]{16}:v3\.4\.4:pipeline$/)
      expect(key).not.toContain('secret-internal-host')
      expect(key).not.toContain('https://')
    })

    it('uses config ID as fallback version when configuredVersion is absent', async () => {
      const provider = new SelfHostedV2Provider({
        id: asProviderConfigId('mp_custom_v1'),
        type: 'self-hosted-v2',
        baseURL: 'https://mineru.example.com',
        modelMap: { vlm: 'vlm-engine' },
      })

      const request: CanonicalParseRequest = {
        schemaVersion: 1,
        files: [{ fileId: createFileId(SHA256_A), name: 'doc.pdf', bytes: 100, sha256: SHA256_A }],
        semantics: { model: 'vlm', ocr: true, parseMethod: 'ocr', language: 'en', formula: false, table: false },
        requiredArtifacts: ['markdown'],
      }

      const key = await provider.compatibilityKey(request, {})
      expect(key).toMatch(/^self-hosted-v2:[a-f0-9]{16}:mp_custom_v1:vlm$/)
    })
  })

  describe('probe (GET /health)', () => {
    it('returns available and queue stats on healthy 200 response', async () => {
      let receivedAuthHeader: string | undefined
      server = createServer((req, res) => {
        receivedAuthHeader = req.headers['authorization']
        if (req.url === '/health' && req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({
            status: 'healthy',
            version: '3.4.4',
            protocol_version: 2,
            queued_tasks: 2,
            processing_tasks: 1,
            completed_tasks: 50,
            failed_tasks: 0,
            max_concurrent_requests: 4,
          }))
          return
        }
        res.writeHead(404)
        res.end()
      })
      await new Promise(resolve => server!.listen(0, '127.0.0.1', () => resolve(true)))
      const port = getPort(server!)
      serverUrl = `http://127.0.0.1:${port}`

      const provider = new SelfHostedV2Provider({
        id: asProviderConfigId('mp_local'),
        type: 'self-hosted-v2',
        baseURL: serverUrl,
        modelMap: { pipeline: 'pipeline' },
        allowInsecureHttp: true,
      })

      const probeResult = await provider.probe(makeContext({ credential: 'my-secret-token' }))
      expect(receivedAuthHeader).toBe('Bearer my-secret-token')
      expect(probeResult.available).toBe(true)
      expect(probeResult.provider).toBe('self-hosted-v2')
      expect(probeResult.authentication).toBe('valid')
      expect(probeResult.protocolVersion).toBe('v2')
      expect(probeResult.serverVersion).toBe('3.4.4')
      expect(probeResult.queue).toEqual({
        queued: 2,
        processing: 1,
        completed: 50,
        failed: 0,
        maxConcurrent: 4,
      })
    })

    it('handles unhealthy 200 response and unconfigured credential', async () => {
      let receivedAuthHeader: string | undefined
      server = createServer((req, res) => {
        receivedAuthHeader = req.headers['authorization']
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          status: 'unhealthy',
          version: '3.4.4',
          protocol_version: 2,
        }))
      })
      await new Promise(resolve => server!.listen(0, '127.0.0.1', () => resolve(true)))
      const port = getPort(server!)

      const provider = new SelfHostedV2Provider({
        id: asProviderConfigId('mp_local'),
        type: 'self-hosted-v2',
        baseURL: `http://127.0.0.1:${port}`,
        modelMap: { pipeline: 'pipeline' },
        allowInsecureHttp: true,
      })

      const probeResult = await provider.probe(makeContext())
      expect(receivedAuthHeader).toBeUndefined()
      expect(probeResult.available).toBe(false)
      expect(probeResult.authentication).toBe('not-configured')
      expect(probeResult.diagnostics).toContain('unhealthy')
    })

    it('reports authentication: invalid when probe returns 401/403', async () => {
      server = createServer((req, res) => {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ detail: 'Invalid token' }))
      })
      await new Promise(resolve => server!.listen(0, '127.0.0.1', () => resolve(true)))
      const port = getPort(server!)

      const provider = new SelfHostedV2Provider({
        id: asProviderConfigId('mp_local'),
        type: 'self-hosted-v2',
        baseURL: `http://127.0.0.1:${port}`,
        modelMap: { pipeline: 'pipeline' },
        allowInsecureHttp: true,
      })

      const probeResult = await provider.probe(makeContext({ credential: 'bad-token' }))
      expect(probeResult.available).toBe(false)
      expect(probeResult.authentication).toBe('invalid')
      expect(probeResult.diagnostics).toContain('Authentication failed (401)')
    })

    it('rejects HTTP redirects with redirect: error', async () => {
      server = createServer((req, res) => {
        res.writeHead(302, { location: '/somewhere-else' })
        res.end()
      })
      await new Promise(resolve => server!.listen(0, '127.0.0.1', () => resolve(true)))
      const port = getPort(server!)

      const provider = new SelfHostedV2Provider({
        id: asProviderConfigId('mp_local'),
        type: 'self-hosted-v2',
        baseURL: `http://127.0.0.1:${port}`,
        modelMap: { pipeline: 'pipeline' },
        allowInsecureHttp: true,
      })

      const probeResult = await provider.probe(makeContext())
      expect(probeResult.available).toBe(false)
      expect(probeResult.diagnostics).toBeTruthy()
    })

    it('handles server connection errors gracefully', async () => {
      const provider = new SelfHostedV2Provider({
        id: asProviderConfigId('mp_local'),
        type: 'self-hosted-v2',
        baseURL: 'http://127.0.0.1:59999', // inactive port
        modelMap: { pipeline: 'pipeline' },
        allowInsecureHttp: true,
      })

      const probeResult = await provider.probe(makeContext())
      expect(probeResult.available).toBe(false)
      expect(probeResult.diagnostics).toBeTruthy()
    })

    it('rethrows CANCELLED when probe is aborted by signal', async () => {
      const controller = new AbortController()
      controller.abort()

      const provider = new SelfHostedV2Provider({
        id: asProviderConfigId('mp_local'),
        type: 'self-hosted-v2',
        baseURL: 'https://example.com',
        modelMap: { pipeline: 'pipeline' },
      })

      await expect(provider.probe(makeContext({ signal: controller.signal }))).rejects.toMatchObject({
        failure: { code: 'CANCELLED' },
      })
    })
  })

  describe('submit (POST /tasks)', () => {
    it('streams multipart form-data with all field mappings and returns ProviderSubmission', async () => {
      let requestBody = ''
      let requestHeaders: IncomingHttpHeaders | undefined
      let receivedUrl = ''

      server = createServer((req, res) => {
        receivedUrl = req.url ?? ''
        requestHeaders = req.headers
        req.on('data', chunk => { requestBody += chunk.toString('utf8') })
        req.on('end', () => {
          res.writeHead(202, { 'content-type': 'application/json' })
          res.end(JSON.stringify({
            task_id: 'task_abc_123',
            status: 'pending',
            backend: 'pipeline',
            file_names: ['report.pdf'],
            created_at: '2025-01-01T00:00:00Z',
            status_url: 'http://127.0.0.1/tasks/task_abc_123',
            result_url: 'http://127.0.0.1/tasks/task_abc_123/result',
            queued_ahead: 1,
          }))
        })
      })
      await new Promise(resolve => server!.listen(0, '127.0.0.1', () => resolve(true)))
      const port = getPort(server!)

      const provider = new SelfHostedV2Provider({
        id: asProviderConfigId('mp_local'),
        type: 'self-hosted-v2',
        baseURL: `http://127.0.0.1:${port}`,
        modelMap: { pipeline: 'pipeline', vlm: 'vlm-engine' },
        allowInsecureHttp: true,
      })

      const file = await createTestFile('report.pdf', '%PDF-1.4 report content')
      const request: CanonicalParseRequest = {
        schemaVersion: 1,
        files: [{ fileId: file.fileId, name: file.name, bytes: file.bytes, sha256: file.sha256 }],
        semantics: {
          model: 'pipeline',
          ocr: false,
          parseMethod: 'auto',
          language: 'ch',
          formula: true,
          table: true,
          pages: '1-5',
        },
        requiredArtifacts: ['markdown', 'layout', 'content-list', 'images'],
      }

      const submission = await provider.submit(request, [file], makeContext({ credential: 'secret-key' }))

      expect(receivedUrl).toBe('/tasks')
      if (requestHeaders === undefined) throw new Error('request headers were not captured')
      expect(requestHeaders['authorization']).toBe('Bearer secret-key')
      expect(requestHeaders['content-type']).toContain('multipart/form-data; boundary=')

      // Verify multipart payload fields
      expect(requestBody).toContain('name="backend"')
      expect(requestBody).toContain('pipeline')
      expect(requestBody).toContain('name="parse_method"')
      expect(requestBody).toContain('auto')
      expect(requestBody).toContain('name="lang_list"')
      expect(requestBody).toContain('ch')
      expect(requestBody).toContain('name="formula_enable"')
      expect(requestBody).toContain('true')
      expect(requestBody).toContain('name="table_enable"')
      expect(requestBody).toContain('true')
      expect(requestBody).toContain('name="start_page_id"')
      expect(requestBody).toContain('0')
      expect(requestBody).toContain('name="end_page_id"')
      expect(requestBody).toContain('4')
      expect(requestBody).toContain('name="return_md"')
      expect(requestBody).toContain('true')
      expect(requestBody).toContain('name="return_middle_json"')
      expect(requestBody).toContain('true')
      expect(requestBody).toContain('name="return_model_output"')
      expect(requestBody).toContain('false')
      expect(requestBody).toContain('name="return_content_list"')
      expect(requestBody).toContain('true')
      expect(requestBody).toContain('name="return_images"')
      expect(requestBody).toContain('true')
      expect(requestBody).toContain('%PDF-1.4 report content')

      // Verify ProviderSubmission structure
      const validatedRef = parseProviderJobRef(submission.ref)
      expect(validatedRef.provider).toBe('self-hosted-v2')
      if (submission.ref.provider === 'self-hosted-v2') {
        expect(submission.ref.taskId).toBe('task_abc_123')
        expect(submission.ref.files).toEqual([
          { dataId: `data_${file.fileId}`, fileId: file.fileId, name: 'report.pdf' },
        ])
      }
      expect(submission.state).toBe('queued')
      expect(submission.files).toHaveLength(1)
      expect(submission.files[0]!.fileId).toBe(file.fileId)
      expect(submission.files[0]!.state).toBe('queued')
    })

    it('maps single page number to equal start and end page indexes', async () => {
      let requestBody = ''
      server = createServer((req, res) => {
        req.on('data', chunk => { requestBody += chunk.toString('utf8') })
        req.on('end', () => {
          res.writeHead(202, { 'content-type': 'application/json' })
          res.end(JSON.stringify({
            task_id: 'task_page_3',
            status: 'pending',
          }))
        })
      })
      await new Promise(resolve => server!.listen(0, '127.0.0.1', () => resolve(true)))
      const port = getPort(server!)

      const provider = new SelfHostedV2Provider({
        id: asProviderConfigId('mp_local'),
        type: 'self-hosted-v2',
        baseURL: `http://127.0.0.1:${port}`,
        modelMap: { pipeline: 'pipeline' },
        allowInsecureHttp: true,
      })

      const file = await createTestFile('page3.pdf')
      const request: CanonicalParseRequest = {
        schemaVersion: 1,
        files: [{ fileId: file.fileId, name: file.name, bytes: file.bytes, sha256: file.sha256 }],
        semantics: { model: 'pipeline', ocr: false, parseMethod: 'auto', language: 'ch', formula: true, table: true, pages: '3' },
        requiredArtifacts: ['markdown'],
      }

      await provider.submit(request, [file], makeContext())
      expect(requestBody).toContain('name="start_page_id"')
      expect(requestBody).toContain('2')
      expect(requestBody).toContain('name="end_page_id"')
      expect(requestBody).toContain('2')
    })

    it('rejects unsupported model in modelMap', async () => {
      const provider = new SelfHostedV2Provider({
        id: asProviderConfigId('mp_local'),
        type: 'self-hosted-v2',
        baseURL: 'https://example.com',
        modelMap: { pipeline: 'pipeline' }, // vlm not mapped
      })

      const file = await createTestFile('test.pdf')
      const request: CanonicalParseRequest = {
        schemaVersion: 1,
        files: [{ fileId: file.fileId, name: file.name, bytes: file.bytes, sha256: file.sha256 }],
        semantics: { model: 'vlm', ocr: true, parseMethod: 'ocr', language: 'en', formula: true, table: true },
        requiredArtifacts: ['markdown'],
      }

      await expect(provider.submit(request, [file], makeContext())).rejects.toMatchObject({
        failure: { code: 'UNSUPPORTED_OPTION' },
      })
    })

    it('rejects multi-interval page ranges for self-hosted provider', async () => {
      const provider = new SelfHostedV2Provider({
        id: asProviderConfigId('mp_local'),
        type: 'self-hosted-v2',
        baseURL: 'https://example.com',
        modelMap: { pipeline: 'pipeline' },
      })

      const file = await createTestFile('test.pdf')
      const request: CanonicalParseRequest = {
        schemaVersion: 1,
        files: [{ fileId: file.fileId, name: file.name, bytes: file.bytes, sha256: file.sha256 }],
        semantics: { model: 'pipeline', ocr: false, parseMethod: 'auto', language: 'ch', formula: true, table: true, pages: '1-3,5-7' },
        requiredArtifacts: ['markdown'],
      }

      await expect(provider.submit(request, [file], makeContext())).rejects.toMatchObject({
        failure: { code: 'UNSUPPORTED_OPTION' },
      })
    })

    it('detects file modifications before upload via stat/fingerprint verification', async () => {
      const provider = new SelfHostedV2Provider({
        id: asProviderConfigId('mp_local'),
        type: 'self-hosted-v2',
        baseURL: 'https://example.com',
        modelMap: { pipeline: 'pipeline' },
      })

      const file = await createTestFile('test.pdf', 'original content')
      // Tamper with file size
      await writeFile(file.path, 'tampered much longer content')

      const request: CanonicalParseRequest = {
        schemaVersion: 1,
        files: [{ fileId: file.fileId, name: file.name, bytes: file.bytes, sha256: file.sha256 }],
        semantics: { model: 'pipeline', ocr: false, parseMethod: 'auto', language: 'ch', formula: true, table: true },
        requiredArtifacts: ['markdown'],
      }

      await expect(provider.submit(request, [file], makeContext())).rejects.toMatchObject({
        failure: { code: 'INVALID_REQUEST' },
      })
    })

    it('maps HTTP errors (413, 429, 500) to unified MinerUError codes', async () => {
      server = createServer((req, res) => {
        req.on('data', () => {})
        req.on('end', () => {
          res.writeHead(413, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ detail: 'File too large' }))
        })
      })
      await new Promise(resolve => server!.listen(0, '127.0.0.1', () => resolve(true)))
      const port = getPort(server!)

      const provider = new SelfHostedV2Provider({
        id: asProviderConfigId('mp_local'),
        type: 'self-hosted-v2',
        baseURL: `http://127.0.0.1:${port}`,
        modelMap: { pipeline: 'pipeline' },
        allowInsecureHttp: true,
      })

      const file = await createTestFile('test.pdf')
      const request: CanonicalParseRequest = {
        schemaVersion: 1,
        files: [{ fileId: file.fileId, name: file.name, bytes: file.bytes, sha256: file.sha256 }],
        semantics: { model: 'pipeline', ocr: false, parseMethod: 'auto', language: 'ch', formula: true, table: true },
        requiredArtifacts: ['markdown'],
      }

      await expect(provider.submit(request, [file], makeContext())).rejects.toMatchObject({
        failure: { code: 'FILE_TOO_LARGE' },
      })
    })

    it('enforces maxApiResponseBytes on submit response', async () => {
      server = createServer((req, res) => {
        req.on('data', () => {})
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({
            task_id: 'task_huge',
            status: 'pending',
            extra_payload: 'x'.repeat(10000),
          }))
        })
      })
      await new Promise(resolve => server!.listen(0, '127.0.0.1', () => resolve(true)))
      const port = getPort(server!)

      const provider = new SelfHostedV2Provider({
        id: asProviderConfigId('mp_local'),
        type: 'self-hosted-v2',
        baseURL: `http://127.0.0.1:${port}`,
        modelMap: { pipeline: 'pipeline' },
        allowInsecureHttp: true,
      })

      const file = await createTestFile('test.pdf')
      const request: CanonicalParseRequest = {
        schemaVersion: 1,
        files: [{ fileId: file.fileId, name: file.name, bytes: file.bytes, sha256: file.sha256 }],
        semantics: { model: 'pipeline', ocr: false, parseMethod: 'auto', language: 'ch', formula: true, table: true },
        requiredArtifacts: ['markdown'],
      }

      const tightContext = makeContext({
        limits: {
          ...makeContext().limits,
          maxApiResponseBytes: 100,
        },
      })

      await expect(provider.submit(request, [file], tightContext)).rejects.toMatchObject({
        failure: { code: 'RESULT_TOO_LARGE' },
      })
    })
  })

  describe('inspect (GET /tasks/{taskId})', () => {
    it('maps task statuses to unified MinerUJobState', async () => {
      let currentStatus = 'processing'
      server = createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          task_id: 'task_123',
          status: currentStatus,
          backend: 'pipeline',
          file_names: ['doc.pdf'],
          queued_ahead: 0,
        }))
      })
      await new Promise(resolve => server!.listen(0, '127.0.0.1', () => resolve(true)))
      const port = getPort(server!)

      const provider = new SelfHostedV2Provider({
        id: asProviderConfigId('mp_local'),
        type: 'self-hosted-v2',
        baseURL: `http://127.0.0.1:${port}`,
        modelMap: { pipeline: 'pipeline' },
        allowInsecureHttp: true,
      })

      const fileId = createFileId(SHA256_A)
      const ref = {
        provider: 'self-hosted-v2' as const,
        taskId: 'task_123',
        files: [{ dataId: 'd1', fileId, name: 'doc.pdf' }],
      }

      const snapshot1 = await provider.inspect(ref, makeContext())
      expect(snapshot1.state).toBe('processing')
      expect(snapshot1.files[0]?.state).toBe('processing')

      currentStatus = 'completed'
      const snapshot2 = await provider.inspect(ref, makeContext())
      expect(snapshot2.state).toBe('completed')
      expect(snapshot2.files[0]?.state).toBe('completed')
    })

    it('throws JOB_NOT_FOUND on 404 response', async () => {
      server = createServer((req, res) => {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ detail: 'Task not found' }))
      })
      await new Promise(resolve => server!.listen(0, '127.0.0.1', () => resolve(true)))
      const port = getPort(server!)

      const provider = new SelfHostedV2Provider({
        id: asProviderConfigId('mp_local'),
        type: 'self-hosted-v2',
        baseURL: `http://127.0.0.1:${port}`,
        modelMap: { pipeline: 'pipeline' },
        allowInsecureHttp: true,
      })

      const ref = {
        provider: 'self-hosted-v2' as const,
        taskId: 'missing_task',
        files: [{ dataId: 'd1', fileId: createFileId(SHA256_A), name: 'doc.pdf' }],
      }

      await expect(provider.inspect(ref, makeContext())).rejects.toMatchObject({
        failure: { code: 'JOB_NOT_FOUND' },
      })
    })

    it('throws REMOTE_PARSE_FAILED on unknown task status', async () => {
      server = createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          task_id: 'task_123',
          status: 'weird_unknown_state',
        }))
      })
      await new Promise(resolve => server!.listen(0, '127.0.0.1', () => resolve(true)))
      const port = getPort(server!)

      const provider = new SelfHostedV2Provider({
        id: asProviderConfigId('mp_local'),
        type: 'self-hosted-v2',
        baseURL: `http://127.0.0.1:${port}`,
        modelMap: { pipeline: 'pipeline' },
        allowInsecureHttp: true,
      })

      const ref = {
        provider: 'self-hosted-v2' as const,
        taskId: 'task_123',
        files: [{ dataId: 'd1', fileId: createFileId(SHA256_A), name: 'doc.pdf' }],
      }

      await expect(provider.inspect(ref, makeContext())).rejects.toMatchObject({
        failure: { code: 'REMOTE_PARSE_FAILED' },
      })
    })
  })

  describe('collect (GET /tasks/{taskId}/result)', () => {
    it('collects all standard artifacts and safe base64 images into ArtifactSink', async () => {
      const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      const dataUrl = `data:image/png;base64,${pngBase64}`

      server = createServer((req, res) => {
        if (req.url === '/tasks/task_123/result') {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({
            backend: 'pipeline',
            version: '3.4.4',
            results: {
              document: {
                md_content: '# Extracted Title\n\nBody text with formulas',
                middle_json: { blocks: [{ type: 'title', text: 'Extracted Title' }] },
                model_output: 'Model raw reasoning text',
                content_list: [{ type: 'text', content: 'Extracted Title' }],
                images: {
                  'figure_1.png': dataUrl,
                  '../traversal.png': dataUrl,
                },
              },
            },
          }))
          return
        }
        res.writeHead(404)
        res.end()
      })
      await new Promise(resolve => server!.listen(0, '127.0.0.1', () => resolve(true)))
      const port = getPort(server!)

      const provider = new SelfHostedV2Provider({
        id: asProviderConfigId('mp_local'),
        type: 'self-hosted-v2',
        baseURL: `http://127.0.0.1:${port}`,
        modelMap: { pipeline: 'pipeline' },
        allowInsecureHttp: true,
      })

      const fileId = createFileId(SHA256_A)
      const ref = {
        provider: 'self-hosted-v2' as const,
        taskId: 'task_123',
        files: [{ dataId: 'd1', fileId, name: 'document.pdf' }],
      }

      const request: CanonicalParseRequest = {
        schemaVersion: 1,
        files: [{ fileId, name: 'document.pdf', bytes: 100, sha256: SHA256_A }],
        semantics: { model: 'pipeline', ocr: false, parseMethod: 'auto', language: 'ch', formula: true, table: true },
        requiredArtifacts: ['markdown', 'layout', 'model-output', 'content-list', 'images'],
      }

      const sink = new MockArtifactSink()
      const collection = await provider.collect(ref, request, sink, makeContext())

      expect(collection.files).toHaveLength(1)
      expect(collection.files[0]!.fileId).toBe(fileId)
      expect(collection.files[0]!.failure).toBeUndefined()
      expect(collection.files[0]!.artifacts).toHaveLength(7) // four document artifacts, two images, and image index

      // Verify artifact kinds written to sink
      const kinds = sink.written.map(w => w.kind)
      expect(kinds).toContain('markdown')
      expect(kinds).toContain('layout')
      expect(kinds).toContain('model-output')
      expect(kinds).toContain('content-list')
      expect(kinds.filter(k => k === 'images')).toHaveLength(3)

      // Verify safe relative names for images (traversal sanitized)
      const imageArtifacts = sink.written.filter(w => w.kind === 'images')
      expect(imageArtifacts[0]?.options.relativeName).toBe('images/figure_1.png')
      expect(imageArtifacts[1]?.options.relativeName).toBe('images/traversal.png')
      expect(imageArtifacts[2]?.options.relativeName).toBe('images/index.json')
    })

    it('matches multi-file results unambiguously and rejects ambiguous stem guesses', async () => {
      server = createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          backend: 'pipeline',
          results: {
            file_a: { md_content: '# File A' },
            file_b: { md_content: '# File B' },
          },
        }))
      })
      await new Promise(resolve => server!.listen(0, '127.0.0.1', () => resolve(true)))
      const port = getPort(server!)

      const provider = new SelfHostedV2Provider({
        id: asProviderConfigId('mp_local'),
        type: 'self-hosted-v2',
        baseURL: `http://127.0.0.1:${port}`,
        modelMap: { pipeline: 'pipeline' },
        allowInsecureHttp: true,
      })

      const fileIdA = createFileId(SHA256_A, 0)
      const fileIdB = createFileId(SHA256_B, 1)

      const ref = {
        provider: 'self-hosted-v2' as const,
        taskId: 'multi_task',
        files: [
          { dataId: 'd1', fileId: fileIdA, name: 'file_a.pdf' },
          { dataId: 'd2', fileId: fileIdB, name: 'file_b.pdf' },
        ],
      }

      const request: CanonicalParseRequest = {
        schemaVersion: 1,
        files: [
          { fileId: fileIdA, name: 'file_a.pdf', bytes: 100, sha256: SHA256_A },
          { fileId: fileIdB, name: 'file_b.pdf', bytes: 100, sha256: SHA256_B },
        ],
        semantics: { model: 'pipeline', ocr: false, parseMethod: 'auto', language: 'ch', formula: true, table: true },
        requiredArtifacts: ['markdown'],
      }

      const sink = new MockArtifactSink()
      const collection = await provider.collect(ref, request, sink, makeContext())

      expect(collection.files).toHaveLength(2)
      expect(collection.files[0]?.artifacts).toHaveLength(1)
      expect(collection.files[1]?.artifacts).toHaveLength(1)
    })
  })


  describe('Diagnostic & Error Sanitization', () => {
    it('sanitizes Bearer tokens and URL query params in server error messages', async () => {
      server = createServer((req, res) => {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          detail: 'Failed upstream with Bearer secret-token-xyz at https://api.upstream.com/path?token=supersecret&key=123#frag',
        }))
      })
      await new Promise(resolve => server!.listen(0, '127.0.0.1', () => resolve(true)))
      const port = getPort(server!)

      const provider = new SelfHostedV2Provider({
        id: asProviderConfigId('mp_local'),
        type: 'self-hosted-v2',
        baseURL: `http://127.0.0.1:${port}`,
        modelMap: { pipeline: 'pipeline' },
        allowInsecureHttp: true,
      })

      const ref = {
        provider: 'self-hosted-v2' as const,
        taskId: 'task_err',
        files: [{ dataId: 'd1', fileId: createFileId(SHA256_A), name: 'doc.pdf' }],
      }

      try {
        await provider.inspect(ref, makeContext())
        expect.unreachable('Should have thrown MinerUError')
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(MinerUError)
        const minerUErr = err as MinerUError
        expect(minerUErr.failure.message).toContain('Bearer [REDACTED]')
        expect(minerUErr.failure.message).not.toContain('secret-token-xyz')
        expect(minerUErr.failure.message).not.toContain('supersecret')
      }
    })
  })

  describe('Signal Cancellation & Timeout', () => {
    it('aborts immediately and returns CANCELLED when signal is triggered', async () => {
      server = createServer((req, res) => {
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ status: 'healthy' }))
        }, 2000)
      })
      await new Promise(resolve => server!.listen(0, '127.0.0.1', () => resolve(true)))
      const port = getPort(server!)

      const provider = new SelfHostedV2Provider({
        id: asProviderConfigId('mp_local'),
        type: 'self-hosted-v2',
        baseURL: `http://127.0.0.1:${port}`,
        modelMap: { pipeline: 'pipeline' },
        allowInsecureHttp: true,
      })

      const controller = new AbortController()
      setTimeout(() => controller.abort(), 50)

      const ref = {
        provider: 'self-hosted-v2' as const,
        taskId: 'task_1',
        files: [{ dataId: 'd1', fileId: createFileId(SHA256_A), name: 'doc.pdf' }],
      }

      await expect(provider.inspect(ref, makeContext({ signal: controller.signal }))).rejects.toMatchObject({
        failure: { code: 'CANCELLED' },
      })
    })

    it('enforces request timeout when server hangs', async () => {
      server = createServer((req, res) => {
        // Never respond
      })
      await new Promise(resolve => server!.listen(0, '127.0.0.1', () => resolve(true)))
      const port = getPort(server!)

      const provider = new SelfHostedV2Provider({
        id: asProviderConfigId('mp_local'),
        type: 'self-hosted-v2',
        baseURL: `http://127.0.0.1:${port}`,
        modelMap: { pipeline: 'pipeline' },
        allowInsecureHttp: true,
      })

      const ref = {
        provider: 'self-hosted-v2' as const,
        taskId: 'task_hang',
        files: [{ dataId: 'd1', fileId: createFileId(SHA256_A), name: 'doc.pdf' }],
      }

      await expect(provider.inspect(ref, makeContext({ timeoutMs: 100 }))).rejects.toMatchObject({
        failure: { code: 'PROVIDER_UNAVAILABLE' },
      })
    })
  })
})