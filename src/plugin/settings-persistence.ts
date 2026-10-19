import type { Context } from '@deepseek-ai/cordis'
import { isVolatile } from '@deepseek-ai/cosmokit'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-config-editor'
import type { SettingsForms } from '@deepseek-ai/dsh-settings'
import type { MinerUConfig } from '../config/model.js'
import { parseConfigWithMigration } from '../config/migrate.js'
import { MinerUError, failure } from '../domain/errors.js'

/** Live configuration plus the host Settings descriptor revision it was read at (null when unavailable). */
export interface SettingsSnapshot {
  readonly config: MinerUConfig
  readonly revision: number | null
}

export interface SettingsPersistence {
  current(): SettingsSnapshot
  /** Persist a complete configuration; a stale expectedRevision is refused with SETTINGS_CONFLICT. */
  save(value: unknown, expectedRevision?: number): Promise<SettingsSnapshot>
}

function configSnapshot(value: unknown): unknown {
  if (isVolatile(value)) return configSnapshot(value.get())
  if (Array.isArray(value)) return value.map(configSnapshot)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, configSnapshot(child)]))
  }
  return value
}

/**
 * Read the fiber's current Config as well as its volatile values: hosts without
 * HMR may reload the fiber while a settings write is in flight. Migration is in memory only.
 */
export function readRuntimeConfig(ctx: Context, entryConfig: unknown): MinerUConfig {
  return parseConfigWithMigration(configSnapshot(ctx.fiber?.config ?? entryConfig)).config
}

// SettingsForms accepts only volatile fields. Send complete live values: its
// replace() resets omitted values to the inherited profile, not package defaults.
function liveConfig(config: MinerUConfig): object {
  const { storage, limits: _limits, ...live } = config
  return { ...live, storage: { cacheEnabled: storage.cacheEnabled, stagingTtlMs: storage.stagingTtlMs } }
}

function settingsConflict(): MinerUError {
  return new MinerUError(failure('SETTINGS_CONFLICT', 'MinerU settings changed since they were read; reload them and retry the save'))
}

function isHostSettingsConflict(error: unknown): boolean {
  return error instanceof Error && (error as Error & { readonly code?: unknown }).code === 'SETTINGS_CONFLICT'
}

/** Explicit saves only; storageRoot and limits are fixed for the plugin's lifetime. */
export function createSettingsPersistence(
  ctx: Context,
  settings: SettingsForms,
  read: () => MinerUConfig,
  fixed: Pick<MinerUConfig, 'storage' | 'limits'>,
): SettingsPersistence {
  const validate = (value: unknown): MinerUConfig => {
    const next = parseConfigWithMigration(value).config
    if (next.storage.storageRoot !== fixed.storage.storageRoot) {
      throw new TypeError('storage.storageRoot cannot change while the MinerU plugin is running')
    }
    for (const key of Object.keys(fixed.limits) as Array<keyof MinerUConfig['limits']>) {
      if (next.limits[key] !== fixed.limits[key]) {
        throw new TypeError(`limits.${key} requires a MinerU plugin restart`)
      }
    }
    return next
  }
  const revision = (namespace: string | undefined): number | null =>
    namespace === undefined ? null : settings.describe().find(row => row.ns === namespace)?.revision ?? null

  return {
    current: () => ({ config: read(), revision: revision(ctx.fiber.entry?.options.id) }),
    save: async (value, expectedRevision) => {
      const next = validate(value)
      const entry = ctx.fiber.entry
      if (entry === undefined) throw new Error('MinerU configuration requires a Loader profile entry')
      const namespace = entry.options.id
      const original = entry.options.config
      try {
        if (original !== undefined && parseConfigWithMigration(original).migrated) {
          // Only an explicit user save enters this branch. Settings.replace keeps
          // raw ordinary fields, which may still contain invalid pre-migration values.
          // Persist the entire validated snapshot in one host-owned transaction.
          const editor = ctx.get('configEditor')
          if (editor === undefined) throw new Error('Saving a migrated configuration requires the host ConfigEditor')
          await editor.edit(entry, current => {
            if (expectedRevision !== undefined && revision(namespace) !== expectedRevision) throw settingsConflict()
            validate(parseConfigWithMigration(current).config)
            return { ...next }
          })
        } else {
          await settings.replace(namespace, liveConfig(next), expectedRevision)
        }
      } catch (error) {
        throw isHostSettingsConflict(error) ? settingsConflict() : error
      }
      return { config: read(), revision: revision(namespace) }
    },
  }
}
