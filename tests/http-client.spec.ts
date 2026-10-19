import { describe, it, expect } from 'vitest'
import { MinerUError, failure, type MinerUErrorCode } from '../src/domain/errors.js'
import type { MinerUProviderId } from '../src/domain/ids.js'
import {
  ProviderHttpClient,
  createHttpStatusError,
  extractErrorMessage,
  resolveProviderUrl,
} from '../src/providers/http/http-client.js'
import { deferred, fakeUpstream, hang, json, seq, text, type ServerRoute } from './support/http-fake.js'
import { callContext, type CallContextOptions } from './support/provider-context.js'

describe('ProviderHttpClient pure helpers', () => {
  it.each([
    ['https://example.com/api/', '/test', 'https://example.com/api/test'],
    ['https://example.com/api', 'test', 'https://example.com/api/test'],
    ['http://127.0.0.1:8000', '/health', 'http://127.0.0.1:8000/health'],
    ['https://example.com/api', '', 'https://example.com/api'],
  ])('resolves %s + %j against the base path', (base, path, expected) => {
    expect(resolveProviderUrl(base, path)).toBe(expected)
    expect(resolveProviderUrl(new URL(base), path)).toBe(expected)
  })

  it.each([
    [{ detail: 'detail wins', msg: 'msg' }, 'self-hosted-legacy-v2', 'detail wins'],
    [{ detail: 'detail', msg: 'msg wins' }, 'official-v4', 'msg wins'],
    [{ message: 'Internal error' }, undefined, 'Internal error'],
    [{ error: 'Crash' }, undefined, 'Crash'],
    ['Plain text server error response', undefined, 'Plain text server error response'],
  ] as const)('extracts the diagnostic from %j (%s)', (body, provider, expected) => {
    expect(extractErrorMessage(typeof body === 'string' ? body : JSON.stringify(body), provider)).toBe(expected)
  })

  it.each([
    [401, 'AUTHENTICATION_FAILED', false], [403, 'AUTHENTICATION_FAILED', false],
    [404, 'JOB_NOT_FOUND', false], [413, 'FILE_TOO_LARGE', false], [400, 'REMOTE_PARSE_FAILED', false],
    [408, 'PROVIDER_UNAVAILABLE', true], [429, 'PROVIDER_RATE_LIMITED', true],
    [500, 'PROVIDER_UNAVAILABLE', true], [503, 'PROVIDER_UNAVAILABLE', true],
  ] as const)('maps HTTP %i to %s (retryable=%s) for every provider', (status, code, retryable) => {
    for (const provider of ['official-v4', 'self-hosted-legacy-v2', 'self-hosted-v1'] satisfies MinerUProviderId[]) {
      const error = createHttpStatusError(provider, status, ': diagnostic', 5000)
      expect(error.failure).toMatchObject({ code, retryable, provider })
      expect(error.http).toEqual({ status, retryAfterMs: 5000 })
    }
  })
})

describe('ProviderHttpClient.requestJson over loopback', () => {
  async function request(route: ServerRoute, context: CallContextOptions = {}, provider: MinerUProviderId = 'self-hosted-legacy-v2') {
    const upstream = await fakeUpstream({ 'GET /resource': route })
    const client = new ProviderHttpClient({ baseURL: upstream.url, provider })
    const result = client.requestJson<Record<string, unknown>>({ path: '/resource', context: callContext(context) })
    return { upstream, result }
  }

  it('sends the credential as a Bearer header and parses JSON', async () => {
    const { upstream, result } = await request(json(200, { ok: true }), { credential: 'secret-token' })
    await expect(result).resolves.toEqual({ ok: true })
    expect(upstream.requests[0]?.headers.authorization).toBe('Bearer secret-token')
  })

  it.each<[string, ServerRoute, CallContextOptions, Partial<{ code: MinerUErrorCode; retryable: boolean }>]>([
    ['a redirect (never followed)', text(302, '', { location: '/elsewhere' }), {}, { code: 'PROVIDER_UNAVAILABLE' }],
    ['a non-JSON content type', text(200, '<html>Not JSON</html>', { 'content-type': 'text/html' }), {}, { code: 'REMOTE_PARSE_FAILED', retryable: false }],
    ['a non-object JSON body', json(200, [1, 2]), {}, { code: 'REMOTE_PARSE_FAILED', retryable: false }],
    ['a body over maxApiResponseBytes', json(200, { padding: 'x'.repeat(512) }), { limits: { maxApiResponseBytes: 64 } }, { code: 'RESULT_TOO_LARGE' }],
  ])('rejects %s after exactly one request', async (_label, route, context, expected) => {
    const { upstream, result } = await request(route, { ...context, retry: { maxRetries: 0 } })
    await expect(result).rejects.toMatchObject({ failure: expected })
    expect(upstream.requests).toHaveLength(1)
  })

  it('times out a hanging upstream as retryable PROVIDER_UNAVAILABLE with HTTP 408 metadata', async () => {
    const { result } = await request(hang, { timeoutMs: 50, retry: { maxRetries: 0 } })
    await expect(result).rejects.toMatchObject({
      failure: { code: 'PROVIDER_UNAVAILABLE', retryable: true },
      http: { status: 408 },
    })
  })

  it('reports CANCELLED when the caller aborts an in-flight request', async () => {
    const controller = new AbortController()
    const arrived = deferred()
    const { result } = await request(() => { arrived.resolve() }, { signal: controller.signal })
    await arrived.promise
    controller.abort()
    await expect(result).rejects.toMatchObject({ failure: { code: 'CANCELLED' } })
  })

  it('runs validateResponse inside the retry loop', async () => {
    const upstream = await fakeUpstream({
      'GET /resource': seq(json(200, { code: 429 }), json(200, { code: 0, data: 'success' })),
    })
    const client = new ProviderHttpClient({ baseURL: upstream.url, provider: 'official-v4' })
    const result = await client.requestJson<{ readonly data?: string }>({
      path: '/resource',
      context: callContext(),
      validateResponse: parsed => {
        if (parsed.code === 429) throw new MinerUError(failure('PROVIDER_RATE_LIMITED', 'Rate limit', true), { http: { status: 429 } })
      },
    })
    expect(result.data).toBe('success')
    expect(upstream.requests).toHaveLength(2)
  })
})
