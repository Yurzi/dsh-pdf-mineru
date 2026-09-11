import type { ClientConnectionRpc, RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import {
  DEFAULT_OUTPUT_CONFIG,
  DEFAULT_PARSE_DEFAULTS,
  DEFAULT_POLLING_CONFIG,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_STORAGE_OPTIONS,
  defaultProviderConfig,
  type MinerUConfig,
  type ProviderConfig,
} from '../config/pure.js'
import { asProviderConfigId } from '../domain/ids.js'

export interface CredentialView {
  readonly configured: boolean
  readonly source?: string
  readonly writable: boolean
}

/** Narrow `ctx.remote.credentials` face used with DSH 0.1.5-rc.2. */
export interface CredentialClient {
  describe(refs: string[]): Promise<RpcResult<Readonly<Record<string, CredentialView>>>>
  set(ref: string, value: string): Promise<RpcResult<void>>
  unset(ref: string): Promise<RpcResult<void>>
}

const PROVIDER_TYPES = ['self-hosted-v2', 'official-v4'] as const

export function ensureProviderProfiles(config: MinerUConfig): MinerUConfig {
  const providers = [...config.providers]
  for (const type of PROVIDER_TYPES) {
    if (providers.some(provider => provider.type === type)) continue
    const defaults = defaultProviderConfig(type)
    let id = defaults.id
    for (let suffix = 2; providers.some(provider => provider.id === id); suffix++) {
      id = asProviderConfigId(defaults.id + '_' + String(suffix))
    }
    providers.push({ ...defaults, id } as ProviderConfig)
  }
  return providers.length === config.providers.length ? config : { ...config, providers }
}

export function patchActiveProvider(
  config: MinerUConfig,
  patch: Partial<ProviderConfig>,
): MinerUConfig {
  const activeId = config.activeProvider
  const providers = config.providers.map(p => {
    if (p.id !== activeId) return p
    return { ...p, ...patch } as ProviderConfig
  })
  return { ...config, providers }
}

export function normalizeProviderDefaults(config: MinerUConfig, provider: ProviderConfig): MinerUConfig {
  if (provider.type !== 'official-v4') return config
  const model = provider.models.includes(config.defaults.model)
    ? config.defaults.model
    : provider.models[0]
  if (model === undefined) return config
  const parseMethod = config.defaults.parseMethod === 'txt' ? 'auto' : config.defaults.parseMethod
  if (model === config.defaults.model && parseMethod === config.defaults.parseMethod) return config
  return {
    ...config,
    defaults: { ...config.defaults, model, parseMethod, ocr: parseMethod === 'ocr' },
  }
}

export function activateProvider(config: MinerUConfig, providerId: string): MinerUConfig {
  const provider = config.providers.find(candidate => candidate.id === providerId)
  if (provider === undefined || provider.id === config.activeProvider) return config
  return normalizeProviderDefaults({ ...config, activeProvider: provider.id }, provider)
}

export function updateConfigSection<K extends keyof MinerUConfig>(
  config: MinerUConfig,
  section: K,
  patch: Partial<MinerUConfig[K]>,
): MinerUConfig {
  const current = config[section]
  if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
    return {
      ...config,
      [section]: {
        ...(current as unknown as Record<string, unknown>),
        ...patch,
      },
    }
  }
  return {
    ...config,
    [section]: patch as unknown as MinerUConfig[K],
  }
}

export async function callRpc<T>(rpc: ClientConnectionRpc, endpoint: string, payload: unknown): Promise<T> {
  return rpc.call('/dsh-pdf-mineru-api', endpoint, payload) as Promise<T>
}

export function credentialReference(provider: ProviderConfig | undefined): string | undefined {
  const reference = provider?.apiKeyEnv?.trim()
  return reference === undefined || reference.length === 0 ? undefined : reference
}

export async function describeCredential(credentials: CredentialClient, reference: string): Promise<CredentialView> {
  const result = await credentials.describe([reference])
  if (!result.ok) throw new Error(result.error.message)
  return result.value[reference] ?? { configured: false, writable: true }
}

export async function storeCredential(
  credentials: CredentialClient,
  reference: string,
  value: string,
): Promise<void> {
  const secret = value.trim()
  if (secret.length === 0) throw new TypeError('API key must not be empty')
  const result = await credentials.set(reference, secret)
  if (!result.ok) throw new Error(result.error.message)
}

export async function clearCredential(credentials: CredentialClient, reference: string): Promise<void> {
  const result = await credentials.unset(reference)
  if (!result.ok) throw new Error(result.error.message)
}

export function resetConfigSection<K extends keyof MinerUConfig>(
  config: MinerUConfig,
  section: K,
): MinerUConfig {
  switch (section) {
    case 'defaults': {
      const active = config.providers.find(p => p.id === config.activeProvider) ?? config.providers[0]
      const next: MinerUConfig = {
        ...config,
        defaults: { ...DEFAULT_PARSE_DEFAULTS },
      }
      return active !== undefined ? normalizeProviderDefaults(next, active) : next
    }
    case 'polling':
      return {
        ...config,
        polling: { ...DEFAULT_POLLING_CONFIG },
      }
    case 'retry':
      return {
        ...config,
        retry: { ...DEFAULT_RETRY_CONFIG },
      }
    case 'output':
      return {
        ...config,
        output: { ...DEFAULT_OUTPUT_CONFIG },
      }
    case 'storage':
      return {
        ...config,
        storage: {
          ...config.storage,
          cacheEnabled: DEFAULT_STORAGE_OPTIONS.cacheEnabled,
          stagingTtlMs: DEFAULT_STORAGE_OPTIONS.stagingTtlMs,
          retainSources: DEFAULT_STORAGE_OPTIONS.retainSources,
        },
      }
    case 'providers': {
      const providers = config.providers.map(p => ({
        ...defaultProviderConfig(p.type),
        id: p.id,
      } as ProviderConfig))
      const active = providers.find(p => p.id === config.activeProvider) ?? providers[0]
      const next: MinerUConfig = { ...config, providers }
      return active !== undefined ? normalizeProviderDefaults(next, active) : next
    }
    default:
      return config
  }
}

export function resetToDefaultConfig(current: MinerUConfig): MinerUConfig {
  const selfHosted = defaultProviderConfig('self-hosted-v2')
  const official = defaultProviderConfig('official-v4')
  return {
    schemaVersion: current.schemaVersion,
    activeProvider: selfHosted.id,
    providers: [selfHosted, official],
    defaults: { ...DEFAULT_PARSE_DEFAULTS },
    storage: {
      ...current.storage,
      cacheEnabled: DEFAULT_STORAGE_OPTIONS.cacheEnabled,
      stagingTtlMs: DEFAULT_STORAGE_OPTIONS.stagingTtlMs,
      retainSources: DEFAULT_STORAGE_OPTIONS.retainSources,
    },
    polling: { ...DEFAULT_POLLING_CONFIG },
    retry: { ...DEFAULT_RETRY_CONFIG },
    output: { ...DEFAULT_OUTPUT_CONFIG },
    limits: current.limits,
  }
}
