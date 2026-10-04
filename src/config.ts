import { homedir } from 'node:os'
import { repairLegacyConfigValues } from './config/migration-values.js'
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
  SELF_HOSTED_TIERS,
  defaultProviderConfig,
  type MinerUConfig,
  type OfficialV4Config,
  type ProviderConfig,
  type SelfHostedTier,
  type SelfHostedV1Config,
  type SelfHostedLegacyV2Config,
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
  const selfHosted = defaultProviderConfig('self-hosted-legacy-v2')
  const official = defaultProviderConfig('official-v4')
  return {
    schemaVersion: MINERU_CONFIG_SCHEMA_VERSION,
    activeProvider: selfHosted.id,
    providers: [selfHosted, official, defaultProviderConfig('self-hosted-v1')],
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
const ALLOWED_LEGACY_PROVIDER_KEYS = new Set([
  'id', 'type', 'baseURL', 'apiKeyEnv', 'modelMap', 'configuredVersion', 'allowInsecureHttp',
])
const ALLOWED_V1_PROVIDER_KEYS = new Set([
  'id', 'type', 'baseURL', 'apiKeyEnv', 'tier', 'ocrMode', 'configuredVersion', 'allowInsecureHttp',
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

function hasLegacySchemaV1Fields(input: Record<string, unknown>): boolean {
  const defaults = record(input.defaults ?? {}, 'defaults')
  const limits = record(input.limits ?? {}, 'limits')
  return Object.hasOwn(defaults, 'artifacts') || Object.hasOwn(limits, 'maxFilesPerRequest')
}

function migrateSchemaV1ToV2(input: Record<string, unknown>): Record<string, unknown> {
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
    schemaVersion: 2,
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
  if (input.type === 'self-hosted-v1') {
    assertAllowedKeys(input, ALLOWED_V1_PROVIDER_KEYS, 'provider')
    const allowInsecureHttp = booleanValue(input.allowInsecureHttp, false, 'provider.allowInsecureHttp')
    let tier: SelfHostedTier | undefined
    if (input.tier !== undefined) {
      if (typeof input.tier !== 'string' || !(SELF_HOSTED_TIERS as readonly string[]).includes(input.tier)) {
        throw new TypeError('provider.tier must be flash, basic, standard or advanced')
      }
      tier = input.tier as SelfHostedTier
    }
    const ocrMode = input.ocrMode === undefined ? 'auto' : input.ocrMode
    if (ocrMode !== 'auto' && ocrMode !== 'txt' && ocrMode !== 'ocr') throw new TypeError('provider.ocrMode must be auto, txt or ocr')
    const v1: SelfHostedV1Config = {
      id, type: 'self-hosted-v1',
      baseURL: baseUrl(input.baseURL, 'http://localhost:8000', allowInsecureHttp, 'provider.baseURL'),
      apiKeyEnv: credentialRef(input.apiKeyEnv, undefined, false),
      ...(tier === undefined ? {} : { tier }), ocrMode,
      ...(input.configuredVersion === undefined ? {} : { configuredVersion: text(input.configuredVersion, '', 'configuredVersion') }),
      allowInsecureHttp,
    }
    return v1
  }
  if (input.type !== 'self-hosted-legacy-v2') throw new TypeError('provider.type is unsupported; choose self-hosted-v1, self-hosted-legacy-v2 or official-v4')
  assertAllowedKeys(input, ALLOWED_LEGACY_PROVIDER_KEYS, 'provider')
  const allowInsecureHttp = booleanValue(input.allowInsecureHttp, false, 'provider.allowInsecureHttp')
  const map = record(input.modelMap, 'provider.modelMap')
  assertAllowedKeys(map, ALLOWED_MODEL_MAP_KEYS, 'modelMap')
  const pipeline = text(map.pipeline, '', 'modelMap.pipeline')
  const vlm = text(map.vlm, '', 'modelMap.vlm')
  if (pipeline === vlm) throw new TypeError('provider modelMap backends must be distinct')
  const selfHosted: SelfHostedLegacyV2Config = {
    id, type: 'self-hosted-legacy-v2',
    baseURL: baseUrl(input.baseURL, 'http://localhost:18000', allowInsecureHttp, 'provider.baseURL'),
    apiKeyEnv: credentialRef(input.apiKeyEnv, undefined, false), modelMap: { pipeline, vlm },
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

export interface SelfHostedProviderMigration {
  readonly providerId: SelfHostedLegacyV2Config['id']
  readonly from: 'self-hosted-v2'
  readonly to: 'self-hosted-legacy-v2'
  /** V1-only fields removed when an old mixed profile is explicitly migrated to legacy. */
  readonly removedFields: readonly 'tier'[]
}

/** Narrow input migration only: never teach runtime providers or canonical schemas an old alias. */
function migrateSelfHostedProviders(input: Record<string, unknown>): {
  readonly input: Record<string, unknown>
  readonly migrations: readonly SelfHostedProviderMigration[]
} {
  if (!Array.isArray(input.providers)) return { input, migrations: [] }
  const migrations: SelfHostedProviderMigration[] = []
  const providers = input.providers.map(value => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
    const provider = value as Record<string, unknown>
    if (provider.type !== 'self-hosted-v2') return value
    assertAllowedKeys(provider, new Set([...ALLOWED_LEGACY_PROVIDER_KEYS, 'tier']), 'provider')
    // The previous mixed profile accepted null/undefined as no explicit tier. Validate
    // before dropping the field so migration cannot hide malformed configuration.
    if (provider.tier !== undefined && provider.tier !== null
      && (typeof provider.tier !== 'string' || !(SELF_HOSTED_TIERS as readonly string[]).includes(provider.tier))) {
      throw new TypeError('legacy provider.tier must be flash, basic, standard or advanced')
    }
    const { tier: _tier, ...legacy } = provider
    migrations.push({
      providerId: asProviderConfigId(text(provider.id, '', 'provider.id')),
      from: 'self-hosted-v2', to: 'self-hosted-legacy-v2',
      removedFields: Object.hasOwn(provider, 'tier') ? ['tier'] : [],
    })
    return { ...legacy, type: 'self-hosted-legacy-v2' }
  })
  return { input: migrations.length === 0 ? input : { ...input, providers }, migrations }
}

export interface ConfigMigrationStep {
  readonly from: number
  readonly to: number
}

interface ConfigMigration {
  readonly to: number
  readonly migrate: (input: Record<string, unknown>) => {
    readonly input: Record<string, unknown>
    readonly providers?: readonly SelfHostedProviderMigration[]
  }
}

/** Each entry advances exactly one version; never infer a protocol from an endpoint or tier. */
const CONFIG_MIGRATIONS: ReadonlyMap<number, ConfigMigration> = new Map([
  [1, { to: 2, migrate: input => ({ input: migrateSchemaV1ToV2(input) }) }],
  [2, { to: 3, migrate: input => {
    const converted = migrateSelfHostedProviders(input)
    return { input: { ...converted.input, schemaVersion: 3 }, providers: converted.migrations }
  } }],
])

export interface ParsedMinerUConfig {
  readonly config: MinerUConfig
  readonly migrated: boolean
  readonly migratedFrom?: 1 | 2
  /** Versionless Provider-based documents predate schema 3 and are interpreted as schema 2. */
  readonly assumedVersion?: 2
  readonly migrationSteps?: readonly ConfigMigrationStep[]
  /** Paths only: never record old values, credentials, endpoints or filesystem paths. */
  readonly defaultedFields?: readonly string[]
  readonly providerMigrations?: readonly SelfHostedProviderMigration[]
}

function migrateConfigInput(value: unknown): ParsedMinerUConfig {
  const fallback = defaultMinerUConfig()
  if (value === undefined || value === null) return { config: fallback, migrated: false }
  const input = record(value, 'config')
  assertAllowedKeys(input, ALLOWED_TOP_KEYS, 'config')
  const sourceVersion = input.schemaVersion === undefined ? 2 : input.schemaVersion
  if (typeof sourceVersion !== 'number' || !Number.isSafeInteger(sourceVersion)
    || sourceVersion < 1 || sourceVersion > MINERU_CONFIG_SCHEMA_VERSION) {
    throw new TypeError('unsupported schemaVersion: ' + String(sourceVersion))
  }
  const repaired = sourceVersion < MINERU_CONFIG_SCHEMA_VERSION
    ? repairLegacyConfigValues(input, fallback, parseProvider, parseCanonical)
    : { input, defaultedFields: [] }
  let current = repaired.input
  // Compatibility for DSH's historical v1 fields composed over a newer base.
  // This startup-only shim does not enable retired provider types in schema 3.
  const cleanComposedFields = sourceVersion !== 1 && hasLegacySchemaV1Fields(current)
  if (cleanComposedFields) {
    // The host can keep obsolete non-form fields in its immutable composition base
    // after saving schema 3. Discard only these two retired fields in memory; do not
    // rewrite the base or broaden current provider/option validation.
    current = { ...migrateSchemaV1ToV2({ ...current,
      defaults: { ...record(current.defaults ?? {}, 'defaults'), artifacts: undefined },
      limits: { ...record(current.limits ?? {}, 'limits'), maxFilesPerRequest: undefined },
    }), schemaVersion: sourceVersion }
  }
  const steps: ConfigMigrationStep[] = []
  const providers: SelfHostedProviderMigration[] = []
  let version = sourceVersion
  while (version < MINERU_CONFIG_SCHEMA_VERSION) {
    const step = CONFIG_MIGRATIONS.get(version)
    if (!step || step.to !== version + 1 || step.to > MINERU_CONFIG_SCHEMA_VERSION) {
      throw new TypeError('Missing configuration migration from schemaVersion ' + String(version))
    }
    const migrated = step.migrate(current)
    current = migrated.input
    if (current.schemaVersion !== step.to) throw new TypeError('Configuration migration produced an invalid schemaVersion')
    steps.push({ from: version, to: step.to })
    providers.push(...(migrated.providers ?? []))
    version = step.to
  }
  const config = parseCanonical(current, fallback)
  return {
    config,
    migrated: cleanComposedFields || steps.length > 0,
    ...(sourceVersion < MINERU_CONFIG_SCHEMA_VERSION ? { migratedFrom: sourceVersion as 1 | 2 } : {}),
    ...(input.schemaVersion === undefined ? { assumedVersion: 2 as const } : {}),
    ...(steps.length === 0 ? {} : { migrationSteps: steps }),
    ...(repaired.defaultedFields.length === 0 ? {} : { defaultedFields: repaired.defaultedFields }),
    ...(providers.length === 0 ? {} : { providerMigrations: providers }),
  }
}

/** Parse startup/settings input, including known field and self-hosted profile migrations. */
export function parseConfigWithMigration(value: unknown): ParsedMinerUConfig {
  return migrateConfigInput(value)
}

/** Strict canonical parser for current-version edits; loading historical documents uses the migration entry point. */
export function parseConfig(value: unknown): MinerUConfig {
  const fallback = defaultMinerUConfig()
  if (value === undefined || value === null) return fallback
  const input = record(value, 'config')
  assertAllowedKeys(input, ALLOWED_TOP_KEYS, 'config')
  if (input.schemaVersion !== undefined && input.schemaVersion !== MINERU_CONFIG_SCHEMA_VERSION) {
    throw new TypeError('unsupported schemaVersion: ' + String(input.schemaVersion) + '; load through migration to schemaVersion ' + String(MINERU_CONFIG_SCHEMA_VERSION))
  }
  return parseCanonical(input, fallback)
}

function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((entry, index) => deepEqualJson(entry, b[index]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every(key => Object.hasOwn(right, key) && deepEqualJson(left[key], right[key]))
}

function pruneObjectSection(
  nextSection: Record<string, unknown>,
  baseSection: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const sectionDiff: Record<string, unknown> = {}
  const allKeys = new Set([...Object.keys(nextSection), ...Object.keys(baseSection)])
  for (const key of allKeys) {
    if (!deepEqualJson(nextSection[key], baseSection[key])) {
      sectionDiff[key] = nextSection[key]
    }
  }
  return Object.keys(sectionDiff).length > 0 ? sectionDiff : undefined
}

export function pruneConfigToDiff(
  next: MinerUConfig,
  base: MinerUConfig = defaultMinerUConfig(),
): Record<string, unknown> {
  const diff: Record<string, unknown> = {}

  if (next.activeProvider !== base.activeProvider) {
    diff.activeProvider = next.activeProvider
  }

  if (!deepEqualJson(next.providers, base.providers)) {
    diff.providers = next.providers
  }

  if (!deepEqualJson(next.defaults, base.defaults)) {
    diff.defaults = next.defaults
  }

  const plainSections = ['storage', 'polling', 'retry', 'output', 'limits'] as const
  for (const section of plainSections) {
    const sectionDiff = pruneObjectSection(
      next[section] as unknown as Record<string, unknown>,
      base[section] as unknown as Record<string, unknown>,
    )
    if (sectionDiff !== undefined) {
      diff[section] = sectionDiff
    }
  }

  if (Object.keys(diff).length === 0) {
    return {}
  }

  return {
    schemaVersion: next.schemaVersion,
    ...diff,
  }
}

export function detectBloatedSettingsOps(
  userSection: Record<string, unknown>,
  base: MinerUConfig = defaultMinerUConfig(),
): Array<{ op: 'unset'; path: string[] }> {
  if (typeof userSection !== 'object' || userSection === null || Array.isArray(userSection)) {
    return []
  }

  const ops: Array<{ op: 'unset'; path: string[] }> = []

  const plainSections = ['limits', 'polling', 'retry', 'storage'] as const
  for (const section of plainSections) {
    const userVal = userSection[section]
    if (typeof userVal === 'object' && userVal !== null && !Array.isArray(userVal)) {
      if (deepEqualJson(userVal, base[section])) {
        ops.push({ op: 'unset', path: [section] })
      } else {
        const userObj = userVal as Record<string, unknown>
        const baseObj = base[section] as unknown as Record<string, unknown>
        for (const key of Object.keys(userObj)) {
          if (deepEqualJson(userObj[key], baseObj[key])) {
            ops.push({ op: 'unset', path: [section, key] })
          }
        }
      }
    }
  }

  const outputVal = userSection.output
  if (deepEqualJson(outputVal, base.output)) {
    ops.push({ op: 'unset', path: ['output'] })
  } else if (typeof outputVal === 'object' && outputVal !== null && !Array.isArray(outputVal)) {
    const outputObj = outputVal as Record<string, unknown>
    const baseOutputObj = base.output as unknown as Record<string, unknown>
    for (const key of Object.keys(outputObj)) {
      if (deepEqualJson(outputObj[key], baseOutputObj[key])) {
        ops.push({ op: 'unset', path: ['output', key] })
      }
    }
  }

  if (deepEqualJson(userSection.defaults, base.defaults)) {
    ops.push({ op: 'unset', path: ['defaults'] })
  }

  if (deepEqualJson(userSection.providers, base.providers)) {
    ops.push({ op: 'unset', path: ['providers'] })
  }

  if (Object.hasOwn(userSection, 'activeProvider') && userSection.activeProvider === base.activeProvider) {
    ops.push({ op: 'unset', path: ['activeProvider'] })
  }

  const remainingKeys = new Set(
    Object.keys(userSection).filter(k => {
      if (k === 'schemaVersion') return false
      const val = userSection[k]
      if (typeof val === 'object' && val !== null && !Array.isArray(val) && Object.keys(val).length === 0) {
        return false
      }
      return true
    }),
  )

  for (const op of ops) {
    if (op.path.length === 1) {
      remainingKeys.delete(op.path[0]!)
    } else if (op.path.length === 2) {
      const parentKey = op.path[0]!
      const parentVal = userSection[parentKey]
      if (typeof parentVal === 'object' && parentVal !== null && !Array.isArray(parentVal)) {
        const parentKeys = Object.keys(parentVal as Record<string, unknown>)
        const unsetKeys = ops
          .filter(o => o.path.length === 2 && o.path[0] === parentKey)
          .map(o => o.path[1]!)
        if (parentKeys.every(k => unsetKeys.includes(k))) {
          remainingKeys.delete(parentKey)
        }
      }
    }
  }

  if (remainingKeys.size === 0 && Object.hasOwn(userSection, 'schemaVersion')) {
    ops.push({ op: 'unset', path: ['schemaVersion'] })
  }

  return ops
}
