import { describe, expect, it, vi } from 'vitest'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import {
  activateProvider,
  activeProviderOf,
  clearCredential,
  credentialReference,
  describeCredential,
  ensureProviderProfiles,
  formatBytes,
  hasAdvancedDefaults,
  orderedProviders,
  patchActiveProvider,
  resetAdvancedSettings,
  resetConfigSection,
  storeCredential,
  structurallyEqual,
  toggleOfficialModel,
  type CredentialClient,
} from '../src/client/helpers.js'
import { en, zh } from '../src/client/locales.js'
import {
  cacheClearConfirmRequest,
  cacheClearPreviewRequest,
  isPartialStatistics,
  quarantineConfirmRequest,
  quarantinePreviewRequest,
  toggleSelection,
} from '../src/client/maintenance.js'
import {
  currentProbe,
  probeKey,
  removeCredential,
  runProbe,
  saveSettings,
  type MutationContext,
  type ProbeResult,
} from '../src/client/settings-operations.js'
import {
  actionBarMode,
  initialSettingsState,
  isDirty,
  pendingKeys,
  savePayload,
  settingsReducer,
  visibleAdjustments,
  type SettingsAction,
  type SettingsState,
} from '../src/client/settings-state.js'
import { formatNumber, NUMBER_FIELDS, parseNumber, readNumber, writeNumber } from '../src/client/units.js'
import { defaultMinerUConfig, parseConfig } from '../src/config/parse.js'
import {
  DEFAULT_OUTPUT_CONFIG,
  DEFAULT_POLLING_CONFIG,
  DEFAULT_RETRY_CONFIG,
  defaultProviderConfig,
  type MinerUConfig,
} from '../src/config/model.js'
import type { CacheClearReport, QuarantineCleanupReport } from '../src/contracts/maintenance.js'
import { asProviderConfigId } from '../src/domain/ids.js'

const LEGACY = defaultProviderConfig('self-hosted-legacy-v2').id
const OFFICIAL = defaultProviderConfig('official-v4').id
const V1 = defaultProviderConfig('self-hosted-v1').id

function loaded(config: MinerUConfig = defaultMinerUConfig(), revision: number | null = 7): SettingsState {
  return initialSettingsState({ config, revision })
}

function run(state: SettingsState, ...actions: SettingsAction[]): SettingsState {
  return actions.reduce<SettingsState>((current, action) => settingsReducer(current, action)!, state)
}

const edit = (update: (config: MinerUConfig) => MinerUConfig): SettingsAction => ({ type: 'edit', update })

describe('settings localization', () => {
  it('has the same non-empty keys in English and Chinese', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
    for (const dictionary of [en, zh]) {
      for (const [key, value] of Object.entries(dictionary)) expect(value.trim(), key).not.toBe('')
    }
  })

  it('uses the same interpolation parameters in both languages', () => {
    const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()
    for (const key of Object.keys(en) as (keyof typeof en)[]) expect(params(zh[key]), key).toEqual(params(en[key]))
  })
})

describe('draft and dirty state', () => {
  it('starts clean, completes missing profiles, and hides the action bar', () => {
    const base = defaultMinerUConfig()
    const state = loaded({ ...base, providers: [base.providers[0]!] })
    expect(state.draft.providers.map(provider => provider.type)).toEqual(['self-hosted-legacy-v2', 'self-hosted-v1', 'official-v4'])
    expect(isDirty(state)).toBe(false)
    expect(actionBarMode(state)).toBe('hidden')
  })

  it('compares drafts structurally, so reverting an edit makes the draft clean again', () => {
    const state = loaded()
    const edited = run(state, edit(config => patchActiveProvider(config, { baseURL: 'http://gpu:18000' })))
    expect(isDirty(edited)).toBe(true)
    expect(actionBarMode(edited)).toBe('dirty')
    const reverted = run(edited, edit(config => patchActiveProvider(config, { baseURL: 'http://localhost:18000' })))
    expect(reverted.draft).not.toBe(reverted.saved)
    expect(isDirty(reverted)).toBe(false)
  })

  it('treats an optional field set to undefined as equal to an absent one', () => {
    expect(structurallyEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true)
    expect(structurallyEqual({ list: [1, 2] }, { list: [2, 1] })).toBe(false)
    const state = run(loaded(), { type: 'activate', providerId: V1 }, edit(config => patchActiveProvider(config, { tier: undefined })))
    expect(state.draft.providers.find(provider => provider.id === V1)).toHaveProperty('tier', undefined)
    expect(isDirty(run(state, { type: 'activate', providerId: LEGACY }))).toBe(false)
  })

  it('counts a typed API key as an unsaved change but never puts it in the config draft', () => {
    const state = run(loaded(), { type: 'keyDraft', reference: 'MINERU_API_KEY', value: '  secret  ' })
    expect(isDirty(state)).toBe(true)
    expect(pendingKeys(state)).toEqual([{ reference: 'MINERU_API_KEY', value: 'secret' }])
    expect(JSON.stringify(savePayload(state))).not.toContain('secret')
    expect(isDirty(run(state, { type: 'keyDraft', reference: 'MINERU_API_KEY', value: '   ' }))).toBe(false)
  })

  it('discard restores the saved config and drops key drafts and notices', () => {
    const state = run(loaded(),
      edit(config => ({ ...config, defaults: { ...config.defaults, parseMethod: 'txt' } })),
      { type: 'activate', providerId: OFFICIAL },
      { type: 'keyDraft', reference: 'MINERU_API_KEY', value: 'k' },
      { type: 'discard' })
    expect(state.draft).toBe(state.saved)
    expect(state.keyDrafts).toEqual({})
    expect(state.adjustments).toEqual([])
    expect(actionBarMode(state)).toBe('hidden')
  })
})

describe('save and conflicts', () => {
  it('sends the complete draft bound to the loaded revision', () => {
    const state = run(loaded(undefined, 7), edit(config => patchActiveProvider(config, { baseURL: 'http://gpu:1' })))
    expect(savePayload(state)).toEqual({ config: state.draft, expected_revision: 7 })
    expect(savePayload(loaded(undefined, null))).not.toHaveProperty('expected_revision')
  })

  it('adopts the stored config and revision, then shows a transient saved notice', () => {
    const draft = run(loaded(), edit(config => patchActiveProvider(config, { baseURL: 'http://gpu:1' })),
      { type: 'keyDraft', reference: 'MINERU_API_KEY', value: 'k' }, { type: 'saveStarted' })
    expect(actionBarMode(draft)).toBe('saving')
    const stored = parseConfig(draft.draft)
    const saved = run(draft,
      { type: 'configSaved', response: { config: stored, revision: 8 }, submitted: draft.draft },
      { type: 'keysStored', keys: [{ reference: 'MINERU_API_KEY', value: 'k' }] })
    expect(saved.revision).toBe(8)
    expect(saved.draft).toBe(saved.saved)
    expect(isDirty(saved)).toBe(false)
    expect(actionBarMode(saved)).toBe('saved')
    expect(actionBarMode(run(saved, { type: 'savedNoticeExpired' }))).toBe('hidden')
    expect(savePayload(run(saved, edit(config => resetConfigSection(config, 'retry'))))).toMatchObject({ expected_revision: 8 })
  })

  it('keeps edits made while a save was in flight', () => {
    const before = run(loaded(), edit(config => patchActiveProvider(config, { baseURL: 'http://a' })), { type: 'saveStarted' })
    const during = run(before, edit(config => patchActiveProvider(config, { baseURL: 'http://b' })))
    const after = run(during, { type: 'configSaved', response: { config: before.draft, revision: 8 }, submitted: before.draft })
    expect(after.saved.providers[0]!.baseURL).toBe('http://a')
    expect(after.draft.providers[0]!.baseURL).toBe('http://b')
    expect(isDirty(after)).toBe(true)
  })

  it('reports a revision conflict separately from other failures and survives further edits', () => {
    const dirty = run(loaded(), edit(config => patchActiveProvider(config, { baseURL: 'http://gpu:1' })), { type: 'saveStarted' })
    const conflict = run(dirty, { type: 'saveFailed', error: Object.assign(new Error('stale'), { code: 'mineru/conflict' }) })
    expect(conflict.status).toEqual({ kind: 'conflict' })
    expect(actionBarMode(run(conflict, edit(config => patchActiveProvider(config, { baseURL: 'http://x' }))))).toBe('conflict')
    const failed = run(dirty, { type: 'saveFailed', error: new Error('disk full') })
    expect(failed.status).toEqual({ kind: 'error', message: 'disk full' })
    expect(actionBarMode(failed)).toBe('error')
  })

  it('reload after a conflict replaces everything stale with the stored settings', () => {
    const stale = run(loaded(), edit(config => patchActiveProvider(config, { baseURL: 'http://stale' })),
      { type: 'keyDraft', reference: 'MINERU_API_KEY', value: 'k' },
      { type: 'saveFailed', error: { code: 'mineru/conflict' } })
    const latest = patchActiveProvider(defaultMinerUConfig(), { baseURL: 'http://elsewhere' })
    const reloaded = settingsReducer(stale, { type: 'loaded', response: { config: latest, revision: 9 } })!
    expect(reloaded.draft.providers[0]!.baseURL).toBe('http://elsewhere')
    expect(reloaded.revision).toBe(9)
    expect(reloaded.keyDrafts).toEqual({})
    expect(actionBarMode(reloaded)).toBe('hidden')
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(settle => { resolve = settle })
  return { promise, resolve }
}

const OK = { ok: true as const, value: undefined }

/** Drives the real save/remove operations against the reducer with a fake transport. */
function harness(initial: SettingsState, call: (endpoint: string) => Promise<unknown>, credentials: CredentialClient) {
  let state = initial
  let generation = 0
  const context: MutationContext = {
    rpc: { call: (_channel: string, endpoint: string) => call(endpoint) } as unknown as ClientConnectionRpc,
    credentials,
    dispatch: action => { state = settingsReducer(state, action)! },
    lock: { current: undefined },
    lockChanged: vi.fn(),
    credentialsChanged: () => { generation++ },
    credentialFailed: vi.fn(),
  }
  return { context, get state() { return state }, get generation() { return generation } }
}

describe('credential races', () => {
  const keyDraft = (value: string): SettingsAction => ({ type: 'keyDraft', reference: 'MINERU_API_KEY', value })

  it('keeps a key typed while the save that stores the previous one is in flight', async () => {
    const configSet = deferred<unknown>()
    const set = vi.fn(async () => OK)
    const h = harness(run(loaded(), keyDraft('A')), () => configSet.promise, { describe: vi.fn(), set, unset: vi.fn() })
    const saving = saveSettings(h.context, h.state)
    h.context.dispatch(keyDraft('B'))
    configSet.resolve({ ok: true, value: { config: h.state.draft, revision: 8 } })
    await saving
    expect(set).toHaveBeenCalledWith('MINERU_API_KEY', 'A')
    expect(h.state.keyDrafts).toEqual({ MINERU_API_KEY: 'B' })
    expect(isDirty(h.state)).toBe(true)
    expect(actionBarMode(h.state)).toBe('dirty')
  })

  it('refuses key removal and a second save while a save is pending', async () => {
    const configSet = deferred<unknown>()
    const call = vi.fn(() => configSet.promise)
    const set = vi.fn(async () => OK)
    const unset = vi.fn(async () => OK)
    const h = harness(run(loaded(), keyDraft('A')), call, { describe: vi.fn(), set, unset })
    const saving = saveSettings(h.context, h.state)
    expect(h.context.lockChanged).toHaveBeenLastCalledWith('save')
    await removeCredential(h.context, 'MINERU_API_KEY')
    await saveSettings(h.context, h.state)
    expect(unset).not.toHaveBeenCalled()
    expect(call).toHaveBeenCalledTimes(1)
    configSet.resolve({ ok: true, value: { config: h.state.draft, revision: 8 } })
    await saving
    expect(set).toHaveBeenCalledWith('MINERU_API_KEY', 'A')
    expect(h.generation).toBe(1)
    expect(h.context.lock.current).toBeUndefined()
    expect(h.context.lockChanged).toHaveBeenLastCalledWith(undefined)
  })

  it('refuses a save while a key removal is pending', async () => {
    const unsetResult = deferred<typeof OK>()
    const call = vi.fn()
    const set = vi.fn(async () => OK)
    const dirty = run(loaded(), edit(config => patchActiveProvider(config, { baseURL: 'http://gpu:1' })), keyDraft('A'))
    const h = harness(dirty, call, { describe: vi.fn(), set, unset: () => unsetResult.promise })
    const removing = removeCredential(h.context, 'MINERU_API_KEY')
    expect(h.context.lock.current).toBe('remove')
    await saveSettings(h.context, h.state)
    expect(call).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
    unsetResult.resolve(OK)
    await removing
    expect(h.generation).toBe(1)
    expect(h.context.lock.current).toBeUndefined()
  })

  it('binds connection tests to the credential generation so a replaced key never shows an old result', async () => {
    const provider = activeProviderOf(loaded().draft)!
    const responses = [deferred<unknown>(), deferred<unknown>()]
    let calls = 0
    const rpc = { call: () => responses[calls++]!.promise } as unknown as ClientConnectionRpc
    const connected = { ok: true, value: { available: true, provider: 'self-hosted-legacy-v2', authentication: 'valid', protocol_version: '2' } }
    let result: ProbeResult | undefined
    const publish = (next: ProbeResult) => { result = next }
    const sequence = { current: 0 }

    const tested = runProbe(rpc, provider, probeKey(provider, 0), sequence, publish)
    responses[0]!.resolve(connected)
    await tested
    expect(currentProbe(result, probeKey(provider, 0))).toMatchObject({ kind: 'done' })
    // Replacing the stored key keeps it "configured" but advances the generation.
    expect(currentProbe(result, probeKey(provider, 1))).toEqual({ kind: 'idle' })

    const inFlight = runProbe(rpc, provider, probeKey(provider, 1), sequence, publish)
    // The key is replaced again before the response arrives.
    responses[1]!.resolve(connected)
    await inFlight
    expect(currentProbe(result, probeKey(provider, 2))).toEqual({ kind: 'idle' })
  })
})

describe('provider switching', () => {
  const txtLegacy = (): SettingsState => run(loaded(), edit(config => ({ ...config, defaults: { ...config.defaults, parseMethod: 'txt' } })))

  it('normalizes txt to auto for the cloud and scopes the notice to that provider', () => {
    const cloud = run(txtLegacy(), { type: 'activate', providerId: OFFICIAL })
    expect(cloud.draft.defaults.parseMethod).toBe('auto')
    expect(visibleAdjustments(cloud)).toEqual(['parseMethod'])
    const back = run(cloud, { type: 'activate', providerId: LEGACY })
    expect(visibleAdjustments(back)).toEqual([])
    expect(back.draft.defaults.parseMethod).toBe('auto')
  })

  it('drops the notice once the user picks another value', () => {
    const cloud = run(txtLegacy(), { type: 'activate', providerId: OFFICIAL },
      edit(config => ({ ...config, defaults: { ...config.defaults, parseMethod: 'ocr', ocr: true } })))
    expect(visibleAdjustments(cloud)).toEqual([])
  })

  it('leaves shared defaults untouched when switching to V1', () => {
    const legacy = txtLegacy()
    const v1 = run(legacy, { type: 'activate', providerId: V1 })
    expect(v1.draft.defaults).toBe(legacy.draft.defaults)
    expect(visibleAdjustments(v1)).toEqual([])
  })

  it('keeps each profile draft independent across switches', () => {
    const state = run(loaded(),
      edit(config => patchActiveProvider(config, { baseURL: 'http://legacy' })),
      { type: 'activate', providerId: V1 },
      edit(config => patchActiveProvider(config, { baseURL: 'http://v1', ocrMode: 'ocr', tier: 'advanced' })),
      { type: 'activate', providerId: LEGACY })
    const byId = Object.fromEntries(state.draft.providers.map(provider => [provider.id, provider]))
    expect(byId[LEGACY]!.baseURL).toBe('http://legacy')
    expect(byId[V1]).toMatchObject({ baseURL: 'http://v1', ocrMode: 'ocr', tier: 'advanced' })
    expect(parseConfig(state.draft)).toEqual(state.draft)
  })

  it('orders profiles cloud, 4.x, 3.x regardless of storage order', () => {
    expect(orderedProviders(loaded().draft).map(provider => provider.type)).toEqual(['official-v4', 'self-hosted-v1', 'self-hosted-legacy-v2'])
  })

  it('keeps at least one cloud model and moves the default off a disabled one', () => {
    const cloud = activateProvider(defaultMinerUConfig(), OFFICIAL)
    const vlmOnly = toggleOfficialModel(cloud, 'pipeline')
    expect(vlmOnly.providers.find(provider => provider.id === OFFICIAL)).toMatchObject({ models: ['vlm'] })
    expect(vlmOnly.defaults.model).toBe('vlm')
    expect(toggleOfficialModel(vlmOnly, 'vlm')).toBe(vlmOnly)
    expect(toggleOfficialModel(vlmOnly, 'pipeline').providers.find(provider => provider.id === OFFICIAL)).toMatchObject({ models: ['pipeline', 'vlm'] })
    expect(parseConfig(vlmOnly)).toEqual(vlmOnly)
  })

  it('ensures missing profiles with unique ids and is idempotent', () => {
    const base = defaultMinerUConfig()
    const official = { ...base.providers[1]!, id: asProviderConfigId('mp_self_hosted') }
    const completed = ensureProviderProfiles({ ...base, activeProvider: official.id, providers: [official] })
    expect(completed.providers.map(provider => provider.id)).toEqual(['mp_self_hosted', 'mp_self_hosted_v1', 'mp_self_hosted_2'])
    expect(ensureProviderProfiles(completed)).toBe(completed)
    expect(parseConfig(completed)).toEqual(completed)
  })
})

describe('advanced defaults and section resets', () => {
  it('restores only polling, retry and output', () => {
    const base = defaultMinerUConfig()
    const edited = {
      ...patchActiveProvider(base, { baseURL: 'http://keep' }),
      polling: { ...base.polling, pollIntervalMs: 9000 },
      retry: { ...base.retry, maxAttempts: 9 },
      output: { ...base.output, maxInlineImages: 1 },
      storage: { ...base.storage, cacheEnabled: false },
    }
    expect(hasAdvancedDefaults(edited)).toBe(false)
    const reset = resetAdvancedSettings(edited)
    expect(reset.polling).toEqual(DEFAULT_POLLING_CONFIG)
    expect(reset.retry).toEqual(DEFAULT_RETRY_CONFIG)
    expect(reset.output).toEqual(DEFAULT_OUTPUT_CONFIG)
    expect(reset.storage.cacheEnabled).toBe(false)
    expect(reset.providers[0]!.baseURL).toBe('http://keep')
    expect(hasAdvancedDefaults(reset)).toBe(true)
  })

  it('resets V1 parsing to its own OCR mode without touching shared defaults', () => {
    const v1 = patchActiveProvider(activateProvider(defaultMinerUConfig(), V1), { ocrMode: 'txt', tier: 'advanced' })
    const reset = resetConfigSection(v1, 'defaults')
    expect(reset.defaults).toBe(v1.defaults)
    expect(reset.providers.find(provider => provider.id === V1)).toMatchObject({ ocrMode: 'auto', tier: 'advanced' })
  })

  it('resets storage options but never the storage root', () => {
    const base = defaultMinerUConfig()
    const reset = resetConfigSection({ ...base, storage: { ...base.storage, storageRoot: '/data', cacheEnabled: false, stagingTtlMs: 1 } }, 'storage')
    expect(reset.storage).toEqual({ ...base.storage, storageRoot: '/data' })
  })
})

describe('unit fields', () => {
  it.each([1, 999, 1000, 1234, 2000, 86_399_999, 2 ** 40])('round-trips %d base units exactly through every scale', base => {
    for (const scale of [1, 1000, 3_600_000]) {
      expect(parseNumber(formatNumber(base, scale), scale, [1, Number.MAX_SAFE_INTEGER])).toBe(base)
    }
  })

  it('shows milliseconds as seconds and hours, and writes back base units', () => {
    const config = defaultMinerUConfig()
    expect(formatNumber(readNumber(config, NUMBER_FIELDS.pollInterval), 1000)).toBe('2')
    expect(formatNumber(readNumber(config, NUMBER_FIELDS.stagingTtl), 3_600_000)).toBe('24')
    const next = writeNumber(config, NUMBER_FIELDS.stagingTtl, parseNumber('1.5', 3_600_000, [1, Number.MAX_SAFE_INTEGER])!)
    expect(next.storage.stagingTtlMs).toBe(5_400_000)
    expect(config.storage.stagingTtlMs).toBe(86_400_000)
  })

  it('rejects empty, non-numeric, fractional base units and out-of-range values', () => {
    const bounds = NUMBER_FIELDS.retryAttempts.bounds(defaultMinerUConfig())
    for (const text of ['', ' ', 'abc', '1.5', '0', '11', 'Infinity']) expect(parseNumber(text, 1, bounds), text).toBeUndefined()
    expect(parseNumber(' 4 ', 1, bounds)).toBe(4)
    expect(parseNumber('0.0005', 1000, [1, 10_000])).toBeUndefined()
    expect(parseNumber('0.5', 1000, [1, 10_000])).toBe(500)
  })

  it('caps the retry delay at the configured maximum delay', () => {
    const config = defaultMinerUConfig()
    expect(NUMBER_FIELDS.retryDelay.bounds({ ...config, retry: { ...config.retry, maxDelayMs: 800 } })).toEqual([1, 800])
    expect(NUMBER_FIELDS.maxImages.bounds(config)).toEqual([0, 100])
  })
})

describe('credentials', () => {
  it('describes, stores trimmed values and clears through the credential service only', async () => {
    const describe = vi.fn(async () => ({ ok: true as const, value: { MINERU_API_KEY: { configured: true, source: 'file', writable: true } } }))
    const set = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const unset = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const credentials = { describe, set, unset } satisfies CredentialClient
    expect(await describeCredential(credentials, 'MINERU_API_KEY')).toEqual({ configured: true, source: 'file', writable: true })
    expect(await describeCredential(credentials, 'OTHER')).toEqual({ configured: false, writable: true })
    await storeCredential(credentials, 'MINERU_API_KEY', '  secret  ')
    expect(set).toHaveBeenCalledWith('MINERU_API_KEY', 'secret')
    await clearCredential(credentials, 'MINERU_API_KEY')
    expect(unset).toHaveBeenCalledWith('MINERU_API_KEY')
  })

  it('rejects blank keys locally and surfaces host rejections', async () => {
    const set = vi.fn(async () => ({ ok: false as const, error: { code: 'credential/rejected', message: 'read-only source', details: {} } }))
    const credentials = { describe: vi.fn(), set, unset: vi.fn() } satisfies CredentialClient
    await expect(storeCredential(credentials, 'K', '   ')).rejects.toThrow(/must not be empty/)
    expect(set).not.toHaveBeenCalled()
    await expect(storeCredential(credentials, 'K', 'v')).rejects.toThrow(/read-only source/)
  })

  it('has no credential reference for a blank name', () => {
    const official = defaultProviderConfig('official-v4')
    expect(credentialReference(undefined)).toBeUndefined()
    expect(credentialReference({ ...official, apiKeyEnv: '  ' })).toBeUndefined()
    expect(credentialReference({ ...official, apiKeyEnv: ' CUSTOM ' })).toBe('CUSTOM')
  })
})

describe('maintenance requests', () => {
  const clearReport = (patch: Partial<CacheClearReport>): CacheClearReport => ({
    generatedAt: 0, dryRun: true, eligible: true, activeOperationCount: 0, activeAccessCount: 0, confirmationToken: 'tok',
    plannedCount: 2, plannedBytes: 10, deletedCount: 0, deletedBytes: 0, skippedCount: 0,
    scan: { limit: 1, scanned: 1, truncated: false, diagnosticsLimit: 50, diagnosticsTruncated: false }, diagnostics: [], ...patch,
  })

  it('previews the cache clear read-only and confirms only with that preview token', () => {
    expect(cacheClearPreviewRequest()).toMatchObject({ dry_run: true })
    expect(cacheClearPreviewRequest()).not.toHaveProperty('confirm')
    expect(cacheClearConfirmRequest(clearReport({}))).toEqual({ dry_run: false, confirm: true, confirmation_token: 'tok', diagnostic_limit: 50 })
    expect(cacheClearConfirmRequest(clearReport({ eligible: false }))).toBeUndefined()
    expect(cacheClearConfirmRequest(clearReport({ confirmationToken: undefined }))).toBeUndefined()
    expect(cacheClearConfirmRequest(clearReport({ dryRun: false }))).toBeUndefined()
  })

  it('deletes only the quarantine entries the preview planned', () => {
    expect(quarantinePreviewRequest([])).toBeUndefined()
    expect(quarantinePreviewRequest(['a', 'b'])).toEqual({ entry_ids: ['a', 'b'], dry_run: true })
    const entry = (id: string) => ({ id, byteUsage: 1, regularFileCount: 1, directoryCount: 1, modifiedAt: 0 })
    const preview: QuarantineCleanupReport = {
      generatedAt: 0, dryRun: true, requestedCount: 2, plannedCount: 1, plannedBytes: 1, deletedCount: 0,
      deletedBytes: 0, missingCount: 1, skippedCount: 0, entries: [entry('a')],
    }
    expect(quarantineConfirmRequest(preview)).toEqual({ entry_ids: ['a'], dry_run: false, confirm: true })
    expect(quarantineConfirmRequest({ ...preview, entries: [] })).toBeUndefined()
    expect(quarantineConfirmRequest({ ...preview, dryRun: false })).toBeUndefined()
  })

  it('toggles selections and flags partial statistics', () => {
    expect(toggleSelection(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleSelection(['a', 'b'], 'a')).toEqual(['b'])
    const area = { byteUsage: 1, logicalEntryCount: 1, regularFileCount: 1, directoryCount: 1, skippedSymlinkCount: 0,
      unexpectedEntryCount: 0, unreadableEntryCount: 0, depthLimitCount: 0, truncated: false, complete: true }
    const stats = { generatedAt: 0, publishedResults: area, staging: area, quarantine: area }
    expect(isPartialStatistics(stats)).toBe(false)
    expect(isPartialStatistics({ ...stats, staging: { ...area, truncated: true } })).toBe(true)
  })

  it('formats byte sizes and marks lower bounds', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1024)).toBe('1.00 KiB')
    expect(formatBytes(10 * 1024 * 1024)).toBe('10.0 MiB')
    expect(formatBytes(512, true)).toBe('≥ 512 B')
  })
})