import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import {
  DEFAULT_OUTPUT_CONFIG,
  DEFAULT_PARSE_DEFAULTS,
  DEFAULT_POLLING_CONFIG,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_STORAGE_OPTIONS,
  defaultProviderConfig,
  PROVIDER_TYPES,
  type MinerUConfig,
  type MinerUModel,
  type MinerUProviderId,
  type ProviderConfig,
} from '../config/model.js'
import { RPC_CHANNEL, type RpcEndpoint, type RpcPayloads, type RpcResponses, type RpcResult } from '../contracts/rpc.js'
import { asProviderConfigId } from '../domain/ids.js'
import type { MineruKey } from './locales.js'

/** Display order of the provider picker: hosted first, then newest self-hosted protocol. */
export const PROVIDER_ORDER: readonly MinerUProviderId[] = ['official-v4', 'self-hosted-v1', 'self-hosted-legacy-v2']

const PROVIDER_LABEL: { readonly [T in MinerUProviderId]: MineruKey } = {
  'official-v4': 'provider.official',
  'self-hosted-v1': 'provider.v1',
  'self-hosted-legacy-v2': 'provider.legacy',
}

export function providerTypeLabelKey(type: MinerUProviderId): MineruKey {
  return PROVIDER_LABEL[type]
}

export function orderedProviders(config: MinerUConfig): readonly ProviderConfig[] {
  return config.providers.toSorted((a, b) => PROVIDER_ORDER.indexOf(a.type) - PROVIDER_ORDER.indexOf(b.type))
}

export function activeProviderOf(config: MinerUConfig): ProviderConfig | undefined {
  return config.providers.find(provider => provider.id === config.activeProvider)
}

/** Structural equality for JSON-shaped values; an own key holding undefined equals an absent key. */
export function structurallyEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => structurallyEqual(item, b[index]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (!structurallyEqual(left[key], right[key])) return false
  }
  return true
}

/** Add a default profile for every protocol the stored config lacks, keeping existing profiles untouched. */
export function ensureProviderProfiles(config: MinerUConfig): MinerUConfig {
  const providers = [...config.providers]
  for (const type of PROVIDER_TYPES) {
    if (providers.some(provider => provider.type === type)) continue
    const defaults = defaultProviderConfig(type)
    let id = defaults.id
    for (let suffix = 2; providers.some(provider => provider.id === id); suffix++) {
      id = asProviderConfigId(defaults.id + '_' + String(suffix))
    }
    providers.push({ ...defaults, id })
  }
  return providers.length === config.providers.length ? config : { ...config, providers }
}

export function patchActiveProvider(config: MinerUConfig, patch: Partial<ProviderConfig>): MinerUConfig {
  return {
    ...config,
    providers: config.providers.map(provider =>
      provider.id === config.activeProvider ? { ...provider, ...patch } as ProviderConfig : provider),
  }
}

/** Official v4 cannot express txt and only accepts its enabled models; other protocols keep shared defaults. */
export function normalizeProviderDefaults(config: MinerUConfig, provider: ProviderConfig): MinerUConfig {
  if (provider.type !== 'official-v4') return config
  const model = provider.models.includes(config.defaults.model) ? config.defaults.model : provider.models[0]
  if (model === undefined) return config
  const parseMethod = config.defaults.parseMethod === 'txt' ? 'auto' : config.defaults.parseMethod
  if (model === config.defaults.model && parseMethod === config.defaults.parseMethod) return config
  return { ...config, defaults: { ...config.defaults, model, parseMethod, ocr: parseMethod === 'ocr' } }
}

export function activateProvider(config: MinerUConfig, providerId: string): MinerUConfig {
  const provider = config.providers.find(candidate => candidate.id === providerId)
  if (provider === undefined || provider.id === config.activeProvider) return config
  return normalizeProviderDefaults({ ...config, activeProvider: provider.id }, provider)
}

export const PROVIDER_MODELS: readonly MinerUModel[] = ['pipeline', 'vlm']

/** Toggle one official cloud model; at least one stays enabled and shared defaults follow the change. */
export function toggleOfficialModel(config: MinerUConfig, model: MinerUModel): MinerUConfig {
  const provider = activeProviderOf(config)
  if (provider?.type !== 'official-v4') return config
  const models = provider.models.includes(model)
    ? provider.models.filter(candidate => candidate !== model)
    : PROVIDER_MODELS.filter(candidate => candidate === model || provider.models.includes(candidate))
  if (models.length === 0) return config
  const next = patchActiveProvider(config, { models })
  return normalizeProviderDefaults(next, { ...provider, models })
}


type Section = 'defaults' | 'polling' | 'retry' | 'output' | 'storage'

export function updateConfigSection<K extends Section>(
  config: MinerUConfig,
  section: K,
  patch: Partial<MinerUConfig[K]>,
): MinerUConfig {
  return { ...config, [section]: { ...config[section], ...patch } }
}

/** Restore one editable section; storageRoot, limits and profile identities are never reset here. */
export function resetConfigSection(config: MinerUConfig, section: Section | 'providers'): MinerUConfig {
  switch (section) {
    case 'defaults': {
      const active = activeProviderOf(config)
      if (active?.type === 'self-hosted-v1') return patchActiveProvider(config, { ocrMode: 'auto' })
      const next = { ...config, defaults: { ...DEFAULT_PARSE_DEFAULTS } }
      return active === undefined ? next : normalizeProviderDefaults(next, active)
    }
    case 'polling': return { ...config, polling: { ...DEFAULT_POLLING_CONFIG } }
    case 'retry': return { ...config, retry: { ...DEFAULT_RETRY_CONFIG } }
    case 'output': return { ...config, output: { ...DEFAULT_OUTPUT_CONFIG } }
    case 'storage': return {
      ...config,
      storage: {
        ...config.storage,
        cacheEnabled: DEFAULT_STORAGE_OPTIONS.cacheEnabled,
        stagingTtlMs: DEFAULT_STORAGE_OPTIONS.stagingTtlMs,
        retainSources: DEFAULT_STORAGE_OPTIONS.retainSources,
      },
    }
    case 'providers': {
      const providers = config.providers.map(p => ({ ...defaultProviderConfig(p.type), id: p.id }) as ProviderConfig)
      const next = { ...config, providers }
      const active = activeProviderOf(next)
      return active === undefined ? next : normalizeProviderDefaults(next, active)
    }
  }
}

const ADVANCED_SECTIONS = ['polling', 'retry', 'output'] as const

/** The Advanced section's restore action: polling, retry and output budgets only. */
export function resetAdvancedSettings(config: MinerUConfig): MinerUConfig {
  return ADVANCED_SECTIONS.reduce<MinerUConfig>((next, section) => resetConfigSection(next, section), config)
}

export function hasAdvancedDefaults(config: MinerUConfig): boolean {
  return structurallyEqual(resetAdvancedSettings(config), config)
}

export class RpcError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'RpcError'
  }
}

export async function callRpc<E extends RpcEndpoint>(
  rpc: ClientConnectionRpc,
  endpoint: E,
  payload: RpcPayloads[E],
): Promise<RpcResponses[E]> {
  const result = await rpc.call(RPC_CHANNEL, endpoint, payload) as RpcResult<RpcResponses[E]>
  if (!result.ok) throw new RpcError(result.error.message, result.error.code)
  return result.value
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface CredentialView {
  readonly configured: boolean
  readonly source?: string
  readonly writable: boolean
}

/** Narrow `ctx.remote.credentials` face used with DSH. */
export interface CredentialClient {
  describe(refs: string[]): Promise<RpcResult<Readonly<Record<string, CredentialView>>>>
  set(ref: string, value: string): Promise<RpcResult<void>>
  unset(ref: string): Promise<RpcResult<void>>
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

export async function storeCredential(credentials: CredentialClient, reference: string, value: string): Promise<void> {
  const secret = value.trim()
  if (secret.length === 0) throw new TypeError('API key must not be empty')
  const result = await credentials.set(reference, secret)
  if (!result.ok) throw new Error(result.error.message)
}

export async function clearCredential(credentials: CredentialClient, reference: string): Promise<void> {
  const result = await credentials.unset(reference)
  if (!result.ok) throw new Error(result.error.message)
}

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const

/** Human byte size; `lowerBound` marks totals from an incomplete scan. */
export function formatBytes(bytes: number, lowerBound = false): string {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit++
  }
  const precision = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2
  return (lowerBound ? '≥ ' : '') + value.toFixed(precision) + ' ' + BYTE_UNITS[unit]
}