import { describe, expect, it } from 'vitest'
import { defaultMinerUConfig, migrateConfig, providerById } from '../src/config.js'
import { asProviderConfigId } from '../src/domain/ids.js'

describe('MinerU config migration and validation', () => {
  it('creates a complete self-hosted default', () => {
    const config = defaultMinerUConfig()
    expect(config.schemaVersion).toBe(1)
    expect(config.activeProvider).toBe('mp_self_hosted')
    expect(config.providers[0]).toMatchObject({ type: 'self-hosted-v2', allowInsecureHttp: true })
    expect(config.defaults).toMatchObject({ model: 'pipeline', parseMethod: 'auto', ocr: false })
    expect(config.storage.storageRoot).toMatch(/[\\/]dsh-pdf-mineru[\\/]v1$/)
  })

  it('migrates legacy self-hosted config and preserves txt semantics', () => {
    const config = migrateConfig({
      baseURL: 'http://mineru.local:18000/',
      apiKeyEnv: 'CUSTOM_MINERU_KEY',
      defaultBackend: 'hybrid-engine',
      defaultParseMethod: 'txt',
      defaultLang: 'en',
      pollIntervalMs: 750,
      maxMdOutputChars: 4096,
    })
    expect(config.activeProvider).toBe('mp_self_hosted')
    expect(config.defaults).toMatchObject({ model: 'vlm', parseMethod: 'txt', ocr: false, language: 'en' })
    expect(config.polling.pollIntervalMs).toBe(750)
    expect(config.output.maxInlineChars).toBe(4096)
    expect(config.providers[0]).toMatchObject({
      type: 'self-hosted-v2',
      baseURL: 'http://mineru.local:18000',
      apiKeyEnv: 'CUSTOM_MINERU_KEY',
      modelMap: { pipeline: 'pipeline', vlm: 'hybrid-engine' },
    })
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

  it('rejects conflicting default OCR and parse method settings', () => {
    const id = asProviderConfigId('mp_official')
    expect(() => migrateConfig({
      activeProvider: id,
      providers: [{ id, type: 'official-v4', apiKeyEnv: 'TOKEN' }],
      defaults: { parseMethod: 'txt', ocr: true },
    })).toThrow(/conflicts/)
  })
})
