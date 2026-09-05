import { MinerUError, failure, sanitizeDiagnostic } from '../domain/errors.js'
import type { MinerUProviderId } from '../domain/errors.js'
import type { ProviderCallContext } from './provider.js'
import {
  type ProviderRetryOperation,
  type ProviderRetryOptions,
  executeWithRetry,
  mergeRetryOptions,
  parseRetryAfter,
  readBoundedResponseText,
} from './retry.js'

export interface ProviderHttpClientOptions {
  readonly baseURL: URL | string
  readonly provider: MinerUProviderId
  readonly defaultRetry?: ProviderRetryOptions
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

export interface ExecuteJsonRequestOptions<T = unknown> extends JsonRequestOptions<T> {
  readonly client?: ProviderHttpClient
  readonly baseURL?: URL | string
  readonly provider?: MinerUProviderId
  readonly defaultRetry?: ProviderRetryOptions
  readonly providerLabel?: string
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

/**
 * Extracts human-readable error messages from an API response body.
 * Inspects JSON fields detail, message, error, msg (prioritizing msg for official-v4, detail for self-hosted),
 * or falls back to truncated raw text for non-JSON bodies.
 */
export function extractErrorMessage(bodyText: string, provider?: MinerUProviderId): string | undefined {
  let parsedError: string | undefined
  try {
    const parsed: unknown = JSON.parse(bodyText)
    if (typeof parsed === 'object' && parsed !== null) {
      const json = parsed as Record<string, unknown>
      if (provider === 'official-v4') {
        if (typeof json.msg === 'string') parsedError = json.msg
        else if (typeof json.message === 'string') parsedError = json.message
        else if (typeof json.detail === 'string') parsedError = json.detail
        else if (typeof json.error === 'string') parsedError = json.error
      } else {
        if (typeof json.detail === 'string') parsedError = json.detail
        else if (typeof json.message === 'string') parsedError = json.message
        else if (typeof json.error === 'string') parsedError = json.error
        else if (typeof json.msg === 'string') parsedError = json.msg
      }
    }
  } catch {
    parsedError = bodyText.slice(0, 500)
  }
  return parsedError
}

/**
 * Maps HTTP error status codes to typed MinerUError instances with provider-specific diagnostic phrasing.
 */
export function createHttpStatusError(
  provider: MinerUProviderId,
  status: number,
  diagnostic: string,
  retryAfterMs?: number,
): MinerUError {
  let err: MinerUError
  if (provider === 'official-v4') {
    if (status === 401 || status === 403) {
      err = new MinerUError(failure('AUTHENTICATION_FAILED', `Official MinerU authentication failed (${String(status)})${diagnostic}`, false, { provider }))
    } else if (status === 404) {
      err = new MinerUError(failure('JOB_NOT_FOUND', `Official MinerU resource not found (${String(status)})${diagnostic}`, false, { provider }))
    } else if (status === 413) {
      err = new MinerUError(failure('FILE_TOO_LARGE', `File exceeds size limit (${String(status)})${diagnostic}`, false, { provider }))
    } else if (status === 429) {
      err = new MinerUError(failure('PROVIDER_RATE_LIMITED', `Official MinerU rate limit exceeded (${String(status)})${diagnostic}`, true, { provider }))
    } else if (status === 408) {
      err = new MinerUError(failure('PROVIDER_UNAVAILABLE', `Official MinerU request timeout (${String(status)})${diagnostic}`, true, { provider }))
    } else if (status >= 500) {
      err = new MinerUError(failure('PROVIDER_UNAVAILABLE', `Official MinerU server error (${String(status)})${diagnostic}`, true, { provider }))
    } else {
      err = new MinerUError(failure('REMOTE_PARSE_FAILED', `Official MinerU returned status ${String(status)}${diagnostic}`, false, { provider }))
    }
  } else {
    if (status === 401 || status === 403) {
      err = new MinerUError(failure('AUTHENTICATION_FAILED', `Authentication failed (${String(status)})${diagnostic}`, false, { provider }))
    } else if (status === 404) {
      err = new MinerUError(failure('JOB_NOT_FOUND', `Resource not found (${String(status)})${diagnostic}`, false, { provider }))
    } else if (status === 413) {
      err = new MinerUError(failure('FILE_TOO_LARGE', `Uploaded file is too large (${String(status)})${diagnostic}`, false, { provider }))
    } else if (status === 429) {
      err = new MinerUError(failure('PROVIDER_RATE_LIMITED', `Provider rate limit exceeded (${String(status)})${diagnostic}`, true, { provider }))
    } else if (status === 408) {
      err = new MinerUError(failure('PROVIDER_UNAVAILABLE', `MinerU server request timeout (${String(status)})${diagnostic}`, true, { provider }))
    } else if (status >= 500) {
      err = new MinerUError(failure('PROVIDER_UNAVAILABLE', `MinerU server error (${String(status)})${diagnostic}`, true, { provider }))
    } else {
      err = new MinerUError(failure('REMOTE_PARSE_FAILED', `MinerU returned unexpected status ${String(status)}${diagnostic}`, false, { provider }))
    }
  }
  Object.assign(err, { httpStatus: status, retryAfterMs })
  return err
}

/**
 * Reusable HTTP client for MinerU providers encapsulating request setup, credential injection,
 * timeout management, error body extraction, status code mapping, and bounded retries.
 */
export class ProviderHttpClient {
  readonly baseUrl: URL
  readonly provider: MinerUProviderId
  readonly defaultRetry: ProviderRetryOptions
  readonly providerLabel: string

  constructor(options: ProviderHttpClientOptions) {
    this.baseUrl = typeof options.baseURL === 'string' ? new URL(options.baseURL) : options.baseURL
    this.provider = options.provider
    this.defaultRetry = options.defaultRetry ?? {}
    this.providerLabel = options.providerLabel ?? (options.provider === 'official-v4' ? 'MinerU official API' : 'MinerU server')
  }

  requestJson<T>(options: JsonRequestOptions<T>): Promise<T>
  requestJson<T>(
    method: string,
    path: string,
    body: BodyInit | undefined,
    headers: Record<string, string> | undefined,
    context: ProviderCallContext,
    acceptedStatuses?: readonly number[],
    options?: {
      operation?: ProviderRetryOperation
      retry?: boolean
      validateResponse?: (parsed: Record<string, unknown>, response: Response) => T | void
    },
  ): Promise<T>
  async requestJson<T>(
    optionsOrMethod: string | JsonRequestOptions<T>,
    path?: string,
    body?: BodyInit,
    headers?: Record<string, string>,
    context?: ProviderCallContext,
    acceptedStatuses?: readonly number[],
    options?: {
      operation?: ProviderRetryOperation
      retry?: boolean
      validateResponse?: (parsed: Record<string, unknown>, response: Response) => T | void
    },
  ): Promise<T> {
    const opts: JsonRequestOptions<T> = typeof optionsOrMethod === 'string'
      ? {
          method: optionsOrMethod,
          path: path!,
          body,
          headers,
          context: context!,
          acceptedStatuses,
          operation: options?.operation,
          retry: options?.retry,
          validateResponse: options?.validateResponse,
        }
      : optionsOrMethod

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
            )
            Object.assign(timeoutErr, { httpStatus: 408 })
            throw timeoutErr
          }
          const message = err instanceof Error ? err.message : String(err)
          throw new MinerUError(
            failure('PROVIDER_UNAVAILABLE', `Failed to connect to ${this.providerLabel}: ${sanitizeDiagnostic(message)}`, true),
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

          const parsedError = extractErrorMessage(errorBody, this.provider)
          const diagnostic = parsedError
            ? `: ${sanitizeDiagnostic(parsedError, [reqContext.credential ?? ''])}`
            : ''
          const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
          throw createHttpStatusError(this.provider, status, diagnostic, retryAfterMs)
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
              `Failed to parse JSON response: ${sanitizeDiagnostic(err instanceof Error ? err.message : String(err))}`,
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
      retryOptions: mergeRetryOptions(this.defaultRetry, reqContext.retry),
      fn: executeOnce,
    })
  }
}

/**
 * Unified helper to execute a JSON HTTP request with timeout, auth, status error handling, and retry.
 */
export async function executeJsonRequest<T>(options: ExecuteJsonRequestOptions<T>): Promise<T> {
  const client = options.client ?? new ProviderHttpClient({
    baseURL: options.baseURL ?? 'http://localhost',
    provider: options.provider ?? 'self-hosted-v2',
    defaultRetry: options.defaultRetry,
    providerLabel: options.providerLabel,
  })
  return await client.requestJson<T>(options)
}
