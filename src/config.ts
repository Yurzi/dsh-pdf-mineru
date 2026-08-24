import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { asProviderConfigId, type ProviderConfigId } from './domain/ids.js'
import type { ArtifactKind, MinerUModel, ParseDefaults, ParseMethod } from './domain/request.js'

export interface SelfHostedV2Config {
  readonly id: ProviderConfigId
  readonly type: 'self-hosted-v2'
  readonly baseURL: string
  readonly apiKeyEnv?: string
  readonly modelMap: Readonly<Record<MinerUModel, string>>
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

export type ProviderConfig = SelfHostedV2Config | OfficialV4Config

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

export interface OutputConfig {
  readonly maxInlineChars: number
}

export interface SecurityLimits {
  readonly maxFilesPerRequest: number
  readonly maxFileBytes: number
  readonly maxApiResponseBytes: number
  readonly maxZipDownloadBytes: number
  readonly maxZipEntries: number
  readonly maxZipEntryBytes: number
  readonly maxZipTotalBytes: number
  readonly maxZipCompressionRatio: number
}

export interface MinerUConfig {
  readonly schemaVersion: 1
  readonly activeProvider: ProviderConfigId
  readonly providers: readonly ProviderConfig[]
  readonly defaults: ParseDefaults
  readonly storage: StorageConfig
  readonly polling: PollingConfig
  readonly output: OutputConfig
  readonly limits: SecurityLimits
}

export interface LegacyMinerUConfig {
  readonly baseURL?: string
  readonly apiKeyEnv?: string
  readonly defaultBackend?: string
  readonly defaultParseMethod?: ParseMethod
  readonly defaultLang?: string
  readonly pollIntervalMs?: number
  readonly pollTimeoutMs?: number
  readonly requestTimeoutMs?: number
  readonly maxMdOutputChars?: number
}

function dshHome(): string {
  const env = process.env.DSH_HOME?.trim()
  return env ? resolve(env) : join(homedir(), '.dsh')
}

export function defaultMinerUConfig(): MinerUConfig {
  const id = asProviderConfigId('mp_self_hosted')
  return {
    schemaVersion: 1,
    activeProvider: id,
    providers: [{
      id,
      type: 'self-hosted-v2',
      baseURL: 'http://localhost:18000',
      apiKeyEnv: 'MINERU_API_KEY',
      modelMap: { pipeline: 'pipeline', vlm: 'vlm-engine' },
      allowInsecureHttp: true,
    }],
    defaults: { model: 'pipeline', ocr: false, parseMethod: 'auto', language: 'ch', formula: true, table: true, artifacts: ['markdown'] },
    storage: { storageRoot: join(dshHome(), 'dsh-pdf-mineru', 'v1'), cacheEnabled: true, retainSources: false, stagingTtlMs: 24 * 60 * 60 * 1000 },
    polling: { pollIntervalMs: 2000, pollTimeoutMs: 600000, requestTimeoutMs: 60000, operationTimeoutMs: 60 * 60 * 1000 },
    output: { maxInlineChars: 200000 },
    limits: {
      maxFilesPerRequest: 1,
      maxFileBytes: 200 * 1024 * 1024,
      maxApiResponseBytes: 8 * 1024 * 1024,
      maxZipDownloadBytes: 512 * 1024 * 1024,
      maxZipEntries: 10000,
      maxZipEntryBytes: 256 * 1024 * 1024,
      maxZipTotalBytes: 2 * 1024 * 1024 * 1024,
      maxZipCompressionRatio: 200,
    },
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, fallback: string, label: string): string {
  const result = value === undefined ? fallback : value
  if (typeof result !== 'string' || result.trim() === '') throw new TypeError(`${label} must be a non-empty string`)
  return result
}

function positive(value: unknown, fallback: number, label: string): number {
  const result = value === undefined ? fallback : value
  if (typeof result !== 'number' || !Number.isSafeInteger(result) || result <= 0) throw new TypeError(`${label} must be a positive safe integer`)
  return result
}

function boundedPositive(value: unknown, fallback: number, label: string, min: number, max: number): number {
  const result = positive(value, fallback, label)
  if (result < min || result > max) throw new TypeError(`${label} must be between ${String(min)} and ${String(max)}`)
  return result
}

function booleanValue(value: unknown, fallback: boolean, label: string): boolean {
  const result = value === undefined ? fallback : value
  if (typeof result !== 'boolean') throw new TypeError(`${label} must be a boolean`)
  return result
}

function credentialRef(value: unknown, fallback: string | undefined, required: boolean): string | undefined {
  const result = value === undefined ? fallback : value
  if (result === undefined && !required) return undefined
  if (typeof result !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(result)) throw new TypeError('apiKeyEnv must be a valid credential reference')
  return result
}

function baseUrl(value: unknown, fallback: string, allowHttp: boolean, label: string): string {
  const parsed = new URL(text(value, fallback, label))
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new TypeError(`${label} must not contain credentials, query, or fragment`)
  if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) throw new TypeError(`${label} must use HTTPS`)
  return parsed.toString().replace(/\/$/, '')
}

function models(value: unknown, fallback: readonly MinerUModel[]): readonly MinerUModel[] {
  const input = value === undefined ? fallback : value
  if (!Array.isArray(input) || input.length === 0 || input.some(item => item !== 'pipeline' && item !== 'vlm')) {
    throw new TypeError('provider models must contain pipeline and/or vlm')
  }
  return [...new Set(input as MinerUModel[])]
}

function artifacts(value: unknown, fallback: readonly ArtifactKind[]): readonly ArtifactKind[] {
  const input = value === undefined ? fallback : value
  const allowed = new Set<ArtifactKind>(['markdown', 'layout', 'model-output', 'content-list', 'images'])
  if (!Array.isArray(input) || input.some(item => typeof item !== 'string' || !allowed.has(item as ArtifactKind))) {
    throw new TypeError('defaults.artifacts contains an unsupported artifact')
  }
  return [...new Set<ArtifactKind>(['markdown', ...(input as ArtifactKind[])])]
}

function parseProvider(value: unknown): ProviderConfig {
  const input = record(value, 'provider')
  const id = asProviderConfigId(text(input.id, '', 'provider.id'))
  if (input.type === 'official-v4') {
    return {
      id,
      type: 'official-v4',
      baseURL: baseUrl(input.baseURL, 'https://mineru.net/api/v4', false, 'provider.baseURL'),
      apiKeyEnv: credentialRef(input.apiKeyEnv, 'MINERU_API_KEY', true)!,
      models: models(input.models, ['pipeline', 'vlm']),
      configuredVersion: 'v4',
    }
  }
  if (input.type !== 'self-hosted-v2') throw new TypeError('provider.type is unsupported')
  const allowInsecureHttp = booleanValue(input.allowInsecureHttp, false, 'provider.allowInsecureHttp')
  const map = record(input.modelMap, 'provider.modelMap')
  const pipeline = text(map.pipeline, '', 'modelMap.pipeline')
  const vlm = text(map.vlm, '', 'modelMap.vlm')
  if (pipeline === vlm) throw new TypeError('provider modelMap backends must be distinct')
  return {
    id,
    type: 'self-hosted-v2',
    baseURL: baseUrl(input.baseURL, 'http://localhost:18000', allowInsecureHttp, 'provider.baseURL'),
    apiKeyEnv: credentialRef(input.apiKeyEnv, undefined, false),
    modelMap: { pipeline, vlm },
    ...(input.configuredVersion === undefined ? {} : { configuredVersion: text(input.configuredVersion, '', 'configuredVersion') }),
    allowInsecureHttp,
  }
}

function parseCanonical(input: Record<string, unknown>, fallback: MinerUConfig): MinerUConfig {
  if (!Array.isArray(input.providers) || input.providers.length === 0) throw new TypeError('providers must be a non-empty array')
  const providers = input.providers.map(parseProvider)
  if (new Set(providers.map(provider => provider.id)).size !== providers.length) throw new TypeError('provider ids must be unique')
  const activeProvider = asProviderConfigId(text(input.activeProvider, '', 'activeProvider'))
  if (!providers.some(provider => provider.id === activeProvider)) throw new TypeError('activeProvider does not identify a configured provider')
  const defaults = record(input.defaults ?? {}, 'defaults')
  const storage = record(input.storage ?? {}, 'storage')
  const polling = record(input.polling ?? {}, 'polling')
  const output = record(input.output ?? {}, 'output')
  const limits = record(input.limits ?? {}, 'limits')
  const model = defaults.model === undefined ? fallback.defaults.model : defaults.model
  if (model !== 'pipeline' && model !== 'vlm') throw new TypeError('defaults.model is invalid')
  const storageRoot = text(storage.storageRoot, fallback.storage.storageRoot, 'storage.storageRoot')
  const result: MinerUConfig = {
    schemaVersion: 1,
    activeProvider,
    providers,
    defaults: {
      model,
      ocr: (() => {
        const method = defaults.parseMethod ?? (defaults.ocr === true ? 'ocr' : fallback.defaults.parseMethod)
        if (method !== 'auto' && method !== 'txt' && method !== 'ocr') throw new TypeError('defaults.parseMethod is invalid')
        const ocr = booleanValue(defaults.ocr, method === 'ocr', 'defaults.ocr')
        if (ocr !== (method === 'ocr')) throw new TypeError('defaults.ocr conflicts with defaults.parseMethod')
        return ocr
      })(),
      parseMethod: (() => {
        const method = defaults.parseMethod ?? (defaults.ocr === true ? 'ocr' : fallback.defaults.parseMethod)
        if (method !== 'auto' && method !== 'txt' && method !== 'ocr') throw new TypeError('defaults.parseMethod is invalid')
        return method
      })(),
      language: text(defaults.language, fallback.defaults.language, 'defaults.language'),
      formula: booleanValue(defaults.formula, fallback.defaults.formula, 'defaults.formula'),
      table: booleanValue(defaults.table, fallback.defaults.table, 'defaults.table'),
      artifacts: artifacts(defaults.artifacts, fallback.defaults.artifacts),
    },
    storage: {
      storageRoot: isAbsolute(storageRoot) ? resolve(storageRoot) : resolve(storageRoot),
      cacheEnabled: booleanValue(storage.cacheEnabled, fallback.storage.cacheEnabled, 'storage.cacheEnabled'),
      retainSources: false,
      stagingTtlMs: positive(storage.stagingTtlMs, fallback.storage.stagingTtlMs, 'storage.stagingTtlMs'),
    },
    polling: {
      pollIntervalMs: positive(polling.pollIntervalMs, fallback.polling.pollIntervalMs, 'polling.pollIntervalMs'),
      pollTimeoutMs: positive(polling.pollTimeoutMs, fallback.polling.pollTimeoutMs, 'polling.pollTimeoutMs'),
      requestTimeoutMs: positive(polling.requestTimeoutMs, fallback.polling.requestTimeoutMs, 'polling.requestTimeoutMs'),
      operationTimeoutMs: positive(polling.operationTimeoutMs, fallback.polling.operationTimeoutMs, 'polling.operationTimeoutMs'),
    },
    output: {
      maxInlineChars: boundedPositive(output.maxInlineChars, fallback.output.maxInlineChars, 'output.maxInlineChars', 1024, 1_000_000),
    },
    limits: {
      maxFilesPerRequest: positive(limits.maxFilesPerRequest, fallback.limits.maxFilesPerRequest, 'limits.maxFilesPerRequest'),
      maxFileBytes: positive(limits.maxFileBytes, fallback.limits.maxFileBytes, 'limits.maxFileBytes'),
      maxApiResponseBytes: positive(limits.maxApiResponseBytes, fallback.limits.maxApiResponseBytes, 'limits.maxApiResponseBytes'),
      maxZipDownloadBytes: positive(limits.maxZipDownloadBytes, fallback.limits.maxZipDownloadBytes, 'limits.maxZipDownloadBytes'),
      maxZipEntries: positive(limits.maxZipEntries, fallback.limits.maxZipEntries, 'limits.maxZipEntries'),
      maxZipEntryBytes: positive(limits.maxZipEntryBytes, fallback.limits.maxZipEntryBytes, 'limits.maxZipEntryBytes'),
      maxZipTotalBytes: positive(limits.maxZipTotalBytes, fallback.limits.maxZipTotalBytes, 'limits.maxZipTotalBytes'),
      maxZipCompressionRatio: positive(limits.maxZipCompressionRatio, fallback.limits.maxZipCompressionRatio, 'limits.maxZipCompressionRatio'),
    },
  }
  const active = providers.find(provider => provider.id === activeProvider)!
  if (active.type === 'official-v4') {
    if (!active.models.includes(result.defaults.model)) throw new TypeError('active official provider does not support defaults.model')
    if (result.defaults.parseMethod === 'txt') throw new TypeError('official-v4 cannot use txt as defaults.parseMethod')
  }
  if (result.limits.maxZipEntryBytes > result.limits.maxZipTotalBytes) {
    throw new TypeError('maxZipEntryBytes cannot exceed maxZipTotalBytes')
  }
  return result
}

export function migrateConfig(value: unknown): MinerUConfig {
  const fallback = defaultMinerUConfig()
  if (value === undefined || value === null) return fallback
  const input = record(value, 'config')
  if (input.providers !== undefined || input.activeProvider !== undefined) return parseCanonical(input, fallback)

  const baseURL = baseUrl(input.baseURL, fallback.providers[0]!.baseURL, true, 'baseURL')
  const defaultBackend = text(input.defaultBackend, 'pipeline', 'defaultBackend')
  const defaultParseMethod = input.defaultParseMethod ?? 'auto'
  if (defaultParseMethod !== 'auto' && defaultParseMethod !== 'txt' && defaultParseMethod !== 'ocr') throw new TypeError('defaultParseMethod is invalid')
  const id = asProviderConfigId('mp_self_hosted')
  const vlmBackend = defaultBackend === 'pipeline' ? 'vlm-engine' : defaultBackend
  return parseCanonical({
    activeProvider: id,
    providers: [{
      id, type: 'self-hosted-v2', baseURL, apiKeyEnv: input.apiKeyEnv,
      modelMap: { pipeline: defaultBackend === 'pipeline' ? defaultBackend : 'pipeline', vlm: vlmBackend },
      allowInsecureHttp: new URL(baseURL).protocol === 'http:',
    }],
    defaults: {
      model: defaultBackend === 'pipeline' ? 'pipeline' : 'vlm',
      ocr: defaultParseMethod === 'ocr',
      parseMethod: defaultParseMethod,
      language: input.defaultLang, formula: true, table: true, artifacts: ['markdown'],
    },
    polling: { pollIntervalMs: input.pollIntervalMs, pollTimeoutMs: input.pollTimeoutMs, requestTimeoutMs: input.requestTimeoutMs },
    output: { maxInlineChars: input.maxMdOutputChars },
  }, fallback)
}

export function providerById(config: MinerUConfig, id: ProviderConfigId): ProviderConfig | undefined {
  return config.providers.find(provider => provider.id === id)
}
