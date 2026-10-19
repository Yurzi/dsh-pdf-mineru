type Brand<T, Name extends string> = T & { readonly __brand: Name }

/** Canonical Provider protocol types; provider enums, parsers and discriminants derive from this list. */
export const PROVIDER_TYPES = ['self-hosted-v1', 'self-hosted-legacy-v2', 'official-v4'] as const
export type MinerUProviderId = typeof PROVIDER_TYPES[number]

export type MinerUResultId = Brand<string, 'MinerUResultId'>
export type MinerUFileId = Brand<string, 'MinerUFileId'>
export type ProviderConfigId = Brand<string, 'ProviderConfigId'>
export type CacheKey = Brand<string, 'CacheKey'>
export type OperationId = Brand<string, 'OperationId'>

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const PREFIXED_ID = /^(?:mr|mf|mp|mo)_[A-Za-z0-9][A-Za-z0-9._-]{0,123}$/
const CACHE_KEY = /^[a-f0-9]{64}$/

export function assertSafePathSegment(value: string, label: string): string {
  if (!SAFE_SEGMENT.test(value) || value === '.' || value === '..') {
    throw new TypeError(`${label} must be a safe path segment`)
  }
  return value
}

function assertPrefixedId(value: string, prefix: string): string {
  if (!value.startsWith(`${prefix}_`) || !PREFIXED_ID.test(value)) {
    throw new TypeError(`invalid ${prefix} identifier`)
  }
  return value
}

export const asResultId = (value: string): MinerUResultId => assertPrefixedId(value, 'mr') as MinerUResultId
export const asFileId = (value: string): MinerUFileId => assertPrefixedId(value, 'mf') as MinerUFileId
export const asProviderConfigId = (value: string): ProviderConfigId => assertPrefixedId(value, 'mp') as ProviderConfigId
export const asOperationId = (value: string): OperationId => assertPrefixedId(value, 'mo') as OperationId

export function asCacheKey(value: string): CacheKey {
  if (!CACHE_KEY.test(value)) throw new TypeError('cache key must be a lowercase SHA-256 digest')
  return value as CacheKey
}

function randomOperationId(): string {
  return `mo_${globalThis.crypto.randomUUID().replaceAll('-', '')}`
}

export const createOperationId = (): OperationId => asOperationId(randomOperationId())

export function createFileId(sha256: string, index = 0): MinerUFileId {
  if (!CACHE_KEY.test(sha256)) throw new TypeError('source SHA-256 is invalid')
  return asFileId(`mf_${sha256.slice(0, 28)}_${String(index)}`)
}

export function resultIdForCacheKey(cacheKey: CacheKey): MinerUResultId {
  return asResultId(`mr_${cacheKey.slice(0, 32)}`)
}
