import { homedir } from 'node:os'
import { asProviderConfigId } from './domain/ids.js'
import { join, resolve } from 'node:path'
import type { MinerUModel, ParseMethod } from './domain/request.js'
import {
  DEFAULT_OUTPUT_CONFIG,
  DEFAULT_PARSE_DEFAULTS,
  DEFAULT_POLLING_CONFIG,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_SECURITY_LIMITS,
  DEFAULT_STORAGE_OPTIONS,
  MAX_INLINE_IMAGE_BUDGET,
  MIN_INLINE_IMAGE_BUDGET,
  MINERU_CONFIG_SCHEMA_VERSION,
  defaultProviderConfig,
  type MinerUConfig,
  type OfficialV4Config,
  type ProviderConfig,
  type SelfHostedV2Config,
} from './config/pure.js'

export * from './config/pure.js'

function dshHome(): string {
  const env = process.env.DSH_HOME?.trim()
  if (!env) return join(homedir(), '.dsh')
  if (env === '~') return homedir()
  if (env.startsWith('~/') || env.startsWith('~\\')) return resolve(join(homedir(), env.slice(2)))
  return resolve(env)
}

export function defaultMinerUConfig(): MinerUConfig {
  const selfHosted = defaultProviderConfig('self-hosted-v2')
  const official = defaultProviderConfig('official-v4')
  return {
    schemaVersion: MINERU_CONFIG_SCHEMA_VERSION,
    activeProvider: selfHosted.id,
    providers: [selfHosted, official],
    defaults: { ...DEFAULT_PARSE_DEFAULTS },
    storage: {
      storageRoot: join(dshHome(), 'cache', 'pdf-mineru'),
      ...DEFAULT_STORAGE_OPTIONS,
    },
    polling: { ...DEFAULT_POLLING_CONFIG },
    retry: { ...DEFAULT_RETRY_CONFIG },
    output: { ...DEFAULT_OUTPUT_CONFIG },
    limits: { ...DEFAULT_SECURITY_LIMITS },
  }
}

const ALLOWED_TOP_KEYS = new Set([
  'schemaVersion', 'activeProvider', 'providers', 'defaults', 'storage',
  'polling', 'retry', 'output', 'limits',
])
const ALLOWED_OFFICIAL_PROVIDER_KEYS = new Set([
  'id', 'type', 'baseURL', 'apiKeyEnv', 'models', 'configuredVersion',
])
const ALLOWED_SELF_HOSTED_PROVIDER_KEYS = new Set([
  'id', 'type', 'baseURL', 'apiKeyEnv', 'modelMap', 'configuredVersion', 'allowInsecureHttp',
])
const ALLOWED_MODEL_MAP_KEYS = new Set(['pipeline', 'vlm'])
const ALLOWED_DEFAULTS_KEYS = new Set(['model', 'ocr', 'parseMethod', 'language', 'formula', 'table'])
const ALLOWED_STORAGE_KEYS = new Set(['storageRoot', 'cacheEnabled', 'retainSources', 'stagingTtlMs'])
const ALLOWED_POLLING_KEYS = new Set(['pollIntervalMs', 'pollTimeoutMs', 'requestTimeoutMs', 'operationTimeoutMs'])
const ALLOWED_RETRY_KEYS = new Set(['maxAttempts', 'baseDelayMs', 'maxDelayMs'])
const ALLOWED_OUTPUT_KEYS = new Set(['maxInlineChars', 'maxInlineImages'])
const ALLOWED_LIMITS_KEYS = new Set([
  'maxFileBytes', 'maxApiResponseBytes', 'maxZipDownloadBytes',
  'maxZipEntries', 'maxZipEntryBytes', 'maxZipTotalBytes', 'maxZipCompressionRatio',
])
const LEGACY_ARTIFACT_KINDS = new Set([
  'markdown', 'layout', 'model-output', 'content-list', 'images',
])

function assertAllowedKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${path} contains unsupported property ${key}`)
    }
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

function boundedInteger(value: unknown, fallback: number, label: string, min: number, max: number): number {
  const result = value === undefined ? fallback : value
  if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < min || result > max) {
    throw new TypeError(`${label} must be an integer between ${String(min)} and ${String(max)}`)
  }
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

function hasLegacyV1Fields(input: Record<string, unknown>): boolean {
  const defaults = record(input.defaults ?? {}, 'defaults')
  const limits = record(input.limits ?? {}, 'limits')
  return Object.hasOwn(defaults, 'artifacts') || Object.hasOwn(limits, 'maxFilesPerRequest')
}

function migrateV1Fields(input: Record<string, unknown>): Record<string, unknown> {
  const defaults = record(input.defaults ?? {}, 'defaults')
  const legacyArtifacts = defaults.artifacts
  if (legacyArtifacts !== undefined && (
    !Array.isArray(legacyArtifacts)
    || legacyArtifacts.some(item => typeof item !== 'string' || !LEGACY_ARTIFACT_KINDS.has(item))
  )) {
    throw new TypeError('defaults.artifacts contains an unsupported artifact')
  }
  const migratedDefaults = { ...defaults }
  delete migratedDefaults.artifacts

  const limits = record(input.limits ?? {}, 'limits')
  if (limits.maxFilesPerRequest !== undefined) {
    positive(limits.maxFilesPerRequest, 1, 'limits.maxFilesPerRequest')
  }
  const migratedLimits = { ...limits }
  delete migratedLimits.maxFilesPerRequest

  return {
    ...input,
    schemaVersion: MINERU_CONFIG_SCHEMA_VERSION,
    defaults: migratedDefaults,
    limits: migratedLimits,
  }
}

function parseProvider(value: unknown): ProviderConfig {
  const input = record(value, 'provider')
  const id = asProviderConfigId(text(input.id, '', 'provider.id'))
  if (input.type === 'official-v4') {
    assertAllowedKeys(input, ALLOWED_OFFICIAL_PROVIDER_KEYS, 'provider')
    const official: OfficialV4Config = {
      id,
      type: 'official-v4',
      baseURL: baseUrl(input.baseURL, 'https://mineru.net/api/v4', false, 'provider.baseURL'),
      apiKeyEnv: credentialRef(input.apiKeyEnv, 'MINERU_API_KEY', true)!,
      models: models(input.models, ['pipeline', 'vlm']),
      configuredVersion: 'v4',
    }
    return official
  }
  if (input.type !== 'self-hosted-v2') throw new TypeError('provider.type is unsupported')
  assertAllowedKeys(input, ALLOWED_SELF_HOSTED_PROVIDER_KEYS, 'provider')
  const allowInsecureHttp = booleanValue(input.allowInsecureHttp, false, 'provider.allowInsecureHttp')
  const map = record(input.modelMap, 'provider.modelMap')
  assertAllowedKeys(map, ALLOWED_MODEL_MAP_KEYS, 'modelMap')
  const pipeline = text(map.pipeline, '', 'modelMap.pipeline')
  const vlm = text(map.vlm, '', 'modelMap.vlm')
  if (pipeline === vlm) throw new TypeError('provider modelMap backends must be distinct')
  const selfHosted: SelfHostedV2Config = {
    id,
    type: 'self-hosted-v2',
    baseURL: baseUrl(input.baseURL, 'http://localhost:18000', allowInsecureHttp, 'provider.baseURL'),
    apiKeyEnv: credentialRef(input.apiKeyEnv, undefined, false),
    modelMap: { pipeline, vlm },
    ...(input.configuredVersion === undefined ? {} : { configuredVersion: text(input.configuredVersion, '', 'configuredVersion') }),
    allowInsecureHttp,
  }
  return selfHosted
}

function parseCanonical(input: Record<string, unknown>, fallback: MinerUConfig): MinerUConfig {
  if (input.schemaVersion !== undefined) {
    if (input.schemaVersion !== MINERU_CONFIG_SCHEMA_VERSION) {
      throw new TypeError(`unsupported schemaVersion: ${String(input.schemaVersion)}`)
    }
  }

  if (!Array.isArray(input.providers) || input.providers.length === 0) throw new TypeError('providers must be a non-empty array')
  const providers = input.providers.map(parseProvider)
  if (new Set(providers.map(provider => provider.id)).size !== providers.length) throw new TypeError('provider ids must be unique')
  const activeProvider = asProviderConfigId(text(input.activeProvider, '', 'activeProvider'))
  if (!providers.some(provider => provider.id === activeProvider)) throw new TypeError('activeProvider does not identify a configured provider')

  const defaults = record(input.defaults ?? {}, 'defaults')
  assertAllowedKeys(defaults, ALLOWED_DEFAULTS_KEYS, 'defaults')

  const storage = record(input.storage ?? {}, 'storage')
  assertAllowedKeys(storage, ALLOWED_STORAGE_KEYS, 'storage')

  const polling = record(input.polling ?? {}, 'polling')
  assertAllowedKeys(polling, ALLOWED_POLLING_KEYS, 'polling')

  const retry = record(input.retry ?? {}, 'retry')
  assertAllowedKeys(retry, ALLOWED_RETRY_KEYS, 'retry')

  const output = record(input.output ?? {}, 'output')
  assertAllowedKeys(output, ALLOWED_OUTPUT_KEYS, 'output')

  const limits = record(input.limits ?? {}, 'limits')
  assertAllowedKeys(limits, ALLOWED_LIMITS_KEYS, 'limits')

  const model = defaults.model === undefined ? fallback.defaults.model : defaults.model
  if (model !== 'pipeline' && model !== 'vlm') throw new TypeError('defaults.model is invalid')

  let parseMethod: ParseMethod
  if (defaults.parseMethod !== undefined) {
    if (defaults.parseMethod !== 'auto' && defaults.parseMethod !== 'txt' && defaults.parseMethod !== 'ocr') {
      throw new TypeError('defaults.parseMethod is invalid')
    }
    parseMethod = defaults.parseMethod as ParseMethod
  } else if (defaults.ocr === true) {
    parseMethod = 'ocr'
  } else {
    parseMethod = fallback.defaults.parseMethod
  }

  const expectedOcr = parseMethod === 'ocr'
  if (defaults.ocr !== undefined) {
    const ocrVal = booleanValue(defaults.ocr, expectedOcr, 'defaults.ocr')
    if (ocrVal !== expectedOcr) {
      throw new TypeError('defaults.ocr conflicts with defaults.parseMethod')
    }
  }
  const ocr = expectedOcr

  const storageRoot = text(storage.storageRoot, fallback.storage.storageRoot, 'storage.storageRoot')

  if (storage.retainSources !== undefined && storage.retainSources !== false) {
    throw new TypeError('storage.retainSources must be false')
  }

  const result: MinerUConfig = {
    schemaVersion: MINERU_CONFIG_SCHEMA_VERSION,
    activeProvider,
    providers,
    defaults: {
      model,
      ocr,
      parseMethod,
      language: text(defaults.language, fallback.defaults.language, 'defaults.language'),
      formula: booleanValue(defaults.formula, fallback.defaults.formula, 'defaults.formula'),
      table: booleanValue(defaults.table, fallback.defaults.table, 'defaults.table'),
    },
    storage: {
      storageRoot: resolve(storageRoot),
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
    retry: {
      maxAttempts: boundedPositive(retry.maxAttempts, fallback.retry.maxAttempts, 'retry.maxAttempts', 1, 10),
      baseDelayMs: boundedPositive(retry.baseDelayMs, fallback.retry.baseDelayMs, 'retry.baseDelayMs', 1, 60_000),
      maxDelayMs: boundedPositive(retry.maxDelayMs, fallback.retry.maxDelayMs, 'retry.maxDelayMs', 1, 300_000),
    },
    output: {
      maxInlineChars: boundedPositive(output.maxInlineChars, fallback.output.maxInlineChars, 'output.maxInlineChars', 1024, 1_000_000),
      maxInlineImages: boundedInteger(
        output.maxInlineImages,
        fallback.output.maxInlineImages,
        'output.maxInlineImages',
        MIN_INLINE_IMAGE_BUDGET,
        MAX_INLINE_IMAGE_BUDGET,
      ),
    },
    limits: {
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
  if (result.retry.baseDelayMs > result.retry.maxDelayMs) {
    throw new TypeError('retry.baseDelayMs cannot exceed retry.maxDelayMs')
  }
  if (result.limits.maxZipEntryBytes > result.limits.maxZipTotalBytes) {
    throw new TypeError('maxZipEntryBytes cannot exceed maxZipTotalBytes')
  }
  return result
}

export interface ParsedMinerUConfig {
  readonly config: MinerUConfig
  readonly migrated: boolean
  readonly migratedFrom?: 1
}

function parseConfigInput(value: unknown, allowCurrentLegacyFields: boolean): ParsedMinerUConfig {
  const fallback = defaultMinerUConfig()
  if (value === undefined || value === null) return { config: fallback, migrated: false }
  const input = record(value, 'config')
  assertAllowedKeys(input, ALLOWED_TOP_KEYS, 'config')
  if (input.schemaVersion === 1) {
    return { config: parseCanonical(migrateV1Fields(input), fallback), migrated: true, migratedFrom: 1 }
  }
  if (
    allowCurrentLegacyFields
    && (input.schemaVersion === undefined || input.schemaVersion === MINERU_CONFIG_SCHEMA_VERSION)
    && hasLegacyV1Fields(input)
  ) {
    return { config: parseCanonical(migrateV1Fields(input), fallback), migrated: true }
  }
  return { config: parseCanonical(input, fallback), migrated: false }
}

/** Parse startup/settings input, including legacy fields merged over a current composition base. */
export function parseConfigWithMigration(value: unknown): ParsedMinerUConfig {
  return parseConfigInput(value, true)
}

export function parseConfig(value: unknown): MinerUConfig {
  return parseConfigInput(value, false).config
}
