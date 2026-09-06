import { describe, expect, it, vi } from 'vitest'
import {
  activateProvider,
  clearCredential,
  credentialReference,
  describeCredential,
  ensureProviderProfiles,
  normalizeProviderDefaults,
  patchActiveProvider,
  storeCredential,
  updateConfigSection,
} from '../src/client/helpers.js'
import { clampNumericDraft, parseNumericDraft } from '../src/client/NumericInput.js'
import { defaultMinerUConfig } from '../src/config.js'
import { defaultProviderConfig, type OfficialV4Config } from '../src/config/pure.js'
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
