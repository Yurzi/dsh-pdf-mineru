import type { MinerUErrorCode } from './domain/errors.js'
import type { MinerUProviderId } from './domain/ids.js'
import type { ProviderRetryOperation } from './providers/http/retry.js'

export type MinerUDiagnosticLevel = 'debug' | 'info' | 'warn' | 'error'

export type MinerUDiagnosticPhase =
  | 'cache-hit'
  | 'uploading'
  | 'provider-accepted'
  | 'collecting'
  | 'published'
  | 'provider-retry'
  | 'failed'

export interface MinerUDiagnosticEvent {
  readonly level: MinerUDiagnosticLevel
  readonly phase: MinerUDiagnosticPhase
  readonly provider?: MinerUProviderId
  readonly operationId?: string
  readonly providerOperation?: ProviderRetryOperation
  readonly durationMs?: number
  readonly bytes?: number
  readonly cacheHit?: boolean
  readonly waiterCount?: number
  readonly errorCode?: MinerUErrorCode
  readonly retryable?: boolean
  readonly attempt?: number
  readonly maxAttempts?: number
  readonly delayMs?: number
  readonly status?: number
  readonly reason?: 'transport' | 'http-status'
}

export type MinerUDiagnosticSink = (event: MinerUDiagnosticEvent) => void

export interface MinerUStructuredLogger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

export function createStructuredDiagnosticSink(logger: MinerUStructuredLogger): MinerUDiagnosticSink {
  return event => {
    try {
      logger[event.level]('dsh-pdf-mineru', event)
    } catch {
      // Structured logging is observational and must never affect parsing.
    }
  }
}

export function emitDiagnostic(
  sink: MinerUDiagnosticSink | undefined,
  event: MinerUDiagnosticEvent,
): void {
  try {
    sink?.(event)
  } catch {
    // Diagnostics must never change parsing behavior.
  }
}
