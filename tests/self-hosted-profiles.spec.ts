import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_PARSE_DEFAULTS, defaultProviderConfig, effectiveParseDefaults,
  type SelfHostedV1Config,
} from '../src/config/pure.js'
import { computeCacheKey } from '../src/domain/cache-key.js'
import { ProviderRegistry } from '../src/providers/registry.js'
import { SelfHostedV1Provider } from '../src/providers/self-hosted-v1.js'
import { SelfHostedLegacyV2Provider } from '../src/providers/self-hosted-legacy-v2.js'
import { RequestNormalizer } from '../src/service/request-normalizer.js'

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function v1Config(ocrMode: SelfHostedV1Config['ocrMode']): SelfHostedV1Config {
  const config = defaultProviderConfig('self-hosted-v1')
  if (config.type !== 'self-hosted-v1') throw new Error('Expected V1 profile')
  return { ...config, ocrMode }
}

describe('explicit self-hosted profiles', () => {
  it('creates distinct registry providers without inspecting the shared endpoint', () => {
    const registry = new ProviderRegistry(() => { throw new Error('create must not read active config') })
    const baseURL = 'https://mineru.example.com'
    const v1 = registry.create({ ...v1Config('auto'), baseURL })
    const legacy = registry.create({ ...defaultProviderConfig('self-hosted-legacy-v2'), baseURL })
    expect(v1).toBeInstanceOf(SelfHostedV1Provider)
    expect(legacy).toBeInstanceOf(SelfHostedLegacyV2Provider)
    expect(v1.id).toBe('self-hosted-v1')
    expect(legacy.id).toBe('self-hosted-legacy-v2')
  })

  it('keeps V1 defaults free of legacy model maps and implicit tier selection', () => {
    const config = v1Config('auto')
    expect(config).not.toHaveProperty('modelMap')
    expect(config).not.toHaveProperty('tier')
    expect(defaultProviderConfig('self-hosted-legacy-v2')).not.toHaveProperty('ocrMode')
  })

  it.each(['auto', 'txt', 'ocr'] as const)('uses %s profile OCR and neutral V1 sentinels instead of global legacy defaults', ocrMode => {
    const defaults = { ...DEFAULT_PARSE_DEFAULTS, model: 'vlm' as const, language: 'en', formula: true, table: true }
    const before = { ...defaults }
    expect(effectiveParseDefaults(defaults, v1Config(ocrMode))).toEqual({
      model: 'pipeline', language: 'auto', formula: false, table: false,
      parseMethod: ocrMode, ocr: ocrMode === 'ocr',
    })
    expect(defaults).toEqual(before)
    expect(effectiveParseDefaults(defaults, defaultProviderConfig('self-hosted-legacy-v2'))).toEqual(defaults)
  })

  it('normalizes profile OCR into separate result caches and keeps explicit OCR overrides effective', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mineru-profile-'))
    tempDirs.push(dir)
    const file_path = join(dir, 'source.pdf')
    await writeFile(file_path, '%PDF-1.4 profile cache fixture')
    const keys: string[] = []
    for (const ocrMode of ['auto', 'txt', 'ocr'] as const) {
      const config = v1Config(ocrMode)
      const normalizer = new RequestNormalizer({ defaults: effectiveParseDefaults(DEFAULT_PARSE_DEFAULTS, config) })
      const { request } = await normalizer.normalize({ file_path }, new AbortController().signal)
      expect(request.semantics.parseMethod).toBe(ocrMode)
      expect(request.semantics.ocr).toBe(ocrMode === 'ocr')
      const provider = new SelfHostedV1Provider(config)
      keys.push(computeCacheKey(request, request.files[0]!, await provider.compatibilityKey(request, {})))
      const forced = await normalizer.normalize({ file_path, ocr: true }, new AbortController().signal)
      expect(forced.request.semantics.parseMethod).toBe('ocr')
      const automatic = await normalizer.normalize({ file_path, ocr: false }, new AbortController().signal)
      expect(automatic.request.semantics.parseMethod).toBe('auto')
    }
    expect(new Set(keys).size).toBe(3)
  })
})
