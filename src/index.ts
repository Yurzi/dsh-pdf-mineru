import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { isVolatile } from '@deepseek-ai/cosmokit'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-settings'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import {
  MINERU_CONFIG_SCHEMA_VERSION,
  parseConfig,
  parseConfigWithMigration,
  type MinerUConfig,
  type ProviderConfig,
} from './config.js'
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
  // Provider-based v1 values are normalized in memory; saving writes v2.
  schemaVersion: z.union([z.const(1), z.const(MINERU_CONFIG_SCHEMA_VERSION)]).volatile(),
  activeProvider: z.string().volatile(),
  providers: z.array(ProviderSchema).volatile(),
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

// Schemastery 3.18.4 has no .check(). Keep its object schema for native form
// projection, and validate the complete domain config at the Standard Schema
// boundary used by Cordis before activation and ConfigEditor persistence.
Object.defineProperty(Config, '~standard', { value: {
  // Loader uses the Schemastery vendor to recognize volatile field paths.
  ...Config['~standard'],
  validate(value: unknown) {
    try {
      parseConfigWithMigration(value)
      return { value: Config(value) }
    } catch (error) {
      return { issues: [{ message: error instanceof Error ? error.message : 'Invalid MinerU configuration' }] }
    }
  },
} satisfies z<unknown>['~standard'] })

function configSnapshot(value: unknown): unknown {
  if (isVolatile(value)) return configSnapshot(value.get())
  if (Array.isArray(value)) return value.map(configSnapshot)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, configSnapshot(child)]))
  }
  return value
}

// SettingsForms accepts only volatile fields. Send complete live values: its
// replace() resets omitted values to the inherited profile, not package defaults.
function liveConfig(config: MinerUConfig): object {
  const { storage, limits: _limits, ...live } = config
  return { ...live, storage: { cacheEnabled: storage.cacheEnabled, stagingTtlMs: storage.stagingTtlMs } }
}

interface CredentialService {
  resolve(reference: string): Promise<{ readonly value: string } | undefined>
}

function isInactiveContextError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return (error as Error & { readonly code?: unknown }).code === 'INACTIVE_EFFECT'
    || error.message === 'cannot create effect on inactive context'
}

function parseDraftProvider(value: unknown, current: MinerUConfig): ProviderConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('provider draft must be an object')
  const id = (value as Record<string, unknown>).id
  if (typeof id !== 'string') throw new TypeError('provider draft id is required')
  return parseConfig({ ...current, activeProvider: id, providers: [value] }).providers[0]!
}

export async function apply(ctx: Context, entryConfig: unknown = {}): Promise<() => Promise<void>> {
  // Read the fiber's current Config as well as its volatile values: hosts
  // without HMR may reload the fiber while a settings write is in flight.
  const runtimeConfig = (): MinerUConfig => parseConfigWithMigration(configSnapshot(ctx.fiber?.config ?? entryConfig)).config
  const initialConfig = runtimeConfig()
  let fixedStorageRoot: string | undefined
  let fixedLimits: MinerUConfig['limits'] | undefined
  let toolDisposer: (() => Promise<void>) | undefined
  let operations: SharedOperationRegistry | undefined
  const startup = new AbortController()

  // Cordis invalidates the fiber before it awaits cleanup. Abort startup work
  // synchronously so an in-flight initialization never resumes into ctx APIs.
  ctx.effect(() => () => startup.abort(), 'dsh-pdf-mineru startup cancellation')

  const validateParsedRuntimeConfig = (next: MinerUConfig): MinerUConfig => {
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
  const validateRuntimeConfig = (value: unknown): MinerUConfig => validateParsedRuntimeConfig(parseConfig(value))

  const settings = ctx.get('settings')
  if (settings === undefined) throw new Error('settings service is unavailable')
  ctx.effect(() => settings.configure({ auto: false }, ctx.fiber), 'dsh-pdf-mineru settings presentation')
  fixedStorageRoot = initialConfig.storage.storageRoot
  fixedLimits = { ...initialConfig.limits }

  const paths = new StoragePaths(fixedStorageRoot)
  const lock = new ProcessLock(paths)

  try {
    await lock.initialize(startup.signal)
    startup.signal.throwIfAborted()
    const operationRegistry = new SharedOperationRegistry()
    operations = operationRegistry
    const accessGate = new StorageAccessGate({ paths, lock })
    const results = new ResultRepository(paths, {
      maxArtifactBytes: initialConfig.limits.maxZipEntryBytes,
      maxJsonValidationBytes: Math.min(initialConfig.limits.maxZipEntryBytes, 64 * 1024 * 1024),
    }, lock)
    await results.cleanupStaging(
      initialConfig.storage.stagingTtlMs, operationRegistry.activeOperationIds(), startup.signal,
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

    // Optional sibling service: retain path tools when it is absent, and clear
    // the capability when Cordis disposes/replaces the attachment provider.
    let attachments: AttachmentStore | undefined
    ctx.inject(['attachments'], attachmentCtx => {
      attachments = attachmentCtx.attachments
      return () => { attachments = undefined }
    })
    toolDisposer = registerTools(ctx, () => service, accessGate, () => runtimeConfig().output, () => attachments)

    // Since DSH 0.1.5, connection no longer requires a WebServer. HTTP RPC
    // registration accesses the caller's webServer, so declare it explicitly.
    // Keep this optional scope separate: headless hosts still get both tools.
    ctx.inject(['connection', 'webServer'], (connectionCtx: Context) => {
      return registerRpc(connectionCtx, {
        getConfig: runtimeConfig,
        setConfig: async value => {
          const next = validateRuntimeConfig(value)
          const namespace = ctx.fiber.entry?.options.id
          if (namespace === undefined) throw new Error('MinerU configuration requires a Loader profile entry')
          await settings.replace(namespace, liveConfig(next))
          return runtimeConfig()
        },
        probe: async (provider, signal) => service.probe(
          signal, provider === undefined ? undefined : parseDraftProvider(provider, runtimeConfig()),
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
export { parseMinerUResultManifest } from './domain/schemas.js'
export * from './domain/errors.js'
export * from './providers/provider.js'
export * from './providers/self-hosted-v2.js'
export * from './providers/official-v4.js'
export * from './providers/http-client.js'
export * from './service/mineru-service.js'
export * from './observability.js'
export * from './storage/maintenance-service.js'
