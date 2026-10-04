import { asProviderConfigId } from '../domain/ids.js'
import { defaultProviderConfig, type MinerUConfig, type ProviderConfig } from './pure.js'

/** Repairs values only while loading known historical versions. It never persists or resolves credentials. */
export function repairLegacyConfigValues(
  input: Record<string, unknown>,
  fallback: MinerUConfig,
  parseProvider: (value: unknown) => ProviderConfig,
  parseCanonical: (value: Record<string, unknown>, fallback: MinerUConfig) => MinerUConfig,
): { input: Record<string, unknown>; defaultedFields: readonly string[] } {
  const repaired = new Set<string>()
  const object = (value: unknown, path: string): Record<string, unknown> => {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>
    repaired.add(path)
    return {}
  }
  const validId = (value: unknown): string | undefined => {
    try { return typeof value === 'string' ? asProviderConfigId(value) : undefined } catch { return undefined }
  }
  const rawProviders = Array.isArray(input.providers) && input.providers.length > 0 ? input.providers : fallback.providers
  if (rawProviders !== input.providers) repaired.add('providers')
  const reserved = new Set(rawProviders.map(value => validId(value?.id)).filter((value): value is string => value !== undefined))
  const used = new Set<string>()
  const providers = rawProviders.map((value, index) => {
    const path = 'providers[' + index + ']'
    const raw = object(value, path)
    const oldType = raw.type === 'self-hosted-v2'
    const type = oldType ? 'self-hosted-legacy-v2'
      : typeof raw.type === 'string' && ['self-hosted-v1','self-hosted-legacy-v2','official-v4'].includes(raw.type) ? raw.type as ProviderConfig['type'] : 'self-hosted-legacy-v2'
    if (type !== raw.type && !oldType) repaired.add(path + '.type')
    const defaults = defaultProviderConfig(type)
    const rawId = validId(raw.id)
    let id = rawId
    if (id === undefined || used.has(id)) {
      id = defaults.id
      for (let suffix = 2; reserved.has(id) || used.has(id); suffix++) id = defaults.id + '_' + suffix
      repaired.add(path + '.id')
    }
    used.add(id)
    let provider: ProviderConfig = {...defaults, id: asProviderConfigId(id)}
    if (provider.type !== 'official-v4') {
      // Missing/invalid HTTP authorization is never interpreted as consent to plaintext.
      const allowInsecureHttp = typeof raw.allowInsecureHttp === 'boolean' ? raw.allowInsecureHttp : false
      if (typeof raw.allowInsecureHttp !== 'boolean') repaired.add(path + '.allowInsecureHttp')
      provider = {...provider, allowInsecureHttp, baseURL: allowInsecureHttp ? provider.baseURL : provider.baseURL.replace(/^http:/u, 'https:'), apiKeyEnv: undefined}
    }
    const allowed = new Set([...Object.keys(provider), 'configuredVersion', 'apiKeyEnv', ...(type === 'self-hosted-v1' || oldType ? ['tier'] : [])])
    for (const key of Object.keys(raw)) {
      if (!allowed.has(key)) throw new TypeError(path + ' contains unsupported property ' + key)
    }
    // Apply each known field through the canonical validator, never bypass its security rules.
    for (const key of ['baseURL','apiKeyEnv','configuredVersion','models','modelMap','tier','ocrMode'] as const) {
      if (!allowed.has(key) || (oldType && key === 'tier')) continue
      if (raw[key] === undefined) {
        if ((provider as unknown as Record<string, unknown>)[key] !== undefined) repaired.add(path + '.' + key)
        continue
      }
      let next = raw[key]
      if (key === 'modelMap' && provider.type === 'self-hosted-legacy-v2') {
        const map = object(next, path + '.modelMap')
        for (const name of Object.keys(map)) if (name !== 'pipeline' && name !== 'vlm') throw new TypeError('modelMap contains unsupported property ' + name)
        next = {...provider.modelMap}
        for (const name of ['pipeline','vlm'] as const) {
          if (typeof map[name] === 'string' && map[name].trim() !== '') (next as Record<string, unknown>)[name] = map[name]
          else repaired.add(path + '.modelMap.' + name)
        }
      }
      try { provider = parseProvider({...provider,[key]:next}) }
      catch { repaired.add(path + '.' + key) }
    }
    if (!oldType) return provider
    const tier = raw.tier
    const validTier = tier === undefined || tier === null || (typeof tier === 'string' && ['flash','basic','standard','advanced'].includes(tier))
    if (!validTier) repaired.add(path + '.tier')
    return {...provider,type:'self-hosted-v2', ...(Object.hasOwn(raw,'tier') ? {tier:validTier ? tier : undefined} : {})}
  })
  const canonicalProviders = providers.map(provider => {
    if (provider.type !== 'self-hosted-v2') return parseProvider(provider)
    const { tier: _tier, ...legacy } = provider
    return parseProvider({...legacy,type:'self-hosted-legacy-v2'})
  })
  let active = typeof input.activeProvider === 'string' && used.has(input.activeProvider) ? input.activeProvider : undefined
  if (active === undefined) { active = used.has(fallback.activeProvider) ? fallback.activeProvider : canonicalProviders[0]!.id; repaired.add('activeProvider') }
  const selected = canonicalProviders.find(provider => provider.id === active)!
  let canonical: MinerUConfig = {...fallback, providers:canonicalProviders, activeProvider:asProviderConfigId(active)}
  if (selected.type === 'official-v4' && !selected.models.includes(canonical.defaults.model)) canonical = {...canonical,defaults:{...canonical.defaults,model:selected.models[0]!}}
  const output: Record<string, unknown> = {...input,providers,activeProvider:active}
  for (const section of ['defaults','storage','polling','retry','output','limits'] as const) {
    const raw = object(input[section],section)
    const sectionDefaults = canonical[section]
    const allowed = new Set(Object.keys(sectionDefaults))
    for (const key of Object.keys(raw)) {
      if ((section === 'defaults' && key === 'artifacts') || (section === 'limits' && key === 'maxFilesPerRequest')) continue
      if (!allowed.has(key)) throw new TypeError(section + ' contains unsupported property ' + key)
    }
    const values: Record<string, unknown> = {...raw}
    if (section === 'defaults') {
      let method = raw.parseMethod === undefined && raw.ocr === true ? 'ocr' : raw.parseMethod === undefined ? canonical.defaults.parseMethod : raw.parseMethod
      if ((typeof method !== 'string' || !['auto','txt','ocr'].includes(method)) || (selected.type === 'official-v4' && method === 'txt')) { method = 'auto'; repaired.add('defaults.parseMethod') }
      if (raw.ocr !== undefined && raw.ocr !== (method === 'ocr')) repaired.add('defaults.ocr')
      canonical = {...canonical, defaults:{...canonical.defaults,parseMethod:method as 'auto'|'txt'|'ocr',ocr:method === 'ocr'}}
    }
    const proposed = {...canonical[section], ...Object.fromEntries(Object.entries(raw).filter(([key,value]) => allowed.has(key) && value !== undefined))}
    if (section === 'defaults') Object.assign(proposed,{parseMethod:canonical.defaults.parseMethod,ocr:canonical.defaults.ocr})
    let validSection = false
    try { canonical = parseCanonical({...canonical,[section]:proposed},fallback); validSection = true } catch { /* Repair fields independently below. */ }
    const accepted: Record<string, unknown> = {...canonical[section]}
    for (const key of allowed) {
      if (section === 'defaults' && (key === 'parseMethod' || key === 'ocr')) continue
      if (raw[key] === undefined) { repaired.add(section + '.' + key); continue }
      if (validSection) continue
      const candidate: Record<string, unknown> = {...canonical[section],[key]:raw[key]}
      // Neutralize only the partner in coupled numeric constraints during per-field
      // validation. These temporary bounds are never returned or persisted.
      if (typeof raw[key] === 'number') {
        if (section === 'retry' && key === 'baseDelayMs') candidate.maxDelayMs = Math.max(canonical.retry.maxDelayMs,raw[key])
        if (section === 'retry' && key === 'maxDelayMs') candidate.baseDelayMs = Math.min(canonical.retry.baseDelayMs,raw[key])
        if (section === 'limits' && key === 'maxZipEntryBytes') candidate.maxZipTotalBytes = Math.max(canonical.limits.maxZipTotalBytes,raw[key])
        if (section === 'limits' && key === 'maxZipTotalBytes') candidate.maxZipEntryBytes = Math.min(canonical.limits.maxZipEntryBytes,raw[key])
      }
      try { accepted[key] = (parseCanonical({...canonical,[section]:candidate},fallback)[section] as unknown as Record<string, unknown>)[key] }
      catch { repaired.add(section + '.' + key) }
    }
    if (!validSection) {
      const pair = section === 'retry' ? ['baseDelayMs','maxDelayMs'] : section === 'limits' ? ['maxZipEntryBytes','maxZipTotalBytes'] : undefined
      if (pair && (accepted[pair[0]!] as number) > (accepted[pair[1]!] as number)) {
        for (const key of pair) { accepted[key] = (fallback[section] as unknown as Record<string, unknown>)[key]; repaired.add(section + '.' + key) }
      }
      canonical = parseCanonical({...canonical,[section]:accepted},fallback)
    }
    Object.assign(values,canonical[section])
    // These removed schema-1 fields cannot affect current execution, even if malformed.
    if (section === 'defaults' && Object.hasOwn(raw,'artifacts')) { values.artifacts = []; repaired.add('defaults.artifacts') }
    if (section === 'limits' && Object.hasOwn(raw,'maxFilesPerRequest')) { values.maxFilesPerRequest = 1; repaired.add('limits.maxFilesPerRequest') }
    output[section] = values
  }
  return {input:output,defaultedFields:[...repaired]}
}
