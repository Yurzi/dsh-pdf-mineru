import { describe, expect, it } from 'vitest'
import {
  defaultMinerUConfig,
  defaultProviderConfig,
  parseConfig,
  parseConfigWithMigration,
  providerById,
} from '../src/config.js'
import { asProviderConfigId } from '../src/domain/ids.js'

describe('MinerU config parsing and validation', () => {
  it('creates complete independent self-hosted and official defaults', () => {
    const config = defaultMinerUConfig()
    expect(config.schemaVersion).toBe(2)
    expect(config.activeProvider).toBe('mp_self_hosted')
    expect(config.providers).toHaveLength(2)
    expect(config.providers[0]).toMatchObject({ id: 'mp_self_hosted', type: 'self-hosted-v2', allowInsecureHttp: true })
    expect(config.providers[1]).toMatchObject({
      id: 'mp_official', type: 'official-v4', baseURL: 'https://mineru.net/api/v4', models: ['pipeline', 'vlm'],
    })
    expect(config.defaults).toMatchObject({ model: 'pipeline', parseMethod: 'auto', ocr: false })
    expect(config.retry).toEqual({ maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 10000 })
    expect(config.output).toEqual({ maxInlineChars: 200000, maxInlineImages: 6 })
    expect(config.storage.storageRoot).toMatch(/[\\/]cache[\\/]pdf-mineru$/)
    expect(config.storage.retainSources).toBe(false)
  })

  it('round-trips the canonical default configuration', () => {
    const base = defaultMinerUConfig()
    expect(parseConfig(base)).toEqual(base)
  })

  it('defaults and validates the inline image budget', () => {
    const base = defaultMinerUConfig()
    expect(parseConfig({ ...base, output: { maxInlineChars: 200000 } }).output.maxInlineImages).toBe(6)
    expect(parseConfig({ ...base, output: { ...base.output, maxInlineImages: 0 } }).output.maxInlineImages).toBe(0)
    expect(parseConfig({ ...base, output: { ...base.output, maxInlineImages: 100 } }).output.maxInlineImages).toBe(100)
    expect(() => parseConfig({ ...base, output: { ...base.output, maxInlineImages: -1 } })).toThrow(/output.maxInlineImages/)
    expect(() => parseConfig({ ...base, output: { ...base.output, maxInlineImages: 101 } })).toThrow(/output.maxInlineImages/)
    expect(() => parseConfig({ ...base, output: { ...base.output, maxInlineImages: 1.5 } })).toThrow(/output.maxInlineImages/)
  })

  it('rejects unsupported schemaVersion and accepts the current schemaVersion', () => {
    const base = defaultMinerUConfig()
    expect(parseConfig({ ...base, schemaVersion: 2 }).schemaVersion).toBe(2)
    expect(() => parseConfig({ ...base, schemaVersion: 3 })).toThrow(/unsupported schemaVersion/)
    expect(() => parseConfig({ ...base, schemaVersion: 0 })).toThrow(/unsupported schemaVersion/)
    expect(() => parseConfig({ ...base, schemaVersion: '1' as unknown as number })).toThrow(/unsupported schemaVersion/)
  })

  it('migrates bounded Provider-based v1 settings without mutating the input', () => {
    const base = defaultMinerUConfig()
    const legacy = {
      ...base,
      schemaVersion: 1,
      defaults: { ...base.defaults, artifacts: ['markdown', 'layout'] },
      limits: { ...base.limits, maxFilesPerRequest: 4 },
    }

    const parsed = parseConfigWithMigration(legacy)
    expect(parsed.migrated).toBe(true)
    expect(parsed.migratedFrom).toBe(1)
    expect(parsed.config.schemaVersion).toBe(2)
    expect(parsed.config.defaults).not.toHaveProperty('artifacts')
    expect(parsed.config.limits).not.toHaveProperty('maxFilesPerRequest')
    expect(legacy.defaults.artifacts).toEqual(['markdown', 'layout'])
    expect(legacy.limits.maxFilesPerRequest).toBe(4)
  })

  it('validates removed v1 fields and keeps v2 unknown-field rejection strict', () => {
    const base = defaultMinerUConfig()
    expect(() => parseConfig({
      ...base,
      schemaVersion: 1,
      defaults: { ...base.defaults, artifacts: ['unknown'] },
    })).toThrow(/defaults.artifacts contains an unsupported artifact/)
    expect(() => parseConfig({
      ...base,
      schemaVersion: 1,
      limits: { ...base.limits, maxFilesPerRequest: 0 },
    })).toThrow(/limits.maxFilesPerRequest must be a positive safe integer/)
    expect(() => parseConfig({
      ...base,
      defaults: { ...base.defaults, artifacts: ['markdown'] },
    })).toThrow(/defaults contains unsupported property artifacts/)
    const mergedLegacySettings = parseConfigWithMigration({
      ...base,
      defaults: { ...base.defaults, artifacts: ['markdown'] },
    })
    expect(mergedLegacySettings.migrated).toBe(true)
    expect(mergedLegacySettings.migratedFrom).toBeUndefined()
    expect(mergedLegacySettings.config.defaults).not.toHaveProperty('artifacts')
  })

  it('rejects removed flat configuration fields', () => {
    expect(() => parseConfig({
      baseURL: 'http://mineru.local:18000/',
      apiKeyEnv: 'CUSTOM_MINERU_KEY',
      defaultBackend: 'hybrid-engine',
    })).toThrow(/config contains unsupported property baseURL/)
  })

  it('rejects unknown nested properties with clear paths', () => {
    const base = defaultMinerUConfig()

    expect(() => parseConfig({
      ...base,
      defaults: { ...base.defaults, unknownProp: 'bad' },
    })).toThrow(/defaults contains unsupported property unknownProp/)

    expect(() => parseConfig({
      ...base,
      storage: { ...base.storage, unknownStorageKey: true },
    })).toThrow(/storage contains unsupported property unknownStorageKey/)

    expect(() => parseConfig({
      ...base,
      polling: { ...base.polling, extraPolling: 123 },
    })).toThrow(/polling contains unsupported property extraPolling/)

    expect(() => parseConfig({
      ...base,
      retry: { ...base.retry, extraRetry: 10 },
    })).toThrow(/retry contains unsupported property extraRetry/)

    expect(() => parseConfig({
      ...base,
      output: { ...base.output, extraOutput: 999 },
    })).toThrow(/output contains unsupported property extraOutput/)

    expect(() => parseConfig({
      ...base,
      limits: { ...base.limits, extraLimit: 12345 },
    })).toThrow(/limits contains unsupported property extraLimit/)

    expect(() => parseConfig({
      ...base,
      providers: [
        { ...base.providers[0]!, unknownProviderKey: 'abc' },
        base.providers[1]!,
      ],
    })).toThrow(/provider contains unsupported property unknownProviderKey/)

    const selfHosted = base.providers[0]! as import('../src/config/pure.js').SelfHostedV2Config
    expect(() => parseConfig({
      ...base,
      providers: [
        { ...selfHosted, modelMap: { ...selfHosted.modelMap, extraModel: 'something' } },
        base.providers[1]!,
      ],
    })).toThrow(/modelMap contains unsupported property extraModel/)
  })

  it('enforces explicit retainSources: false contract', () => {
    const base = defaultMinerUConfig()
    expect(parseConfig({
      ...base,
      storage: { ...base.storage, retainSources: false },
    }).storage.retainSources).toBe(false)

    expect(() => parseConfig({
      ...base,
      storage: { ...base.storage, retainSources: true as unknown as false },
    })).toThrow(/storage.retainSources must be false/)

    expect(() => parseConfig({
      ...base,
      storage: { ...base.storage, retainSources: 'false' as unknown as false },
    })).toThrow(/storage.retainSources must be false/)
  })

  it('accepts an official-v4 discriminated provider config', () => {
    const id = asProviderConfigId('mp_official')
    const config = parseConfig({
      activeProvider: id,
      providers: [{ id, type: 'official-v4', apiKeyEnv: 'MINERU_CLOUD_TOKEN', models: ['pipeline', 'vlm'] }],
      defaults: { model: 'vlm', parseMethod: 'ocr', ocr: true },
    })
    expect(providerById(config, id)).toEqual({
      id,
      type: 'official-v4',
      baseURL: 'https://mineru.net/api/v4',
      apiKeyEnv: 'MINERU_CLOUD_TOKEN',
      models: ['pipeline', 'vlm'],
      configuredVersion: 'v4',
    })
    expect(config.defaults).toMatchObject({ model: 'vlm', parseMethod: 'ocr', ocr: true })
  })

  it('rejects duplicate provider identities and unsafe official URLs', () => {
    const id = asProviderConfigId('mp_duplicate')
    expect(() => parseConfig({
      activeProvider: id,
      providers: [
        { id, type: 'official-v4', apiKeyEnv: 'TOKEN' },
        { id, type: 'official-v4', apiKeyEnv: 'TOKEN' },
      ],
    })).toThrow(/unique/)
    expect(() => parseConfig({
      activeProvider: id,
      providers: [{ id, type: 'official-v4', baseURL: 'http://mineru.example/v4', apiKeyEnv: 'TOKEN' }],
    })).toThrow(/HTTPS/)
  })

  it('rejects active official defaults that the provider cannot express', () => {
    const id = asProviderConfigId('mp_official')
    expect(() => parseConfig({
      activeProvider: id,
      providers: [{ id, type: 'official-v4', apiKeyEnv: 'TOKEN', models: ['pipeline'] }],
      defaults: { model: 'vlm', parseMethod: 'auto', ocr: false },
    })).toThrow(/does not support defaults.model/)
    expect(() => parseConfig({
      activeProvider: id,
      providers: [{ id, type: 'official-v4', apiKeyEnv: 'TOKEN' }],
      defaults: { model: 'pipeline', parseMethod: 'txt', ocr: false },
    })).toThrow(/cannot use txt/)
  })

  it('resolves parseMethod and ocr truthfully and detects conflicts', () => {
    const id = asProviderConfigId('mp_official')
    // conflict: parseMethod is txt, but ocr is true
    expect(() => parseConfig({
      activeProvider: id,
      providers: [{ id, type: 'official-v4', apiKeyEnv: 'TOKEN' }],
      defaults: { parseMethod: 'txt', ocr: true },
    })).toThrow(/conflicts/)

    // conflict: parseMethod is auto, but ocr is true
    expect(() => parseConfig({
      activeProvider: id,
      providers: [{ id, type: 'official-v4', apiKeyEnv: 'TOKEN' }],
      defaults: { parseMethod: 'auto', ocr: true },
    })).toThrow(/conflicts/)

    // ocr: true without parseMethod infers parseMethod: 'ocr'
    const ocrInferred = parseConfig({
      activeProvider: id,
      providers: [{ id, type: 'official-v4', apiKeyEnv: 'TOKEN' }],
      defaults: { ocr: true },
    })
    expect(ocrInferred.defaults.ocr).toBe(true)
    expect(ocrInferred.defaults.parseMethod).toBe('ocr')

    // parseMethod: 'ocr' without ocr infers ocr: true
    const methodOcr = parseConfig({
      activeProvider: id,
      providers: [{ id, type: 'official-v4', apiKeyEnv: 'TOKEN' }],
      defaults: { parseMethod: 'ocr' },
    })
    expect(methodOcr.defaults.ocr).toBe(true)
    expect(methodOcr.defaults.parseMethod).toBe('ocr')
  })

  it('fills retry defaults for 0.0.1 configs and validates bounded delays', () => {
    const base = defaultMinerUConfig()
    const olderCanonical = { ...base, retry: undefined }
    expect(parseConfig(olderCanonical).retry).toEqual(base.retry)

    expect(() => parseConfig({
      ...base,
      retry: { maxAttempts: 11, baseDelayMs: 500, maxDelayMs: 10000 },
    })).toThrow(/retry.maxAttempts/)
    expect(() => parseConfig({
      ...base,
      retry: { maxAttempts: 3, baseDelayMs: 2000, maxDelayMs: 1000 },
    })).toThrow(/cannot exceed/)
  })
})
