import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientConnectionRpc, RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import type { MinerUConfig } from '../config/pure.js'
import type { ProbeView } from '../service/mineru-service.js'
import type { MineruKey } from './locales.js'
import {
  activateProvider,
  callRpc,
  clearCredential,
  credentialReference,
  describeCredential,
  ensureProviderProfiles,
  storeCredential,
  type CredentialClient,
  type CredentialView,
} from './helpers.js'
import { ProviderSection } from './sections/ProviderSection.js'
import { DefaultsSection } from './sections/DefaultsSection.js'
import { AdvancedSections } from './sections/AdvancedSections.js'
import { StorageOperations } from './StorageOperations.js'
import css from './SettingsPage.module.css'

export {
  activateProvider,
  clearCredential,
  credentialReference,
  describeCredential,
  ensureProviderProfiles,
  normalizeProviderDefaults,
  patchActiveProvider,
  storeCredential,
  updateConfigSection,
  type CredentialClient,
  type CredentialView,
} from './helpers.js'

export interface MineruSettingsInjected {
  readonly rpc: ClientConnectionRpc
  readonly credentials: CredentialClient
}

type SettingsPageProps = PropsRuntime<'settings.section'> & PropsLocale<'dsh-pdf-mineru'> & MineruSettingsInjected

type ConfigGetResult = RpcResult<{ readonly config: MinerUConfig }>
type ConfigSetResult = RpcResult<{ readonly config: MinerUConfig }>
type ProbeRpcResult = RpcResult<ProbeView>

interface CredentialState {
  readonly status: 'unavailable' | 'loading' | 'ready' | 'error'
  readonly ref?: string
  readonly view?: CredentialView
  readonly error?: string
}

export function SettingsPage({ rpc, credentials, t }: SettingsPageProps) {
  const [draft, setDraft] = useState<MinerUConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [credentialBusy, setCredentialBusy] = useState(false)
  const [credentialRevision, setCredentialRevision] = useState(0)
  const [credentialState, setCredentialState] = useState<CredentialState>({ status: 'unavailable' })
  const [txtToAutoNotice, setTxtToAutoNotice] = useState(false)
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
        setTxtToAutoNotice(false)
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

  const handleActivateProvider = useCallback((providerId: string) => {
    if (draft === null) return
    const next = activateProvider(draft, providerId)
    if (draft.defaults.parseMethod === 'txt' && next.defaults.parseMethod === 'auto') {
      setTxtToAutoNotice(true)
    }
    setDraft(next)
  }, [draft])

  if (loading || draft === null) {
    return (
      <section className={css.section}>
        <h2 className={css.title}>{t('page.title')}</h2>
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

  return (
    <section className={css.section}>
      <h2 className={css.title}>{t('page.title')}</h2>
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
      <ProviderSection
        draft={draft}
        setDraft={setDraft}
        activeProvider={activeProvider}
        activeCredentialRef={activeCredentialRef}
        apiKeyDraft={apiKeyDraft}
        setApiKeyDraft={setApiKeyDraft}
        credentialStateReady={credentialStateReady}
        credentialView={credentialView}
        credentialLocked={credentialLocked}
        credentialInputDisabled={credentialInputDisabled}
        credentialPlaceholder={credentialPlaceholder}
        credentialBusy={credentialBusy}
        credentialStatus={credentialState.status}
        credentialError={credentialState.error}
        onClearCredential={() => void clearStoredCredential()}
        onActivateProvider={handleActivateProvider}
        t={t}
      />

      {/* 2. Defaults */}
      <DefaultsSection
        draft={draft}
        setDraft={setDraft}
        activeProvider={activeProvider}
        txtToAutoNotice={txtToAutoNotice}
        onDismissTxtNotice={() => setTxtToAutoNotice(false)}
        t={t}
      />

      {/* 3, 5, 6, 7, 8. Storage, Polling, Retry, Output, Limits */}
      <AdvancedSections
        draft={draft}
        setDraft={setDraft}
        t={t}
      />

      <StorageOperations rpc={rpc} t={t} />
    </section>
  )
}
