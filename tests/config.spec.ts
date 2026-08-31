import { describe, expect, it } from 'vitest'
import { defaultMinerUConfig, migrateConfig, providerById } from '../src/config.js'
import { asProviderConfigId } from '../src/domain/ids.js'

describe('MinerU config parsing and validation', () => {
  it('creates complete independent self-hosted and official defaults', () => {
    const config = defaultMinerUConfig()
    expect(config.schemaVersion).toBe(1)
    expect(config.activeProvider).toBe('mp_self_hosted')
    expect(config.providers).toHaveLength(2)
    expect(config.providers[0]).toMatchObject({ id: 'mp_self_hosted', type: 'self-hosted-v2', allowInsecureHttp: true })
    expect(config.providers[1]).toMatchObject({
      id: 'mp_official', type: 'official-v4', baseURL: 'https://mineru.net/api/v4', models: ['pipeline', 'vlm'],
    })
    expect(config.defaults).toMatchObject({ model: 'pipeline', parseMethod: 'auto', ocr: false })
    expect(config.retry).toEqual({ maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 10000 })
    expect(config.limits.maxFilesPerRequest).toBe(1)
    expect(config.storage.storageRoot).toMatch(/[\\/]cache[\\/]pdf-mineru$/)
  })

  it('rejects removed flat configuration fields', () => {
    expect(() => migrateConfig({
      baseURL: 'http://mineru.local:18000/',
      apiKeyEnv: 'CUSTOM_MINERU_KEY',
      defaultBackend: 'hybrid-engine',
    })).toThrow(/unsupported property/)
  })

  it('accepts an official-v4 discriminated provider config', () => {
    const id = asProviderConfigId('mp_official')
    const config = migrateConfig({
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
    expect(() => migrateConfig({
      activeProvider: id,
      providers: [
        { id, type: 'official-v4', apiKeyEnv: 'TOKEN' },
        { id, type: 'official-v4', apiKeyEnv: 'TOKEN' },
      ],
    })).toThrow(/unique/)
    expect(() => migrateConfig({
      activeProvider: id,
      providers: [{ id, type: 'official-v4', baseURL: 'http://mineru.example/v4', apiKeyEnv: 'TOKEN' }],
    })).toThrow(/HTTPS/)
  })

  it('rejects active official defaults that the provider cannot express', () => {
    const id = asProviderConfigId('mp_official')
    expect(() => migrateConfig({
      activeProvider: id,
      providers: [{ id, type: 'official-v4', apiKeyEnv: 'TOKEN', models: ['pipeline'] }],
      defaults: { model: 'vlm', parseMethod: 'auto', ocr: false },
    })).toThrow(/does not support defaults.model/)
    expect(() => migrateConfig({
      activeProvider: id,
      providers: [{ id, type: 'official-v4', apiKeyEnv: 'TOKEN' }],
      defaults: { model: 'pipeline', parseMethod: 'txt', ocr: false },
    })).toThrow(/cannot use txt/)
  })

  it('fills retry defaults for 0.0.1 configs and validates bounded delays', () => {
    const base = defaultMinerUConfig()
    const olderCanonical = { ...base, retry: undefined }
    expect(migrateConfig(olderCanonical).retry).toEqual(base.retry)

    expect(() => migrateConfig({
      ...base,
      retry: { maxAttempts: 11, baseDelayMs: 500, maxDelayMs: 10000 },
    })).toThrow(/retry.maxAttempts/)
    expect(() => migrateConfig({
      ...base,
      retry: { maxAttempts: 3, baseDelayMs: 2000, maxDelayMs: 1000 },
    })).toThrow(/cannot exceed/)
  })

  it('rejects conflicting default OCR and parse method settings', () => {
    const id = asProviderConfigId('mp_official')
    expect(() => migrateConfig({
      activeProvider: id,
      providers: [{ id, type: 'official-v4', apiKeyEnv: 'TOKEN' }],
      defaults: { parseMethod: 'txt', ocr: true },
    })).toThrow(/conflicts/)
  })
})
