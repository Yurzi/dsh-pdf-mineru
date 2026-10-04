import type { MinerUModel, ParseDefaults, ParseMethod } from '../domain/request.js';
import { type ProviderConfigId } from '../domain/ids.js';
export declare const MINERU_CONFIG_SCHEMA_VERSION: 2;
/** Parse tiers advertised by the MinerU 4.0+ self-hosted V1 API. */
export declare const SELF_HOSTED_TIERS: readonly ["flash", "basic", "standard", "advanced"];
export type SelfHostedTier = typeof SELF_HOSTED_TIERS[number];
export interface SelfHostedLegacyV2Config {
    readonly id: ProviderConfigId;
    readonly type: 'self-hosted-legacy-v2';
    readonly baseURL: string;
    readonly apiKeyEnv?: string;
    readonly modelMap: Readonly<Record<MinerUModel, string>>;
    readonly configuredVersion?: string;
    readonly allowInsecureHttp: boolean;
}
export interface SelfHostedV1Config {
    readonly id: ProviderConfigId;
    readonly type: 'self-hosted-v1';
    readonly baseURL: string;
    readonly apiKeyEnv?: string;
    readonly tier?: SelfHostedTier;
    readonly ocrMode: ParseMethod;
    readonly configuredVersion?: string;
    readonly allowInsecureHttp: boolean;
}
export interface OfficialV4Config {
    readonly id: ProviderConfigId;
    readonly type: 'official-v4';
    readonly baseURL: string;
    readonly apiKeyEnv: string;
    readonly models: readonly MinerUModel[];
    readonly configuredVersion: 'v4';
}
export type ProviderConfig = SelfHostedV1Config | SelfHostedLegacyV2Config | OfficialV4Config;
export interface StorageConfig {
    readonly storageRoot: string;
    readonly cacheEnabled: boolean;
    readonly retainSources: false;
    readonly stagingTtlMs: number;
}
export interface PollingConfig {
    readonly pollIntervalMs: number;
    readonly pollTimeoutMs: number;
    readonly requestTimeoutMs: number;
    readonly operationTimeoutMs: number;
}
export interface RetryConfig {
    readonly maxAttempts: number;
    readonly baseDelayMs: number;
    readonly maxDelayMs: number;
}
export interface OutputConfig {
    /** Character budget (UTF-16 units) for one structured/prose read response, excluding image bytes. */
    readonly maxInlineChars: number;
    /** Maximum number of image attachments emitted by one read response. */
    readonly maxInlineImages: number;
}
export declare const MIN_INLINE_IMAGE_BUDGET: 0;
export declare const MAX_INLINE_IMAGE_BUDGET: 100;
export interface SecurityLimits {
    readonly maxFileBytes: number;
    readonly maxApiResponseBytes: number;
    readonly maxZipDownloadBytes: number;
    readonly maxZipEntries: number;
    readonly maxZipEntryBytes: number;
    readonly maxZipTotalBytes: number;
    readonly maxZipCompressionRatio: number;
}
export interface MinerUConfig {
    readonly schemaVersion: typeof MINERU_CONFIG_SCHEMA_VERSION;
    readonly activeProvider: ProviderConfigId;
    readonly providers: readonly ProviderConfig[];
    readonly defaults: ParseDefaults;
    readonly storage: StorageConfig;
    readonly polling: PollingConfig;
    readonly retry: RetryConfig;
    readonly output: OutputConfig;
    readonly limits: SecurityLimits;
}
export declare function defaultProviderConfig(type: ProviderConfig['type']): ProviderConfig;
export declare function providerById(config: MinerUConfig, id: ProviderConfigId): ProviderConfig | undefined;
export declare const DEFAULT_PARSE_DEFAULTS: ParseDefaults;
/** V1 has no model/language/formula/table selectors; use stable internal sentinels for cache identity. */
export declare function effectiveParseDefaults(defaults: ParseDefaults, provider: ProviderConfig): ParseDefaults;
export declare const DEFAULT_POLLING_CONFIG: PollingConfig;
export declare const DEFAULT_RETRY_CONFIG: RetryConfig;
export declare const DEFAULT_OUTPUT_CONFIG: OutputConfig;
export declare const DEFAULT_SECURITY_LIMITS: SecurityLimits;
export declare const DEFAULT_STORAGE_OPTIONS: {
    cacheEnabled: boolean;
    retainSources: false;
    stagingTtlMs: number;
};
