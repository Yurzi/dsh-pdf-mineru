import type { MinerUFileId } from './ids.js';
export type MinerUProviderId = 'self-hosted-v2' | 'official-v4';
export type MinerUErrorCode = 'INVALID_REQUEST' | 'FILE_NOT_FOUND' | 'FILE_TOO_LARGE' | 'UNSUPPORTED_OPTION' | 'CREDENTIAL_MISSING' | 'AUTHENTICATION_FAILED' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_CONFIG_MISSING' | 'PROVIDER_RATE_LIMITED' | 'PROVIDER_QUOTA_EXHAUSTED' | 'UPLOAD_FAILED' | 'REMOTE_PARSE_FAILED' | 'RESULT_NOT_READY' | 'RESULT_DOWNLOAD_FAILED' | 'RESULT_ARCHIVE_INVALID' | 'RESULT_TOO_LARGE' | 'CACHE_CORRUPT' | 'CACHE_CONFLICT' | 'CACHE_EVICTED' | 'INTERRUPTED_UPLOAD' | 'POLL_TIMEOUT' | 'CANCELLED' | 'UNAUTHENTICATED_SESSION' | 'JOB_NOT_FOUND' | 'JOB_ACCESS_DENIED' | 'STORAGE_LOCKED';
export interface MinerUFailure {
    readonly code: MinerUErrorCode;
    readonly message: string;
    readonly retryable: boolean;
    readonly provider?: MinerUProviderId;
    readonly providerCode?: string;
    readonly traceId?: string;
    readonly fileId?: MinerUFileId;
}
export declare class MinerUError extends Error {
    readonly failure: MinerUFailure;
    constructor(failure: MinerUFailure, options?: ErrorOptions);
}
export declare function sanitizeDiagnostic(input: string, secrets?: readonly string[]): string;
export declare function failure(code: MinerUErrorCode, message: string, retryable?: boolean, details?: Omit<MinerUFailure, 'code' | 'message' | 'retryable'>): MinerUFailure;
export declare function toMinerUFailure(error: unknown, fallback?: MinerUErrorCode): MinerUFailure;
export declare function throwMinerU(code: MinerUErrorCode, message: string, retryable?: boolean): never;
