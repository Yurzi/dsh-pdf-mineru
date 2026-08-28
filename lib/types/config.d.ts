import { type ProviderConfigId } from './domain/ids.js';
import type { MinerUModel, ParseDefaults } from './domain/request.js';
export interface SelfHostedV2Config {
    readonly id: ProviderConfigId;
    readonly type: 'self-hosted-v2';
    readonly baseURL: string;
    readonly apiKeyEnv?: string;
    readonly modelMap: Readonly<Record<MinerUModel, string>>;
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
export type ProviderConfig = SelfHostedV2Config | OfficialV4Config;
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
    readonly maxInlineChars: number;
}
export interface SecurityLimits {
    readonly maxFilesPerRequest: number;
    readonly maxFileBytes: number;
    readonly maxApiResponseBytes: number;
    readonly maxZipDownloadBytes: number;
    readonly maxZipEntries: number;
    readonly maxZipEntryBytes: number;
    readonly maxZipTotalBytes: number;
    readonly maxZipCompressionRatio: number;
}
export interface MinerUConfig {
    readonly schemaVersion: 1;
    readonly activeProvider: ProviderConfigId;
    readonly providers: readonly ProviderConfig[];
    readonly defaults: ParseDefaults;
    readonly storage: StorageConfig;
    readonly polling: PollingConfig;
    readonly retry: RetryConfig;
    readonly output: OutputConfig;
    readonly limits: SecurityLimits;
}
export declare function defaultMinerUConfig(): MinerUConfig;
export declare function migrateConfig(value: unknown): MinerUConfig;
export declare function providerById(config: MinerUConfig, id: ProviderConfigId): ProviderConfig | undefined;
