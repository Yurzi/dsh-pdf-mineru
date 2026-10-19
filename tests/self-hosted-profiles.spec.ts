import { describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_PARSE_DEFAULTS, defaultProviderConfig, effectiveParseDefaults,
  type ProviderConfig, type SelfHostedV1Config,
} from '../src/config/model.js'
import { computeCacheKey } from '../src/domain/cache-key.js'
import type { MinerUModel } from '../src/domain/request.js'
import { createProvider } from '../src/providers/registry.js'
import { SelfHostedV1Provider } from '../src/providers/self-hosted-v1/index.js'
import { SelfHostedLegacyV2Provider } from '../src/providers/self-hosted-legacy-v2/index.js'
import { canonicalParseRequest, prepareSource } from '../src/source/prepared-source.js'
import { canonicalRequest, tempDir } from './support/provider-context.js'

const v1Config = (ocrMode: SelfHostedV1Config['ocrMode']): SelfHostedV1Config => ({ ...defaultProviderConfig('self-hosted-v1'), ocrMode })
const official = defaultProviderConfig('official-v4')
const legacy = defaultProviderConfig('self-hosted-legacy-v2')

// Literal keys pin persisted cache identity: a change here orphans every cached result.
const compatibilityGoldens: readonly { readonly name: string; readonly config: ProviderConfig; readonly model: MinerUModel; readonly key: string }[] = [
  { name: 'official default pipeline', config: official, model: 'pipeline', key: 'official-v4:5f5862f18c52dae898917c55' },
  { name: 'official default vlm', config: official, model: 'vlm', key: 'official-v4:7fce9c7bc4d1823f0f83d94b' },
  {
    name: 'official prefixed endpoint', model: 'pipeline', key: 'official-v4:b683c8e80a98b31a80ef7b71',
    config: { ...official, baseURL: 'https://proxy.example/mineru/api/v4///?ignored=1' },
  },
  { name: 'V1 default untiered', config: v1Config('auto'), model: 'pipeline', key: 'self-hosted-v1:bde48253cce20e0f2171b97a' },
  {
    name: 'V1 prefixed versioned standard tier', model: 'pipeline', key: 'self-hosted-v1:16b3fef70e9c076a240a5b11',
    config: { ...v1Config('txt'), baseURL: 'https://mineru.example/prefix///?ignored=1', tier: 'standard', configuredVersion: '4.0.1' },
  },
  {
    name: 'V1 advanced tier', model: 'pipeline', key: 'self-hosted-v1:88a2d35c8adc22e53c2f49b9',
    config: { ...v1Config('ocr'), baseURL: 'https://mineru.example/prefix/', tier: 'advanced' },
  },
  { name: 'legacy default pipeline', config: legacy, model: 'pipeline', key: 'self-hosted-legacy-v2:d134285f695d63333e3bb6bb' },
  { name: 'legacy default vlm', config: legacy, model: 'vlm', key: 'self-hosted-legacy-v2:84e9f70dc20a5266fd12632e' },
  {
    name: 'legacy prefixed versioned custom backend', model: 'vlm', key: 'self-hosted-legacy-v2:ba59a1d1e7dc949106b2af9e',
    config: {
      ...legacy, baseURL: 'https://mineru.example/prefix///?ignored=1', configuredVersion: '3.0.2',
      modelMap: { pipeline: 'pipeline-custom', vlm: 'vlm-custom' }, allowInsecureHttp: false,
    },
  },
]

describe('provider compatibility golden keys', () => {
  it.each(compatibilityGoldens)('preserves $name', ({ config, model, key }) => {
    const request = canonicalRequest({ semantics: { ...DEFAULT_PARSE_DEFAULTS, model } })
    expect(createProvider(config).compatibilityKey(request)).toBe(key)
  })
})

describe('explicit self-hosted profiles', () => {
  it('creates distinct registry providers for one endpoint without inspecting it', () => {
    const baseURL = 'https://mineru.example.com'
    expect(createProvider({ ...v1Config('auto'), baseURL })).toBeInstanceOf(SelfHostedV1Provider)
    expect(createProvider({ ...legacy, baseURL })).toBeInstanceOf(SelfHostedLegacyV2Provider)
  })

  it('keeps V1 defaults free of legacy model maps and implicit tiers', () => {
    expect(v1Config('auto')).not.toHaveProperty('modelMap')
    expect(v1Config('auto')).not.toHaveProperty('tier')
    expect(legacy).not.toHaveProperty('ocrMode')
  })

  it.each(['auto', 'txt', 'ocr'] as const)('uses the %s profile OCR mode and neutral V1 sentinels, never shared legacy defaults', ocrMode => {
    const defaults = { ...DEFAULT_PARSE_DEFAULTS, model: 'vlm' as const, language: 'en', formula: true, table: true }
    const before = { ...defaults }
    expect(effectiveParseDefaults(defaults, v1Config(ocrMode))).toEqual({
      model: 'pipeline', language: 'auto', formula: false, table: false, parseMethod: ocrMode, ocr: ocrMode === 'ocr',
    })
    expect(defaults).toEqual(before)
    expect(effectiveParseDefaults(defaults, legacy)).toEqual(defaults)
  })

  it('separates auto, txt and ocr in cache semantics, not in provider compatibility', async () => {
    const path = join(await tempDir('mineru-profile-'), 'source.pdf')
    await writeFile(path, '%PDF-1.4 profile cache fixture')
    const source = await prepareSource(path, Number.MAX_SAFE_INTEGER, new AbortController().signal)
    const keys = (['auto', 'txt', 'ocr'] as const).map(ocrMode => {
      const config = v1Config(ocrMode)
      const request = canonicalParseRequest(effectiveParseDefaults(DEFAULT_PARSE_DEFAULTS, config), source)
      expect(request.semantics).toMatchObject({ parseMethod: ocrMode, ocr: ocrMode === 'ocr' })
      const compatibility = new SelfHostedV1Provider(config).compatibilityKey(request)
      return { compatibility, cache: computeCacheKey(request, request.files[0]!, compatibility) }
    })
    expect(new Set(keys.map(key => key.compatibility)).size).toBe(1)
    expect(new Set(keys.map(key => key.cache)).size).toBe(3)
  })
})
