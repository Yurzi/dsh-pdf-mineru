import { describe, it, expect, vi } from 'vitest'
import { MinerUError, failure, type MinerUErrorCode } from '../src/domain/errors.js'
import {
  calculateBackoffDelay,
  defaultSleep,
  executeWithRetry,
  isRetryableError,
  isRetryableHttpStatus,
  parseRetryAfter,
  readBoundedResponseText,
  resolveRetryPolicy,
  type ProviderRetryEvent,
  type ProviderRetryOptions,
  type ProviderRetryPolicy,
} from '../src/providers/http/retry.js'

/** A typed provider error carrying the HTTP metadata the http client attaches. */
function httpError(code: MinerUErrorCode, retryable: boolean, http?: MinerUError['http']): MinerUError {
  return new MinerUError(failure(code, code, retryable), { http })
}

const transient = (): MinerUError => httpError('PROVIDER_UNAVAILABLE', true)

describe('MinerUError HTTP metadata', () => {
  it('preserves ErrorOptions and keeps HTTP metadata separate from the failure', () => {
    const cause = new Error('upstream failed')
    const details = failure('PROVIDER_UNAVAILABLE', 'Unavailable', true)
    const http = { status: 503, retryAfterMs: 2000 }
    const error = new MinerUError(details, { cause, http })
    expect(error.cause).toBe(cause)
    expect(error.http).toEqual(http)
    expect(error.failure).toBe(details)
    expect(new MinerUError(details).http).toBeUndefined()
  })
})

/** Records attempts, sleeps and sanitized retry events of one executeWithRetry run. */
function run<T>(fn: (attempt: number) => Promise<T>, options: ProviderRetryOptions = {}, signal = new AbortController().signal) {
  const events: ProviderRetryEvent[] = []
  const slept: number[] = []
  let attempts = 0
  const result = executeWithRetry({
    provider: 'official-v4', operation: 'inspect', signal,
    retryOptions: {
      maxRetries: 2, initialDelayMs: 100, jitter: false,
      sleep: async ms => { slept.push(ms) },
      onRetry: event => { events.push(event) },
      ...options,
    },
    fn: async attempt => { attempts++; return await fn(attempt) },
  })
  return { result, events, slept, attempts: () => attempts }
}

describe('readBoundedResponseText', () => {
  it('reads bodies within the limit and rejects oversized bodies as RESULT_TOO_LARGE', async () => {
    const signal = new AbortController().signal
    await expect(readBoundedResponseText(new Response('hello'), 5, signal)).resolves.toBe('hello')
    await expect(readBoundedResponseText(new Response('too large'), 3, signal))
      .rejects.toMatchObject({ failure: { code: 'RESULT_TOO_LARGE' } })
  })
})

describe('parseRetryAfter', () => {
  const now = Date.parse('Wed, 21 Oct 2025 07:28:00 GMT')
  it.each([
    [undefined, undefined], [null, undefined], ['', undefined], ['   ', undefined],
    ['0', 0], ['5', 5000], ['  30  ', 30_000],
    ['-5', undefined], ['12.34', undefined], ['abc', undefined], ['999999999999999999999999999', undefined],
    ['Wed, 21 Oct 2025 07:29:00 GMT', 60_000],
    ['Wed, 21 Oct 2025 07:27:00 GMT', 0],
  ] as const)('parses %j as %j ms', (header, expected) => {
    expect(parseRetryAfter(header, now)).toBe(expected)
  })
})

describe('retry classification', () => {
  it.each([
    [408, true], [429, true], [500, true], [503, true], [599, true],
    [200, false], [204, false], [302, false], [400, false], [401, false], [404, false], [413, false], [422, false],
  ])('treats HTTP %i as retryable=%s', (status, expected) => {
    expect(isRetryableHttpStatus(status)).toBe(expected)
  })

  const aborted = new AbortController()
  aborted.abort()
  it.each([
    ['a retryable MinerUError', transient(), undefined, true],
    ['a non-retryable MinerUError', httpError('AUTHENTICATION_FAILED', false), undefined, false],
    ['CANCELLED even when flagged retryable', httpError('CANCELLED', true), undefined, false],
    ['a DOMException AbortError', new DOMException('Aborted', 'AbortError'), undefined, false],
    ['an untyped error (fails closed)', Object.assign(new Error('disk full'), { code: 'ENOSPC' }), undefined, false],
    ['any error once the caller aborted', transient(), aborted.signal, false],
  ] as const)('classifies %s', (_label, error, signal, expected) => {
    expect(isRetryableError(error, signal)).toBe(expected)
  })
})

describe('backoff policy', () => {
  const policy: Required<ProviderRetryPolicy> = { maxRetries: 3, initialDelayMs: 500, maxDelayMs: 1500, backoffFactor: 2, jitter: false }

  it.each([[1, 500], [2, 1000], [3, 1500], [4, 1500]])('backs off exponentially, clamped (attempt %i → %i ms)', (attempt, delay) => {
    expect(calculateBackoffDelay(attempt, policy)).toBe(delay)
  })

  it('prefers Retry-After, clamped to maxDelayMs', () => {
    expect(calculateBackoffDelay(1, policy, 1200)).toBe(1200)
    expect(calculateBackoffDelay(1, policy, 50_000)).toBe(1500)
  })

  it.each([[0, 250], [0.5, 375], [1, 500]])('keeps jitter within [delay/2, delay] (random %d → %i ms)', (random, delay) => {
    expect(calculateBackoffDelay(1, { ...policy, jitter: true }, undefined, () => random)).toBe(delay)
  })

  it('defaults to three total attempts and rejects unsafe bounds', () => {
    expect(resolveRetryPolicy()).toMatchObject({ maxRetries: 2, initialDelayMs: 500, maxDelayMs: 10_000 })
    expect(() => resolveRetryPolicy({ maxRetries: 10 })).toThrow(TypeError)
    expect(() => resolveRetryPolicy({ initialDelayMs: 2000, maxDelayMs: 1000 })).toThrow(TypeError)
    expect(() => resolveRetryPolicy({ backoffFactor: Number.POSITIVE_INFINITY })).toThrow(TypeError)
  })
})

describe('defaultSleep', () => {
  it('resolves immediately for non-positive delays', async () => {
    const signal = new AbortController().signal
    await expect(defaultSleep(0, signal)).resolves.toBeUndefined()
    await expect(defaultSleep(-100, signal)).resolves.toBeUndefined()
  })

  it('rejects with the abort reason before or during the delay', async () => {
    const before = new AbortController()
    const reason = new DOMException('stopped', 'AbortError')
    before.abort(reason)
    await expect(defaultSleep(60_000, before.signal)).rejects.toBe(reason)

    const during = new AbortController()
    const sleeping = defaultSleep(60_000, during.signal)
    during.abort(reason)
    await expect(sleeping).rejects.toBe(reason)
  })
})

describe('executeWithRetry', () => {
  it('returns the first success without sleeping or emitting events', async () => {
    const execution = run(async attempt => `ok-${String(attempt)}`)
    await expect(execution.result).resolves.toBe('ok-1')
    expect(execution.slept).toEqual([])
    expect(execution.events).toEqual([])
  })

  it('retries transient failures with backoff and emits only typed diagnostic fields', async () => {
    const execution = run(async attempt => {
      if (attempt === 1) throw httpError('PROVIDER_UNAVAILABLE', true, { status: 503 })
      return 'recovered'
    }, { maxRetries: 3, initialDelayMs: 200 })
    await expect(execution.result).resolves.toBe('recovered')
    expect(execution.attempts()).toBe(2)
    expect(execution.slept).toEqual([200])
    expect(execution.events).toEqual([{
      provider: 'official-v4', operation: 'inspect', attempt: 1, maxRetries: 3, delayMs: 200, reason: 'http-status', status: 503,
    }])
  })

  it('honors Retry-After carried by the error', async () => {
    const execution = run(async attempt => {
      if (attempt === 1) throw httpError('PROVIDER_RATE_LIMITED', true, { status: 429, retryAfterMs: 3500 })
      return 'ok'
    }, { maxDelayMs: 10_000 })
    await expect(execution.result).resolves.toBe('ok')
    expect(execution.slept).toEqual([3500])
    expect(execution.events[0]).toMatchObject({ status: 429, retryAfterMs: 3500, delayMs: 3500 })
  })

  it('rethrows the last error once the retry budget is exhausted', async () => {
    const last = transient()
    const execution = run(async () => { throw last })
    await expect(execution.result).rejects.toBe(last)
    expect(execution.attempts()).toBe(3)
    expect(execution.events.map(event => event.attempt)).toEqual([1, 2])
    expect(execution.events.every(event => event.reason === 'transport')).toBe(true)
  })

  it('never retries non-retryable errors', async () => {
    const execution = run(async () => { throw httpError('AUTHENTICATION_FAILED', false, { status: 401 }) })
    await expect(execution.result).rejects.toMatchObject({ failure: { code: 'AUTHENTICATION_FAILED' } })
    expect(execution.attempts()).toBe(1)
    expect(execution.slept).toEqual([])
  })

  it('does not start when the caller already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const fn = vi.fn(async () => 'never')
    await expect(executeWithRetry({ provider: 'self-hosted-legacy-v2', operation: 'probe', signal: controller.signal, fn }))
      .rejects.toThrow()
    expect(fn).not.toHaveBeenCalled()
  })

  it('stops as CANCELLED when the caller aborts during backoff', async () => {
    const controller = new AbortController()
    const execution = run(async () => { throw transient() }, {
      maxRetries: 3,
      sleep: async (_ms, signal) => {
        controller.abort(new DOMException('User cancelled', 'AbortError'))
        signal.throwIfAborted()
      },
    }, controller.signal)
    await expect(execution.result).rejects.toMatchObject({ failure: { code: 'CANCELLED' } })
    expect(execution.attempts()).toBe(1)
  })

  it('propagates a sleep failure that is not a cancellation', async () => {
    const sleepError = new Error('custom sleep error')
    const execution = run(async () => { throw transient() }, { sleep: async () => { throw sleepError } })
    await expect(execution.result).rejects.toBe(sleepError)
  })

  it('isolates a throwing onRetry hook from the retry loop', async () => {
    const execution = run(async attempt => {
      if (attempt === 1) throw transient()
      return 'ok'
    }, { onRetry: () => { throw new Error('Broken logging listener') } })
    await expect(execution.result).resolves.toBe('ok')
    expect(execution.attempts()).toBe(2)
  })
})
