import { describe, expect, it } from 'vitest'
import { isVolatile } from '@deepseek-ai/cosmokit'
import { Config } from '../src/index.js'
import { defaultMinerUConfig, parseConfig, parseConfigWithMigration } from '../src/config.js'

function oldConfig(schemaVersion?: number, tier?: unknown) {
  const base = defaultMinerUConfig()
  const first = { ...base.providers[0], id: 'mp_existing', type: 'self-hosted-v2',
    baseURL: 'https://mineru.example/old', apiKeyEnv: 'PRIVATE_MINERU_KEY',
    configuredVersion: '3.4.5-custom', modelMap: { pipeline: 'pipeline', vlm: 'hybrid-engine' },
    ...(tier === undefined ? {} : { tier }) }
  return { ...base, schemaVersion, activeProvider: first.id, providers: [first, ...base.providers.slice(1)],
    defaults: { ...base.defaults, model: 'vlm' as const, parseMethod: 'txt' as const, ocr: false, language: 'ja' },
    ...(schemaVersion === 1 ? {
      defaults: { ...base.defaults, model: 'vlm' as const, parseMethod: 'txt' as const, ocr: false, language: 'ja', artifacts: ['markdown'] },
      limits: { ...base.limits, maxFilesPerRequest: 1 },
    } : {}),
  }
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value)) freeze(child)
  }
  return value
}
function snapshot(value: unknown): unknown {
  if (isVolatile(value)) return snapshot(value.get())
  if (Array.isArray(value)) return value.map(snapshot)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item)]))
  return value
}

describe('self-hosted provider configuration migration', () => {
  it.each([undefined, 1, 2])('migrates schema %s without changing identity or mutating input', version => {
    const input = freeze(oldConfig(version))
    const parsed = parseConfigWithMigration(input)
    expect(parsed.migrated).toBe(true)
    expect(parsed.migratedFrom).toBe(version === 1 ? 1 : 2)
    expect(parsed.assumedVersion).toBe(version === undefined ? 2 : undefined)
    expect(parsed.migrationSteps).toEqual(version === 1 ? [{from:1,to:2},{from:2,to:3}] : [{from:2,to:3}])
    expect(parsed.providerMigrations).toEqual([{providerId:'mp_existing',from:'self-hosted-v2',to:'self-hosted-legacy-v2',removedFields:[]}])
    expect(parsed.config.schemaVersion).toBe(3)
    expect(parsed.config.activeProvider).toBe('mp_existing')
    expect(parsed.config.providers[0]).toEqual({...input.providers[0],type:'self-hosted-legacy-v2'})
    expect(parsed.config.providers.slice(1)).toEqual(input.providers.slice(1))
    expect(parsed.config.defaults).toMatchObject({model:'vlm',parseMethod:'txt',ocr:false,language:'ja'})
    expect(parsed.config.defaults).not.toHaveProperty('artifacts')
    expect(parsed.config.limits).not.toHaveProperty('maxFilesPerRequest')
    for (const section of ['storage','polling','retry','output'] as const) expect(parsed.config[section]).toEqual(input[section])
    expect(input.providers[0]!.type).toBe('self-hosted-v2')
    expect(parseConfig(parsed.config)).toEqual(parsed.config)
    expect(parseConfigWithMigration(parsed.config)).toEqual({config:parsed.config,migrated:false})
  })

  it.each(['flash','basic','standard','advanced',null,undefined])('validates and removes old mixed tier %s', tier => {
    const input = oldConfig(2)
    Object.assign(input.providers[0]!, {tier})
    const parsed = parseConfigWithMigration(freeze(input))
    expect(parsed.config.providers[0]).not.toHaveProperty('tier')
    expect(parsed.config.providers[0]?.type).toBe('self-hosted-legacy-v2')
    expect(parsed.providerMigrations?.[0]?.removedFields).toEqual(['tier'])
    expect(input.providers[0]).toHaveProperty('tier',tier)
  })

  it('migrates inactive old profiles without selecting a different provider or changing order', () => {
    const input = oldConfig()
    const other = {...input.providers[0],id:'mp_secondary'}
    input.providers.push(other)
    input.activeProvider = 'mp_official'
    const parsed = parseConfigWithMigration(input)
    expect(parsed.config.activeProvider).toBe('mp_official')
    expect(parsed.config.defaults.parseMethod).toBe('auto')
    expect(parsed.config.providers.map(p=>p.id)).toEqual(input.providers.map(p=>p.id))
    expect(parsed.providerMigrations?.map(m=>m.providerId)).toEqual(['mp_existing','mp_secondary'])
  })

  it('composes type migration with v1 fields merged over a current schema base', () => {
    const input = {...oldConfig(),defaults:{...oldConfig().defaults,artifacts:['markdown']}}
    expect(parseConfigWithMigration(input)).toMatchObject({migrated:true,config:{schemaVersion:3,providers:[{type:'self-hosted-legacy-v2'},{type:'official-v4'},{type:'self-hosted-v1'}]}})
    expect(() => parseConfig(input)).toThrow()
  })

  it.each([
    {ocrMode:'auto'}, {models:['pipeline']}, {apiKey:'do-not-store'},
  ])('does not hide malformed or unsupported old fields: %j', patch => {
    const input = oldConfig()
    Object.assign(input.providers[0]!,patch)
    expect(() => parseConfigWithMigration(input)).toThrow()
    expect(() => parseConfig(input)).toThrow()
  })

  it.each([0,4,99])('does not migrate unsupported schema version %s', version => {
    expect(() => parseConfigWithMigration(oldConfig(version))).toThrow(/schemaVersion/)
  })

  it('does not reinterpret retired provider types in the current version', () => {
    expect(() => parseConfigWithMigration({...oldConfig(),schemaVersion:3})).toThrow(/provider.type/)
    const current = defaultMinerUConfig()
    expect(parseConfigWithMigration(current)).toEqual({config:current,migrated:false})
  })

  it('defaults unsupported legacy values while preserving valid values and security opt-in', () => {
    const input = oldConfig(2,'fastest')
    Object.assign(input.providers[0]!, {apiKeyEnv:'invalid ref',baseURL:'http://example.com',allowInsecureHttp:false,modelMap:{pipeline:'custom-pipeline',vlm:123}})
    const damaged = {...input, defaults:{...input.defaults,model:'unknown',formula:'yes',language:'de'},
      output:{maxInlineChars:-1,maxInlineImages:8}, retry:{maxAttempts:0,baseDelayMs:1000,maxDelayMs:20000},
      storage:{...input.storage,retainSources:true},limits:{...input.limits,maxZipEntryBytes:-10}}
    const parsed = parseConfigWithMigration(freeze(damaged))
    expect(parsed.config.providers[0]).toMatchObject({type:'self-hosted-legacy-v2',allowInsecureHttp:false,baseURL:'https://localhost:18000',modelMap:{pipeline:'custom-pipeline',vlm:'vlm-engine'}})
    expect(parsed.config.providers[0]?.apiKeyEnv).toBeUndefined()
    expect(parsed.config.providers[0]).not.toHaveProperty('tier')
    expect(parsed.config.defaults).toMatchObject({model:'pipeline',formula:true,language:'de'})
    expect(parsed.config.output).toEqual({maxInlineChars:12000,maxInlineImages:8})
    expect(parsed.config.retry).toEqual({maxAttempts:3,baseDelayMs:1000,maxDelayMs:20000})
    expect(parsed.config.storage.retainSources).toBe(false)
    expect(parsed.defaultedFields).toContain('providers[0].tier')
    expect(JSON.stringify(parsed.defaultedFields)).not.toContain('example.com')
    expect(parseConfigWithMigration(parsed.config)).toEqual({config:parsed.config,migrated:false})
    expect(() => parseConfig(damaged)).toThrow()
  })

  it('fills missing fields and repairs bad provider IDs without collisions', () => {
    const parsed = parseConfigWithMigration({schemaVersion:2,activeProvider:'mp_missing',providers:[
      {id:'mp_existing',type:'self-hosted-v2',allowInsecureHttp:true},
      {id:'mp_existing',type:'self-hosted-v2',allowInsecureHttp:true},
      {id:'mp_self_hosted',type:'official-v4'},
    ]})
    expect(parsed.config.providers.map(provider=>provider.id)).toEqual(['mp_existing','mp_self_hosted_2','mp_self_hosted'])
    expect(parsed.config.activeProvider).toBe('mp_self_hosted')
    expect(parsed.config.providers[0]).toMatchObject({baseURL:'http://localhost:18000',modelMap:{pipeline:'pipeline',vlm:'vlm-engine'}})
    expect(parsed.config.defaults).toEqual(defaultMinerUConfig().defaults)
    expect(parsed.defaultedFields).toContain('providers[1].id')
  })

  it('preserves valid coupled values even when another field in the section is invalid', () => {
    const parsed = parseConfigWithMigration({...oldConfig(2),retry:{maxAttempts:'bad',baseDelayMs:20000,maxDelayMs:30000},
      limits:{maxFileBytes:'bad',maxZipEntryBytes:3*1024**3,maxZipTotalBytes:4*1024**3}})
    expect(parsed.config.retry).toEqual({maxAttempts:3,baseDelayMs:20000,maxDelayMs:30000})
    expect(parsed.config.limits).toMatchObject({maxZipEntryBytes:3*1024**3,maxZipTotalBytes:4*1024**3})
    expect(parsed.defaultedFields).not.toContain('retry.baseDelayMs')
    expect(parsed.defaultedFields).not.toContain('limits.maxZipEntryBytes')
  })

  it('resets conflicting numeric pairs to compatible defaults', () => {
    const parsed = parseConfigWithMigration({...oldConfig(2),retry:{maxAttempts:5,baseDelayMs:50000,maxDelayMs:1},
      limits:{maxZipEntryBytes:4000,maxZipTotalBytes:1000}})
    expect(parsed.config.retry).toEqual({...defaultMinerUConfig().retry,maxAttempts:5})
    expect(parsed.config.limits).toEqual(defaultMinerUConfig().limits)
  })

  it('keeps current-version edits strict instead of repairing them silently', () => {
    const current = defaultMinerUConfig()
    expect(() => parseConfigWithMigration({...current,output:{...current.output,maxInlineImages:999}})).toThrow()
  })

  it('still rejects unknown types, missing active IDs and duplicate IDs', () => {
    const input = {...oldConfig(),schemaVersion:3}
    expect(() => parseConfig({...input,providers:[{...input.providers[0],type:'self-hosted'}]})).toThrow(/provider.type/)
    expect(() => parseConfig({...input,activeProvider:'mp_missing'})).toThrow()
    expect(() => parseConfig({...input,providers:[input.providers[0],input.providers[0]]})).toThrow()
  })

  it('feeds canonical data into the native discriminator and remains idempotent', async () => {
    for (const version of [undefined,1,2]) {
      const input = freeze(oldConfig(version,'standard'))
      const result = await Config['~standard'].validate(input)
      expect(result.issues).toBeUndefined()
      if (result.issues) throw new Error('migration failed')
      const value = snapshot(result.value)
      expect(parseConfig(value)).toEqual(parseConfigWithMigration(input).config)
      expect(parseConfigWithMigration(value).migrated).toBe(false)
      expect(input.providers[0]!.type).toBe('self-hosted-v2')
    }
  })
})
