import { describe, expect, it } from 'vitest'
import { isVolatile } from '@deepseek-ai/cosmokit'
import { defaultProviderConfig, providerById, type MinerUConfig } from '../src/config/model.js'
import { defaultMinerUConfig, parseConfig } from '../src/config/parse.js'
import { Config } from '../src/config/schema.js'
import { asProviderConfigId } from '../src/domain/ids.js'

type Patch = Record<string, unknown>
const base = (): MinerUConfig => defaultMinerUConfig()
const legacy = defaultProviderConfig('self-hosted-legacy-v2')
const official = defaultProviderConfig('official-v4')
const v1 = defaultProviderConfig('self-hosted-v1')
/** One-provider configuration whose active profile is the given provider. */
const only = (provider: Patch, extra: Patch = {}): Patch => ({ activeProvider: provider.id, providers: [provider], ...extra })
const officialWith = (defaults: Patch, provider: Patch = {}): Patch =>
  only({ id: 'mp_official', type: 'official-v4', apiKeyEnv: 'TOKEN', ...provider }, { defaults })

describe('MinerU config defaults', () => {
  it('creates three independent profiles in legacy, official, V1 order with bounded defaults', () => {
    const config = base()
    expect(config).toMatchObject({
      schemaVersion: 3, activeProvider: 'mp_self_hosted',
      defaults: { model: 'pipeline', parseMethod: 'auto', ocr: false },
      retry: { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 10000 },
      output: { maxInlineChars: 12000, maxInlineImages: 6 },
      storage: { retainSources: false },
    })
    expect(config.providers.map(provider => provider.type)).toEqual(['self-hosted-legacy-v2', 'official-v4', 'self-hosted-v1'])
    expect(config.providers[1]).toMatchObject({ baseURL: 'https://mineru.net/api/v4', models: ['pipeline', 'vlm'] })
    expect(config.providers[2]).toEqual({
      id: 'mp_self_hosted_v1', type: 'self-hosted-v1', baseURL: 'http://localhost:8000',
      apiKeyEnv: 'MINERU_API_KEY', allowInsecureHttp: true, ocrMode: 'auto',
    })
    expect(config.storage.storageRoot).toMatch(/[\\/]cache[\\/]pdf-mineru$/)
    expect(parseConfig(config)).toEqual(config)
  })
})

describe('MinerU config domain validation', () => {
  it.each<[string, () => unknown, RegExp]>([
    ['inline image budget below range', () => ({ ...base(), output: { ...base().output, maxInlineImages: -1 } }), /output.maxInlineImages/],
    ['inline image budget above range', () => ({ ...base(), output: { ...base().output, maxInlineImages: 101 } }), /output.maxInlineImages/],
    ['fractional inline image budget', () => ({ ...base(), output: { ...base().output, maxInlineImages: 1.5 } }), /output.maxInlineImages/],
    ['future schemaVersion', () => ({ ...base(), schemaVersion: 4 }), /unsupported schemaVersion/],
    ['zero schemaVersion', () => ({ ...base(), schemaVersion: 0 }), /unsupported schemaVersion/],
    ['string schemaVersion', () => ({ ...base(), schemaVersion: '3' }), /unsupported schemaVersion/],
    ['removed flat fields', () => ({ baseURL: 'http://mineru.local:18000/', apiKeyEnv: 'KEY', defaultBackend: 'hybrid-engine' }), /config contains unsupported property baseURL/],
    ['unknown provider property', () => ({ ...base(), providers: [{ ...legacy, unknownProviderKey: 'abc' }] }), /provider contains unsupported property unknownProviderKey/],
    ['unknown modelMap property', () => only({ ...legacy, modelMap: { ...legacy.modelMap, extraModel: 'x' } }), /modelMap contains unsupported property extraModel/],
    ['retained sources', () => ({ ...base(), storage: { ...base().storage, retainSources: true } }), /storage.retainSources must be false/],
    ['string retainSources', () => ({ ...base(), storage: { ...base().storage, retainSources: 'false' } }), /storage.retainSources must be false/],
    ['too many retry attempts', () => ({ ...base(), retry: { maxAttempts: 11, baseDelayMs: 500, maxDelayMs: 10000 } }), /retry.maxAttempts/],
    ['retry base delay above max delay', () => ({ ...base(), retry: { maxAttempts: 3, baseDelayMs: 2000, maxDelayMs: 1000 } }), /cannot exceed/],
    ['duplicate identities across types', () => ({ activeProvider: legacy.id, providers: [legacy, { ...v1, id: legacy.id }] }), /unique/],
    ['duplicate official identities', () => ({ activeProvider: 'mp_dup', providers: [{ id: 'mp_dup', type: 'official-v4' }, { id: 'mp_dup', type: 'official-v4' }] }), /unique/],
    ['official plain HTTP', () => only({ ...official, baseURL: 'http://mineru.example/v4' }), /HTTPS/],
    ['official model outside its models list', () => officialWith({ model: 'vlm', parseMethod: 'auto', ocr: false }, { models: ['pipeline'] }), /does not support defaults.model/],
    ['official txt parse method', () => officialWith({ model: 'pipeline', parseMethod: 'txt', ocr: false }), /cannot use txt/],
    ['txt parse method with OCR', () => officialWith({ parseMethod: 'txt', ocr: true }), /conflicts/],
    ['auto parse method with OCR', () => officialWith({ parseMethod: 'auto', ocr: true }), /conflicts/],
    ...(['fastest', '', 'STANDARD', 1, null, false] as const).map(tier =>
      ['V1 tier ' + JSON.stringify(tier), () => only({ ...v1, tier }), /provider.tier/] as [string, () => unknown, RegExp]),
    ...(['', 'text', 'OCR', false, 1, null] as const).map(ocrMode =>
      ['V1 ocrMode ' + JSON.stringify(ocrMode), () => only({ ...v1, ocrMode }), /provider.ocrMode/] as [string, () => unknown, RegExp]),
    ...([undefined, null, 1, '', 'unknown', ['self', 'hosted'].join('-')] as const).map(type =>
      ['provider type ' + JSON.stringify(type), () => ({ ...base(), providers: [{ ...legacy, type }] }), /provider.type/] as [string, () => unknown, RegExp]),
  ])('rejects %s', (_label, value, error) => {
    expect(() => parseConfig(value())).toThrow(error)
  })

  it.each(['defaults', 'storage', 'polling', 'retry', 'output', 'limits'] as const)('rejects unknown %s properties with their path', section => {
    expect(() => parseConfig({ ...base(), [section]: { ...base()[section], extraField: 1 } }))
      .toThrow(new RegExp(section + ' contains unsupported property extraField'))
  })

  it.each([
    ['self-hosted-v1', 'modelMap', { pipeline: 'pipeline', vlm: 'vlm-engine' }],
    ['self-hosted-v1', 'models', ['pipeline']],
    ['self-hosted-v1', 'parseMethod', 'txt'],
    ['self-hosted-v1', 'ocr', true],
    ['self-hosted-legacy-v2', 'tier', 'standard'],
    ['self-hosted-legacy-v2', 'ocrMode', 'auto'],
    ['self-hosted-legacy-v2', 'models', ['pipeline']],
    ['official-v4', 'tier', 'standard'],
    ['official-v4', 'ocrMode', 'auto'],
    ['official-v4', 'modelMap', { pipeline: 'pipeline', vlm: 'vlm-engine' }],
    ['official-v4', 'allowInsecureHttp', true],
  ] as const)('strictly rejects %s cross-type field %s even when undefined', (type, field, value) => {
    const provider = defaultProviderConfig(type)
    for (const invalid of [value, undefined]) {
      expect(() => parseConfig(only({ ...provider, [field]: invalid }))).toThrow('provider contains unsupported property ' + field)
    }
  })

  it.each(['self-hosted-v1', 'self-hosted-legacy-v2'] as const)('requires explicit HTTP opt-in for %s and rejects unsafe URL components', type => {
    const provider = defaultProviderConfig(type)
    const parse = (patch: Patch) => parseConfig(only({ ...provider, ...patch })).providers[0]
    expect(() => parse({ allowInsecureHttp: false })).toThrow(/HTTPS/)
    expect(() => parse({ allowInsecureHttp: undefined })).toThrow(/HTTPS/)
    expect(() => parse({ allowInsecureHttp: 'true' })).toThrow(/allowInsecureHttp/)
    expect(parse({ allowInsecureHttp: true })).toMatchObject({ baseURL: provider.baseURL })
    expect(parse({ baseURL: 'https://mineru.example/api/', allowInsecureHttp: false })).toMatchObject({ baseURL: 'https://mineru.example/api' })
    for (const baseURL of [
      'https://user:password@mineru.example', 'https://mineru.example?token=secret',
      'https://mineru.example#fragment', 'ftp://mineru.example', 'file:///tmp/mineru', 'not a url', '',
    ]) expect(() => parse({ baseURL, allowInsecureHttp: true })).toThrow()
  })
})

describe('MinerU config normalization', () => {
  it('defaults and bounds the inline image budget', () => {
    expect(parseConfig({ ...base(), output: { maxInlineChars: 200000 } }).output.maxInlineImages).toBe(6)
    for (const maxInlineImages of [0, 100]) {
      expect(parseConfig({ ...base(), output: { ...base().output, maxInlineImages } }).output.maxInlineImages).toBe(maxInlineImages)
    }
  })

  it('accepts all V1 tiers and OCR modes independently of shared defaults', () => {
    const shared = { model: 'vlm', language: 'en', parseMethod: 'ocr', ocr: true, formula: true, table: true }
    expect(parseConfig(only({ ...v1 })).providers[0]).not.toHaveProperty('tier')
    for (const tier of ['flash', 'basic', 'standard', 'advanced']) {
      expect(parseConfig(only({ ...v1, tier })).providers[0]).toMatchObject({ type: 'self-hosted-v1', tier })
    }
    for (const ocrMode of [undefined, 'auto', 'txt', 'ocr']) {
      const config = parseConfig(only({ id: 'mp_v1', type: 'self-hosted-v1', allowInsecureHttp: true, ocrMode }, { defaults: shared }))
      expect(config.providers[0]).toEqual({ id: 'mp_v1', type: 'self-hosted-v1', baseURL: 'http://localhost:8000', allowInsecureHttp: true, ocrMode: ocrMode ?? 'auto' })
      expect(config.defaults).toEqual(shared)
    }
  })

  it('fills official-v4 profile defaults and infers OCR/parseMethod truthfully', () => {
    const id = asProviderConfigId('mp_official')
    const config = parseConfig(officialWith({ model: 'vlm', parseMethod: 'ocr', ocr: true }, { apiKeyEnv: 'MINERU_CLOUD_TOKEN', models: ['pipeline', 'vlm'] }))
    expect(providerById(config, id)).toEqual({
      id, type: 'official-v4', baseURL: 'https://mineru.net/api/v4', apiKeyEnv: 'MINERU_CLOUD_TOKEN', models: ['pipeline', 'vlm'], configuredVersion: 'v4',
    })
    expect(parseConfig(officialWith({ ocr: true })).defaults).toMatchObject({ ocr: true, parseMethod: 'ocr' })
    expect(parseConfig(officialWith({ parseMethod: 'ocr' })).defaults).toMatchObject({ ocr: true, parseMethod: 'ocr' })
  })

  it('fills omitted retry settings with defaults', () => {
    expect(parseConfig({ ...base(), retry: undefined }).retry).toEqual(base().retry)
  })
})

describe('Standard Schema parity', () => {
  const snapshot = (value: unknown): unknown => {
    if (isVolatile(value)) return snapshot(value.get())
    if (Array.isArray(value)) return value.map(snapshot)
    if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, snapshot(child)]))
    return value
  }
  const unauthenticated: Patch = { ...legacy }
  delete unauthenticated.apiKeyEnv
  delete unauthenticated.configuredVersion
  const v1Variants = [undefined, 'flash', 'basic', 'standard', 'advanced'].flatMap(tier => [undefined, 'auto', 'txt', 'ocr'].map(ocrMode =>
    only({ id: 'mp_v1', type: 'self-hosted-v1', allowInsecureHttp: true, tier, ocrMode },
      { defaults: { model: 'vlm', language: 'ja', formula: true, table: true, parseMethod: 'txt', ocr: false } })))

  it.each<[string, unknown]>([
    ['default configuration', base()],
    ...base().providers.map(provider => ['single ' + provider.type + ' profile', { ...base(), activeProvider: provider.id, providers: [provider] }] as [string, unknown]),
    ['unauthenticated legacy profile', { ...base(), providers: [unauthenticated] }],
    ...v1Variants.map((value, index) => ['V1 tier/ocrMode variant ' + String(index), value] as [string, unknown]),
  ])('accepts %s with the same canonical value as the domain parser', async (_label, value) => {
    const validated = await Config['~standard'].validate(value)
    expect(validated.issues).toBeUndefined()
    if (validated.issues) throw new Error('Expected accepted configuration')
    expect(parseConfig(snapshot(validated.value))).toEqual(parseConfig(value))
  })

  it.each<[string, Patch]>([
    ['legacy tier', { ...legacy, tier: 'standard' }], ['legacy ocrMode', { ...legacy, ocrMode: 'auto' }],
    ['legacy undefined tier', { ...legacy, tier: undefined }], ['legacy undefined ocrMode', { ...legacy, ocrMode: undefined }],
    ['legacy models', { ...legacy, models: ['pipeline'] }],
    ['V1 modelMap', { ...v1, modelMap: { pipeline: 'pipeline', vlm: 'vlm-engine' } }], ['V1 undefined modelMap', { ...v1, modelMap: undefined }],
    ['V1 models', { ...v1, models: ['pipeline'] }], ['V1 invalid tier', { ...v1, tier: 'fastest' }], ['V1 invalid ocrMode', { ...v1, ocrMode: 'text' }],
    ['V1 parseMethod', { ...v1, parseMethod: 'txt' }], ['V1 ocr', { ...v1, ocr: true }],
    ['official tier', { ...official, tier: 'standard' }], ['official ocrMode', { ...official, ocrMode: 'auto' }],
    ['official modelMap', { ...official, modelMap: {} }], ['official HTTP opt-in', { ...official, allowInsecureHttp: true }],
    ['official plain HTTP', { ...official, baseURL: 'http://mineru.example' }],
    ['legacy without HTTP opt-in', { ...legacy, allowInsecureHttp: false }], ['V1 without HTTP opt-in', { ...v1, allowInsecureHttp: false }],
    ['V1 URL credentials', { ...v1, baseURL: 'https://user:secret@mineru.example' }], ['V1 URL query', { ...v1, baseURL: 'https://mineru.example?token=secret' }],
    ...[undefined, null, 1, '', 'unsupported', ['self', 'hosted'].join('-')].map(type => ['provider type ' + JSON.stringify(type), { ...v1, type }] as [string, Patch]),
  ])('rejects %s at both boundaries', async (_label, provider) => {
    const value = { ...base(), ...only(provider) }
    expect(() => parseConfig(value)).toThrow()
    const validated = await Config['~standard'].validate(value)
    expect(validated.issues?.length).toBeGreaterThan(0)
    expect(validated).not.toHaveProperty('value')
  })

  it.each<[string, unknown]>([
    ['duplicate identities', { ...base(), providers: [legacy, { ...v1, id: legacy.id }] }],
    ['future schemaVersion', { ...base(), schemaVersion: 4 }],
    ['retained sources', { ...base(), storage: { ...base().storage, retainSources: true } }],
  ])('rejects %s at both boundaries', async (_label, value) => {
    expect(() => parseConfig(value)).toThrow()
    expect((await Config['~standard'].validate(value)).issues?.length).toBeGreaterThan(0)
  })
})
