import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { ProviderConfig } from '../config/model.js'
import type { ProbeView } from '../contracts/probe.js'
import { callRpc, clearCredential, errorMessage, storeCredential, type CredentialClient } from './helpers.js'
import type { Translate } from './locales.js'
import { isDirty, pendingKeys, savePayload, type SettingsAction, type SettingsState } from './settings-state.js'

/** A credential-affecting mutation: Save may store keys, Remove clears one. */
export type CredentialMutation = 'save' | 'remove'

export interface MutationContext {
  readonly rpc: ClientConnectionRpc
  readonly credentials: CredentialClient
  readonly dispatch: (action: SettingsAction) => void
  /** The pending mutation, shared by Save and Remove so they never overlap. */
  readonly lock: { current: CredentialMutation | undefined }
  readonly lockChanged: (mutation: CredentialMutation | undefined) => void
  /** Stored credentials may have changed: advance the credential generation. */
  readonly credentialsChanged: () => void
  readonly credentialFailed: (message: string | undefined) => void
}

/** Runs `operation` only if no other credential mutation is pending; an overlapping request is refused. */
async function exclusive(context: MutationContext, mutation: CredentialMutation, operation: () => Promise<void>): Promise<void> {
  if (context.lock.current !== undefined) return
  context.lock.current = mutation
  context.lockChanged(mutation)
  try {
    await operation()
  } finally {
    context.lock.current = undefined
    context.lockChanged(undefined)
  }
}

/** Saves the config first, then the typed keys; a credential failure keeps the key draft dirty. */
export async function saveSettings(context: MutationContext, state: SettingsState): Promise<void> {
  if (!isDirty(state)) return
  await exclusive(context, 'save', async () => {
    const submitted = state.draft
    const keys = pendingKeys(state)
    context.dispatch({ type: 'saveStarted' })
    try {
      const response = await callRpc(context.rpc, 'mineru/config.set', savePayload(state))
      context.dispatch({ type: 'configSaved', response, submitted })
      for (const { reference, value } of keys) await storeCredential(context.credentials, reference, value)
      context.dispatch({ type: 'keysStored', keys })
      if (keys.length > 0) context.credentialsChanged()
    } catch (error) {
      context.dispatch({ type: 'saveFailed', error })
    }
  })
}

export async function removeCredential(context: MutationContext, reference: string): Promise<void> {
  await exclusive(context, 'remove', async () => {
    context.credentialFailed(undefined)
    try {
      await clearCredential(context.credentials, reference)
      context.dispatch({ type: 'keyDraft', reference, value: '' })
    } catch (error) {
      context.credentialFailed(errorMessage(error))
    }
    context.credentialsChanged()
  })
}

export type ProbeState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'testing' }
  | { readonly kind: 'done'; readonly view: ProbeView }
  | { readonly kind: 'failed'; readonly message: string }

export interface ProbeResult {
  readonly key: string
  readonly state: ProbeState
}

/** Identity of a connection test: the exact provider draft and the monotonic credential generation. */
export function probeKey(provider: ProviderConfig | undefined, credentialVersion: number): string {
  return JSON.stringify([provider, credentialVersion])
}

/** A result counts only for the identity it was launched with; any other draft or generation reads idle. */
export function currentProbe(result: ProbeResult | undefined, key: string): ProbeState {
  return result?.key === key ? result.state : { kind: 'idle' }
}

/** A connection test passes only when the service is available and did not reject the key. */
export function probeHealthy(view: ProbeView): boolean {
  return view.available && (view.authentication === 'valid' || view.authentication === 'not-configured')
}

/** How a connection test reads: a state dot, a headline and detail lines. */
export interface ProbeStatus {
  readonly dot: 'ongoing' | 'error' | 'warning' | 'done'
  readonly text: string
  readonly details: readonly string[]
}

/**
 * Describes a connection test. A failed check keeps the server's sanitized diagnostic as its detail,
 * so an upstream code such as `engine_dead` or `invalid_api_key` stays visible.
 */
export function describeProbe(state: ProbeState, t: Translate): ProbeStatus | undefined {
  switch (state.kind) {
    case 'idle': return undefined
    case 'testing': return { dot: 'ongoing', text: t('action.testing'), details: [] }
    case 'failed': return { dot: 'error', text: t('probe.failed', { message: state.message }), details: [] }
    case 'done': {
      const { view } = state
      if (!probeHealthy(view)) {
        const diagnostic = view.diagnostics?.trim()
        return {
          dot: 'warning',
          text: t(view.authentication === 'invalid' ? 'probe.authInvalid' : 'probe.unavailable'),
          details: diagnostic ? [diagnostic] : [],
        }
      }
      const details = [
        view.server_version === undefined ? '' : t('probe.version', { version: view.server_version }),
        view.available_tiers === undefined || view.available_tiers.length === 0 ? '' : t('probe.tiers', { tiers: view.available_tiers.join(', ') }),
      ].filter(Boolean)
      return { dot: 'done', text: t('probe.ok'), details }
    }
  }
}

/**
 * Tests `provider`; only the latest launch publishes, under its launch identity. Since the credential
 * generation only grows, a response from an older generation can never become current.
 */
export async function runProbe(
  rpc: ClientConnectionRpc,
  provider: ProviderConfig,
  key: string,
  sequence: { current: number },
  publish: (result: ProbeResult) => void,
): Promise<void> {
  const current = ++sequence.current
  publish({ key, state: { kind: 'testing' } })
  try {
    const view = await callRpc(rpc, 'mineru/probe', { provider })
    if (sequence.current === current) publish({ key, state: { kind: 'done', view } })
  } catch (error) {
    if (sequence.current === current) publish({ key, state: { kind: 'failed', message: errorMessage(error) } })
  }
}
