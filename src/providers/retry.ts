import { setTimeout } from 'node:timers/promises'
import type { MinerUProviderId } from '../domain/errors.js'
import { MinerUError, failure } from '../domain/errors.js'

export type ProviderRetryOperation =
  | 'probe'
  | 'submit'
  | 'inspect'
  | 'collect'
  | 'api-json'
  | 'presigned-put'
  | 'cdn-download'

export interface ProviderRetryEvent {
  readonly provider: MinerUProviderId
  readonly operation: ProviderRetryOperation
  readonly attempt: number
  readonly maxRetries: number
  readonly delayMs: number
  readonly reason: 'transport' | 'http-status'
  readonly status?: number
  readonly retryAfterMs?: number
}

export type ProviderRetryHook = (event: ProviderRetryEvent) => void

export interface ProviderRetryPolicy {
  readonly maxRetries?: number
  readonly initialDelayMs?: number
  readonly maxDelayMs?: number
  readonly backoffFactor?: number
  readonly jitter?: boolean
}

export interface ProviderRetryHooks {
  readonly onRetry?: ProviderRetryHook
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  readonly random?: () => number
}

export interface ProviderRetryOptions extends ProviderRetryPolicy, ProviderRetryHooks {}

export function mergeRetryOptions(
  defaults: ProviderRetryOptions,
  overrides: ProviderRetryOptions | undefined,
): ProviderRetryOptions {
  return { ...defaults, ...(overrides ?? {}) }
}

export async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const body = response.body
  if (body === null) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        throw new MinerUError(failure('RESULT_TOO_LARGE', `Response body exceeded limit of ${String(maxBytes)} bytes`))
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  } catch (error) {
    try { await reader.cancel() } catch {}
    throw error
  } finally {
    reader.releaseLock()
  }
}

export const DEFAULT_RETRY_POLICY: Required<ProviderRetryPolicy> = {
  maxRetries: 2,
  initialDelayMs: 500,
  maxDelayMs: 10000,
  backoffFactor: 2,
  jitter: true,
}

/**
 * Parses a standard HTTP Retry-After header value.
 * Supports decimal integer seconds (e.g. "120") and HTTP-date strings.
 * Returns the delay in milliseconds, or undefined if missing/unparseable.
 */
export function parseRetryAfter(header: string | null | undefined, now = Date.now()): number | undefined {
  if (!header || typeof header !== 'string') return undefined
  const trimmed = header.trim()
  if (!trimmed) return undefined

  // 1. Decimal integer seconds (1*DIGIT)
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed)
    if (Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= Math.floor(Number.MAX_SAFE_INTEGER / 1000)) {
      return seconds * 1000
    }
  }

  // Reject numeric-like or negative strings that Date.parse might misinterpret (e.g. "-5", "12.34")
  if (/^[-+]?\d+/.test(trimmed) && !/\s/.test(trimmed)) {
    return undefined
  }

  // 2. HTTP-date (RFC 7231 IMF-fixdate / RFC 850 / asctime, must contain month names)
  if (/[A-Za-z]{3}/.test(trimmed)) {
    const parsedDate = Date.parse(trimmed)
    if (!Number.isNaN(parsedDate)) {
      return Math.max(0, parsedDate - now)
    }
  }

  return undefined
}

/**
 * Returns true if an HTTP status code is typically transient and safe to retry.
 * Matches 408 (Request Timeout), 429 (Too Many Requests), and 5xx server errors.
 */
export function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599)
}

/**
 * Determines whether a caught error is retryable.
 * Abort/cancellation errors and explicit non-retryable MinerUErrors return false.
 */
export function isRetryableError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false
  if (err instanceof DOMException && err.name === 'AbortError') return false
  if (err instanceof MinerUError) {
    if (err.failure.code === 'CANCELLED') return false
    return err.failure.retryable
  }
  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.message.toLowerCase().includes('aborted')) return false
  }
  return false
}

/**
 * Abort-aware delay utility using node:timers/promises.
 */
export async function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return
  try {
    await setTimeout(ms, undefined, { signal })
  } catch (error) {
    if (signal.aborted && signal.reason) throw signal.reason
    throw error
  }
}

/**
 * Calculates exponential backoff delay with optional jitter or Retry-After header.
 */
export function calculateBackoffDelay(
  attempt: number,
  policy: Required<ProviderRetryPolicy>,
  retryAfterMs?: number,
  random: () => number = Math.random,
): number {
  if (retryAfterMs !== undefined && retryAfterMs >= 0) {
    return Math.min(policy.maxDelayMs, retryAfterMs)
  }
  const base = policy.initialDelayMs * Math.pow(policy.backoffFactor, Math.max(0, attempt - 1))
  const clamped = Math.min(policy.maxDelayMs, base)
  if (!policy.jitter) {
    return clamped
  }
  // Jitter in range [clamped * 0.5, clamped]
  const jittered = clamped * (0.5 + 0.5 * random())
  return Math.round(jittered)
}

export interface RetryExecutionContext<T> {
  readonly provider: MinerUProviderId
  readonly operation: ProviderRetryOperation
  readonly signal: AbortSignal
  readonly retryOptions?: ProviderRetryOptions
  readonly fn: (attempt: number) => Promise<T>
}

function boundedInteger(value: number, label: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(label + ' must be an integer between ' + String(min) + ' and ' + String(max))
  }
  return value
}

export function resolveRetryPolicy(options: ProviderRetryPolicy = {}): Required<ProviderRetryPolicy> {
  const maxRetries = boundedInteger(options.maxRetries ?? DEFAULT_RETRY_POLICY.maxRetries, 'maxRetries', 0, 9)
  const initialDelayMs = boundedInteger(options.initialDelayMs ?? DEFAULT_RETRY_POLICY.initialDelayMs, 'initialDelayMs', 1, 60_000)
  const maxDelayMs = boundedInteger(options.maxDelayMs ?? DEFAULT_RETRY_POLICY.maxDelayMs, 'maxDelayMs', 1, 300_000)
  const backoffFactor = options.backoffFactor ?? DEFAULT_RETRY_POLICY.backoffFactor
  const jitter = options.jitter ?? DEFAULT_RETRY_POLICY.jitter
  if (!Number.isFinite(backoffFactor) || backoffFactor < 1 || backoffFactor > 10) {
    throw new TypeError('backoffFactor must be between 1 and 10')
  }
  if (typeof jitter !== 'boolean') throw new TypeError('jitter must be a boolean')
  if (initialDelayMs > maxDelayMs) throw new TypeError('initialDelayMs cannot exceed maxDelayMs')
  return { maxRetries, initialDelayMs, maxDelayMs, backoffFactor, jitter }
}

/**
 * Reusable bounded, abort-aware retry executor for idempotent provider operations.
 */
export async function executeWithRetry<T>(ctx: RetryExecutionContext<T>): Promise<T> {
  const policy = resolveRetryPolicy(ctx.retryOptions)
  const sleepFn = ctx.retryOptions?.sleep ?? defaultSleep
  const randomFn = ctx.retryOptions?.random ?? Math.random
  const onRetry = ctx.retryOptions?.onRetry

  let attempt = 1
  while (true) {
    ctx.signal.throwIfAborted()
    try {
      return await ctx.fn(attempt)
    } catch (err: unknown) {
      if (ctx.signal.aborted) {
        throw new MinerUError(failure('CANCELLED', 'Operation was cancelled', true), { cause: err })
      }

      const retryable = isRetryableError(err, ctx.signal)
      if (!retryable || attempt > policy.maxRetries) {
        throw err
      }

      // Extract optional status and retryAfterMs if error carries them
      let status: number | undefined
      let retryAfterMs: number | undefined
      if (typeof err === 'object' && err !== null) {
        if ('httpStatus' in err && typeof (err as { httpStatus?: unknown }).httpStatus === 'number') {
          status = (err as { httpStatus: number }).httpStatus
        }
        if ('retryAfterMs' in err && typeof (err as { retryAfterMs?: unknown }).retryAfterMs === 'number') {
          retryAfterMs = (err as { retryAfterMs: number }).retryAfterMs
        }
      }

      const delayMs = calculateBackoffDelay(attempt, policy, retryAfterMs, randomFn)
      const reason: ProviderRetryEvent['reason'] = status === undefined ? 'transport' : 'http-status'

      if (onRetry) {
        try {
          onRetry({
            provider: ctx.provider,
            operation: ctx.operation,
            attempt,
            maxRetries: policy.maxRetries,
            delayMs,
            reason,
            ...(status !== undefined ? { status } : {}),
            ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
          })
        } catch {
          // Diagnostic hook errors must never break the retry loop
        }
      }

      try {
        await sleepFn(delayMs, ctx.signal)
      } catch (sleepErr) {
        if (ctx.signal.aborted) {
          throw new MinerUError(failure('CANCELLED', 'Operation was cancelled during retry backoff', true), { cause: sleepErr })
        }
        throw sleepErr
      }

      attempt++
    }
  }
}
