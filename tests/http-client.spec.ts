import { describe, it, expect, vi, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { MinerUError } from '../src/domain/errors.js'
import type { ProviderCallContext } from '../src/providers/provider.js'
import {
  ProviderHttpClient,
  resolveProviderUrl,
  extractErrorMessage,
  createHttpStatusError,
} from '../src/providers/http-client.js'

function getPort(server: Server): number {
  return (server.address() as AddressInfo).port
}

function makeContext(overrides?: Partial<ProviderCallContext>): ProviderCallContext {
  return {
    signal: new AbortController().signal,
    timeoutMs: 2000,
    limits: {
      maxApiResponseBytes: 1024 * 1024,
      maxZipDownloadBytes: 50 * 1024 * 1024,
      maxZipEntries: 100,
      maxZipEntryBytes: 10 * 1024 * 1024,
      maxZipTotalBytes: 50 * 1024 * 1024,
      maxZipCompressionRatio: 100,
    },
    ...overrides,
  }
}

describe('ProviderHttpClient', () => {
  let server: Server | null = null

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close(err => (err ? reject(err) : resolve()))
      })
      server = null
    }
    vi.restoreAllMocks()
  })

  describe('resolveProviderUrl', () => {
    it('resolves baseURL with trailing slash and path with leading slash', () => {
      const url = resolveProviderUrl('https://example.com/api/', '/test')
      expect(url).toBe('https://example.com/api/test')
    })

    it('resolves baseURL without trailing slash and path without leading slash', () => {
      const url = resolveProviderUrl(new URL('https://example.com/api'), 'test')
      expect(url).toBe('https://example.com/api/test')
    })

    it('resolves root baseURL without pathname', () => {
      const url = resolveProviderUrl('http://127.0.0.1:8000', '/health')
      expect(url).toBe('http://127.0.0.1:8000/health')
    })
  })

  describe('extractErrorMessage', () => {
    it('extracts detail field for self-hosted provider', () => {
      const msg = extractErrorMessage(JSON.stringify({ detail: 'Validation failed' }), 'self-hosted-v2')
      expect(msg).toBe('Validation failed')
    })

    it('extracts msg field for official provider', () => {
      const msg = extractErrorMessage(JSON.stringify({ code: 400, msg: 'Bad request' }), 'official-v4')
      expect(msg).toBe('Bad request')
    })

    it('extracts message and error fields', () => {
      expect(extractErrorMessage(JSON.stringify({ message: 'Internal error' }))).toBe('Internal error')
      expect(extractErrorMessage(JSON.stringify({ error: 'Crash' }))).toBe('Crash')
    })

    it('falls back to truncated text on invalid JSON', () => {
      const text = 'Plain text server error response'
      expect(extractErrorMessage(text)).toBe(text)
    })
  })

  describe('createHttpStatusError', () => {
    it('maps 401/403 to AUTHENTICATION_FAILED with provider details', () => {
      const err = createHttpStatusError('official-v4', 401, ': Invalid token')
      expect(err.failure.code).toBe('AUTHENTICATION_FAILED')
      expect(err.failure.retryable).toBe(false)
      expect(err.failure.provider).toBe('official-v4')
      expect(err.message).toContain('Official MinerU authentication failed (401): Invalid token')
      expect(err.httpStatus).toBe(401)
    })

    it('maps 429 to PROVIDER_RATE_LIMITED with retryAfterMs', () => {
      const err = createHttpStatusError('self-hosted-v2', 429, '', 5000)
      expect(err.failure.code).toBe('PROVIDER_RATE_LIMITED')
      expect(err.failure.retryable).toBe(true)
      expect(err.httpStatus).toBe(429)
      expect(err.retryAfterMs).toBe(5000)
    })

    it('maps 413 to FILE_TOO_LARGE', () => {
      const err = createHttpStatusError('self-hosted-v2', 413, '')
      expect(err.failure.code).toBe('FILE_TOO_LARGE')
      expect(err.failure.retryable).toBe(false)
    })

    it('maps 500/502/503 to PROVIDER_UNAVAILABLE with retryable: true', () => {
      const err = createHttpStatusError('official-v4', 503, ': Bad Gateway')
      expect(err.failure.code).toBe('PROVIDER_UNAVAILABLE')
      expect(err.failure.retryable).toBe(true)
    })
  })

  describe('requestJson HTTP behavior', () => {
    it('sends Bearer Authorization header when credential is provided', async () => {
      let receivedAuth: string | undefined
      server = createServer((req, res) => {
        receivedAuth = req.headers['authorization']
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      })
      await new Promise(resolve => server!.listen(0, '127.0.0.1', () => resolve(true)))
      const port = getPort(server!)

      const client = new ProviderHttpClient({
        baseURL: `http://127.0.0.1:${port}`,
        provider: 'self-hosted-v2',
      })

      const result = await client.requestJson<{ ok: boolean }>({
        method: 'GET',
        path: '/test',
        context: makeContext({ credential: 'secret-token' }),
      })

      expect(result).toEqual({ ok: true })
      expect(receivedAuth).toBe('Bearer secret-token')
    })

    it('rejects HTTP redirects without following the target', async () => {
      const requestedPaths: string[] = []
      server = createServer((req, res) => {
        requestedPaths.push(req.url ?? '')
        res.writeHead(302, { location: '/somewhere' })
        res.end()
      })
      await new Promise(resolve => server!.listen(0, '127.0.0.1', () => resolve(true)))
      const port = getPort(server!)

      const client = new ProviderHttpClient({
        baseURL: `http://127.0.0.1:${port}`,
        provider: 'self-hosted-v2',
      })

      await expect(
        client.requestJson({
          method: 'GET',
          path: '/redirect',
          context: makeContext({ retry: { maxRetries: 0 } }),
        }),
      ).rejects.toThrow()
      expect(requestedPaths).toEqual(['/redirect'])
    })

    it('enforces request timeout with HTTP 408 status', async () => {
      server = createServer((_req, _res) => {
        // Never respond
      })
      await new Promise(resolve => server!.listen(0, '127.0.0.1', () => resolve(true)))
      const port = getPort(server!)

      const client = new ProviderHttpClient({
        baseURL: `http://127.0.0.1:${port}`,
        provider: 'self-hosted-v2',
      })

      await expect(
        client.requestJson({
          method: 'GET',
          path: '/hang',
          context: makeContext({ timeoutMs: 100, retry: { maxRetries: 0 } }),
        }),
      ).rejects.toMatchObject({
        failure: expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE', retryable: true }),
        httpStatus: 408,
      })
    })

    it('aborts immediately when context.signal is triggered', async () => {
      server = createServer((_req, _res) => {
        // Wait for client cancellation; no timer outlives this test.
      })
      await new Promise(resolve => server!.listen(0, '127.0.0.1', () => resolve(true)))
      const port = getPort(server!)

      const client = new ProviderHttpClient({
        baseURL: `http://127.0.0.1:${port}`,
        provider: 'self-hosted-v2',
      })

      const controller = new AbortController()
      setTimeout(() => controller.abort(), 50)

      await expect(
        client.requestJson({
          method: 'GET',
          path: '/cancel',
          context: makeContext({ signal: controller.signal }),
        }),
      ).rejects.toMatchObject({
        failure: expect.objectContaining({ code: 'CANCELLED' }),
      })
    })

    it('rejects non-json content-type', async () => {
      server = createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html>Not JSON</html>')
      })
      await new Promise(resolve => server!.listen(0, '127.0.0.1', () => resolve(true)))
      const port = getPort(server!)

      const client = new ProviderHttpClient({
        baseURL: `http://127.0.0.1:${port}`,
        provider: 'official-v4',
      })

      await expect(
        client.requestJson({
          method: 'GET',
          path: '/html',
          context: makeContext(),
        }),
      ).rejects.toMatchObject({
        failure: expect.objectContaining({ code: 'REMOTE_PARSE_FAILED' }),
      })
    })

    it('executes validateResponse hook inside retry loop', async () => {
      let attempts = 0
      server = createServer((_req, res) => {
        attempts++
        res.writeHead(200, { 'content-type': 'application/json' })
        if (attempts === 1) {
          res.end(JSON.stringify({ code: 429, msg: 'Rate limited' }))
        } else {
          res.end(JSON.stringify({ code: 0, data: 'success' }))
        }
      })
      await new Promise(resolve => server!.listen(0, '127.0.0.1', () => resolve(true)))
      const port = getPort(server!)

      const client = new ProviderHttpClient({
        baseURL: `http://127.0.0.1:${port}`,
        provider: 'official-v4',
        defaultRetry: { maxRetries: 2, initialDelayMs: 10, jitter: false },
      })

      const result = await client.requestJson<{ code: number; data?: string }>({
        method: 'GET',
        path: '/retry-hook',
        context: makeContext(),
        retry: true,
        validateResponse: (parsed) => {
          if (parsed.code === 429) {
            const err = new MinerUError({
              code: 'PROVIDER_RATE_LIMITED',
              message: 'Rate limit',
              retryable: true,
            })
            Object.assign(err, { httpStatus: 429 })
            throw err
          }
          return parsed as { code: number; data?: string }
        },
      })

      expect(attempts).toBe(2)
      expect(result.data).toBe('success')
    })
  })
})
