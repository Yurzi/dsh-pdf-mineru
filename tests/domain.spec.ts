import { utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { asCacheKey, asFileId, asOperationId, asProviderConfigId, asResultId, createFileId } from '../src/domain/ids.js'
import { sanitizeDiagnostic } from '../src/domain/errors.js'
import type { CanonicalParseRequest, ParseDefaults } from '../src/domain/request.js'
import { narrowPageSelection, normalizeFocusSelection, normalizePageSelection } from '../src/domain/selection.js'
import { canonicalJson, computeCacheKey } from '../src/domain/cache-key.js'
import { formatPageOutOfRangeMessage } from '../src/reader/selection.js'
import { assertSourcesUnchanged, canonicalParseRequest, prepareSource } from '../src/source/prepared-source.js'
import { sampleRequest, tempRoot } from './support/storage-fixtures.js'

const defaults: ParseDefaults = { model: 'pipeline', ocr: false, parseMethod: 'auto', language: 'ch', formula: true, table: true }

async function preparedFixture() {
  const root = await tempRoot('mineru-domain-')
  const path = join(root, 'document.pdf')
  await writeFile(path, '%PDF-1.4 fixture')
  const source = await prepareSource(path, Number.MAX_SAFE_INTEGER, new AbortController().signal)
  return { root, path, source, request: canonicalParseRequest(defaults, source) }
}

describe('request normalization', () => {
  it('applies defaults and keeps the local path only on the ephemeral prepared source', async () => {
    const { root, path, source, request } = await preparedFixture()
    expect(request.semantics).toEqual(defaults)
    expect(request.requiredArtifacts).toEqual(['markdown', 'layout', 'model-output', 'content-list', 'images'])
    expect(request.files).toHaveLength(1)
    expect(source.path).toBe(path)
    expect(JSON.stringify(request)).not.toContain(root)
  })

  it('detects a file changed after hashing and before upload', async () => {
    const { path, source } = await preparedFixture()
    await writeFile(path, '%PDF-1.4 changed')
    const later = new Date(Date.now() + 2000)
    await utimes(path, later, later)
    await expect(assertSourcesUnchanged([source], new AbortController().signal))
      .rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
  })
})

describe('page and focus selection', () => {
  it.each([
    [3, [3]], [[1, 2, 5], [1, 2, 5]], ['1-3, 5', [1, 2, 3, 5]],
  ] as const)('normalizes page selection %j', (input, pages) => {
    expect(normalizePageSelection(input)).toEqual(new Set(pages))
  })

  it.each([
    [undefined, 50, { pagesSet: undefined, pagesLabel: '1-50', outOfRange: [], fullyOutOfRange: false }],
    [undefined, 1, { pagesSet: undefined, pagesLabel: '1', outOfRange: [], fullyOutOfRange: false }],
    [[1, 2, 3], 50, { pagesSet: new Set([1, 2, 3]), pagesLabel: '1-3', outOfRange: [], fullyOutOfRange: false }],
    [[48, 49, 50, 51, 52], 50, { pagesSet: new Set([48, 49, 50]), pagesLabel: '48-50', outOfRange: [51, 52], fullyOutOfRange: false }],
    [[2, 60], 3, { pagesSet: new Set([2]), pagesLabel: '2', outOfRange: [60], fullyOutOfRange: false }],
    [[99, 100], 50, { pagesSet: new Set(), pagesLabel: '', outOfRange: [99, 100], fullyOutOfRange: true }],
  ] as const)('narrows %j to the legal bounds of a %i-page document', (pages, total, expected) => {
    expect(narrowPageSelection(pages === undefined ? undefined : new Set(pages), total)).toEqual(expected)
  })

  it('names the valid range in page-out-of-range errors only when the page count is known', () => {
    expect(formatPageOutOfRangeMessage(3)).toMatch(/^\[PAGE_OUT_OF_RANGE\].*valid: 1-3, total pages: 3/)
    for (const unknown of [undefined, 0, -5]) expect(formatPageOutOfRangeMessage(unknown)).not.toContain('valid:')
  })

  it('normalizes focus values and rejects unknown ones', () => {
    expect(normalizeFocusSelection(undefined)).toEqual(new Set(['all']))
    expect(normalizeFocusSelection('table')).toEqual(new Set(['table']))
    expect(normalizeFocusSelection(['text', 'toc', 'artifacts'])).toEqual(new Set(['text', 'toc', 'artifacts']))
    expect(() => normalizeFocusSelection('invalid')).toThrow(/invalid/)
  })
})

describe('cache key', () => {
  const request = (language = 'é'): CanonicalParseRequest => ({
    ...sampleRequest(), files: [{ fileId: createFileId('a'.repeat(64)), name: 'x.pdf', bytes: 4, sha256: 'a'.repeat(64) }],
    semantics: { ...defaults, language },
  })

  it('is stable across canonically equivalent Unicode', () => {
    const composed = request('\u00e9')
    const decomposed = request('e\u0301')
    expect(computeCacheKey(composed, composed.files[0]!, 'provider:v1')).toBe(computeCacheKey(decomposed, decomposed.files[0]!, 'provider:v1'))
  })

  it('isolates provider, artifact, semantics and schema versions', () => {
    const base = request()
    const file = base.files[0]!
    const keys = [
      computeCacheKey(base, file, 'provider:v1'),
      computeCacheKey(base, file, 'provider:v2'),
      computeCacheKey({ ...base, requiredArtifacts: ['markdown', 'layout'] }, file, 'provider:v1'),
      computeCacheKey({ ...base, semantics: { ...base.semantics, table: false } }, file, 'provider:v1'),
      computeCacheKey(base, file, 'provider:v1', { cacheKey: 2 }),
      computeCacheKey(base, file, 'provider:v1', { result: 2 }),
    ]
    expect(new Set(keys).size).toBe(keys.length)
  })

  it.each([
    ['auto', 'b2d5313dacfb974770f45a4e0dbbc87b7c5188e0c06a8a106810316f1dbb93b4'],
    ['txt', '247a4fd5e650ddd14ffafdd216f7248e59d11898c0d417c7f48900d9d75b1bea'],
  ] as const)('preserves the existing %s cache key in the legacy namespace', (parseMethod, expected) => {
    const file = { fileId: createFileId('a'.repeat(64)), name: 'fixture.pdf', bytes: 10, sha256: 'a'.repeat(64) }
    const req: CanonicalParseRequest = { schemaVersion: 1, files: [file], requiredArtifacts: ['markdown'], semantics: { ...defaults, parseMethod } }
    expect(computeCacheKey(req, file, 'self-hosted-legacy-v2:golden')).toBe(expected)
  })

  it('canonicalizes NFC, key order and negative zero, and keeps prototype-like own keys', () => {
    expect(canonicalJson({ z: -0, a: 'e\u0301' })).toBe('{"a":"é","z":0}')
    const value: unknown = JSON.parse('{"__proto__":{"safe":true},"constructor":1,"toString":2}')
    expect(canonicalJson(value)).toBe('{"__proto__":{"safe":true},"constructor":1,"toString":2}')
    expect(Object.prototype).not.toHaveProperty('safe')
  })

  it.each([
    [{ 'é': 1, 'e\u0301': 2 }, /collision/], [{ value: undefined }, /undefined/], [Infinity, /non-finite/],
  ])('rejects ambiguous or non-JSON input %#', (value, error) => {
    expect(() => canonicalJson(value)).toThrow(error)
  })
})

describe('identifier and diagnostic safety', () => {
  it.each([
    ['cache key', () => asCacheKey('not-a-digest')],
    ['cache key casing', () => asCacheKey('A'.repeat(64))],
    ['result id prefix', () => asResultId('mf_0123')],
    ['file id traversal', () => asFileId('mf_../escape')],
    ['provider config separator', () => asProviderConfigId('mp_a/b')],
    ['operation id prefix', () => asOperationId('op_123')],
    ['file id from bad digest', () => createFileId('xyz')],
  ])('rejects an unsafe %s', (_label, build) => {
    expect(build).toThrow(TypeError)
  })

  it('redacts bearer credentials and all secret-bearing URL components', () => {
    const clean = sanitizeDiagnostic(
      'Authorization: Bearer secret.token https://user:p%40ss@cdn.example/token/secret?X-Amz-Signature=query-secret#fragment-secret',
    )
    for (const secret of ['secret.token', 'user', 'p%40ss', '/token/secret', 'query-secret', 'fragment-secret', 'X-Amz']) {
      expect(clean).not.toContain(secret)
    }
    expect(clean).toContain('https://cdn.example/[REDACTED]')
  })
})
