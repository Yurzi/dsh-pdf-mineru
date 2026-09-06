import { createHash } from 'node:crypto'
import { asCacheKey, type CacheKey } from './ids.js'
import { CACHE_KEY_SPEC_VERSION, RESULT_SCHEMA_VERSION, type CanonicalParseRequest, type CanonicalSourceFile } from './request.js'

type CanonicalJson = null | boolean | number | string | readonly CanonicalJson[] | { readonly [key: string]: CanonicalJson }

function normalizeJson(value: unknown): CanonicalJson {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') return value.normalize('NFC')
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON cannot contain non-finite numbers')
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) return value.map(normalizeJson)
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>
    const target: Record<string, CanonicalJson> = Object.create(null) as Record<string, CanonicalJson>
    for (const rawKey of Object.keys(source).sort()) {
      const key = rawKey.normalize('NFC')
      if (Object.hasOwn(target, key)) throw new TypeError('canonical JSON key normalization collision')
      const entry = source[rawKey]
      if (entry === undefined) throw new TypeError('canonical JSON cannot contain undefined')
      target[key] = normalizeJson(entry)
    }
    return target
  }
  throw new TypeError(`unsupported canonical JSON value: ${typeof value}`)
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value))
}

export function computeCacheKey(
  request: CanonicalParseRequest,
  file: CanonicalSourceFile,
  providerCompatibilityKey: string,
  versions: { readonly cacheKey?: number; readonly result?: number } = {},
): CacheKey {
  const encoded = canonicalJson({
    cacheKeySchemaVersion: versions.cacheKey ?? CACHE_KEY_SPEC_VERSION,
    sourceSha256: file.sha256,
    parseSemantics: request.semantics,
    requiredArtifacts: request.requiredArtifacts,
    providerCompatibilityKey,
    resultSchemaVersion: versions.result ?? RESULT_SCHEMA_VERSION,
  })
  return asCacheKey(createHash('sha256').update(encoded, 'utf8').digest('hex'))
}
