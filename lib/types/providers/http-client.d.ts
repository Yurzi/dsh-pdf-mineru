import { MinerUError } from '../domain/errors.js';
import type { MinerUProviderId } from '../domain/errors.js';
import type { ProviderCallContext } from './provider.js';
import { type ProviderRetryOperation, type ProviderRetryOptions } from './retry.js';
export interface ProviderHttpClientOptions {
    readonly baseURL: URL | string;
    readonly provider: MinerUProviderId;
    readonly defaultRetry?: ProviderRetryOptions;
    readonly providerLabel?: string;
}
export interface JsonRequestOptions<T = unknown> {
    readonly method?: string;
    readonly path: string;
    readonly body?: BodyInit;
    readonly headers?: Record<string, string>;
    readonly context: ProviderCallContext;
    readonly acceptedStatuses?: readonly number[];
    readonly operation?: ProviderRetryOperation;
    readonly retry?: boolean;
    readonly validateResponse?: (parsed: Record<string, unknown>, response: Response) => T | void;
}
/**
 * Resolves a request path against a base URL, preserving pathname prefix if any.
 */
export declare function resolveProviderUrl(baseUrl: URL | string, path: string): string;
/**
 * Extracts human-readable error messages from an API response body.
 * Inspects JSON fields detail, message, error, msg (prioritizing msg for official-v4, detail for self-hosted),
 * or falls back to truncated raw text for non-JSON bodies.
 */
export declare function extractErrorMessage(bodyText: string, provider?: MinerUProviderId): string | undefined;
/**
 * Maps HTTP error status codes to typed MinerUError instances with provider-specific diagnostic phrasing.
 */
export declare function createHttpStatusError(provider: MinerUProviderId, status: number, diagnostic: string, retryAfterMs?: number): MinerUError;
/**
 * Reusable HTTP client for MinerU providers encapsulating request setup, credential injection,
 * timeout management, error body extraction, status code mapping, and bounded retries.
 */
export declare class ProviderHttpClient {
    readonly baseUrl: URL;
    readonly provider: MinerUProviderId;
    readonly defaultRetry: ProviderRetryOptions;
    readonly providerLabel: string;
    constructor(options: ProviderHttpClientOptions);
    requestJson<T>(opts: JsonRequestOptions<T>): Promise<T>;
}
