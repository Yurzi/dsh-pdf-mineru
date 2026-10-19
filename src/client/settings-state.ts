import type { MinerUConfig } from '../config/model.js'
import type { ConfigResponse, RpcPayloads } from '../contracts/rpc.js'
import { activateProvider, ensureProviderProfiles, errorMessage, structurallyEqual } from './helpers.js'

export const SETTINGS_CONFLICT = 'mineru/conflict'

export type SaveStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'conflict' }

/** Shared default silently changed by a provider switch, shown beside its field while it still holds. */
export interface Adjustment {
  readonly providerId: string
  readonly field: 'model' | 'parseMethod'
  readonly value: string
}

export interface SettingsState {
  /** Last configuration the host confirmed. */
  readonly saved: MinerUConfig
  readonly draft: MinerUConfig
  readonly revision: number | null
  /** Typed but unsaved API keys, by credential reference. Never part of the config draft. */
  readonly keyDrafts: Readonly<Record<string, string>>
  readonly adjustments: readonly Adjustment[]
  readonly status: SaveStatus
}

export type SettingsAction =
  | { readonly type: 'loaded'; readonly response: ConfigResponse }
  | { readonly type: 'edit'; readonly update: (config: MinerUConfig) => MinerUConfig }
  | { readonly type: 'activate'; readonly providerId: string }
  | { readonly type: 'keyDraft'; readonly reference: string; readonly value: string }
  | { readonly type: 'discard' }
  | { readonly type: 'saveStarted' }
  | { readonly type: 'configSaved'; readonly response: ConfigResponse; readonly submitted: MinerUConfig }
  | { readonly type: 'keysStored'; readonly keys: readonly PendingKey[] }
  | { readonly type: 'saveFailed'; readonly error: unknown }
  | { readonly type: 'savedNoticeExpired' }

const IDLE: SaveStatus = { kind: 'idle' }

export function initialSettingsState(response: ConfigResponse): SettingsState {
  const config = ensureProviderProfiles(response.config)
  return { saved: config, draft: config, revision: response.revision, keyDrafts: {}, adjustments: [], status: IDLE }
}

/** Edits retire a transient "saved" notice but keep errors and conflicts visible until resolved. */
function afterEdit(status: SaveStatus): SaveStatus {
  return status.kind === 'saved' ? IDLE : status
}

export function classifySaveError(error: unknown): SaveStatus {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
  return code === SETTINGS_CONFLICT ? { kind: 'conflict' } : { kind: 'error', message: errorMessage(error) }
}

function adjustmentsFor(before: MinerUConfig, after: MinerUConfig): readonly Adjustment[] {
  const fields = (['model', 'parseMethod'] as const).filter(field => before.defaults[field] !== after.defaults[field])
  return fields.map(field => ({ providerId: after.activeProvider, field, value: after.defaults[field] }))
}

export function settingsReducer(state: SettingsState | null, action: SettingsAction): SettingsState | null {
  if (action.type === 'loaded') return initialSettingsState(action.response)
  if (state === null) return state
  switch (action.type) {
    case 'edit': {
      const draft = action.update(state.draft)
      return draft === state.draft ? state : { ...state, draft, status: afterEdit(state.status) }
    }
    case 'activate': {
      const draft = activateProvider(state.draft, action.providerId)
      if (draft === state.draft) return state
      return { ...state, draft, adjustments: adjustmentsFor(state.draft, draft), status: afterEdit(state.status) }
    }
    case 'keyDraft':
      return {
        ...state,
        keyDrafts: { ...state.keyDrafts, [action.reference]: action.value },
        status: afterEdit(state.status),
      }
    case 'discard':
      return { ...state, draft: state.saved, keyDrafts: {}, adjustments: [], status: IDLE }
    case 'saveStarted':
      return { ...state, status: { kind: 'saving' } }
    case 'configSaved': {
      const saved = ensureProviderProfiles(action.response.config)
      // Edits made while the request was in flight stay in the draft.
      const draft = structurallyEqual(state.draft, action.submitted) ? saved : state.draft
      return { ...state, saved, draft, revision: action.response.revision, adjustments: [] }
    }
    case 'keysStored': {
      // Only drafts still equal to what was stored are cleared; a key typed meanwhile stays pending.
      const keyDrafts = Object.fromEntries(Object.entries(state.keyDrafts).filter(([reference, value]) =>
        !action.keys.some(key => key.reference === reference && key.value === value.trim())))
      return { ...state, keyDrafts, status: { kind: 'saved' } }
    }
    case 'saveFailed':
      return { ...state, status: classifySaveError(action.error) }
    case 'savedNoticeExpired':
      return state.status.kind === 'saved' ? { ...state, status: IDLE } : state
  }
}

export interface PendingKey {
  readonly reference: string
  readonly value: string
}

export function pendingKeys(state: SettingsState): readonly PendingKey[] {
  return Object.entries(state.keyDrafts)
    .map(([reference, value]) => ({ reference, value: value.trim() }))
    .filter(entry => entry.value.length > 0)
}

export function isDirty(state: SettingsState): boolean {
  return !structurallyEqual(state.draft, state.saved) || pendingKeys(state).length > 0
}

/** The config.set request: the complete draft, bound to the revision it was edited from. */
export function savePayload(state: SettingsState): RpcPayloads['mineru/config.set'] {
  return state.revision === null ? { config: state.draft } : { config: state.draft, expected_revision: state.revision }
}

export type ActionBarMode = 'hidden' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict'

export function actionBarMode(state: SettingsState): ActionBarMode {
  switch (state.status.kind) {
    case 'saving': return 'saving'
    case 'conflict': return 'conflict'
    case 'error': return 'error'
    case 'saved': return isDirty(state) ? 'dirty' : 'saved'
    case 'idle': return isDirty(state) ? 'dirty' : 'hidden'
  }
}

/** Switch notices for the active provider whose adjusted value is still in the draft. */
export function visibleAdjustments(state: SettingsState): readonly Adjustment['field'][] {
  return state.adjustments
    .filter(adjustment => adjustment.providerId === state.draft.activeProvider
      && state.draft.defaults[adjustment.field] === adjustment.value)
    .map(adjustment => adjustment.field)
}