import { asProviderConfigId } from '../domain/ids.js'
import { MINERU_CONFIG_SCHEMA_VERSION, SELF_HOSTED_TIERS, type MinerUConfig, type SelfHostedLegacyV2Config } from './model.js'
import { repairLegacyConfigValues } from './migration-values.js'
import { ALLOWED_TOP_KEYS, PROVIDER_FIELDS, assertAllowedKeys, defaultMinerUConfig, parseCanonical, positive, record, text } from './parse.js'

const LEGACY_ARTIFACT_KINDS = new Set([
  'markdown', 'layout', 'model-output', 'content-list', 'images',
])

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
    assertAllowedKeys(provider, new Set([...PROVIDER_FIELDS['self-hosted-legacy-v2'], 'tier']), 'provider')
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

/** Parse startup/settings input, including known field and self-hosted profile migrations. Never persists. */
export function parseConfigWithMigration(value: unknown): ParsedMinerUConfig {
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
    ? repairLegacyConfigValues(input, fallback)
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
