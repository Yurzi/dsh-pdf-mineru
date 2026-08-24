import { describe, it, expect, vi } from 'vitest'
import { MinerUError, failure } from '../src/domain/errors.js'
import {
  calculateBackoffDelay,
  DEFAULT_RETRY_POLICY,
  defaultSleep,
  executeWithRetry,
  isRetryableError,
  isRetryableHttpStatus,
  mergeRetryOptions,
  parseRetryAfter,
  readBoundedResponseText,
  resolveRetryPolicy,
  type ProviderRetryEvent,
  type ProviderRetryPolicy,
} from '../src/providers/retry.js'

describe('Retry Utility (src/providers/retry.ts)', () => {
  describe('shared provider helpers', () => {
    it('merges per-call retry options over provider defaults', () => {
      const sleep = vi.fn()
      expect(mergeRetryOptions(
        { maxRetries: 2, initialDelayMs: 500, jitter: true },
        { maxRetries: 0, sleep },
      )).toEqual({ maxRetries: 0, initialDelayMs: 500, jitter: true, sleep })
    })

    it('reads response bodies within the limit and cancels oversized bodies', async () => {
      const signal = new AbortController().signal
      await expect(readBoundedResponseText(new Response('hello'), 5, signal)).resolves.toBe('hello')
      await expect(readBoundedResponseText(new Response('too large'), 3, signal))
        .rejects.toMatchObject({ failure: expect.objectContaining({ code: 'RESULT_TOO_LARGE' }) })
    })
  })

  describe('parseRetryAfter', () => {
    it('returns undefined for undefined, null, empty or whitespace strings', () => {
      expect(parseRetryAfter(undefined)).toBeUndefined()
      expect(parseRetryAfter(null)).toBeUndefined()
      expect(parseRetryAfter('')).toBeUndefined()
      expect(parseRetryAfter('   ')).toBeUndefined()
    })

    it('parses decimal integer seconds correctly', () => {
      expect(parseRetryAfter('0')).toBe(0)
      expect(parseRetryAfter('5')).toBe(5000)
      expect(parseRetryAfter('120')).toBe(120000)
      expect(parseRetryAfter('  30  ')).toBe(30000)
    })

    it('returns undefined for invalid integer formats or negative numbers', () => {
      expect(parseRetryAfter('-5')).toBeUndefined()
      expect(parseRetryAfter('12.34')).toBeUndefined()
      expect(parseRetryAfter('abc')).toBeUndefined()
      expect(parseRetryAfter('999999999999999999999999999')).toBeUndefined()
    })

    it('parses valid HTTP-date strings correctly against a reference timestamp', () => {
      const baseTime = Date.parse('Wed, 21 Oct 2025 07:28:00 GMT')
      const targetTime = Date.parse('Wed, 21 Oct 2025 07:29:00 GMT') // 60s later
      const dateStr = new Date(targetTime).toUTCString()

      expect(parseRetryAfter(dateStr, baseTime)).toBe(60000)
    })

    it('clamps past HTTP-date strings to 0ms', () => {
      const baseTime = Date.parse('Wed, 21 Oct 2025 07:28:00 GMT')
      const pastTime = Date.parse('Wed, 21 Oct 2025 07:27:00 GMT') // 60s before
      const dateStr = new Date(pastTime).toUTCString()

      expect(parseRetryAfter(dateStr, baseTime)).toBe(0)
    })
  })

  describe('isRetryableHttpStatus', () => {
    it('identifies 408, 429, and 5xx as retryable', () => {
      expect(isRetryableHttpStatus(408)).toBe(true)
      expect(isRetryableHttpStatus(429)).toBe(true)
      expect(isRetryableHttpStatus(500)).toBe(true)
      expect(isRetryableHttpStatus(502)).toBe(true)
      expect(isRetryableHttpStatus(503)).toBe(true)
      expect(isRetryableHttpStatus(504)).toBe(true)
      expect(isRetryableHttpStatus(599)).toBe(true)
    })

    it('identifies 2xx, 3xx, and client 4xx (except 408/429) as non-retryable', () => {
      expect(isRetryableHttpStatus(200)).toBe(false)
      expect(isRetryableHttpStatus(201)).toBe(false)
      expect(isRetryableHttpStatus(204)).toBe(false)
      expect(isRetryableHttpStatus(301)).toBe(false)
      expect(isRetryableHttpStatus(302)).toBe(false)
      expect(isRetryableHttpStatus(400)).toBe(false)
      expect(isRetryableHttpStatus(401)).toBe(false)
      expect(isRetryableHttpStatus(403)).toBe(false)
      expect(isRetryableHttpStatus(404)).toBe(false)
      expect(isRetryableHttpStatus(413)).toBe(false)
      expect(isRetryableHttpStatus(422)).toBe(false)
    })
  })

  describe('isRetryableError', () => {
    it('returns false when signal is already aborted', () => {
      const controller = new AbortController()
      controller.abort()
      expect(isRetryableError(new Error('Network drop'), controller.signal)).toBe(false)
    })

    it('returns false for AbortError', () => {
      expect(isRetryableError(new DOMException('Aborted', 'AbortError'))).toBe(false)
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      expect(isRetryableError(err)).toBe(false)
    })

    it('honors MinerUError retryable flag', () => {
      const retryableErr = new MinerUError(failure('PROVIDER_UNAVAILABLE', 'Server down', true))
      expect(isRetryableError(retryableErr)).toBe(true)

      const nonRetryableErr = new MinerUError(failure('AUTHENTICATION_FAILED', 'Bad key', false))
      expect(isRetryableError(nonRetryableErr)).toBe(false)

      const cancelledErr = new MinerUError(failure('CANCELLED', 'Cancelled', true))
      expect(isRetryableError(cancelledErr)).toBe(false)
    })

    it('fails closed for untyped errors so local failures are not retried', () => {
      expect(isRetryableError(new TypeError('fetch failed'))).toBe(false)
      expect(isRetryableError(Object.assign(new Error('disk full'), { code: 'ENOSPC' }))).toBe(false)
    })
  })

  describe('calculateBackoffDelay', () => {
    const testPolicy: Required<ProviderRetryPolicy> = {
      maxRetries: 3,
      initialDelayMs: 500,
      maxDelayMs: 30000,
      backoffFactor: 2,
      jitter: false,
    }

    it('calculates deterministic exponential backoff when jitter is false', () => {
      expect(calculateBackoffDelay(1, testPolicy)).toBe(500)
      expect(calculateBackoffDelay(2, testPolicy)).toBe(1000)
      expect(calculateBackoffDelay(3, testPolicy)).toBe(2000)
      expect(calculateBackoffDelay(4, testPolicy)).toBe(4000)
    })

    it('clamps delay to maxDelayMs', () => {
      const tightPolicy = { ...testPolicy, maxDelayMs: 1500 }
      expect(calculateBackoffDelay(1, tightPolicy)).toBe(500)
      expect(calculateBackoffDelay(2, tightPolicy)).toBe(1000)
      expect(calculateBackoffDelay(3, tightPolicy)).toBe(1500)
      expect(calculateBackoffDelay(4, tightPolicy)).toBe(1500)
    })

    it('uses Retry-After header delay when provided and clamps to maxDelayMs', () => {
      expect(calculateBackoffDelay(1, testPolicy, 3000)).toBe(3000)
      expect(calculateBackoffDelay(2, testPolicy, 50000)).toBe(30000)
    })

    it('applies jitter within [0.5 * delay, delay] when jitter is true', () => {
      const jitterPolicy = { ...testPolicy, jitter: true }
      // random returns 0 -> 0.5 * 500 = 250
      expect(calculateBackoffDelay(1, jitterPolicy, undefined, () => 0)).toBe(250)
      // random returns 1 -> 1.0 * 500 = 500
      expect(calculateBackoffDelay(1, jitterPolicy, undefined, () => 1)).toBe(500)
      // random returns 0.5 -> 0.75 * 500 = 375
      expect(calculateBackoffDelay(1, jitterPolicy, undefined, () => 0.5)).toBe(375)
    })
  })

  describe('resolveRetryPolicy', () => {
    it('uses three total attempts by default and rejects unsafe bounds', () => {
      expect(resolveRetryPolicy()).toMatchObject({ maxRetries: 2, initialDelayMs: 500, maxDelayMs: 10000 })
      expect(() => resolveRetryPolicy({ maxRetries: 10 })).toThrow(/maxRetries/)
      expect(() => resolveRetryPolicy({ initialDelayMs: 2000, maxDelayMs: 1000 })).toThrow(/cannot exceed/)
      expect(() => resolveRetryPolicy({ backoffFactor: Number.POSITIVE_INFINITY })).toThrow(/backoffFactor/)
    })
  })

  describe('defaultSleep', () => {
    it('resolves immediately when ms <= 0', async () => {
      const controller = new AbortController()
      await expect(defaultSleep(0, controller.signal)).resolves.toBeUndefined()
      await expect(defaultSleep(-100, controller.signal)).resolves.toBeUndefined()
    })

    it('throws immediately when signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort(new DOMException('Already cancelled', 'AbortError'))
      await expect(defaultSleep(1000, controller.signal)).rejects.toThrowError(/cancelled/i)
    })

    it('rejects when aborted during sleep delay and cleans up timer', async () => {
      const controller = new AbortController()
      const sleepPromise = defaultSleep(5000, controller.signal)
      setTimeout(() => {
        controller.abort(new DOMException('User stopped', 'AbortError'))
      }, 20)
      await expect(sleepPromise).rejects.toThrowError(/User stopped/i)
    })
  })

  describe('executeWithRetry', () => {
    it('returns result immediately on first attempt if successful', async () => {
      const onRetry = vi.fn()
      const sleep = vi.fn()
      const controller = new AbortController()

      const result = await executeWithRetry({
        provider: 'official-v4',
        operation: 'inspect',
        signal: controller.signal,
        retryOptions: { onRetry, sleep },
        fn: async attempt => `ok-${attempt}`,
      })

      expect(result).toBe('ok-1')
      expect(onRetry).not.toHaveBeenCalled()
      expect(sleep).not.toHaveBeenCalled()
    })

    it('retries on transient failure and succeeds on subsequent attempt', async () => {
      const events: ProviderRetryEvent[] = []
      const slept: number[] = []
      const controller = new AbortController()

      let attempts = 0
      const result = await executeWithRetry({
        provider: 'official-v4',
        operation: 'inspect',
        signal: controller.signal,
        retryOptions: {
          maxRetries: 3,
          initialDelayMs: 200,
          backoffFactor: 2,
          jitter: false,
          onRetry: event => events.push(event),
          sleep: async ms => { slept.push(ms) },
        },
        fn: async attempt => {
          attempts++
          if (attempt === 1) {
            const err = new MinerUError(failure('PROVIDER_UNAVAILABLE', 'Server overloaded (503)', true))
            Object.assign(err, { httpStatus: 503 })
            throw err
          }
          return 'recovered'
        },
      })

      expect(result).toBe('recovered')
      expect(attempts).toBe(2)
      expect(slept).toEqual([200])
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        provider: 'official-v4',
        operation: 'inspect',
        attempt: 1,
        maxRetries: 3,
        delayMs: 200,
        status: 503,
      })
    })

    it('honors Retry-After in transient error', async () => {
      const events: ProviderRetryEvent[] = []
      const slept: number[] = []
      const controller = new AbortController()

      let attempts = 0
      const result = await executeWithRetry({
        provider: 'self-hosted-v2',
        operation: 'collect',
        signal: controller.signal,
        retryOptions: {
          maxRetries: 3,
          initialDelayMs: 200,
          onRetry: event => events.push(event),
          sleep: async ms => { slept.push(ms) },
        },
        fn: async attempt => {
          attempts++
          if (attempt === 1) {
            const err = new MinerUError(failure('PROVIDER_RATE_LIMITED', 'Rate limited (429)', true))
            Object.assign(err, { httpStatus: 429, retryAfterMs: 3500 })
            throw err
          }
          return 'ok-after-rate-limit'
        },
      })

      expect(result).toBe('ok-after-rate-limit')
      expect(attempts).toBe(2)
      expect(slept).toEqual([3500])
      expect(events[0]).toMatchObject({
        provider: 'self-hosted-v2',
        operation: 'collect',
        attempt: 1,
        delayMs: 3500,
        status: 429,
        retryAfterMs: 3500,
      })
    })

    it('throws final error upon exhaustion when maxRetries is exceeded', async () => {
      const events: ProviderRetryEvent[] = []
      const controller = new AbortController()

      let attempts = 0
      await expect(
        executeWithRetry({
          provider: 'official-v4',
          operation: 'cdn-download',
          signal: controller.signal,
          retryOptions: {
            maxRetries: 2,
            initialDelayMs: 100,
            jitter: false,
            onRetry: e => events.push(e),
            sleep: async () => {},
          },
          fn: async () => {
            attempts++
            throw new MinerUError(failure('PROVIDER_UNAVAILABLE', 'Persistent 500', true))
          },
        }),
      ).rejects.toThrowError(/Persistent 500/)

      // 1 initial + 2 retries = 3 attempts total
      expect(attempts).toBe(3)
      expect(events).toHaveLength(2)
      expect(events[0]!.attempt).toBe(1)
      expect(events[1]!.attempt).toBe(2)
    })

    it('does NOT retry non-retryable errors and throws on attempt 1', async () => {
      const events: ProviderRetryEvent[] = []
      const sleep = vi.fn()
      const controller = new AbortController()

      let attempts = 0
      await expect(
        executeWithRetry({
          provider: 'official-v4',
          operation: 'inspect',
          signal: controller.signal,
          retryOptions: {
            maxRetries: 3,
            onRetry: e => events.push(e),
            sleep,
          },
          fn: async () => {
            attempts++
            throw new MinerUError(failure('AUTHENTICATION_FAILED', 'Invalid token', false))
          },
        }),
      ).rejects.toThrowError(/Invalid token/)

      expect(attempts).toBe(1)
      expect(events).toHaveLength(0)
      expect(sleep).not.toHaveBeenCalled()
    })

    it('aborts immediately and throws CANCELLED without retry when caller aborts before start', async () => {
      const controller = new AbortController()
      controller.abort()

      const fn = vi.fn()
      await expect(
        executeWithRetry({
          provider: 'self-hosted-v2',
          operation: 'probe',
          signal: controller.signal,
          fn,
        }),
      ).rejects.toThrowError()

      expect(fn).not.toHaveBeenCalled()
    })

    it('aborts immediately and throws CANCELLED when caller aborts during backoff delay', async () => {
      const controller = new AbortController()
      let attempts = 0

      await expect(
        executeWithRetry({
          provider: 'official-v4',
          operation: 'presigned-put',
          signal: controller.signal,
          retryOptions: {
            maxRetries: 3,
            sleep: async (_, signal) => {
              // Simulate caller aborting during sleep
              controller.abort(new DOMException('User cancelled operation', 'AbortError'))
              signal.throwIfAborted()
            },
          },
          fn: async () => {
            attempts++
            throw new MinerUError(failure('UPLOAD_FAILED', 'Transient upload error', true))
          },
        }),
      ).rejects.toMatchObject({
        failure: expect.objectContaining({ code: 'CANCELLED' }),
      })

      expect(attempts).toBe(1)
    })

    it('catches and ignores diagnostic hook errors without interrupting the retry loop', async () => {
      const controller = new AbortController()
      let attempts = 0

      const result = await executeWithRetry({
        provider: 'official-v4',
        operation: 'inspect',
        signal: controller.signal,
        retryOptions: {
          maxRetries: 2,
          sleep: async () => {},
          onRetry: () => {
            throw new Error('Broken logging listener')
          },
        },
        fn: async attempt => {
          attempts++
          if (attempt === 1) {
            throw new MinerUError(failure('PROVIDER_UNAVAILABLE', 'Temporary glitch', true))
          }
          return 'success-despite-hook-throw'
        },
      })

      expect(result).toBe('success-despite-hook-throw')
      expect(attempts).toBe(2)
    })
  })
})
