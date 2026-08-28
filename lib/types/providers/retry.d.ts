import type { MinerUProviderId } from '../domain/errors.js';
export type ProviderRetryOperation = 'probe' | 'submit' | 'inspect' | 'collect' | 'api-json' | 'presigned-put' | 'cdn-download';
export interface ProviderRetryEvent {
    readonly provider: MinerUProviderId;
    readonly operation: ProviderRetryOperation;
    readonly attempt: number;
    readonly maxRetries: number;
    readonly delayMs: number;
    readonly reason: 'transport' | 'http-status';
    readonly status?: number;
    readonly retryAfterMs?: number;
}
export type ProviderRetryHook = (event: ProviderRetryEvent) => void;
export interface ProviderRetryPolicy {
    readonly maxRetries?: number;
    readonly initialDelayMs?: number;
    readonly maxDelayMs?: number;
    readonly backoffFactor?: number;
    readonly jitter?: boolean;
}
export interface ProviderRetryHooks {
    readonly onRetry?: ProviderRetryHook;
    readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    readonly random?: () => number;
}
export interface ProviderRetryOptions extends ProviderRetryPolicy, ProviderRetryHooks {
}
export declare function mergeRetryOptions(defaults: ProviderRetryOptions, overrides: ProviderRetryOptions | undefined): ProviderRetryOptions;
export declare function readBoundedResponseText(response: Response, maxBytes: number, signal: AbortSignal): Promise<string>;
export declare const DEFAULT_RETRY_POLICY: Required<ProviderRetryPolicy>;
/**
 * Parses a standard HTTP Retry-After header value.
 * Supports decimal integer seconds (e.g. "120") and HTTP-date strings.
 * Returns the delay in milliseconds, or undefined if missing/unparseable.
 */
export declare function parseRetryAfter(header: string | null | undefined, now?: number): number | undefined;
/**
 * Returns true if an HTTP status code is typically transient and safe to retry.
 * Matches 408 (Request Timeout), 429 (Too Many Requests), and 5xx server errors.
 */
export declare function isRetryableHttpStatus(status: number): boolean;
/**
 * Determines whether a caught error is retryable.
 * Abort/cancellation errors and explicit non-retryable MinerUErrors return false.
 */
export declare function isRetryableError(err: unknown, signal?: AbortSignal): boolean;
/**
 * Abort-aware delay utility.
 * Cleans up its timer listener immediately when aborted or resolved.
 */
export declare function defaultSleep(ms: number, signal: AbortSignal): Promise<void>;
/**
 * Calculates exponential backoff delay with optional jitter or Retry-After header.
 */
export declare function calculateBackoffDelay(attempt: number, policy: Required<ProviderRetryPolicy>, retryAfterMs?: number, random?: () => number): number;
export interface RetryExecutionContext<T> {
    readonly provider: MinerUProviderId;
    readonly operation: ProviderRetryOperation;
    readonly signal: AbortSignal;
    readonly retryOptions?: ProviderRetryOptions;
    readonly fn: (attempt: number) => Promise<T>;
}
export declare function resolveRetryPolicy(options?: ProviderRetryPolicy): Required<ProviderRetryPolicy>;
/**
 * Reusable bounded, abort-aware retry executor for idempotent provider operations.
 */
export declare function executeWithRetry<T>(ctx: RetryExecutionContext<T>): Promise<T>;
