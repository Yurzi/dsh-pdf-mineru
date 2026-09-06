import z from '@deepseek-ai/schemastery'
import type { Context } from 'cordis'
import { parseConfig, type MinerUConfig, type ProviderConfig } from './config.js'
import { ProviderRegistry } from './providers/registry.js'
import { MinerUService } from './service/mineru-service.js'
import { SharedOperationRegistry } from './service/shared-operations.js'
import { StoragePaths } from './storage/paths.js'
import { ProcessLock } from './storage/process-lock.js'
import { StorageAccessGate } from './storage/access-gate.js'
import { ResultRepository } from './storage/result-repository.js'
import { StorageMaintenanceService } from './storage/maintenance-service.js'
import { registerTools } from './tools.js'
import { registerRpc } from './rpc.js'
import { createStructuredDiagnosticSink } from './observability.js'
import type {} from '@deepseek-ai/dsh-client-connection'

export const name = 'dsh-pdf-mineru'
export const inject = ['tools', 'jobs', 'settings']

const ProviderSchema = z.union([
  z.object({
    id: z.string(),
    type: z.const('self-hosted-v2'),
    baseURL: z.string(),
    apiKeyEnv: z.string().role('credential-ref'),
    modelMap: z.object({ pipeline: z.string(), vlm: z.string() }),
    configuredVersion: z.string(),
    allowInsecureHttp: z.boolean(),
  }),
  z.object({
    id: z.string(),
    type: z.const('official-v4'),
    baseURL: z.string(),
    apiKeyEnv: z.string().role('credential-ref'),
    models: z.array(z.union(['pipeline', 'vlm'])),
    configuredVersion: z.string(),
  }),
])

export const Config = z.object({
  schemaVersion: z.const(1),
  activeProvider: z.string(),
  providers: z.array(ProviderSchema),
  defaults: z.object({
    model: z.union(['pipeline', 'vlm']),
    ocr: z.boolean(),
    parseMethod: z.union(['auto', 'txt', 'ocr']),
    language: z.string(),
    formula: z.boolean(),
    table: z.boolean(),
  }),
  storage: z.object({
    storageRoot: z.string(),
    cacheEnabled: z.boolean(),
    retainSources: z.const(false),
    stagingTtlMs: z.number(),
  }),
  polling: z.object({
    pollIntervalMs: z.number(),
    pollTimeoutMs: z.number(),
    requestTimeoutMs: z.number(),
    operationTimeoutMs: z.number(),
  }),
  retry: z.object({
    maxAttempts: z.number(),
    baseDelayMs: z.number(),
    maxDelayMs: z.number(),
  }),
  output: z.object({ maxInlineChars: z.number() }),
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

function isInactiveContextError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return (error as Error & { readonly code?: unknown }).code === 'INACTIVE_EFFECT'
    || error.message === 'cannot create effect on inactive context'
}

function asObject(value: MinerUConfig): object {
  return value as unknown as object
}

function parseDraftProvider(value: unknown, current: MinerUConfig): ProviderConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('provider draft must be an object')
  const id = (value as Record<string, unknown>).id
  if (typeof id !== 'string') throw new TypeError('provider draft id is required')
  return parseConfig({ ...current, activeProvider: id, providers: [value] }).providers[0]!
}

export async function apply(ctx: Context, entryConfig: unknown = {}): Promise<() => Promise<void>> {
  let persistedConfig = parseConfig(entryConfig)
  let fixedStorageRoot: string | undefined
  let fixedLimits: MinerUConfig['limits'] | undefined
  let toolDisposer: (() => Promise<void>) | undefined
  let operations: SharedOperationRegistry | undefined
  const startup = new AbortController()

  // Cordis invalidates the fiber before it awaits cleanup. Abort startup work
  // synchronously so an in-flight initialization never resumes into ctx APIs.
  ctx.effect(() => () => startup.abort(), 'dsh-pdf-mineru startup cancellation')

  const validateRuntimeConfig = (value: unknown): MinerUConfig => {
    const next = parseConfig(value)
    if (fixedStorageRoot !== undefined && next.storage.storageRoot !== fixedStorageRoot) {
      throw new TypeError('storage.storageRoot cannot change while the MinerU plugin is running')
    }
    if (fixedLimits !== undefined) {
      for (const key of Object.keys(fixedLimits) as Array<keyof MinerUConfig['limits']>) {
        if (next.limits[key] !== fixedLimits[key]) {
          throw new TypeError(`limits.${key} requires a MinerU plugin restart`)
        }
      }
    }
    return next
  }
  const runtimeConfig = (): MinerUConfig => persistedConfig

  // The user layer can retain a storage root from an older bundle default.
  // Resolve it before fixing the process-wide root and acquiring its lock.
  const settings = ctx.get('settings') as SettingsService | undefined
  if (settings === undefined) throw new Error('settings service is unavailable')
  const settingsScope = settings.register('dsh-pdf-mineru', Config, {
    base: asObject(persistedConfig),
    applies: 'live',
    validate: value => { validateRuntimeConfig(value) },
  })
  persistedConfig = validateRuntimeConfig(settingsScope.get())
  fixedStorageRoot = persistedConfig.storage.storageRoot
  fixedLimits = { ...persistedConfig.limits }
  ctx.effect(
    () => settingsScope.watch(next => { persistedConfig = validateRuntimeConfig(next) }),
    'dsh-pdf-mineru settings watch',
  )

  const paths = new StoragePaths(fixedStorageRoot)
  const lock = new ProcessLock(paths)

  try {
    await lock.initialize(startup.signal)
    startup.signal.throwIfAborted()
    const operationRegistry = new SharedOperationRegistry()
    operations = operationRegistry
    const accessGate = new StorageAccessGate({ paths, lock })
    const results = new ResultRepository(paths, {
      maxArtifactBytes: persistedConfig.limits.maxZipEntryBytes,
      maxJsonValidationBytes: Math.min(persistedConfig.limits.maxZipEntryBytes, 64 * 1024 * 1024),
    }, lock)
    await results.cleanupStaging(
      persistedConfig.storage.stagingTtlMs, operationRegistry.activeOperationIds(), startup.signal,
    )
    startup.signal.throwIfAborted()
    const maintenance = new StorageMaintenanceService(paths, results, operationRegistry, lock, accessGate)

    const providers = new ProviderRegistry(runtimeConfig)
    const diagnostics = createStructuredDiagnosticSink(ctx.logger)
    const service = new MinerUService({
      getConfig: runtimeConfig, providers, results, operations: operationRegistry, diagnostics, accessGate,
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

    toolDisposer = registerTools(ctx, () => service, accessGate)

    ctx.inject(['connection'], (connectionCtx: Context) => {
      return registerRpc(connectionCtx, {
        getConfig: () => persistedConfig,
        setConfig: async value => {
          const next = validateRuntimeConfig(value)
          await settingsScope.replace(asObject(next))
          persistedConfig = next
          return next
        },
        probe: async (provider, signal) => service.probe(
          signal, provider === undefined ? undefined : parseDraftProvider(provider, persistedConfig),
        ),
        maintenance,
      })
    })

    let disposing: Promise<void> | undefined
    const dispose = (): Promise<void> => {
      disposing ??= (async () => {
        await toolDisposer?.()
        await operationRegistry.shutdown()
      })()
      return disposing
    }
    ctx.effect(() => async () => { await dispose() }, 'dsh-pdf-mineru lifecycle')
    return dispose
  } catch (error) {
    await toolDisposer?.()
    if (operations !== undefined) await operations.shutdown()
    if (startup.signal.aborted || isInactiveContextError(error)) return async () => undefined
    throw error
  }
}

export * from './config.js'
export * from './domain/ids.js'
export * from './domain/request.js'
export * from './domain/result.js'
export * from './domain/errors.js'
export * from './providers/provider.js'
export * from './providers/self-hosted-v2.js'
export * from './providers/official-v4.js'
export * from './providers/http-client.js'
export * from './service/mineru-service.js'
export * from './observability.js'
export * from './storage/maintenance-service.js'