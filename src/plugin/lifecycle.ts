import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-working-directory'
import { parseProviderDraft } from '../config/parse.js'
import { createStructuredDiagnosticSink } from '../observability.js'
import { createProvider } from '../providers/registry.js'
import { ReaderService } from '../reader/reader-service.js'
import { registerRpc } from '../rpc.js'
import { ParseService } from '../service/parse-service.js'
import { SharedOperationRegistry } from '../service/shared-operations.js'
import { StorageAccessGate } from '../storage/access-gate.js'
import { StorageMaintenanceService } from '../storage/maintenance/service.js'
import { StoragePaths } from '../storage/paths.js'
import { ProcessLock } from '../storage/process-lock.js'
import { ResultRepository } from '../storage/result-repository.js'
import { registerTools } from '../tools/index.js'
import { credentialResolver } from './credentials.js'
import { createSettingsPersistence, readRuntimeConfig } from './settings-persistence.js'

function isInactiveContextError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return (error as Error & { readonly code?: unknown }).code === 'INACTIVE_EFFECT'
    || error.message === 'cannot create effect on inactive context'
}

/** Build the plugin graph; disposal stops tools first, then shared producers. */
export async function apply(ctx: Context, entryConfig: unknown = {}): Promise<() => Promise<void>> {
  const runtimeConfig = () => readRuntimeConfig(ctx, entryConfig)
  const initialConfig = runtimeConfig()
  let toolDisposer: (() => Promise<void>) | undefined
  let operations: SharedOperationRegistry | undefined
  const startup = new AbortController()

  // Cordis invalidates the fiber before it awaits cleanup. Abort startup work
  // synchronously so an in-flight initialization never resumes into ctx APIs.
  ctx.effect(() => () => startup.abort(), 'dsh-pdf-mineru startup cancellation')

  const settings = ctx.get('settings')
  if (settings === undefined) throw new Error('settings service is unavailable')
  ctx.effect(() => settings.configure({ auto: false }, ctx.fiber), 'dsh-pdf-mineru settings presentation')
  const persistence = createSettingsPersistence(ctx, settings, runtimeConfig, { storage: initialConfig.storage, limits: { ...initialConfig.limits } })

  const paths = new StoragePaths(initialConfig.storage.storageRoot)
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

    const parser = new ParseService({
      createProvider, results, operations: operationRegistry, accessGate,
      diagnostics: createStructuredDiagnosticSink(ctx.logger),
      resolveCredential: credentialResolver(ctx),
    })
    const reader = new ReaderService({ parser, results, accessGate })

    // Optional sibling service: retain path tools when it is absent, and clear
    // the capability when Cordis disposes/replaces the attachment provider.
    let attachments: AttachmentStore | undefined
    ctx.inject(['attachments'], attachmentCtx => {
      attachments = attachmentCtx.attachments
      return () => { attachments = undefined }
    })
    toolDisposer = registerTools(ctx, { reader, config: runtimeConfig, attachments: () => attachments })

    // HTTP RPC registration accesses the caller's webServer, so declare it explicitly.
    // Keep this optional scope separate: headless hosts still get both tools.
    ctx.inject(['connection', 'webServer'], (connectionCtx: Context) => registerRpc(connectionCtx, {
      settings: persistence,
      probe: async (provider, signal) => {
        const config = runtimeConfig()
        return await parser.probe(config, signal, provider === undefined ? undefined : parseProviderDraft(provider, config))
      },
      maintenance,
    }))

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
