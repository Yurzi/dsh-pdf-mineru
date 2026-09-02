import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientConnectionRpc, RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import { defaultProviderConfig, type MinerUConfig, type OfficialV4Config, type ProviderConfig, type SelfHostedV2Config } from '../config.js'
import { asProviderConfigId } from '../domain/ids.js'
import type { ArtifactKind, MinerUModel, ParseMethod } from '../domain/request.js'
import type { ProbeView } from '../service/mineru-service.js'
import type { MineruKey } from './locales.js'
import { StorageOperations } from './StorageOperations.js'
import css from './SettingsPage.module.css'

export interface MineruSettingsInjected {
  readonly rpc: ClientConnectionRpc
  readonly credentials: CredentialClient
}

export interface CredentialView {
  readonly configured: boolean
  readonly source?: string
  readonly writable: boolean
}

/** Normalized face: native Remote on newer DSH, adapter on RC2. */
export interface CredentialClient {
  describe(refs: string[]): Promise<RpcResult<Readonly<Record<string, CredentialView>>>>
  set(ref: string, value: string): Promise<RpcResult<void>>
  unset(ref: string): Promise<RpcResult<void>>
}

export type SettingsPageProps = PropsRuntime & PropsLocale<'dsh-pdf-mineru'> & MineruSettingsInjected & {
  /** The parent plugin card already supplies the page title. */
  readonly embedded?: boolean
}

type ConfigGetResult = RpcResult<{ readonly config: MinerUConfig }>
type ConfigSetResult = RpcResult<{ readonly config: MinerUConfig }>
type ProbeRpcResult = RpcResult<ProbeView>

interface CredentialState {
  readonly status: 'unavailable' | 'loading' | 'ready' | 'error'
  readonly ref?: string
  readonly view?: CredentialView
  readonly error?: string
}

const ALL_ARTIFACT_KINDS: readonly ArtifactKind[] = ['markdown', 'layout', 'model-output', 'content-list', 'images']

const PROVIDER_TYPES = ['self-hosted-v2', 'official-v4'] as const

export function ensureProviderProfiles(config: MinerUConfig): MinerUConfig {
  const providers = [...config.providers]
  for (const type of PROVIDER_TYPES) {
    if (providers.some(provider => provider.type === type)) continue
    const defaults = defaultProviderConfig(type)
    let id = defaults.id
    for (let suffix = 2; providers.some(provider => provider.id === id); suffix++) {
      id = asProviderConfigId(defaults.id + '_' + String(suffix))
    }
    providers.push({ ...defaults, id } as ProviderConfig)
  }
  return providers.length === config.providers.length ? config : { ...config, providers }
}

export function patchActiveProvider(
  config: MinerUConfig,
  patch: Partial<ProviderConfig>,
): MinerUConfig {
  const activeId = config.activeProvider
  const providers = config.providers.map(p => {
    if (p.id !== activeId) return p
    return { ...p, ...patch } as ProviderConfig
  })
  return { ...config, providers }
}

export function normalizeProviderDefaults(config: MinerUConfig, provider: ProviderConfig): MinerUConfig {
  if (provider.type !== 'official-v4') return config
  const model = provider.models.includes(config.defaults.model)
    ? config.defaults.model
    : provider.models[0]
  if (model === undefined) return config
  const parseMethod = config.defaults.parseMethod === 'txt' ? 'auto' : config.defaults.parseMethod
  if (model === config.defaults.model && parseMethod === config.defaults.parseMethod) return config
  return {
    ...config,
    defaults: { ...config.defaults, model, parseMethod, ocr: parseMethod === 'ocr' },
  }
}

export function activateProvider(config: MinerUConfig, providerId: string): MinerUConfig {
  const provider = config.providers.find(candidate => candidate.id === providerId)
  if (provider === undefined || provider.id === config.activeProvider) return config
  return normalizeProviderDefaults({ ...config, activeProvider: provider.id }, provider)
}

export function updateConfigSection<K extends keyof MinerUConfig>(
  config: MinerUConfig,
  section: K,
  patch: Partial<MinerUConfig[K]>,
): MinerUConfig {
  const current = config[section]
  if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
    return {
      ...config,
      [section]: {
        ...(current as unknown as Record<string, unknown>),
        ...patch,
      },
    }
  }
  return {
    ...config,
    [section]: patch as unknown as MinerUConfig[K],
  }
}

async function callRpc<T>(rpc: ClientConnectionRpc, endpoint: string, payload: unknown): Promise<T> {
  return rpc.call('/dsh-pdf-mineru-api', endpoint, payload) as Promise<T>
}

export function credentialReference(provider: ProviderConfig | undefined): string | undefined {
  const reference = provider?.apiKeyEnv?.trim()
  return reference === undefined || reference.length === 0 ? undefined : reference
}

export async function describeCredential(credentials: CredentialClient, reference: string): Promise<CredentialView> {
  const result = await credentials.describe([reference])
  if (!result.ok) throw new Error(result.error.message)
  return result.value[reference] ?? { configured: false, writable: true }
}

export async function storeCredential(
  credentials: CredentialClient,
  reference: string,
  value: string,
): Promise<void> {
  const secret = value.trim()
  if (secret.length === 0) throw new TypeError('API key must not be empty')
  const result = await credentials.set(reference, secret)
  if (!result.ok) throw new Error(result.error.message)
}

export async function clearCredential(credentials: CredentialClient, reference: string): Promise<void> {
  const result = await credentials.unset(reference)
  if (!result.ok) throw new Error(result.error.message)
}

export function SettingsPage({ rpc, credentials, t, embedded = false }: SettingsPageProps) {
  const [draft, setDraft] = useState<MinerUConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [credentialBusy, setCredentialBusy] = useState(false)
  const [credentialRevision, setCredentialRevision] = useState(0)
  const [credentialState, setCredentialState] = useState<CredentialState>({ status: 'unavailable' })
  const [testState, setTestState] = useState<{
    status: 'idle' | 'testing' | 'healthy' | 'unhealthy' | 'error'
    view?: ProbeView
    error?: string
  }>({ status: 'idle' })

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const result = await callRpc<ConfigGetResult>(rpc, 'mineru/config.get', {})
      if (result.ok) {
        setDraft(ensureProviderProfiles(result.value.config))
      } else {
        setError(result.error.message)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [rpc])

  useEffect(() => { void refresh() }, [refresh])

  const activeProviderDraft = draft?.providers.find(p => p.id === draft.activeProvider) ?? draft?.providers[0]
  const activeCredentialRef = credentialReference(activeProviderDraft)

  useEffect(() => {
    setApiKeyDraft('')
    if (activeCredentialRef === undefined) {
      setCredentialState({ status: 'unavailable' })
      return undefined
    }

    let stale = false
    setCredentialState({ status: 'loading', ref: activeCredentialRef })
    void describeCredential(credentials, activeCredentialRef).then(
      view => {
        if (!stale) setCredentialState({ status: 'ready', ref: activeCredentialRef, view })
      },
      err => {
        if (!stale) {
          setCredentialState({
            status: 'error',
            ref: activeCredentialRef,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      },
    )
    return () => { stale = true }
  }, [activeCredentialRef, credentialRevision, credentials])

  const save = useCallback(async () => {
    if (draft === null) return
    const reference = credentialReference(draft.providers.find(p => p.id === draft.activeProvider))
    const secret = apiKeyDraft.trim()
    setSaving(true)
    setError(undefined)
    setSaved(false)
    try {
      const result = await callRpc<ConfigSetResult>(rpc, 'mineru/config.set', { config: draft })
      if (result.ok) {
        setDraft(ensureProviderProfiles(result.value.config))
        if (secret.length > 0) {
          if (reference === undefined) throw new TypeError(t('credential.referenceRequired'))
          await storeCredential(credentials, reference, secret)
          setApiKeyDraft('')
          setCredentialRevision(value => value + 1)
        }
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } else {
        setError(result.error.message)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [apiKeyDraft, credentials, draft, rpc, t])

  const clearStoredCredential = useCallback(async () => {
    if (activeCredentialRef === undefined) return
    setCredentialBusy(true)
    setError(undefined)
    setSaved(false)
    try {
      await clearCredential(credentials, activeCredentialRef)
      setApiKeyDraft('')
      setCredentialRevision(value => value + 1)
      setTestState({ status: 'idle' })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCredentialBusy(false)
    }
  }, [activeCredentialRef, credentials])

  const testActiveProvider = useCallback(async () => {
    if (draft === null) return
    const active = draft.providers.find(p => p.id === draft.activeProvider)
    if (active === undefined) return

    setTestState({ status: 'testing' })
    try {
      const result = await callRpc<ProbeRpcResult>(rpc, 'mineru/probe', { provider: active })
      if (result.ok) {
        setTestState({
          status: result.value.available ? 'healthy' : 'unhealthy',
          view: result.value,
        })
      } else {
        setTestState({
          status: 'error',
          error: result.error.message,
        })
      }
    } catch (err: unknown) {
      setTestState({
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }, [draft, rpc])

  if (loading || draft === null) {
    return (
      <section className={css.section}>
        {!embedded && <h2 className={css.title}>{t('page.title')}</h2>}
        <div className={css.loading}>…</div>
      </section>
    )
  }

  const activeProvider = activeProviderDraft!
  const credentialStateReady = credentialState.status === 'ready' && credentialState.ref === activeCredentialRef
  const credentialView = credentialStateReady ? credentialState.view : undefined
  const credentialLocked = credentialView?.writable === false
  const credentialInputDisabled = saving || credentialBusy || activeCredentialRef === undefined || !credentialStateReady || credentialLocked
  const credentialPlaceholder = credentialView?.configured === true
    ? t('credential.placeholderStored')
    : t('credential.placeholderEmpty')

  const toggleArtifact = (kind: ArtifactKind): void => {
    const current = draft.defaults.artifacts
    let next: ArtifactKind[]
    if (current.includes(kind)) {
      if (kind === 'markdown') return // markdown is mandatory
      next = current.filter(k => k !== kind)
    } else {
      next = [...current, kind]
    }
    setDraft(prev => (prev === null ? prev : updateConfigSection(prev, 'defaults', { artifacts: next })))
  }

  const toggleOfficialModel = (model: MinerUModel): void => {
    if (activeProvider.type !== 'official-v4') return
    const current = activeProvider.models
    let next: MinerUModel[]
    if (current.includes(model)) {
      if (current.length <= 1 || draft.defaults.model === model) return
      next = current.filter(m => m !== model)
    } else {
      next = [...current, model]
    }
    setDraft(prev => (prev === null ? prev : patchActiveProvider(prev, { models: next })))
  }

  return (
    <section className={css.section}>
      {!embedded && <h2 className={css.title}>{t('page.title')}</h2>}
      {error !== undefined && (
        <div className={css.error}>
          <span>{error}</span>
          <button type="button" className={css.errorDismiss} onClick={() => setError(undefined)}>×</button>
        </div>
      )}

      {/* Action Bar */}
      <div className={css.actionBar}>
        <button
          type="button"
          className={css.primaryButton}
          disabled={saving || credentialBusy}
          onClick={() => void save()}
        >
          {saving ? '…' : saved ? t('action.saved') : t('action.save')}
        </button>
        <button
          type="button"
          className={css.secondaryButton}
          disabled={testState.status === 'testing'}
          onClick={() => void testActiveProvider()}
        >
          {testState.status === 'testing' ? t('action.testing') : t('action.test')}
        </button>
      </div>

      {/* Test Connection Result Box */}
      {testState.status !== 'idle' && (
        <div
          className={`${css.testResult} ${
            testState.status === 'healthy'
              ? css.testResultHealthy
              : testState.status === 'unhealthy' || testState.status === 'error'
                ? css.testResultError
                : css.testResultTesting
          }`}
        >
          {testState.status === 'testing' && <span>{t('action.testing')}</span>}
          {testState.status === 'error' && (
            <>
              <div className={css.testHeader}>{t('test.error')}</div>
              <div>{testState.error}</div>
            </>
          )}
          {(testState.status === 'healthy' || testState.status === 'unhealthy') && testState.view && (
            <>
              <div className={css.testHeader}>
                {testState.status === 'healthy' ? t('test.healthy') : t('test.unhealthy')} — {testState.view.provider}
              </div>
              <div className={css.testDetails}>
                <div>Auth: {testState.view.authentication} | Protocol: {testState.view.protocol_version}{testState.view.server_version ? ` | Server: v${testState.view.server_version}` : ''}</div>
                {testState.view.queue && (
                  <div>Queue: {testState.view.queue.processing ?? 0} active, {testState.view.queue.queued ?? 0} queued (max concurrent: {testState.view.queue.max_concurrent ?? 'N/A'})</div>
                )}
                {testState.view.diagnostics && <div>Diagnostics: {testState.view.diagnostics}</div>}
              </div>
            </>
          )}
        </div>
      )}

      {/* 1. Provider Settings */}
      <div className={css.editorGroup}>
        <h3 className={css.groupTitle}>{t('section.provider')}</h3>

        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.activeProvider')}</span>
            <select
              className={css.select}
              value={draft.activeProvider}
              onChange={event => setDraft(prev => prev === null ? prev : activateProvider(prev, event.target.value))}
            >
              {draft.providers.map(provider => (
                <option key={provider.id} value={provider.id}>
                  {t(provider.type === 'self-hosted-v2' ? 'provider.type.selfHosted' : 'provider.type.official')} — {provider.id}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.baseURL')}</span>
            <input
              className={css.input}
              value={activeProvider.baseURL}
              placeholder={t('field.baseURL.placeholder')}
              onChange={e => setDraft(prev => prev === null ? prev : patchActiveProvider(prev, { baseURL: e.target.value }))}
            />
          </label>

          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.apiKeyEnv')}</span>
            <input
              className={css.input}
              value={activeProvider.apiKeyEnv ?? ''}
              placeholder={t('field.apiKeyEnv.placeholder')}
              onChange={e => setDraft(prev => prev === null ? prev : patchActiveProvider(prev, { apiKeyEnv: e.target.value || undefined }))}
            />
            <span className={css.fieldHint}>{t('field.apiKeyEnv.hint')}</span>
          </label>
        </div>

        <div className={css.field}>
          <span className={css.fieldLabel}>{t('field.apiKey')}</span>
          <div className={css.credentialInputRow}>
            <input
              className={css.input}
              type="password"
              autoComplete="off"
              aria-label={t('field.apiKey')}
              value={apiKeyDraft}
              placeholder={credentialPlaceholder}
              disabled={credentialInputDisabled}
              onChange={event => setApiKeyDraft(event.target.value)}
            />
            <button
              type="button"
              className={css.secondaryButton}
              disabled={credentialInputDisabled || credentialView?.configured !== true}
              onClick={() => void clearStoredCredential()}
            >
              {credentialBusy ? t('action.clearingApiKey') : t('action.clearApiKey')}
            </button>
          </div>
          <span className={css.fieldHint}>
            {credentialState.status === 'loading'
              ? t('credential.loading')
              : credentialState.status === 'error'
                ? credentialState.error
                : activeCredentialRef === undefined
                  ? t('credential.referenceRequired')
                  : credentialLocked
                    ? t('credential.readOnly')
                    : credentialView?.configured === true
                      ? [t('credential.configured'), credentialView.source ? ` (${credentialView.source})` : ''].join('')
                      : t('credential.notConfigured')}
          </span>
        </div>

        {activeProvider.type === 'self-hosted-v2' && (
          <>
            <div className={css.row}>
              <label className={css.checkboxField}>
                <input
                  type="checkbox"
                  checked={(activeProvider as SelfHostedV2Config).allowInsecureHttp}
                  onChange={e => setDraft(prev => prev === null ? prev : patchActiveProvider(prev, { allowInsecureHttp: e.target.checked }))}
                />
                <span className={css.checkboxLabel}>{t('field.allowInsecureHttp')}</span>
              </label>
            </div>

            <div className={css.row}>
              <div className={css.field}>
                <span className={css.fieldLabel}>{t('field.modelMap.pipeline')}</span>
                <input
                  className={css.input}
                  list="mineru-modelmap-pipeline-options"
                  placeholder={t('field.modelMap.pipeline.placeholder')}
                  value={(activeProvider as SelfHostedV2Config).modelMap.pipeline}
                  onChange={e => {
                    const currentMap = (activeProvider as SelfHostedV2Config).modelMap
                    setDraft(prev => prev === null ? prev : patchActiveProvider(prev, { modelMap: { ...currentMap, pipeline: e.target.value } }))
                  }}
                />
                <datalist id="mineru-modelmap-pipeline-options">
                  <option value="pipeline">{t('field.modelMap.opt.pipeline')}</option>
                </datalist>
                <div className={css.chipGroup}>
                  <button
                    type="button"
                    className={`${css.chip} ${(activeProvider as SelfHostedV2Config).modelMap.pipeline === 'pipeline' ? css.chipActive : ''}`}
                    onClick={() => {
                      const currentMap = (activeProvider as SelfHostedV2Config).modelMap
                      setDraft(prev => prev === null ? prev : patchActiveProvider(prev, { modelMap: { ...currentMap, pipeline: 'pipeline' } }))
                    }}
                  >
                    <span>pipeline</span>
                    <span className={css.chipBadge}>({t('field.modelMap.chip.default')})</span>
                  </button>
                </div>
                <span className={css.fieldHint}>{t('field.modelMap.pipeline.hint')}</span>
              </div>

              <div className={css.field}>
                <span className={css.fieldLabel}>{t('field.modelMap.vlm')}</span>
                <input
                  className={css.input}
                  list="mineru-modelmap-vlm-options"
                  placeholder={t('field.modelMap.vlm.placeholder')}
                  value={(activeProvider as SelfHostedV2Config).modelMap.vlm}
                  onChange={e => {
                    const currentMap = (activeProvider as SelfHostedV2Config).modelMap
                    setDraft(prev => prev === null ? prev : patchActiveProvider(prev, { modelMap: { ...currentMap, vlm: e.target.value } }))
                  }}
                />
                <datalist id="mineru-modelmap-vlm-options">
                  <option value="hybrid-engine">{t('field.modelMap.opt.hybridEngine')}</option>
                  <option value="vlm-engine">{t('field.modelMap.opt.vlmEngine')}</option>
                </datalist>
                <div className={css.chipGroup}>
                  {([
                    { value: 'hybrid-engine', badge: t('field.modelMap.chip.recommended') },
                    { value: 'vlm-engine', badge: t('field.modelMap.chip.vlmEngine') },
                  ] as const).map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`${css.chip} ${(activeProvider as SelfHostedV2Config).modelMap.vlm === opt.value ? css.chipActive : ''}`}
                      onClick={() => {
                        const currentMap = (activeProvider as SelfHostedV2Config).modelMap
                        setDraft(prev => prev === null ? prev : patchActiveProvider(prev, { modelMap: { ...currentMap, vlm: opt.value } }))
                      }}
                    >
                      <span>{opt.value}</span>
                      <span className={css.chipBadge}>({opt.badge})</span>
                    </button>
                  ))}
                </div>
                <span className={css.fieldHint}>{t('field.modelMap.vlm.hint')}</span>
              </div>
            </div>
          </>
        )}

        {activeProvider.type === 'official-v4' && (
          <div className={css.field}>
            <span className={css.fieldLabel}>{t('field.officialModels')}</span>
            <div className={css.checkboxGroup}>
              {(['pipeline', 'vlm'] as const).map(m => (
                <label key={m} className={css.checkboxOption}>
                  <input
                    type="checkbox"
                    checked={(activeProvider as OfficialV4Config).models.includes(m)}
                    disabled={draft.defaults.model === m}
                    onChange={() => toggleOfficialModel(m)}
                  />
                  <span>{t(m === 'pipeline' ? 'model.pipeline' : 'model.vlm')}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 2. Defaults */}
      <div className={css.editorGroup}>
        <h3 className={css.groupTitle}>{t('section.defaults')}</h3>

        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.defaultModel')}</span>
            <select
              className={css.select}
              value={draft.defaults.model}
              onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'defaults', { model: e.target.value as MinerUModel }))}
            >
              {(activeProvider.type === 'official-v4' ? activeProvider.models : (['pipeline', 'vlm'] as const)).map(model => (
                <option key={model} value={model}>{t(model === 'pipeline' ? 'model.pipeline' : 'model.vlm')}</option>
              ))}
            </select>
          </label>

          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.defaultParseMethod')}</span>
            <select
              className={css.select}
              value={draft.defaults.parseMethod}
              onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'defaults', { parseMethod: e.target.value as ParseMethod, ocr: e.target.value === 'ocr' }))}
            >
              <option value="auto">{t('parse.auto')}</option>
              {activeProvider.type === 'self-hosted-v2' && <option value="txt">{t('parse.txt')}</option>}
              <option value="ocr">{t('parse.ocr')}</option>
            </select>
          </label>

          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.defaultLang')}</span>
            <input
              className={css.input}
              value={draft.defaults.language}
              onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'defaults', { language: e.target.value }))}
            />
          </label>
        </div>

        <div className={css.row}>
          <label className={css.checkboxField}>
            <input
              type="checkbox"
              checked={draft.defaults.formula}
              onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'defaults', { formula: e.target.checked }))}
            />
            <span className={css.checkboxLabel}>{t('field.defaultFormula')}</span>
          </label>

          <label className={css.checkboxField}>
            <input
              type="checkbox"
              checked={draft.defaults.table}
              onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'defaults', { table: e.target.checked }))}
            />
            <span className={css.checkboxLabel}>{t('field.defaultTable')}</span>
          </label>
        </div>

        <div className={css.field}>
          <span className={css.fieldLabel}>{t('field.defaultArtifacts')}</span>
          <div className={css.checkboxGroup}>
            {ALL_ARTIFACT_KINDS.map(kind => (
              <label key={kind} className={css.checkboxOption}>
                <input
                  type="checkbox"
                  checked={draft.defaults.artifacts.includes(kind)}
                  disabled={kind === 'markdown'}
                  onChange={() => toggleArtifact(kind)}
                />
                <span>{t(`artifact.${kind}` as MineruKey)}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* 3. Storage & Cache */}
      <div className={css.editorGroup}>
        <h3 className={css.groupTitle}>{t('section.storage')}</h3>

        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.storageRoot')}</span>
            <input
              className={css.input}
              value={draft.storage.storageRoot}
              readOnly
              disabled
              title="Storage root changes require editing plugin configuration and restarting the plugin."
            />
          </label>

          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.stagingTtlMs')}</span>
            <input
              className={css.input}
              type="number"
              value={draft.storage.stagingTtlMs}
              onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'storage', { stagingTtlMs: Number(e.target.value) }))}
            />
          </label>
        </div>

        <div className={css.row}>
          <label className={css.checkboxField}>
            <input
              type="checkbox"
              checked={draft.storage.cacheEnabled}
              onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'storage', { cacheEnabled: e.target.checked }))}
            />
            <span className={css.checkboxLabel}>{t('field.cacheEnabled')}</span>
          </label>
        </div>
      </div>

      <StorageOperations rpc={rpc} t={t} />

      {/* 5. Polling & Timeouts */}
      <div className={css.editorGroup}>
        <h3 className={css.groupTitle}>{t('section.polling')}</h3>

        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.pollIntervalMs')}</span>
            <input
              className={css.input}
              type="number"
              value={draft.polling.pollIntervalMs}
              onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'polling', { pollIntervalMs: Number(e.target.value) }))}
            />
          </label>

          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.pollTimeoutMs')}</span>
            <input
              className={css.input}
              type="number"
              value={draft.polling.pollTimeoutMs}
              onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'polling', { pollTimeoutMs: Number(e.target.value) }))}
            />
          </label>
        </div>

        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.requestTimeoutMs')}</span>
            <input
              className={css.input}
              type="number"
              value={draft.polling.requestTimeoutMs}
              onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'polling', { requestTimeoutMs: Number(e.target.value) }))}
            />
          </label>

          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.operationTimeoutMs')}</span>
            <input
              className={css.input}
              type="number"
              value={draft.polling.operationTimeoutMs}
              onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'polling', { operationTimeoutMs: Number(e.target.value) }))}
            />
          </label>
        </div>
      </div>

      {/* 6. Retry Policy */}
      <div className={css.editorGroup}>
        <h3 className={css.groupTitle}>{t('section.retry')}</h3>

        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.retryMaxAttempts')}</span>
            <input
              className={css.input}
              type="number"
              min={1}
              max={10}
              value={draft.retry.maxAttempts}
              onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'retry', { maxAttempts: Number(e.target.value) }))}
            />
          </label>

          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.retryBaseDelayMs')}</span>
            <input
              className={css.input}
              type="number"
              min={1}
              max={60000}
              value={draft.retry.baseDelayMs}
              onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'retry', { baseDelayMs: Number(e.target.value) }))}
            />
          </label>

          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.retryMaxDelayMs')}</span>
            <input
              className={css.input}
              type="number"
              min={1}
              max={300000}
              value={draft.retry.maxDelayMs}
              onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'retry', { maxDelayMs: Number(e.target.value) }))}
            />
          </label>
        </div>
      </div>

      {/* 7. Output Limits */}
      <div className={css.editorGroup}>
        <h3 className={css.groupTitle}>{t('section.output')}</h3>

        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.maxInlineChars')}</span>
            <input
              className={css.input}
              type="number"
              value={draft.output.maxInlineChars}
              onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'output', { maxInlineChars: Number(e.target.value) }))}
            />
          </label>
        </div>
      </div>

      {/* 8. Security Limits */}
      <div className={css.editorGroup}>
        <h3 className={css.groupTitle}>{t('section.limits')}</h3>

        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.maxFilesPerRequest')}</span>
            <input
              className={css.input}
              type="number"
              value={draft.limits.maxFilesPerRequest}
              onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'limits', { maxFilesPerRequest: Number(e.target.value) }))}
            />
          </label>

          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.maxFileBytes')}</span>
            <input
              className={css.input}
              type="number"
              value={draft.limits.maxFileBytes}
              onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'limits', { maxFileBytes: Number(e.target.value) }))}
            />
          </label>
        </div>

        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.maxApiResponseBytes')}</span>
            <input
              className={css.input}
              type="number"
              value={draft.limits.maxApiResponseBytes}
              onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'limits', { maxApiResponseBytes: Number(e.target.value) }))}
            />
          </label>

          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.maxZipDownloadBytes')}</span>
            <input
              className={css.input}
              type="number"
              value={draft.limits.maxZipDownloadBytes}
              onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'limits', { maxZipDownloadBytes: Number(e.target.value) }))}
            />
          </label>
        </div>

        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.maxZipEntries')}</span>
            <input
              className={css.input}
              type="number"
              value={draft.limits.maxZipEntries}
              onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'limits', { maxZipEntries: Number(e.target.value) }))}
            />
          </label>

          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.maxZipEntryBytes')}</span>
            <input
              className={css.input}
              type="number"
              value={draft.limits.maxZipEntryBytes}
              onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'limits', { maxZipEntryBytes: Number(e.target.value) }))}
            />
          </label>
        </div>

        <div className={css.row}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.maxZipTotalBytes')}</span>
            <input
              className={css.input}
              type="number"
              value={draft.limits.maxZipTotalBytes}
              onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'limits', { maxZipTotalBytes: Number(e.target.value) }))}
            />
          </label>

          <label className={css.field}>
            <span className={css.fieldLabel}>{t('field.maxZipCompressionRatio')}</span>
            <input
              className={css.input}
              type="number"
              value={draft.limits.maxZipCompressionRatio}
              onChange={e => setDraft(prev => prev === null ? prev : updateConfigSection(prev, 'limits', { maxZipCompressionRatio: Number(e.target.value) }))}
            />
          </label>
        </div>
      </div>
    </section>
  )
}
