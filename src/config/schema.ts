import z from '@deepseek-ai/schemastery'
import { PROVIDER_TYPES, type MinerUProviderId } from '../domain/ids.js'
import { MINERU_CONFIG_SCHEMA_VERSION } from './model.js'
import { parseConfigWithMigration } from './migrate.js'

/** Native form projection of each canonical provider profile; the domain parser stays the validator. */
const PROVIDER_SCHEMAS: { readonly [T in MinerUProviderId]: z } = {
  'self-hosted-v1': z.object({
    id: z.string(), type: z.const('self-hosted-v1'), baseURL: z.string(),
    apiKeyEnv: z.string().role('credential-ref'),
    tier: z.union(['flash', 'basic', 'standard', 'advanced']),
    ocrMode: z.union(['auto', 'txt', 'ocr']),
    configuredVersion: z.string(), allowInsecureHttp: z.boolean(),
  }),
  'self-hosted-legacy-v2': z.object({
    id: z.string(),
    type: z.const('self-hosted-legacy-v2'),
    baseURL: z.string(),
    apiKeyEnv: z.string().role('credential-ref'),
    modelMap: z.object({ pipeline: z.string(), vlm: z.string() }),
    configuredVersion: z.string(),
    allowInsecureHttp: z.boolean(),
  }),
  'official-v4': z.object({
    id: z.string(),
    type: z.const('official-v4'),
    baseURL: z.string(),
    apiKeyEnv: z.string().role('credential-ref'),
    models: z.array(z.union(['pipeline', 'vlm'])),
    configuredVersion: z.string(),
  }),
}

export const Config = z.object({
  // Known historical versions are normalized by Standard Schema before activation.
  schemaVersion: z.union([z.const(1), z.const(2), z.const(MINERU_CONFIG_SCHEMA_VERSION)]).volatile(),
  activeProvider: z.string().volatile(),
  providers: z.array(z.union(PROVIDER_TYPES.map(type => PROVIDER_SCHEMAS[type]))).volatile(),
  defaults: z.object({
    model: z.union(['pipeline', 'vlm']),
    ocr: z.boolean(),
    parseMethod: z.union(['auto', 'txt', 'ocr']),
    language: z.string(),
    formula: z.boolean(),
    table: z.boolean(),
  }).volatile(),
  storage: z.object({
    storageRoot: z.string(),
    cacheEnabled: z.boolean().volatile(),
    retainSources: z.const(false),
    stagingTtlMs: z.number().volatile(),
  }).default({}),
  polling: z.object({
    pollIntervalMs: z.number(),
    pollTimeoutMs: z.number(),
    requestTimeoutMs: z.number(),
    operationTimeoutMs: z.number(),
  }).volatile(),
  retry: z.object({
    maxAttempts: z.number(),
    baseDelayMs: z.number(),
    maxDelayMs: z.number(),
  }).volatile(),
  output: z.object({ maxInlineChars: z.number(), maxInlineImages: z.number() }).volatile(),
  limits: z.object({
    maxFileBytes: z.number(),
    maxApiResponseBytes: z.number(),
    maxZipDownloadBytes: z.number(),
    maxZipEntries: z.number(),
    maxZipEntryBytes: z.number(),
    maxZipTotalBytes: z.number(),
    maxZipCompressionRatio: z.number(),
  }),
}) as unknown as z<unknown>

// Schemastery 3.18 has no .check(). Keep its object schema for native form
// projection, and validate the complete domain config at the Standard Schema
// boundary used by Cordis before activation and ConfigEditor persistence.
Object.defineProperty(Config, '~standard', { value: {
  // Loader uses the Schemastery vendor to recognize volatile field paths.
  ...Config['~standard'],
  validate(value: unknown) {
    try {
      const parsed = parseConfigWithMigration(value)
      // The native union only accepts canonical types; validate and wrap migrated
      // data, not the original old profile that would still fail its discriminator.
      return { value: Config(parsed.migrated ? parsed.config : value) }
    } catch (error) {
      return { issues: [{ message: error instanceof Error ? error.message : 'Invalid MinerU configuration' }] }
    }
  },
} satisfies z<unknown>['~standard'] })
