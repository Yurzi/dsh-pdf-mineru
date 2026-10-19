import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { MinerUConfig, ProviderConfig } from '../config/model.js'
import {
  activeProviderOf,
  callRpc,
  credentialReference,
  describeCredential,
  errorMessage,
  type CredentialClient,
  type CredentialView,
} from './helpers.js'
import {
  currentProbe,
  probeKey,
  removeCredential,
  runProbe,
  saveSettings,
  type CredentialMutation,
  type MutationContext,
  type ProbeResult,
} from './settings-operations.js'
import { settingsReducer, type SettingsState } from './settings-state.js'

export type LoadState = { readonly kind: 'loading' } | { readonly kind: 'failed'; readonly message: string } | { readonly kind: 'ready' }

export type CredentialState =
  | { readonly kind: 'none' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly view: CredentialView }
  | { readonly kind: 'failed'; readonly message: string }

const SAVED_NOTICE_MS = 2400

/** Credential status for one reference, re-read when the reference or `version` changes. */
function useCredentialView(credentials: CredentialClient, reference: string | undefined, version: number): CredentialState {
  const [result, setResult] = useState<{ readonly key: string; readonly state: CredentialState }>()
  const key = reference === undefined ? '' : reference + '#' + String(version)
  useEffect(() => {
    if (reference === undefined) return
    let cancelled = false
    describeCredential(credentials, reference).then(
      view => { if (!cancelled) setResult({ key, state: { kind: 'ready', view } }) },
      (error: unknown) => { if (!cancelled) setResult({ key, state: { kind: 'failed', message: errorMessage(error) } }) },
    )
    return () => { cancelled = true }
  }, [credentials, reference, key])
  if (reference === undefined) return { kind: 'none' }
  // A result for another reference or an older version is stale: show loading instead.
  return result?.key === key ? result.state : { kind: 'loading' }
}

/** Probe results are bound to the exact provider draft and credential generation they tested. */
function useProbe(rpc: ClientConnectionRpc, provider: ProviderConfig | undefined, credentialVersion: number) {
  const [result, setResult] = useState<ProbeResult>()
  const sequence = useRef(0)
  const key = probeKey(provider, credentialVersion)
  const test = async (): Promise<void> => {
    if (provider !== undefined) await runProbe(rpc, provider, key, sequence, setResult)
  }
  return { state: currentProbe(result, key), test }
}

export interface SettingsControllerOptions {
  readonly rpc: ClientConnectionRpc
  readonly credentials: CredentialClient
}

export function useSettingsController({ rpc, credentials }: SettingsControllerOptions) {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })
  const [state, dispatch] = useReducer(settingsReducer, null)
  const [credentialVersion, setCredentialVersion] = useState(0)
  const [credentialError, setCredentialError] = useState<string>()
  const [mutation, setMutation] = useState<CredentialMutation>()
  const lock = useRef<CredentialMutation>()
  const loadSequence = useRef(0)

  const reload = useCallback(async (): Promise<void> => {
    const current = ++loadSequence.current
    setLoad({ kind: 'loading' })
    try {
      const response = await callRpc(rpc, 'mineru/config.get', {})
      if (loadSequence.current !== current) return
      dispatch({ type: 'loaded', response })
      setLoad({ kind: 'ready' })
    } catch (error) {
      if (loadSequence.current === current) setLoad({ kind: 'failed', message: errorMessage(error) })
    }
  }, [rpc])

  useEffect(() => { void reload() }, [reload])

  const statusKind = state?.status.kind
  useEffect(() => {
    if (statusKind !== 'saved') return
    const timer = setTimeout(() => { dispatch({ type: 'savedNoticeExpired' }) }, SAVED_NOTICE_MS)
    return () => { clearTimeout(timer) }
  }, [statusKind])

  const provider = state === null ? undefined : activeProviderOf(state.draft)
  const reference = credentialReference(provider)
  const credential = useCredentialView(credentials, reference, credentialVersion)
  const probe = useProbe(rpc, provider, credentialVersion)

  const operations: MutationContext = {
    rpc,
    credentials,
    dispatch,
    lock,
    lockChanged: setMutation,
    credentialsChanged: () => { setCredentialVersion(version => version + 1) },
    credentialFailed: setCredentialError,
  }
  const save = async (): Promise<void> => { if (state !== null) await saveSettings(operations, state) }
  const removeKey = async (): Promise<void> => { if (reference !== undefined) await removeCredential(operations, reference) }

  return {
    load,
    reload,
    state,
    provider,
    credential: { reference, state: credential, error: credentialError, remove: removeKey },
    probe,
    /** Pending Save or key removal; conflicting controls stay disabled meanwhile. */
    mutation,
    edit: (update: (config: MinerUConfig) => MinerUConfig) => { dispatch({ type: 'edit', update }) },
    activate: (providerId: string) => { dispatch({ type: 'activate', providerId }) },
    setKeyDraft: (keyReference: string, value: string) => { dispatch({ type: 'keyDraft', reference: keyReference, value }) },
    discard: () => { dispatch({ type: 'discard' }) },
    save,
  }
}

export type SettingsController = ReturnType<typeof useSettingsController>
/** The controller once configuration has loaded. */
export type ReadySettings = SettingsController & { readonly state: SettingsState; readonly provider: ProviderConfig }
