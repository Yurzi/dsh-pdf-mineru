import type { MinerUFileId } from './ids.js'

export type MinerUProviderId = 'self-hosted-v2' | 'official-v4'

export type MinerUErrorCode =
  | 'INVALID_REQUEST'
  | 'FILE_NOT_FOUND'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_OPTION'
  | 'CREDENTIAL_MISSING'
  | 'AUTHENTICATION_FAILED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_CONFIG_MISSING'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_QUOTA_EXHAUSTED'
  | 'UPLOAD_FAILED'
  | 'REMOTE_PARSE_FAILED'
  | 'RESULT_NOT_READY'
  | 'RESULT_DOWNLOAD_FAILED'
  | 'RESULT_ARCHIVE_INVALID'
  | 'RESULT_TOO_LARGE'
  | 'CACHE_CORRUPT'
  | 'CACHE_CONFLICT'
  | 'CACHE_EVICTED'
  | 'INTERRUPTED_UPLOAD'
  | 'POLL_TIMEOUT'
  | 'CANCELLED'
  | 'UNAUTHENTICATED_SESSION'
  | 'JOB_NOT_FOUND'
  | 'JOB_ACCESS_DENIED'
  | 'STORAGE_LOCKED'

export interface MinerUFailure {
  readonly code: MinerUErrorCode
  readonly message: string
  readonly retryable: boolean
  readonly provider?: MinerUProviderId
  readonly providerCode?: string
  readonly traceId?: string
  readonly fileId?: MinerUFileId
}

export class MinerUError extends Error {
  constructor(public readonly failure: MinerUFailure, options?: ErrorOptions) {
    super(failure.message, options)
    this.name = 'MinerUError'
  }
}

export function sanitizeDiagnostic(input: string, secrets: readonly string[] = []): string {
  let sanitized = input
  for (const secret of secrets) {
    if (secret !== '') sanitized = sanitized.split(secret).join('[REDACTED]')
  }
  return sanitized
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .replace(/https?:\/\/[^\s<>"']+/gi, raw => {
      try {
        const url = new URL(raw)
        url.username = ''
        url.password = ''
        url.pathname = url.pathname === '/' ? '/' : '/[REDACTED]'
        url.search = ''
        url.hash = ''
        return url.toString()
      } catch {
        return '[REDACTED_URL]'
      }
    })
    .slice(0, 2000)
}

export function failure(
  code: MinerUErrorCode,
  message: string,
  retryable = false,
  details: Omit<MinerUFailure, 'code' | 'message' | 'retryable'> = {},
): MinerUFailure {
  return { code, message: sanitizeDiagnostic(message), retryable, ...details }
}

export function toMinerUFailure(error: unknown, fallback: MinerUErrorCode = 'PROVIDER_UNAVAILABLE'): MinerUFailure {
  if (error instanceof MinerUError) return error.failure
  if (error instanceof Error && error.name === 'AbortError') {
    return failure('CANCELLED', 'MinerU operation was cancelled', true)
  }
  return failure(fallback, error instanceof Error ? error.message : String(error), true)
}

export function throwMinerU(code: MinerUErrorCode, message: string, retryable = false): never {
  throw new MinerUError(failure(code, message, retryable))
}
