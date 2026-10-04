import type { MinerUModel, ParseDefaults, ParseMethod } from '../domain/request.js'

import { asProviderConfigId, type ProviderConfigId } from '../domain/ids.js'

/** Plugin configuration version, independent of upstream APIs and cached result schemas. */
export const MINERU_CONFIG_SCHEMA_VERSION = 3 as const

/** Parse tiers advertised by the MinerU 4.0+ self-hosted V1 API. */
export const SELF_HOSTED_TIERS = ['flash', 'basic', 'standard', 'advanced'] as const
export type SelfHostedTier = typeof SELF_HOSTED_TIERS[number]

export interface SelfHostedLegacyV2Config {
  readonly id: ProviderConfigId
  readonly type: 'self-hosted-legacy-v2'
  readonly baseURL: string
  readonly apiKeyEnv?: string
  readonly modelMap: Readonly<Record<MinerUModel, string>>
  readonly configuredVersion?: string
  readonly allowInsecureHttp: boolean
}

export interface SelfHostedV1Config {
  readonly id: ProviderConfigId
  readonly type: 'self-hosted-v1'
  readonly baseURL: string
  readonly apiKeyEnv?: string
  readonly tier?: SelfHostedTier
  readonly ocrMode: ParseMethod
  readonly configuredVersion?: string
  readonly allowInsecureHttp: boolean
}

export interface OfficialV4Config {
  readonly id: ProviderConfigId
  readonly type: 'official-v4'
  readonly baseURL: string
  readonly apiKeyEnv: string
  readonly models: readonly MinerUModel[]
  readonly configuredVersion: 'v4'
}

export type ProviderConfig = SelfHostedV1Config | SelfHostedLegacyV2Config | OfficialV4Config

export interface StorageConfig {
  readonly storageRoot: string
  readonly cacheEnabled: boolean
  readonly retainSources: false
  readonly stagingTtlMs: number
}

export interface PollingConfig {
  readonly pollIntervalMs: number
  readonly pollTimeoutMs: number
  readonly requestTimeoutMs: number
  readonly operationTimeoutMs: number
}

export interface RetryConfig {
  readonly maxAttempts: number
  readonly baseDelayMs: number
  readonly maxDelayMs: number
}

export interface OutputConfig {
  /** Character budget (UTF-16 units) for one structured/prose read response, excluding image bytes. */
  readonly maxInlineChars: number
  /** Maximum number of image attachments emitted by one read response. */
  readonly maxInlineImages: number
}

export const MIN_INLINE_IMAGE_BUDGET = 0 as const
export const MAX_INLINE_IMAGE_BUDGET = 100 as const

export interface SecurityLimits {
  readonly maxFileBytes: number
  readonly maxApiResponseBytes: number
  readonly maxZipDownloadBytes: number
  readonly maxZipEntries: number
  readonly maxZipEntryBytes: number
  readonly maxZipTotalBytes: number
  readonly maxZipCompressionRatio: number
}

export interface MinerUConfig {
  readonly schemaVersion: typeof MINERU_CONFIG_SCHEMA_VERSION
  readonly activeProvider: ProviderConfigId
  readonly providers: readonly ProviderConfig[]
  readonly defaults: ParseDefaults
  readonly storage: StorageConfig
  readonly polling: PollingConfig
  readonly retry: RetryConfig
  readonly output: OutputConfig
  readonly limits: SecurityLimits
}

export function defaultProviderConfig(type: ProviderConfig['type']): ProviderConfig {
  if (type === 'self-hosted-v1') {
    return { id: asProviderConfigId('mp_self_hosted_v1'), type, baseURL: 'http://localhost:8000',
      apiKeyEnv: 'MINERU_API_KEY', ocrMode: 'auto', allowInsecureHttp: true }
  }
  if (type === 'official-v4') {
    return {
      id: asProviderConfigId('mp_official'),
      type,
      baseURL: 'https://mineru.net/api/v4',
      apiKeyEnv: 'MINERU_API_KEY',
      models: ['pipeline', 'vlm'],
      configuredVersion: 'v4',
    }
  }
  return {
    id: asProviderConfigId('mp_self_hosted'),
    type,
    baseURL: 'http://localhost:18000',
    apiKeyEnv: 'MINERU_API_KEY',
    modelMap: { pipeline: 'pipeline', vlm: 'vlm-engine' },
    allowInsecureHttp: true,
  }
}

export function providerById(config: MinerUConfig, id: ProviderConfigId): ProviderConfig | undefined {
  return config.providers.find(provider => provider.id === id)
}

export const DEFAULT_PARSE_DEFAULTS: ParseDefaults = {
  model: 'pipeline',
  ocr: false,
  parseMethod: 'auto',
  language: 'ch',
  formula: true,
  table: true,
}

/** V1 has no model/language/formula/table selectors; use stable internal sentinels for cache identity. */
export function effectiveParseDefaults(defaults: ParseDefaults, provider: ProviderConfig): ParseDefaults {
  if (provider.type !== 'self-hosted-v1') return defaults
  return { model: 'pipeline', parseMethod: provider.ocrMode, ocr: provider.ocrMode === 'ocr',
    language: 'auto', formula: false, table: false }
}

export const DEFAULT_POLLING_CONFIG: PollingConfig = {
  pollIntervalMs: 2000,
  pollTimeoutMs: 600000,
  requestTimeoutMs: 60000,
  operationTimeoutMs: 60 * 60 * 1000,
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 10000,
}

export const DEFAULT_OUTPUT_CONFIG: OutputConfig = {
  maxInlineChars: 12000,
  maxInlineImages: 6,
}

export const DEFAULT_SECURITY_LIMITS: SecurityLimits = {
  maxFileBytes: 200 * 1024 * 1024,
  maxApiResponseBytes: 8 * 1024 * 1024,
  maxZipDownloadBytes: 512 * 1024 * 1024,
  maxZipEntries: 10000,
  maxZipEntryBytes: 256 * 1024 * 1024,
  maxZipTotalBytes: 2 * 1024 * 1024 * 1024,
  maxZipCompressionRatio: 200,
}

export const DEFAULT_STORAGE_OPTIONS = {
  cacheEnabled: true,
  retainSources: false as const,
  stagingTtlMs: 24 * 60 * 60 * 1000,
}
