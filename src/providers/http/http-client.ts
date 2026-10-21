import { MinerUError, failure, sanitizeDiagnostic } from '../../domain/errors.js'
import type { MinerUProviderId } from '../../domain/ids.js'
import type {
  ProviderCallContext,
} from '../contract.js'
import {
  type ProviderRetryOperation,
  executeWithRetry,
  parseRetryAfter,
  readBoundedResponseText,
} from './retry.js'

export interface ProviderHttpClientOptions {
  readonly baseURL: URL | string
  readonly provider: MinerUProviderId
  readonly providerLabel?: string
}

export interface JsonRequestOptions<T = unknown> {
  readonly method?: string
  readonly path: string
  readonly body?: BodyInit
  readonly headers?: Record<string, string>
  readonly context: ProviderCallContext
  readonly acceptedStatuses?: readonly number[]
  readonly operation?: ProviderRetryOperation
  readonly retry?: boolean
  readonly validateResponse?: (parsed: Record<string, unknown>, response: Response) => T | void
}

/**
 * Resolves a request path against a base URL, preserving pathname prefix if any.
 */
export function resolveProviderUrl(baseUrl: URL | string, path: string): string {
  const parsed = typeof baseUrl === 'string' ? new URL(baseUrl) : baseUrl
  const basePath = parsed.pathname.replace(/\/+$/, '')
  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : ''
  return `${parsed.origin}${basePath}${normalizedPath}`
}

/** A diagnostic parsed from an upstream error body or error object. */
export interface UpstreamErrorDetail {
  /** Human-readable diagnostic; a MinerU V1 error leads with its upstream code. */
  readonly message?: string
  /** Machine-readable upstream code, kept only when it is a plain token. */
  readonly code?: string
}

const UPSTREAM_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * Describes a MinerU 4.x V1 error object `{ type, code, message, param }`. API servers and Routers use
 * it for HTTP error bodies (under `error`) and for per-file job errors. The code leads the diagnostic
 * because it names the cause (`engine_dead`, `quality_tier_unavailable`, `file_not_found`) more
 * precisely than the HTTP status. `fallbackMessage` stands in for a missing message.
 */
export function describeV1Error(value: unknown, fallbackMessage?: string): UpstreamErrorDetail | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const code = nonEmptyString(record.code)
  const text = nonEmptyString(record.message) ?? (code === undefined ? undefined : nonEmptyString(fallbackMessage))
  if (code === undefined && text === undefined) return undefined
  const param = nonEmptyString(record.param)
  const message = [code, text].filter((part): part is string => part !== undefined).join(': ')
    + (param === undefined ? '' : ` (param: ${param})`)
  return { message, ...(code !== undefined && UPSTREAM_CODE_PATTERN.test(code) ? { code } : {}) }
}

/** Keeps an upstream code as `providerCode` only when it is a plain token carrying none of the secrets. */
export function safeProviderCode(code: string | undefined, secrets: readonly string[] = []): string | undefined {
  if (code === undefined || !UPSTREAM_CODE_PATTERN.test(code)) return undefined
  return sanitizeDiagnostic(code, secrets) === code ? code : undefined
}

/**
 * Extracts the diagnostic of an API error response body. A self-hosted V1 body is read as the V1
 * error envelope first; otherwise the JSON fields detail, message, error and msg are inspected
 * (msg first for official-v4, detail first for self-hosted). Non-JSON bodies fall back to their
 * truncated raw text.
 */
export function extractErrorDetail(bodyText: string, provider?: MinerUProviderId): UpstreamErrorDetail {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    const raw = bodyText.slice(0, 500)
    return raw === '' ? {} : { message: raw }
  }
  if (typeof parsed !== 'object' || parsed === null) return {}
  const json = parsed as Record<string, unknown>
  if (provider === 'self-hosted-v1') {
    const envelope = describeV1Error(json.error)
    if (envelope !== undefined) return envelope
  }
  const fields = provider === 'official-v4' ? ['msg', 'message', 'detail', 'error'] : ['detail', 'message', 'error', 'msg']
  for (const field of fields) {
    const value = json[field]
    if (typeof value === 'string') return { message: value }
  }
  return {}
}

/** The diagnostic text of an API error response body; see {@link extractErrorDetail}. */
export function extractErrorMessage(bodyText: string, provider?: MinerUProviderId): string | undefined {
  return extractErrorDetail(bodyText, provider).message
}

/**
 * Maps HTTP error status codes to typed MinerUError instances with provider-specific diagnostic phrasing.
 * `providerCode` records the upstream error code when the body carried one.
 */
export function createHttpStatusError(
  provider: MinerUProviderId,
  status: number,
  diagnostic: string,
  retryAfterMs?: number,
  providerCode?: string,
): MinerUError {
  const options = { http: { status, retryAfterMs } }
  const details = { provider, ...(providerCode === undefined ? {} : { providerCode }) }
  let err: MinerUError
  if (provider === 'official-v4') {
    if (status === 401 || status === 403) {
      err = new MinerUError(failure('AUTHENTICATION_FAILED', `Official MinerU authentication failed (${String(status)})${diagnostic}`, false, details), options)
    } else if (status === 404) {
      err = new MinerUError(failure('JOB_NOT_FOUND', `Official MinerU resource not found (${String(status)})${diagnostic}`, false, details), options)
    } else if (status === 413) {
      err = new MinerUError(failure('FILE_TOO_LARGE', `File exceeds size limit (${String(status)})${diagnostic}`, false, details), options)
    } else if (status === 429) {
      err = new MinerUError(failure('PROVIDER_RATE_LIMITED', `Official MinerU rate limit exceeded (${String(status)})${diagnostic}`, true, details), options)
    } else if (status === 408) {
      err = new MinerUError(failure('PROVIDER_UNAVAILABLE', `Official MinerU request timeout (${String(status)})${diagnostic}`, true, details), options)
    } else if (status >= 500) {
      err = new MinerUError(failure('PROVIDER_UNAVAILABLE', `Official MinerU server error (${String(status)})${diagnostic}`, true, details), options)
    } else {
      err = new MinerUError(failure('REMOTE_PARSE_FAILED', `Official MinerU returned status ${String(status)}${diagnostic}`, false, details), options)
    }
  } else {
    if (status === 401 || status === 403) {
      err = new MinerUError(failure('AUTHENTICATION_FAILED', `Authentication failed (${String(status)})${diagnostic}`, false, details), options)
    } else if (status === 404) {
      err = new MinerUError(failure('JOB_NOT_FOUND', `Resource not found (${String(status)})${diagnostic}`, false, details), options)
    } else if (status === 413) {
      err = new MinerUError(failure('FILE_TOO_LARGE', `Uploaded file is too large (${String(status)})${diagnostic}`, false, details), options)
    } else if (status === 429) {
      err = new MinerUError(failure('PROVIDER_RATE_LIMITED', `Provider rate limit exceeded (${String(status)})${diagnostic}`, true, details), options)
    } else if (status === 408) {
      err = new MinerUError(failure('PROVIDER_UNAVAILABLE', `MinerU server request timeout (${String(status)})${diagnostic}`, true, details), options)
    } else if (status >= 500) {
      err = new MinerUError(failure('PROVIDER_UNAVAILABLE', `MinerU server error (${String(status)})${diagnostic}`, true, details), options)
    } else {
      err = new MinerUError(failure('REMOTE_PARSE_FAILED', `MinerU returned unexpected status ${String(status)}${diagnostic}`, false, details), options)
    }
  }
  return err
}

/**
 * Reusable HTTP client for MinerU providers encapsulating request setup, credential injection,
 * timeout management, error body extraction, status code mapping, and bounded retries.
 */
export class ProviderHttpClient {
  readonly baseUrl: URL
  readonly provider: MinerUProviderId
  readonly providerLabel: string

  constructor(options: ProviderHttpClientOptions) {
    this.baseUrl = typeof options.baseURL === 'string' ? new URL(options.baseURL) : options.baseURL
    this.provider = options.provider
    this.providerLabel = options.providerLabel ?? (options.provider === 'official-v4' ? 'MinerU official API' : 'MinerU server')
  }

  async requestJson<T>(opts: JsonRequestOptions<T>): Promise<T> {
    const method = opts.method ?? 'GET'
    const reqPath = opts.path
    const reqBody = opts.body
    const reqHeaders = opts.headers ?? {}
    const reqContext = opts.context
    const acceptedStatusesList = opts.acceptedStatuses ?? [200]
    const allowRetry = opts.retry ?? (method.toUpperCase() === 'GET')
    const operation = opts.operation ?? (
      reqPath.startsWith('/health') || reqPath.includes('probe') ? 'probe' : 'api-json'
    )

    const executeOnce = async (): Promise<T> => {
      reqContext.signal.throwIfAborted()

      const url = resolveProviderUrl(this.baseUrl, reqPath)
      const controller = new AbortController()
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort(new DOMException(`Request timed out after ${String(reqContext.timeoutMs)}ms`, 'TimeoutError'))
      }, reqContext.timeoutMs)

      const onParentAbort = () => {
        controller.abort(reqContext.signal.reason)
      }
      reqContext.signal.addEventListener('abort', onParentAbort, { once: true })

      try {
        const requestHeaders: Record<string, string> = { ...reqHeaders }
        if (reqContext.credential && reqContext.credential.trim() !== '') {
          requestHeaders['authorization'] = `Bearer ${reqContext.credential}`
        }

        let response: Response
        try {
          const requestInit: RequestInit & { duplex?: 'half' } = {
            method,
            headers: requestHeaders,
            body: reqBody,
            signal: controller.signal,
            redirect: 'error',
            ...(reqBody !== undefined ? { duplex: 'half' } : {}),
          }
          response = await fetch(url, requestInit)
        } catch (err: unknown) {
          if (reqContext.signal.aborted) {
            throw new MinerUError(failure('CANCELLED', 'Operation was cancelled', true))
          }
          if (timedOut) {
            const timeoutErr = new MinerUError(
              failure('PROVIDER_UNAVAILABLE', `Request to ${this.providerLabel} timed out after ${String(reqContext.timeoutMs)}ms`, true),
              { http: { status: 408 } },
            )
            throw timeoutErr
          }
          const message = err instanceof Error ? err.message : String(err)
          throw new MinerUError(
            failure('PROVIDER_UNAVAILABLE', `Failed to connect to ${this.providerLabel}: ${message}`, true),
            { cause: err },
          )
        }

        const status = response.status
        if (!acceptedStatusesList.includes(status)) {
          let errorBody = ''
          try {
            errorBody = await readBoundedResponseText(response, reqContext.limits.maxApiResponseBytes, controller.signal)
          } catch {
            if (response.body) {
              try { await response.body.cancel() } catch {}
            }
          }

          const secrets = [reqContext.credential ?? '']
          const detail = extractErrorDetail(errorBody, this.provider)
          const diagnostic = detail.message
            ? `: ${sanitizeDiagnostic(detail.message, secrets)}`
            : ''
          const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
          throw createHttpStatusError(this.provider, status, diagnostic, retryAfterMs, safeProviderCode(detail.code, secrets))
        }

        const contentType = response.headers.get('content-type') ?? ''
        if (!contentType.toLowerCase().includes('application/json')) {
          if (response.body) {
            try { await response.body.cancel() } catch {}
          }
          throw new MinerUError(
            failure(
              'REMOTE_PARSE_FAILED',
              this.provider === 'official-v4'
                ? `Expected application/json response, got "${contentType}"`
                : `Expected application/json response, got ${contentType || 'unknown'}`,
              false,
              { provider: this.provider },
            ),
          )
        }

        const rawText = await readBoundedResponseText(response, reqContext.limits.maxApiResponseBytes, controller.signal)
        let parsed: unknown
        try {
          parsed = JSON.parse(rawText)
        } catch (err) {
          if (err instanceof MinerUError) throw err
          throw new MinerUError(
            failure(
              'REMOTE_PARSE_FAILED',
              `Failed to parse JSON response: ${err instanceof Error ? err.message : String(err)}`,
              false,
              { provider: this.provider },
            ),
            { cause: err },
          )
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new MinerUError(
            failure(
              'REMOTE_PARSE_FAILED',
              this.provider === 'official-v4'
                ? 'Official MinerU response must be an object'
                : 'MinerU response must be an object',
              false,
              { provider: this.provider },
            ),
          )
        }

        if (opts.validateResponse) {
          const validated = opts.validateResponse(parsed as Record<string, unknown>, response)
          if (validated !== undefined) {
            return validated as T
          }
        }
        return parsed as T
      } finally {
        clearTimeout(timer)
        reqContext.signal.removeEventListener('abort', onParentAbort)
      }
    }

    if (!allowRetry) {
      return await executeOnce()
    }

    return await executeWithRetry({
      provider: this.provider,
      operation,
      signal: reqContext.signal,
      retryOptions: reqContext.retry,
      fn: executeOnce,
    })
  }
}
