import z from 'schemastery'
import type { Context } from 'cordis'
import { migrateConfig, type MinerUConfig, type ProviderConfig } from './config.js'
import { ProviderRegistry } from './providers/registry.js'
import { MinerUService } from './service/mineru-service.js'
import { SharedOperationRegistry } from './service/shared-operations.js'
import { StoragePaths } from './storage/paths.js'
import { ProcessLock } from './storage/process-lock.js'
import { JobRepository } from './storage/job-repository.js'
import { ResultRepository } from './storage/result-repository.js'
import { registerTools } from './tools.js'
import { registerRpc } from './rpc.js'
import type {} from '@deepseek-ai/dsh-client-connection'

export const name = 'dsh-pdf-mineru'
export const inject = ['tools']

const ProviderSchema = z.union([
  z.object({
    id: z.string(),
    type: z.string(),
    baseURL: z.string(),
    apiKeyEnv: z.string().role('credential-ref'),
    modelMap: z.object({ pipeline: z.string(), vlm: z.string() }),
    configuredVersion: z.string(),
    allowInsecureHttp: z.boolean(),
  }),
  z.object({
    id: z.string(),
    type: z.string(),
    baseURL: z.string(),
    apiKeyEnv: z.string().role('credential-ref'),
    models: z.array(z.union(['pipeline', 'vlm'])),
    configuredVersion: z.string(),
  }),
])

/** Entry schema accepts both the provider config and the legacy flat config. */
export const Config = z.object({
  schemaVersion: z.number(),
  activeProvider: z.string(),
  providers: z.array(ProviderSchema),
  defaults: z.object({
    model: z.union(['pipeline', 'vlm']),
    ocr: z.boolean(),
    parseMethod: z.union(['auto', 'txt', 'ocr']),
    language: z.string(),
    formula: z.boolean(),
    table: z.boolean(),
    artifacts: z.array(z.union(['markdown', 'layout', 'model-output', 'content-list', 'images'])),
  }),
  storage: z.object({
    storageRoot: z.string(),
    cacheEnabled: z.boolean(),
    retainSources: z.boolean(),
    stagingTtlMs: z.number(),
  }),
  polling: z.object({
    pollIntervalMs: z.number(),
    pollTimeoutMs: z.number(),
    requestTimeoutMs: z.number(),
    operationTimeoutMs: z.number(),
  }),
  output: z.object({ maxInlineChars: z.number() }),
  limits: z.object({
    maxFilesPerRequest: z.number(),
    maxFileBytes: z.number(),
    maxApiResponseBytes: z.number(),
    maxZipDownloadBytes: z.number(),
    maxZipEntries: z.number(),
    maxZipEntryBytes: z.number(),
    maxZipTotalBytes: z.number(),
    maxZipCompressionRatio: z.number(),
  }),
  baseURL: z.string(),
  apiKeyEnv: z.string().role('credential-ref'),
  defaultBackend: z.string(),
  defaultParseMethod: z.string(),
  defaultLang: z.string(),
  pollIntervalMs: z.number(),
  pollTimeoutMs: z.number(),
  requestTimeoutMs: z.number(),
  maxMdOutputChars: z.number(),
}) as unknown as z<unknown>

interface SettingsScope {
  get(): unknown
  watch(callback: (next: unknown) => void | Promise<void>): () => void
  replace(section: object): Promise<void>
}

interface SettingsService {
  register(
    namespace: string, schema: unknown,
    options: { readonly base: object; readonly applies: 'live' | 'restart'; readonly validate: (value: unknown) => void },
  ): SettingsScope
}

interface CredentialService {
  resolve(reference: string): Promise<{ readonly value: string } | undefined>
}

function asObject(value: MinerUConfig): object {
  return value as unknown as object
}

function parseDraftProvider(value: unknown, current: MinerUConfig): ProviderConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('provider draft must be an object')
  const id = (value as Record<string, unknown>).id
  if (typeof id !== 'string') throw new TypeError('provider draft id is required')
  return migrateConfig({ ...current, activeProvider: id, providers: [value] }).providers[0]!
}

export async function apply(ctx: Context, entryConfig: unknown = {}): Promise<() => Promise<void>> {
  let persistedConfig = migrateConfig(entryConfig)
  let settingsScope: SettingsScope | undefined

  const fixedStorageRoot = persistedConfig.storage.storageRoot
  const runtimeConfig = (): MinerUConfig => ({
    ...persistedConfig,
    storage: { ...persistedConfig.storage, storageRoot: fixedStorageRoot },
  })

  const paths = new StoragePaths(fixedStorageRoot)
  const lock = new ProcessLock(paths)
  await lock.acquire()

  try {
    const operations = new SharedOperationRegistry()
    const jobs = new JobRepository(paths)
    const results = new ResultRepository(paths, {
      maxArtifactBytes: persistedConfig.limits.maxZipEntryBytes,
      maxJsonValidationBytes: Math.min(persistedConfig.limits.maxZipEntryBytes, 64 * 1024 * 1024),
    })
    await results.cleanupStaging(persistedConfig.storage.stagingTtlMs, operations.activeOperationIds())

    const providers = new ProviderRegistry(runtimeConfig)
    const service = new MinerUService({
      getConfig: runtimeConfig, providers, jobs, results, operations,
      resolveCredential: async (reference, signal) => {
        signal.throwIfAborted()
        const credentials = ctx.get('credentials') as CredentialService | undefined
        const resolved = await credentials?.resolve(reference)
        signal.throwIfAborted()
        if (resolved?.value) return resolved.value
        const environment = process.env[reference]
        return environment && environment.length > 0 ? environment : undefined
      },
    })

    const toolDisposer = registerTools(ctx, () => service, runtimeConfig)

    ctx.inject(['settings'], (settingsCtx: Context) => {
      const settings = (settingsCtx.get('settings') ?? ctx.get('settings')) as SettingsService | undefined
      if (settings !== undefined) {
        settingsScope = settings.register('dsh-pdf-mineru', Config, {
          base: asObject(persistedConfig),
          applies: 'live',
          validate: value => { migrateConfig(value) },
        })
        persistedConfig = migrateConfig(settingsScope.get())
        return settingsScope.watch(next => { persistedConfig = migrateConfig(next) })
      }
      return undefined
    })

    ctx.inject(['connection'], (connectionCtx: Context) => {
      return registerRpc(connectionCtx, {
        getConfig: () => persistedConfig,
        setConfig: async value => {
          const next = migrateConfig(value)
          if (settingsScope !== undefined) await settingsScope.replace(asObject(next))
          persistedConfig = next
          return next
        },
        probe: async (provider, signal) => service.probe(
          signal, provider === undefined ? undefined : parseDraftProvider(provider, persistedConfig),
        ),
      })
    })

    const dispose = async () => {
      operations.dispose()
      toolDisposer()
      await lock.release()
    }
    ctx.effect(() => async () => { await dispose() }, 'dsh-pdf-mineru lifecycle')
    return dispose
  } catch (error) {
    await lock.release()
    throw error
  }
}

export * from './config.js'
export * from './domain/ids.js'
export * from './domain/request.js'
export * from './domain/job.js'
export * from './domain/result.js'
export * from './domain/errors.js'
export * from './providers/provider.js'
export * from './providers/self-hosted-v2.js'
export * from './providers/official-v4.js'
export * from './service/mineru-service.js'