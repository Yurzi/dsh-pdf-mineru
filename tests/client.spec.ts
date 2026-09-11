import { describe, expect, it, vi } from 'vitest'
import {
  activateProvider,
  clearCredential,
  credentialReference,
  describeCredential,
  ensureProviderProfiles,
  normalizeProviderDefaults,
  patchActiveProvider,
  resetConfigSection,
  resetToDefaultConfig,
  storeCredential,
  updateConfigSection,
} from '../src/client/helpers.js'
import { clampNumericDraft, parseNumericDraft } from '../src/client/NumericInput.js'
import { defaultMinerUConfig, pruneConfigToDiff } from '../src/config.js'
import {
  DEFAULT_OUTPUT_CONFIG,
  DEFAULT_PARSE_DEFAULTS,
  DEFAULT_POLLING_CONFIG,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_STORAGE_OPTIONS,
  defaultProviderConfig,
  type OfficialV4Config,
} from '../src/config/pure.js'
import { asProviderConfigId } from '../src/domain/ids.js'

describe('Client helpers and state transitions', () => {
  it('updates nested section in config draft without mutating original', () => {
    const base = defaultMinerUConfig()
    const updated = updateConfigSection(base, 'polling', { pollIntervalMs: 5000 })
    expect(updated.polling.pollIntervalMs).toBe(5000)
    expect(base.polling.pollIntervalMs).toBe(2000)
  })

  it('detects txt -> auto normalization when activating an official-v4 provider', () => {
    const base = defaultMinerUConfig()
    const official = defaultProviderConfig('official-v4')
    const configWithBoth = ensureProviderProfiles({
      ...base,
      activeProvider: base.providers[0]!.id,
      defaults: { ...base.defaults, parseMethod: 'txt', ocr: false },
    })

    // Currently on self-hosted with parseMethod: 'txt'
    expect(configWithBoth.defaults.parseMethod).toBe('txt')

    // Switching to official-v4
    const next = activateProvider(configWithBoth, official.id)
    expect(next.activeProvider).toBe(official.id)
    // txt was adjusted to auto
    expect(next.defaults.parseMethod).toBe('auto')
  })

  it('keeps auto or ocr parseMethod when switching to official-v4 provider', () => {
    const base = defaultMinerUConfig()
    const official = defaultProviderConfig('official-v4')
    const configWithOcr = ensureProviderProfiles({
      ...base,
      activeProvider: base.providers[0]!.id,
      defaults: { ...base.defaults, parseMethod: 'ocr', ocr: true },
    })

    const next = activateProvider(configWithOcr, official.id)
    expect(next.defaults.parseMethod).toBe('ocr')
    expect(next.defaults.ocr).toBe(true)
  })

  it('ensures provider profiles populates missing provider types with unique ids', () => {
    const base = defaultMinerUConfig()
    // Config with only official-v4
    const officialOnly = {
      ...base,
      activeProvider: asProviderConfigId('mp_official'),
      providers: [base.providers.find(p => p.type === 'official-v4')!],
    }
    const completed = ensureProviderProfiles(officialOnly)
    expect(completed.providers.some(p => p.type === 'self-hosted-v2')).toBe(true)
    expect(completed.providers.some(p => p.type === 'official-v4')).toBe(true)
  })

  it('patches active provider fields cleanly', () => {
    const base = defaultMinerUConfig()
    const patched = patchActiveProvider(base, { baseURL: 'https://custom.mineru.lan:18000' })
    const active = patched.providers.find(p => p.id === patched.activeProvider)
    expect(active?.baseURL).toBe('https://custom.mineru.lan:18000')
  })

  it('extracts credential reference correctly', () => {
    expect(credentialReference(undefined)).toBeUndefined()
    expect(credentialReference({
      id: asProviderConfigId('mp_test'),
      type: 'official-v4',
      baseURL: 'https://mineru.net/api/v4',
      apiKeyEnv: '',
      models: ['pipeline'],
      configuredVersion: 'v4',
    })).toBeUndefined()
    expect(credentialReference({
      id: asProviderConfigId('mp_test'),
      type: 'official-v4',
      baseURL: 'https://mineru.net/api/v4',
      apiKeyEnv: '   ',
      models: ['pipeline'],
      configuredVersion: 'v4',
    })).toBeUndefined()
    expect(credentialReference({
      id: asProviderConfigId('mp_test'),
      type: 'official-v4',
      baseURL: 'https://mineru.net/api/v4',
      apiKeyEnv: 'CUSTOM_KEY',
      models: ['pipeline'],
      configuredVersion: 'v4',
    })).toBe('CUSTOM_KEY')
  })
})

describe('NumericInput parsing and clamping helpers', () => {
  it('parses valid safe integer drafts and respects min/max boundaries', () => {
    expect(parseNumericDraft('42', 1, 100)).toEqual({ valid: true, value: 42 })
    expect(parseNumericDraft('0', 0, 10)).toEqual({ valid: true, value: 0 })

    // Intermediate states while typing
    expect(parseNumericDraft('', 1, 100)).toEqual({ valid: false })
    expect(parseNumericDraft('   ', 1, 100)).toEqual({ valid: false })
    expect(parseNumericDraft('abc', 1, 100)).toEqual({ valid: false })
    expect(parseNumericDraft('3.14', 1, 100)).toEqual({ valid: false })

    // Out of bounds drafts
    expect(parseNumericDraft('0', 1, 100)).toEqual({ valid: false })
    expect(parseNumericDraft('150', 1, 100)).toEqual({ valid: false })
  })

  it('clamps bounded values on blur and handles invalid drafts gracefully', () => {
    // Clamping above max
    expect(clampNumericDraft('150', 50, 1, 100)).toEqual({
      nextDraft: '100',
      value: 100,
      changed: true,
    })

    // Clamping below min
    expect(clampNumericDraft('0', 50, 10, 100)).toEqual({
      nextDraft: '10',
      value: 10,
      changed: true,
    })

    // Reverting empty draft to fallback without change
    expect(clampNumericDraft('', 50, 1, 100)).toEqual({
      nextDraft: '50',
      value: 50,
      changed: false,
    })

    // Reverting unparseable draft to fallback without change
    expect(clampNumericDraft('not-a-number', 50, 1, 100)).toEqual({
      nextDraft: '50',
      value: 50,
      changed: false,
    })

    // Valid value in range commits without clamping
    expect(clampNumericDraft('75', 50, 1, 100)).toEqual({
      nextDraft: '75',
      value: 75,
      changed: true,
    })
  })
})

describe('Reset-to-default configuration helpers', () => {
  describe('resetConfigSection', () => {
    it('reverts polling to DEFAULT_POLLING_CONFIG without affecting other sections', () => {
      const base = defaultMinerUConfig()
      const modified = {
        ...base,
        polling: {
          pollIntervalMs: 9999,
          pollTimeoutMs: 88888,
          requestTimeoutMs: 77777,
          operationTimeoutMs: 66666,
        },
        output: {
          maxInlineChars: 12345,
          maxInlineImages: 10,
        },
      }

      const reset = resetConfigSection(modified, 'polling')
      expect(reset.polling).toEqual(DEFAULT_POLLING_CONFIG)
      expect(reset.output.maxInlineChars).toBe(12345)
      expect(reset.output.maxInlineImages).toBe(10)
      expect(modified.polling.pollIntervalMs).toBe(9999)
    })

    it('reverts defaults to DEFAULT_PARSE_DEFAULTS and respects active official-v4 provider (normalizing parseMethod)', () => {
      const base = defaultMinerUConfig()
      const official = defaultProviderConfig('official-v4')
      const modifiedWithOfficial = {
        ...base,
        activeProvider: official.id,
        defaults: {
          model: 'vlm' as const,
          ocr: true,
          parseMethod: 'ocr' as const,
          language: 'en',
          formula: false,
          table: false,
        },
      }

      const reset = resetConfigSection(modifiedWithOfficial, 'defaults')
      expect(reset.defaults).toEqual(DEFAULT_PARSE_DEFAULTS)

      // Test with custom official provider that only supports 'vlm'
      const vlmOnlyOfficial: OfficialV4Config = {
        ...(official as OfficialV4Config),
        models: ['vlm'],
      }
      const configVlmOnly = {
        ...base,
        activeProvider: vlmOnlyOfficial.id,
        providers: [vlmOnlyOfficial],
        defaults: {
          model: 'pipeline' as const,
          ocr: false,
          parseMethod: 'auto' as const,
          language: 'en',
          formula: true,
          table: true,
        },
      }

      const resetVlmOnly = resetConfigSection(configVlmOnly, 'defaults')
      expect(resetVlmOnly.defaults.model).toBe('vlm')
      expect(resetVlmOnly.defaults.parseMethod).toBe('auto')
      expect(resetVlmOnly.defaults.ocr).toBe(false)
    })

    it('reverts output to DEFAULT_OUTPUT_CONFIG', () => {
      const base = defaultMinerUConfig()
      const modified = {
        ...base,
        output: {
          maxInlineChars: 50000,
          maxInlineImages: 20,
        },
      }

      const reset = resetConfigSection(modified, 'output')
      expect(reset.output).toEqual(DEFAULT_OUTPUT_CONFIG)
      expect(modified.output.maxInlineChars).toBe(50000)
    })

    it('reverts storage cacheEnabled and stagingTtlMs while keeping storageRoot intact', () => {
      const base = defaultMinerUConfig()
      const modified = {
        ...base,
        storage: {
          storageRoot: '/custom/persistent/mineru-cache',
          cacheEnabled: false,
          retainSources: false as const,
          stagingTtlMs: 123456,
        },
      }

      const reset = resetConfigSection(modified, 'storage')
      expect(reset.storage.storageRoot).toBe('/custom/persistent/mineru-cache')
      expect(reset.storage.cacheEnabled).toBe(DEFAULT_STORAGE_OPTIONS.cacheEnabled)
      expect(reset.storage.stagingTtlMs).toBe(DEFAULT_STORAGE_OPTIONS.stagingTtlMs)
      expect(reset.storage.retainSources).toBe(false)
      expect(modified.storage.cacheEnabled).toBe(false)
    })

    it('reverts retry to DEFAULT_RETRY_CONFIG', () => {
      const base = defaultMinerUConfig()
      const modified = {
        ...base,
        retry: {
          maxAttempts: 10,
          baseDelayMs: 5000,
          maxDelayMs: 60000,
        },
      }

      const reset = resetConfigSection(modified, 'retry')
      expect(reset.retry).toEqual(DEFAULT_RETRY_CONFIG)
    })

    it('reverts providers to defaultProviderConfig while keeping provider IDs', () => {
      const base = defaultMinerUConfig()
      const modified = {
        ...base,
        providers: base.providers.map(p => ({
          ...p,
          baseURL: 'https://custom.endpoint.com',
          apiKeyEnv: 'CUSTOM_KEY',
        })),
      }

      const reset = resetConfigSection(modified, 'providers')
      const selfHosted = reset.providers.find(p => p.type === 'self-hosted-v2')
      const official = reset.providers.find(p => p.type === 'official-v4')
      expect(selfHosted?.baseURL).toBe('http://localhost:18000')
      expect(selfHosted?.apiKeyEnv).toBe('MINERU_API_KEY')
      expect(official?.baseURL).toBe('https://mineru.net/api/v4')
      expect(official?.apiKeyEnv).toBe('MINERU_API_KEY')
    })
  })

  describe('resetToDefaultConfig', () => {
    it('reverts all editable settings to defaults while preserving storageRoot and limits', () => {
      const base = defaultMinerUConfig()
      const customRoot = '/mnt/custom/storage/root'
      const customLimits = {
        ...base.limits,
        maxFileBytes: 1234567,
        maxZipEntries: 42,
      }

      const modified = {
        ...base,
        activeProvider: asProviderConfigId('mp_official'),
        providers: base.providers.map(p => ({
          ...p,
          baseURL: 'https://override.example.com',
        })),
        defaults: {
          model: 'vlm' as const,
          ocr: true,
          parseMethod: 'ocr' as const,
          language: 'en',
          formula: false,
          table: false,
        },
        storage: {
          storageRoot: customRoot,
          cacheEnabled: false,
          retainSources: false as const,
          stagingTtlMs: 9999,
        },
        polling: {
          pollIntervalMs: 9999,
          pollTimeoutMs: 88888,
          requestTimeoutMs: 77777,
          operationTimeoutMs: 66666,
        },
        retry: {
          maxAttempts: 9,
          baseDelayMs: 3000,
          maxDelayMs: 90000,
        },
        output: {
          maxInlineChars: 12345,
          maxInlineImages: 2,
        },
        limits: customLimits,
      }

      const reset = resetToDefaultConfig(modified)

      // Preserved fields
      expect(reset.storage.storageRoot).toBe(customRoot)
      expect(reset.limits).toEqual(customLimits)
      expect(reset.storage.retainSources).toBe(false)
      expect(reset.schemaVersion).toBe(modified.schemaVersion)

      // Reverted fields
      expect(reset.activeProvider).toBe(defaultProviderConfig('self-hosted-v2').id)
      expect(reset.providers).toEqual([
        defaultProviderConfig('self-hosted-v2'),
        defaultProviderConfig('official-v4'),
      ])
      expect(reset.defaults).toEqual(DEFAULT_PARSE_DEFAULTS)
      expect(reset.storage.cacheEnabled).toBe(DEFAULT_STORAGE_OPTIONS.cacheEnabled)
      expect(reset.storage.stagingTtlMs).toBe(DEFAULT_STORAGE_OPTIONS.stagingTtlMs)
      expect(reset.polling).toEqual(DEFAULT_POLLING_CONFIG)
      expect(reset.retry).toEqual(DEFAULT_RETRY_CONFIG)
      expect(reset.output).toEqual(DEFAULT_OUTPUT_CONFIG)

      // Verify pruneConfigToDiff prunes all reset sections
      const diff = pruneConfigToDiff(reset, defaultMinerUConfig())
      expect(diff.defaults).toBeUndefined()
      expect(diff.polling).toBeUndefined()
      expect(diff.retry).toBeUndefined()
      expect(diff.output).toBeUndefined()
      expect(diff.providers).toBeUndefined()
      expect(diff.activeProvider).toBeUndefined()
      // Only custom storageRoot and limits are kept in diff (pruned to diff)
      expect(diff.storage).toEqual({ storageRoot: customRoot })
      expect(diff.limits).toEqual({ maxFileBytes: 1234567, maxZipEntries: 42 })
    })

    it('produces empty diff on pruneConfigToDiff when storageRoot and limits are also defaults', () => {
      const base = defaultMinerUConfig()
      const modified = {
        ...base,
        defaults: {
          model: 'vlm' as const,
          ocr: true,
          parseMethod: 'ocr' as const,
          language: 'ja',
          formula: false,
          table: false,
        },
        polling: {
          ...base.polling,
          pollIntervalMs: 5000,
        },
      }

      const reset = resetToDefaultConfig(modified)
      const diff = pruneConfigToDiff(reset, base)
      expect(diff).toEqual({})
    })
  })
})
