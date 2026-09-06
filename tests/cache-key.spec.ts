import { describe, expect, it } from 'vitest'
import { canonicalJson, computeCacheKey } from '../src/domain/cache-key.js'
import { createFileId } from '../src/domain/ids.js'
import type { CanonicalParseRequest, ParseMethod } from '../src/domain/request.js'

const file = { fileId: createFileId('a'.repeat(64)), name: 'fixture.pdf', bytes: 10, sha256: 'a'.repeat(64) }
function request(parseMethod: ParseMethod): CanonicalParseRequest {
  return {
    schemaVersion: 1, files: [file], requiredArtifacts: ['markdown'],
    semantics: { model: 'pipeline', ocr: false, parseMethod, language: 'ch', formula: true, table: true },
  }
}

describe('version 1 cache identity compatibility', () => {
  it.each([
    ['auto', '71c1ee24770042d2b931a918ddddbc052d28ac77ecd4a0f061e06787d8b70777'],
    ['txt', 'ffeaac8ba9e290669abecc4b71a7a1fd6f34cf7fa80d815166f5552dfe916a2d'],
  ] as const)('preserves the %s golden cache key', (method, expected) => {
    expect(computeCacheKey(request(method), file, 'self-hosted-v2:golden')).toBe(expected)
  })

  it('preserves NFC normalization, sorted keys and negative zero', () => {
    expect(canonicalJson({ z: -0, a: 'e\u0301' })).toBe('{"a":"é","z":0}')
    expect(canonicalJson({ a: 'é', z: 0 })).toBe(canonicalJson({ z: -0, a: 'e\u0301' }))
  })

  it('accepts own properties that resemble Object.prototype without dropping them', () => {
    const value: unknown = JSON.parse('{"__proto__":{"safe":true},"constructor":1,"toString":2}')
    expect(canonicalJson(value)).toBe('{"__proto__":{"safe":true},"constructor":1,"toString":2}')
    expect(Object.prototype).not.toHaveProperty('safe')
  })

  it('still rejects ambiguous normalized keys and non-JSON values', () => {
    expect(() => canonicalJson({ 'é': 1, 'e\u0301': 2 })).toThrow('collision')
    expect(() => canonicalJson({ value: undefined })).toThrow('undefined')
    expect(() => canonicalJson(Infinity)).toThrow('non-finite')
  })
})
