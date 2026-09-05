import { mkdtemp, rm, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { asCacheKey, asSessionId, createFileId } from '../src/domain/ids.js'
import { MinerUError, sanitizeDiagnostic } from '../src/domain/errors.js'
import { CANONICAL_PARSE_REQUEST_SCHEMA_VERSION, narrowPageSelection, normalizeFocusSelection, normalizePageSelection, type CanonicalParseRequest, type ParseDefaults, type ParseRequestInput } from '../src/domain/request.js'
import { computeCacheKey } from '../src/service/cache-key.js'
import { RequestNormalizer, assertSourcesUnchanged, normalizePages } from '../src/service/request-normalizer.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const defaults: ParseDefaults = {
  model: 'pipeline',
  ocr: false,
  parseMethod: 'auto',
  language: 'ch',
  formula: true,
  table: true,
}

async function fixture(name = 'document.pdf', contents = '%PDF-1.4 fixture'): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), 'mineru-domain-'))
  roots.push(root)
  const path = join(root, name)
  await writeFile(path, contents)
  return { root, path }
}

describe('request normalization', () => {
  it('sorts and merges one-based page ranges', () => {
    expect(normalizePages('15, 3-5,1-3,10-14')).toBe('1-5,10-15')
    expect(() => normalizePages('0-2')).toThrow(MinerUError)
    expect(() => normalizePages('3-2')).toThrow(MinerUError)
  })

  it('applies defaults and strips local paths from the canonical request', async () => {
    const { root, path } = await fixture()
    const normalizer = new RequestNormalizer({ defaults, cwd: root })
    const prepared = await normalizer.normalize({ file_path: path }, new AbortController().signal)
    expect(prepared.request.semantics).toEqual({
      model: 'pipeline', ocr: false, parseMethod: 'auto', language: 'ch', formula: true, table: true,
    })
    expect(prepared.request.requiredArtifacts).toEqual(['markdown', 'layout', 'model-output', 'content-list', 'images'])
    expect(prepared.sources[0]?.path).toBe(path)
    expect(JSON.stringify(prepared.request)).not.toContain(root)
  })

  it('normalizes modern request fields and artifact selection', async () => {
    const { path } = await fixture()
    const normalizer = new RequestNormalizer({ defaults })
    const prepared = await normalizer.normalize({
      file_path: path, model: 'vlm', ocr: true, language: 'en', pages: '1-5',
      artifacts: ['markdown', 'content-list', 'images'],
    }, new AbortController().signal)
    expect(prepared.request.semantics).toMatchObject({
      model: 'vlm', ocr: true, parseMethod: 'ocr', language: 'en', pages: '1-5',
    })
    expect(prepared.request.requiredArtifacts).toEqual(['markdown', 'content-list', 'images'])
  })


  it('accepts single file_path and normalizes to canonical request file', async () => {
    const { path } = await fixture()
    const normalizer = new RequestNormalizer({ defaults })
    const prepared = await normalizer.normalize({ file_path: path }, new AbortController().signal)
    expect(prepared.request.files).toHaveLength(1)
    expect(prepared.sources[0]?.path).toBe(path)
  })

  it('normalizes page selection for various input formats', () => {
    expect(normalizePageSelection(3)).toEqual(new Set([3]))
    expect(normalizePageSelection([1, 2, 5])).toEqual(new Set([1, 2, 5]))
    expect(normalizePageSelection('1-3, 5')).toEqual(new Set([1, 2, 3, 5]))
    expect(normalizePageSelection(undefined)).toBeUndefined()
  })

  it('narrows page selection safely to legal document page bounds', () => {
    expect(narrowPageSelection(undefined, 50)).toEqual({ pagesSet: undefined, pagesLabel: '1-50' })
    expect(narrowPageSelection(undefined, 1)).toEqual({ pagesSet: undefined, pagesLabel: '1' })
    expect(narrowPageSelection(new Set([3]), 50)).toEqual({ pagesSet: new Set([3]), pagesLabel: '3' })
    expect(narrowPageSelection(new Set([1, 2, 3]), 50)).toEqual({ pagesSet: new Set([1, 2, 3]), pagesLabel: '1-3' })
    expect(narrowPageSelection(new Set([48, 49, 50, 51, 52]), 50)).toEqual({
      pagesSet: new Set([48, 49, 50]),
      pagesLabel: '48-50',
    })
    expect(narrowPageSelection(new Set([99, 100]), 50)).toEqual({
      pagesSet: new Set([50]),
      pagesLabel: '50',
    })
  })

  it('normalizes focus selection for single and array formats', () => {
    expect(normalizeFocusSelection('table')).toEqual(new Set(['table']))
    expect(normalizeFocusSelection(['text', 'image'])).toEqual(new Set(['text', 'image']))
    expect(normalizeFocusSelection('toc')).toEqual(new Set(['toc']))
    expect(normalizeFocusSelection('outline')).toEqual(new Set(['toc']))
    expect(normalizeFocusSelection(['text', 'toc'])).toEqual(new Set(['text', 'toc']))
    expect(normalizeFocusSelection(['text', 'outline'])).toEqual(new Set(['text', 'toc']))
    expect(normalizeFocusSelection('artifacts')).toEqual(new Set(['artifacts']))
    expect(normalizeFocusSelection('artifact')).toEqual(new Set(['artifacts']))
    expect(normalizeFocusSelection(['text', 'artifacts'])).toEqual(new Set(['text', 'artifacts']))
    expect(normalizeFocusSelection(undefined)).toEqual(new Set(['all']))
    expect(() => normalizeFocusSelection('invalid')).toThrowError('Invalid focus option: invalid')
  })

  it('rejects every removed request alias at the service boundary', async () => {
    const { path } = await fixture()
    const normalizer = new RequestNormalizer({ defaults })
    const aliases: Record<string, unknown> = {
      backend: 'pipeline', parse_method: 'ocr', lang_list: ['en'],
      formula_enable: true, table_enable: true, return_middle_json: true,
      return_model_output: true, return_content_list: true, return_images: true,
      start_page_id: 0, end_page_id: 1,
    }
    for (const [key, value] of Object.entries(aliases)) {
      const input = { file_path: path, [key]: value } as unknown as ParseRequestInput
      await expect(normalizer.normalize(input, new AbortController().signal))
        .rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
    }
  })

  it('detects a file changed after hashing and before upload', async () => {
    const { path } = await fixture()
    const normalizer = new RequestNormalizer({ defaults })
    const prepared = await normalizer.normalize({ file_path: path }, new AbortController().signal)
    await writeFile(path, '%PDF-1.4 changed')
    const now = new Date(Date.now() + 2000)
    await utimes(path, now, now)
    await expect(assertSourcesUnchanged(prepared.sources, new AbortController().signal))
      .rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
  })
})

describe('cache key', () => {
  function request(language = 'é'): CanonicalParseRequest {
    const sha = 'a'.repeat(64)
    return {
      schemaVersion: CANONICAL_PARSE_REQUEST_SCHEMA_VERSION,
      files: [{ fileId: createFileId(sha), name: 'x.pdf', bytes: 4, sha256: sha }],
      semantics: { model: 'pipeline', ocr: false, parseMethod: 'auto', language, formula: true, table: true },
      requiredArtifacts: ['markdown'],
    }
  }

  it('is stable across canonically equivalent Unicode', () => {
    const composed = request('é')
    const decomposed = request('é')
    expect(computeCacheKey(composed, composed.files[0]!, 'provider:v1'))
      .toBe(computeCacheKey(decomposed, decomposed.files[0]!, 'provider:v1'))
  })

  it('isolates provider, artifact, semantics, and schema versions', () => {
    const base = request()
    const initial = computeCacheKey(base, base.files[0]!, 'provider:v1')
    expect(computeCacheKey(base, base.files[0]!, 'provider:v2')).not.toBe(initial)
    expect(computeCacheKey({ ...base, requiredArtifacts: ['markdown', 'layout'] }, base.files[0]!, 'provider:v1')).not.toBe(initial)
    expect(computeCacheKey({ ...base, semantics: { ...base.semantics, table: false } }, base.files[0]!, 'provider:v1')).not.toBe(initial)
    expect(computeCacheKey(base, base.files[0]!, 'provider:v1', { cacheKey: 2 })).not.toBe(initial)
    expect(computeCacheKey(base, base.files[0]!, 'provider:v1', { result: 2 })).not.toBe(initial)
  })
})

describe('identifier and diagnostic safety', () => {
  it('rejects unsafe path identifiers and malformed cache keys', () => {
    expect(() => asSessionId('../other')).toThrow()
    expect(() => asCacheKey('not-a-digest')).toThrow()
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
