import { mkdtemp, rm, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { asCacheKey, asSessionId, createFileId } from '../src/domain/ids.js'
import { MinerUError, sanitizeDiagnostic } from '../src/domain/errors.js'
import { CANONICAL_PARSE_REQUEST_SCHEMA_VERSION, type CanonicalParseRequest, type ParseDefaults } from '../src/domain/request.js'
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
  artifacts: ['markdown'],
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
    expect(prepared.request.requiredArtifacts).toEqual(['markdown'])
    expect(prepared.sources[0]?.path).toBe(path)
    expect(JSON.stringify(prepared.request)).not.toContain(root)
  })

  it('normalizes legacy aliases without losing txt semantics', async () => {
    const { path } = await fixture()
    const normalizer = new RequestNormalizer({
      defaults,
      legacyBackendModels: { pipeline: 'pipeline', 'vlm-engine': 'vlm' },
    })
    const prepared = await normalizer.normalize({
      file_path: path,
      backend: 'vlm-engine',
      parse_method: 'txt',
      lang_list: ['en'],
      start_page_id: 0,
      end_page_id: 4,
      return_content_list: true,
      return_images: true,
    }, new AbortController().signal)
    expect(prepared.request.semantics).toMatchObject({
      model: 'vlm', ocr: false, parseMethod: 'txt', language: 'en', pages: '1-5',
    })
    expect(prepared.request.requiredArtifacts).toEqual(['markdown', 'content-list', 'images'])
  })

  it('rejects conflicting modern and legacy aliases', async () => {
    const { path } = await fixture()
    const normalizer = new RequestNormalizer({ defaults })
    await expect(normalizer.normalize({
      file_path: path, ocr: true, parse_method: 'auto',
    }, new AbortController().signal)).rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
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

  it('redacts bearer credentials and signed URL queries', () => {
    const clean = sanitizeDiagnostic('Authorization: Bearer secret.token https://cdn.example/result.zip?X-Amz-Signature=secret')
    expect(clean).not.toContain('secret.token')
    expect(clean).not.toContain('X-Amz')
    expect(clean).toContain('https://cdn.example/result.zip')
  })
})
